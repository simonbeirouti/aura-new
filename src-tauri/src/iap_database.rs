use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::command;

use crate::database::{get_authenticated_db, DatabaseConfig};

// IAP Transaction record matching the database schema
#[derive(Debug, Serialize, Deserialize)]
pub struct IAPTransactionRecord {
    pub id: Option<String>,
    pub user_id: String,
    pub transaction_id: String,
    pub product_id: String,
    pub product_type: String, // 'subscription' | 'consumable'
    pub purchase_token: String,
    pub order_id: Option<String>,
    pub package_name: Option<String>,
    pub purchase_time: String, // ISO timestamp
    pub purchase_state: i32,
    pub signature: Option<String>,
    pub original_json: Option<serde_json::Value>,
    pub is_acknowledged: bool,
}

// User Subscription record matching the database schema
#[derive(Debug, Serialize, Deserialize)]
pub struct UserSubscriptionRecord {
    pub id: Option<String>,
    pub user_id: String,
    pub iap_transaction_id: String,
    pub product_id: String,
    pub subscription_status: String, // 'active' | 'expired' | 'cancelled' | 'pending'
    pub start_date: String, // ISO timestamp
    pub expiry_time: Option<String>,
    pub renewal_date: Option<String>,
    pub cancellation_date: Option<String>,
    pub is_auto_renewing: bool,
}

// Token Transaction record matching the database schema
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenTransactionRecord {
    pub id: Option<String>,
    pub user_id: String,
    pub iap_transaction_id: Option<String>,
    pub transaction_type: String, // 'purchase' | 'usage' | 'refund' | 'bonus'
    pub token_amount: i32,
    pub description: Option<String>,
    pub product_id: Option<String>,
    pub feature_used: Option<String>,
}

// User Token Balance record
#[derive(Debug, Serialize, Deserialize)]
pub struct UserTokenBalance {
    pub total_tokens: i32,
    pub tokens_used: i32,
    pub tokens_available: i32,
}

// Get authenticated database configuration (reuse from database.rs)
async fn get_db_config(app: &tauri::AppHandle) -> Result<DatabaseConfig, String> {
    get_authenticated_db(app).await
}

/// Save IAP transaction to database
#[command]
pub async fn save_iap_transaction(
    transaction: IAPTransactionRecord,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/iap_transactions", db_config.database_url);
    
    let mut transaction_data = HashMap::new();
    transaction_data.insert("user_id", serde_json::json!(transaction.user_id));
    transaction_data.insert("transaction_id", serde_json::json!(transaction.transaction_id));
    transaction_data.insert("product_id", serde_json::json!(transaction.product_id));
    transaction_data.insert("product_type", serde_json::json!(transaction.product_type));
    transaction_data.insert("purchase_token", serde_json::json!(transaction.purchase_token));
    transaction_data.insert("purchase_time", serde_json::json!(transaction.purchase_time));
    transaction_data.insert("purchase_state", serde_json::json!(transaction.purchase_state));
    transaction_data.insert("is_acknowledged", serde_json::json!(transaction.is_acknowledged));
    
    
    if let Some(order_id) = transaction.order_id {
        transaction_data.insert("order_id", serde_json::json!(order_id));
    }
    if let Some(package_name) = transaction.package_name {
        transaction_data.insert("package_name", serde_json::json!(package_name));
    }
    if let Some(signature) = transaction.signature {
        transaction_data.insert("signature", serde_json::json!(signature));
    }
    if let Some(original_json) = transaction.original_json {
        transaction_data.insert("original_json", original_json);
    }
    
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .json(&transaction_data)
        .send()
        .await
        .map_err(|e| format!("Failed to save IAP transaction: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error saving IAP transaction: {}", error_text));
    }
    
    let saved_transactions: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse IAP transaction response: {}", e))?;
    
    let transaction_id = saved_transactions
        .first()
        .and_then(|t| t.get("id"))
        .and_then(|id| id.as_str())
        .ok_or("No transaction ID returned")?;
    
    Ok(transaction_id.to_string())
}

/// Save user subscription to database using upsert
#[command]
pub async fn save_user_subscription(
    subscription: UserSubscriptionRecord,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    // Use the upsert function instead of direct insert
    let url = format!("{}/rest/v1/rpc/upsert_user_subscription", db_config.database_url);
    
    let mut function_params = HashMap::new();
    function_params.insert("p_user_id", serde_json::json!(subscription.user_id));
    function_params.insert("p_iap_transaction_id", serde_json::json!(subscription.iap_transaction_id));
    function_params.insert("p_product_id", serde_json::json!(subscription.product_id));
    function_params.insert("p_subscription_status", serde_json::json!(subscription.subscription_status));
    function_params.insert("p_start_date", serde_json::json!(subscription.start_date));
    function_params.insert("p_is_auto_renewing", serde_json::json!(subscription.is_auto_renewing));
    
    if let Some(expiry_time) = subscription.expiry_time {
        function_params.insert("p_expiry_time", serde_json::json!(expiry_time));
    }
    if let Some(renewal_date) = subscription.renewal_date {
        function_params.insert("p_renewal_date", serde_json::json!(renewal_date));
    }
    if let Some(cancellation_date) = subscription.cancellation_date {
        function_params.insert("p_cancellation_date", serde_json::json!(cancellation_date));
    }
    
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .json(&function_params)
        .send()
        .await
        .map_err(|e| format!("Failed to upsert subscription: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error upserting subscription: {}", error_text));
    }
    
    Ok(())
}

/// Save token transaction to database
#[command]
pub async fn save_token_transaction(
    token_transaction: TokenTransactionRecord,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/token_transactions", db_config.database_url);
    
    let mut token_data = HashMap::new();
    token_data.insert("user_id", serde_json::json!(token_transaction.user_id));
    token_data.insert("transaction_type", serde_json::json!(token_transaction.transaction_type));
    token_data.insert("token_amount", serde_json::json!(token_transaction.token_amount));
    
    if let Some(iap_transaction_id) = token_transaction.iap_transaction_id {
        token_data.insert("iap_transaction_id", serde_json::json!(iap_transaction_id));
    }
    if let Some(description) = token_transaction.description {
        token_data.insert("description", serde_json::json!(description));
    }
    if let Some(product_id) = token_transaction.product_id {
        token_data.insert("product_id", serde_json::json!(product_id));
    }
    if let Some(feature_used) = token_transaction.feature_used {
        token_data.insert("feature_used", serde_json::json!(feature_used));
    }
    
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .json(&token_data)
        .send()
        .await
        .map_err(|e| format!("Failed to save token transaction: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error saving token transaction: {}", error_text));
    }
    
    Ok(())
}

/// Get user token balance
#[command]
pub async fn get_user_token_balance(
    user_id: String,
    app: tauri::AppHandle,
) -> Result<UserTokenBalance, String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/user_tokens", db_config.database_url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[("user_id", format!("eq.{}", user_id))])
        .send()
        .await
        .map_err(|e| format!("Failed to get token balance: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        
        // For 404 or similar, just return zero balance (new user)
        if status == 404 || error_text.contains("No rows found") {
            return Ok(UserTokenBalance {
                total_tokens: 0,
                tokens_used: 0,
                tokens_available: 0,
            });
        }
        
        return Err(format!("Database error getting token balance: {}", error_text));
    }
    
    let token_records: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token balance response: {}", e))?;
    
    if let Some(record) = token_records.first() {
        Ok(UserTokenBalance {
            total_tokens: record.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            tokens_used: record.get("tokens_used").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            tokens_available: record.get("tokens_available").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        })
    } else {
        // No record found, return zero balance
        Ok(UserTokenBalance {
            total_tokens: 0,
            tokens_used: 0,
            tokens_available: 0,
        })
    }
}

/// Get user subscriptions
#[command]
pub async fn get_user_subscriptions(
    user_id: String,
    app: tauri::AppHandle,
) -> Result<Vec<UserSubscriptionRecord>, String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/user_subscriptions", db_config.database_url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[("user_id", format!("eq.{}", user_id))])
        .send()
        .await
        .map_err(|e| format!("Failed to get subscriptions: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        
        // For 404 or similar, just return empty array (new user)
        if status == 404 || error_text.contains("No rows found") {
            return Ok(vec![]);
        }
        
        return Err(format!("Database error getting subscriptions: {}", error_text));
    }
    
    let subscription_records: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse subscriptions response: {}", e))?;
    
    let subscriptions = subscription_records
        .into_iter()
        .map(|record| UserSubscriptionRecord {
            id: record.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
            user_id: record.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            iap_transaction_id: record.get("iap_transaction_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            product_id: record.get("product_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            subscription_status: record.get("subscription_status").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            start_date: record.get("start_date").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            expiry_time: record.get("expiry_time").and_then(|v| v.as_str()).map(|s| s.to_string()),
            renewal_date: record.get("renewal_date").and_then(|v| v.as_str()).map(|s| s.to_string()),
            cancellation_date: record.get("cancellation_date").and_then(|v| v.as_str()).map(|s| s.to_string()),
            is_auto_renewing: record.get("is_auto_renewing").and_then(|v| v.as_bool()).unwrap_or(false),
        })
        .collect();
    
    Ok(subscriptions)
}

/// Check if a transaction already exists in the database
#[command]
pub async fn check_transaction_exists(
    user_id: String,
    transaction_id: String,
    purchase_token: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/iap_transactions", db_config.database_url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[
            ("user_id", format!("eq.{}", user_id)),
            ("transaction_id", format!("eq.{}", transaction_id)),
            ("purchase_token", format!("eq.{}", purchase_token)),
            ("select", "id".to_string())
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to check transaction existence: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        
        // For 404 or similar, transaction doesn't exist
        if status == 404 || error_text.contains("No rows found") {
            return Ok(false);
        }
        
        return Err(format!("Database error checking transaction existence: {}", error_text));
    }
    
    let transactions: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse transaction check response: {}", e))?;
    
    // If we found any matching transactions, it exists
    Ok(!transactions.is_empty())
}

/// Update subscription data (comprehensive update)
#[command]
pub async fn update_subscription_data(
    subscription_id: String,
    status: String,
    expiry_time: Option<String>,
    renewal_date: Option<String>,
    is_auto_renewing: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/user_subscriptions", db_config.database_url);
    
    let mut update_data = HashMap::new();
    update_data.insert("subscription_status", serde_json::json!(status));
    update_data.insert("is_auto_renewing", serde_json::json!(is_auto_renewing));
    update_data.insert("updated_at", serde_json::json!(chrono::Utc::now().to_rfc3339()));
    
    if let Some(expiry_time) = expiry_time {
        update_data.insert("expiry_time", serde_json::json!(expiry_time));
    }
    if let Some(renewal_date) = renewal_date {
        update_data.insert("renewal_date", serde_json::json!(renewal_date));
    }
    
    let response = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .query(&[("id", format!("eq.{}", subscription_id))])
        .json(&update_data)
        .send()
        .await
        .map_err(|e| format!("Failed to update subscription data: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error updating subscription data: {}", error_text));
    }
    
    Ok(())
}

/// Get user's token transactions (purchase history)
#[command]
pub async fn get_user_iap_transactions(
    user_id: String,
    app: tauri::AppHandle,
) -> Result<Vec<IAPTransactionRecord>, String> {
    println!("🔍 Getting token transactions for user: {}", user_id);
    
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/token_transactions", db_config.database_url);
    println!("🔍 Query URL: {}", url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[
            ("user_id", format!("eq.{}", user_id)),
            ("transaction_type", "eq.purchase".to_string()),
            ("order", "created_at.desc".to_string()) // Most recent first
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to get IAP transactions: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        
        println!("🚨 Database query failed - Status: {}, Error: {}", status, error_text);
        
        // For 404 or similar, just return empty array (new user)
        if status == 404 || error_text.contains("No rows found") {
            println!("📝 No transactions found for user (404/empty)");
            return Ok(vec![]);
        }
        
        return Err(format!("Database error getting IAP transactions: {}", error_text));
    }
    
    let transaction_records: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse IAP transactions response: {}", e))?;
    
    println!("🔍 Raw database response: {} records", transaction_records.len());
    
    let transactions: Vec<IAPTransactionRecord> = transaction_records
        .into_iter()
        .map(|record| IAPTransactionRecord {
            id: record.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
            user_id: record.get("user_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            transaction_id: record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), // Use token transaction ID
            product_id: record.get("product_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            product_type: "consumable".to_string(), // Token purchases are consumables
            purchase_token: record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), // Use token transaction ID as token
            order_id: None,
            package_name: None,
            purchase_time: record.get("created_at").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            purchase_state: 0, // All token transactions are successful (state 0)
            signature: None,
            original_json: None,
            is_acknowledged: true,
        })
        .collect();
    
    println!("🔍 Parsed {} transactions for user", transactions.len());
    for (i, tx) in transactions.iter().enumerate() {
        println!("  Transaction {}: product_id={}, purchase_state={}, purchase_time={}", 
                 i+1, tx.product_id, tx.purchase_state, tx.purchase_time);
    }
    
    Ok(transactions)
}

/// Update subscription status (legacy function for backward compatibility)
#[command]
pub async fn update_subscription_status(
    subscription_id: String,
    status: String,
    expiry_time: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let db_config = get_db_config(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/user_subscriptions", db_config.database_url);
    
    let mut update_data = HashMap::new();
    update_data.insert("subscription_status", serde_json::json!(status));
    update_data.insert("updated_at", serde_json::json!(chrono::Utc::now().to_rfc3339()));
    
    if let Some(expiry_time) = expiry_time {
        update_data.insert("expiry_time", serde_json::json!(expiry_time));
    }
    
    let response = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .query(&[("id", format!("eq.{}", subscription_id))])
        .json(&update_data)
        .send()
        .await
        .map_err(|e| format!("Failed to update subscription status: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error updating subscription status: {}", error_text));
    }
    
    Ok(())
}
