use serde::{Deserialize, Serialize};
use crate::database::{get_authenticated_db, DatabaseConfig};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: String,
    pub name: String,
    pub description: String,
    pub token_cost: i64,
    pub category: String,
    pub is_active: bool,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Purchase {
    pub id: String,
    pub user_id: String,
    pub product_id: String,
    pub token_cost: i64,
    pub purchase_status: String,
    pub transaction_id: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PurchaseRequest {
    pub user_id: String,
    pub product_id: String,
}

// HTTP client for database operations
async fn make_db_request(
    method: &str,
    endpoint: &str,
    body: Option<serde_json::Value>,
    config: &DatabaseConfig,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/{}", config.database_url, endpoint);
    
    let mut request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err("Unsupported HTTP method".to_string()),
    };
    
    request = request
        .header("apikey", &config.anon_key)
        .header("Authorization", format!("Bearer {}", config.access_token))
        .header("Content-Type", "application/json");
    
    if let Some(body) = body {
        request = request.json(&body);
    }
    
    let response = request.send().await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Database request failed with status {}: {}", status, error_text));
    }
    
    // Get response text first to debug empty responses
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    // Check if response is empty (common with Supabase POST operations)
    if response_text.is_empty() {
        // Return empty JSON object for successful operations with no response body
        return Ok(serde_json::json!({}));
    }
    
    // Parse the response text as JSON
    serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response JSON: {} (response: '{}')", e, response_text))
}

#[tauri::command]
pub async fn get_products(app: tauri::AppHandle) -> Result<Vec<Product>, String> {
    let config = get_authenticated_db(&app).await?;
    
    let response = make_db_request(
        "GET",
        "products?is_active=eq.true&order=category,name",
        None,
        &config,
    ).await?;
    
    let products: Vec<Product> = serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse products: {}", e))?;
    
    Ok(products)
}

#[tauri::command]
pub async fn purchase_product(
    user_id: String,
    product_id: String,
    app: tauri::AppHandle
) -> Result<Purchase, String> {
    let config = get_authenticated_db(&app).await?;
    
    // First, check if product exists and get its cost
    let product_response = make_db_request(
        "GET",
        &format!("products?id=eq.{}&is_active=eq.true", product_id),
        None,
        &config,
    ).await?;
    
    let products: Vec<Product> = serde_json::from_value(product_response)
        .map_err(|e| format!("Failed to parse product: {}", e))?;
    
    let product = products.first()
        .ok_or("Product not found or inactive")?;
    
    // Check user's token balance
    let balance_response = make_db_request(
        "GET",
        &format!("user_tokens?user_id=eq.{}", user_id),
        None,
        &config,
    ).await?;
    
    let balances: Vec<serde_json::Value> = serde_json::from_value(balance_response)
        .map_err(|e| format!("Failed to parse balance: {}", e))?;
    
    let balance = balances.first()
        .ok_or("User token balance not found")?;
    
    let total_tokens = balance["total_tokens"].as_i64().unwrap_or(0);
    let tokens_used = balance["tokens_used"].as_i64().unwrap_or(0);
    let available_tokens = total_tokens - tokens_used;
    
    if available_tokens < product.token_cost {
        return Err(format!("Insufficient tokens. Required: {}, Available: {}", product.token_cost, available_tokens));
    }
    
    let now = chrono::Utc::now();
    let now_rfc = now.to_rfc3339();
    
    // Generate unique purchase ID
    let purchase_id = format!("purchase_{}_{}_{}", user_id, product_id, now.timestamp_millis());
    
    // Create purchase record
    let purchase_data = serde_json::json!({
        "id": purchase_id,
        "user_id": user_id,
        "product_id": product_id,
        "token_cost": product.token_cost,
        "purchase_status": "completed",
        "created_at": now_rfc,
        "updated_at": now_rfc
    });
    
    let _purchase_response = make_db_request(
        "POST",
        "purchases",
        Some(purchase_data),
        &config,
    ).await?;
    
    // Purchase created successfully - use the ID we generated
    // No need to extract from response since we provided the ID
    
    // Update user token balance
    let new_tokens_used = tokens_used + product.token_cost;
    let balance_update = serde_json::json!({
        "tokens_used": new_tokens_used
    });
    
    make_db_request(
        "PATCH",
        &format!("user_tokens?user_id=eq.{}", user_id),
        Some(balance_update),
        &config,
    ).await?;
    
    // Create token transaction record
    let transaction_data = serde_json::json!({
        "user_id": user_id,
        "token_amount": -product.token_cost, // Negative for usage
        "transaction_type": "usage",
        "description": format!("Purchase: {}", product.name),
        "product_id": product_id,
        "created_at": now_rfc.clone(),
        "updated_at": now_rfc,
    });
    
    make_db_request(
        "POST",
        "token_transactions",
        Some(transaction_data),
        &config,
    ).await?;
    
    // Return the purchase
    Ok(Purchase {
        id: purchase_id,
        user_id,
        product_id,
        token_cost: product.token_cost,
        purchase_status: "completed".to_string(),
        transaction_id: None,
        metadata: None,
        created_at: now_rfc.clone(),
        updated_at: now_rfc,
    })
}

#[tauri::command]
pub async fn get_user_purchases(
    user_id: String,
    app: tauri::AppHandle
) -> Result<Vec<Purchase>, String> {
    let config = get_authenticated_db(&app).await?;
    
    let response = make_db_request(
        "GET",
        &format!("purchases?user_id=eq.{}&order=created_at.desc", user_id),
        None,
        &config,
    ).await?;
    
    let purchases: Vec<Purchase> = serde_json::from_value(response)
        .map_err(|e| format!("Failed to parse purchases: {}", e))?;
    
    Ok(purchases)
}

#[tauri::command]
pub async fn can_purchase_product(
    user_id: String,
    product_id: String,
    app: tauri::AppHandle
) -> Result<bool, String> {
    let config = get_authenticated_db(&app).await?;
    
    // Get product cost
    let product_response = make_db_request(
        "GET",
        &format!("products?id=eq.{}&is_active=eq.true", product_id),
        None,
        &config,
    ).await?;
    
    let products: Vec<Product> = serde_json::from_value(product_response)
        .map_err(|e| format!("Failed to parse product: {}", e))?;
    
    let product = match products.first() {
        Some(p) => p,
        None => return Ok(false), // Product doesn't exist or inactive
    };
    
    // Get user balance
    let balance_response = make_db_request(
        "GET",
        &format!("user_tokens?user_id=eq.{}", user_id),
        None,
        &config,
    ).await?;
    
    let balances: Vec<serde_json::Value> = serde_json::from_value(balance_response)
        .map_err(|e| format!("Failed to parse balance: {}", e))?;
    
    let balance = match balances.first() {
        Some(b) => b,
        None => return Ok(false), // User balance doesn't exist
    };
    
    let total_tokens = balance["total_tokens"].as_i64().unwrap_or(0);
    let tokens_used = balance["tokens_used"].as_i64().unwrap_or(0);
    let available_tokens = total_tokens - tokens_used;
    
    Ok(available_tokens >= product.token_cost)
}
