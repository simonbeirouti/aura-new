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
    println!("🛒 Tauri purchase_product called with user_id: {}, product_id: {}", user_id, product_id);

    let config = get_authenticated_db(&app).await?;
    println!("✅ Database config retrieved successfully");

    // Use the new database-level make_purchase function for atomic transactions
    // For Supabase RPC calls, we need to pass parameters in the request body
    let purchase_data = serde_json::json!({
        "p_user_id": user_id,
        "p_product_id": product_id
    });

    println!("📤 Making RPC call to make_purchase with data: {:?}", purchase_data);
    println!("🔗 RPC URL: {}/rpc/make_purchase", config.database_url);

    // Call the make_purchase PostgreSQL function
    println!("🔄 Calling make_db_request...");
    let response = match make_db_request(
        "POST",
        "rpc/make_purchase",
        Some(purchase_data),
        &config,
    ).await {
        Ok(resp) => {
            println!("✅ make_db_request succeeded");
            resp
        },
        Err(e) => {
            println!("❌ make_db_request failed: {}", e);
            return Err(format!("Database request failed: {}", e));
        }
    };

    println!("📥 RPC response received: {:?}", response);

    // Check if the purchase was successful
    let success = response["success"].as_bool().unwrap_or(false);
    if !success {
        let error_msg = response["error"]
            .as_str()
            .unwrap_or("Purchase failed - unknown error");
        println!("Purchase failed with error: {}", error_msg);
        return Err(error_msg.to_string());
    }

    // Extract purchase details from the response
    let purchase_id = response["purchase_id"]
        .as_str()
        .ok_or("Purchase ID not found in response")?
        .to_string();

    println!("Purchase successful, ID: {}", purchase_id);

    // Get the purchase details from the database to return complete information
    let purchase_response = make_db_request(
        "GET",
        &format!("purchases?id=eq.{}", purchase_id),
        None,
        &config,
    ).await?;

    let purchases: Vec<Purchase> = serde_json::from_value(purchase_response)
        .map_err(|e| format!("Failed to retrieve purchase details: {}", e))?;

    let purchase = purchases.first()
        .ok_or("Purchase not found after creation")?;

    Ok(purchase.clone())
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

#[derive(Debug, Serialize, Deserialize)]
pub struct PurchaseEligibility {
    pub can_purchase: bool,
    pub tokens_available: i64,
    pub token_cost: i64,
    pub tokens_needed: i64,
}

#[tauri::command]
pub async fn can_purchase_product(
    user_id: String,
    product_id: String,
    app: tauri::AppHandle
) -> Result<bool, String> {
    let config = get_authenticated_db(&app).await?;

    // Use the new database-level user_purchase_eligibility view
    println!("Checking purchase eligibility for user: {}, product: {}", user_id, product_id);

    let eligibility_response = make_db_request(
        "GET",
        &format!("user_purchase_eligibility?user_id=eq.{}&product_id=eq.{}", user_id, product_id),
        None,
        &config,
    ).await?;

    println!("Eligibility response: {:?}", eligibility_response);

    let eligibility: Vec<serde_json::Value> = serde_json::from_value(eligibility_response)
        .map_err(|e| format!("Failed to check purchase eligibility: {}", e))?;

    // Check if we have any results
    if eligibility.is_empty() {
        return Err("Product not found or not available".to_string());
    }

    // Get the first (and should be only) result
    let item = &eligibility[0];

    let can_purchase = item.get("can_purchase")
        .and_then(|v| v.as_i64())
        .map(|v| v == 1)
        .unwrap_or(false);

    let tokens_available = item.get("tokens_available")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let token_cost = item.get("token_cost")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    println!("Can purchase result: {}, tokens_available: {}, token_cost: {}", can_purchase, tokens_available, token_cost);

    // If cannot purchase due to insufficient tokens, return a specific error
    if !can_purchase && tokens_available < token_cost {
        return Err("INSUFFICIENT_TOKENS".to_string());
    }

    Ok(can_purchase)
}
