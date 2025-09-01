use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::command;
use tauri_plugin_store::StoreExt;

// Profile struct matching migrations/001_initial.sql schema exactly
#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub updated_at: Option<String>,
    pub username: Option<String>,
    pub full_name: Option<String>,
    pub avatar_url: Option<String>,
    pub onboarding_complete: Option<bool>,
    pub notifications: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub database_url: String,
    pub access_token: String,
    pub anon_key: String,
}

// Initialize database with provided configuration (called from frontend)
#[command]
pub async fn init_database(
    database_url: String,
    access_token: String,
    anon_key: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store = app.store("session.store")
        .map_err(|e| format!("Failed to access session store: {}", e))?;
    
    // Store the configuration for later use
    store.set("database_url", serde_json::json!(database_url));
    store.set("anon_key", serde_json::json!(anon_key));
    store.save().map_err(|e| e.to_string())?;
    
    Ok(())
}

// Get authenticated database configuration from session store
pub async fn get_authenticated_db(app: &tauri::AppHandle) -> Result<DatabaseConfig, String> {
    let store = app.store("session.store")
        .map_err(|e| format!("Failed to access session store: {}", e))?;
    
    // Get stored tokens (using same keys as session.rs)
    let access_token = store.get("sb-access-token")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or("No access token found in session")?;
    
    // Get stored configuration
    let anon_key = store.get("anon_key")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or("No anon key found in session")?;
    
    let database_url = store.get("database_url")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or("No database URL found in session")?;
    
    Ok(DatabaseConfig {
        database_url,
        access_token,
        anon_key,
    })
}

/// Test database connection
#[command]
pub async fn test_database_connection(app: tauri::AppHandle) -> Result<String, String> {
    let db_config = get_authenticated_db(&app).await?;
    
    // Test connection by making a simple request
    let client = reqwest::Client::new();
    let url = format!("{}/rest/v1/profiles", db_config.database_url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[("select", "id"), ("limit", "1")])
        .send()
        .await
        .map_err(|e| format!("Database connection failed: {}", e))?;
    
    if response.status().is_success() {
        Ok("Database initialized successfully".to_string())
    } else {
        Err(format!("Database connection test failed: {}", response.status()))
    }
}

/// Get user profile by ID
#[command]
pub async fn get_user_profile(
    user_id: String,
    app: tauri::AppHandle,
) -> Result<Option<Profile>, String> {
    let db_config = get_authenticated_db(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/profiles", db_config.database_url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[("id", format!("eq.{}", user_id))])
        .send()
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error: {}", error_text));
    }
    
    let profiles: Vec<Profile> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse profile response: {}", e))?;
    
    Ok(profiles.into_iter().next())
}

/// Update user profile
#[command]
pub async fn update_user_profile(
    user_id: String,
    username: Option<String>,
    full_name: Option<String>,
    avatar_url: Option<String>,
    onboarding_complete: Option<bool>,
    notifications: Option<bool>,
    app: tauri::AppHandle,
) -> Result<Option<Profile>, String> {
    let db_config = get_authenticated_db(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/profiles", db_config.database_url);
    
    let mut update_data = HashMap::new();
    if let Some(username) = username {
        update_data.insert("username", serde_json::json!(username));
    }
    if let Some(full_name) = full_name {
        update_data.insert("full_name", serde_json::json!(full_name));
    }
    if let Some(avatar_url) = avatar_url {
        update_data.insert("avatar_url", serde_json::json!(avatar_url));
    }
    if let Some(onboarding_complete) = onboarding_complete {
        update_data.insert("onboarding_complete", serde_json::json!(onboarding_complete));
    }
    if let Some(notifications) = notifications {
        update_data.insert("notifications", serde_json::json!(notifications));
    }
    update_data.insert("updated_at", serde_json::json!(chrono::Utc::now().to_rfc3339()));
    
    let response = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .query(&[("id", format!("eq.{}", user_id))])
        .json(&update_data)
        .send()
        .await
        .map_err(|e| format!("Failed to update profile: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error: {}", error_text));
    }
    
    let profiles: Vec<Profile> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse update response: {}", e))?;
    
    Ok(profiles.into_iter().next())
}

/// Create user profile
#[command]
pub async fn create_user_profile(
    user_id: String,
    username: Option<String>,
    full_name: Option<String>,
    avatar_url: Option<String>,
    onboarding_complete: Option<bool>,
    notifications: Option<bool>,
    app: tauri::AppHandle,
) -> Result<Option<Profile>, String> {
    let db_config = get_authenticated_db(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/profiles", db_config.database_url);
    
    let mut profile_data = HashMap::new();
    profile_data.insert("id", serde_json::json!(user_id));
    if let Some(username) = username {
        profile_data.insert("username", serde_json::json!(username));
    }
    if let Some(full_name) = full_name {
        profile_data.insert("full_name", serde_json::json!(full_name));
    }
    if let Some(avatar_url) = avatar_url {
        profile_data.insert("avatar_url", serde_json::json!(avatar_url));
    }
    if let Some(onboarding_complete) = onboarding_complete {
        profile_data.insert("onboarding_complete", serde_json::json!(onboarding_complete));
    }
    if let Some(notifications) = notifications {
        profile_data.insert("notifications", serde_json::json!(notifications));
    }
    profile_data.insert("updated_at", serde_json::json!(chrono::Utc::now().to_rfc3339()));
    
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .json(&profile_data)
        .send()
        .await
        .map_err(|e| format!("Failed to create profile: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error: {}", error_text));
    }
    
    let profiles: Vec<Profile> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse create response: {}", e))?;
    
    Ok(profiles.into_iter().next())
}

/// Check if username is available
#[command]
pub async fn check_username_availability(
    username: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let db_config = get_authenticated_db(&app).await?;
    let client = reqwest::Client::new();
    
    let url = format!("{}/rest/v1/profiles", db_config.database_url);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", db_config.access_token))
        .header("apikey", &db_config.anon_key)
        .query(&[
            ("username", format!("eq.{}", username)),
            ("select", "id".to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to check username: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Database error: {}", error_text));
    }
    
    let profiles: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse username check response: {}", e))?;
    
    // Username is available if no profiles found
    Ok(profiles.is_empty())
}

/// Get database status
#[command]
pub async fn get_database_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let db_config = get_authenticated_db(&app).await?;
    
    let mut status = serde_json::Map::new();
    status.insert("connected".to_string(), serde_json::json!(true));
    status.insert("database_url".to_string(), serde_json::json!(db_config.database_url));
    status.insert("has_access_token".to_string(), serde_json::json!(!db_config.access_token.is_empty()));
    status.insert("has_anon_key".to_string(), serde_json::json!(!db_config.anon_key.is_empty()));
    
    Ok(serde_json::Value::Object(status))
}
