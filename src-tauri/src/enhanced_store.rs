use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::command;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreMetadata {
    pub store_id: String,
    pub last_updated: u64,
    pub size: usize,
    pub version: u32,
}

/// Get data from a specific store
#[command]
pub async fn store_get(store_id: String, app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let store_file = format!("{}.store", store_id);
    let store = app.store(&store_file).map_err(|e| e.to_string())?;

    // Get the main data key for this store
    let data = store.get("data");
    
    Ok(data.map(|v| v.clone()))
}

/// Set data in a specific store
#[command]
pub async fn store_set(
    store_id: String,
    data: Value,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store_file = format!("{}.store", store_id);
    let store = app.store(&store_file).map_err(|e| e.to_string())?;

    // Store the data with metadata
    store.set("data", data);
    store.set("last_updated", serde_json::json!(chrono::Utc::now().timestamp_millis() as u64));
    store.set("version", serde_json::json!(1u32));

    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Get metadata for a specific store
#[command]
pub async fn store_get_metadata(
    store_id: String,
    app: tauri::AppHandle,
) -> Result<StoreMetadata, String> {
    let store_file = format!("{}.store", store_id);
    let store = app.store(&store_file).map_err(|e| e.to_string())?;

    let last_updated = store
        .get("last_updated")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let version = store
        .get("version")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;

    let size = store
        .get("data")
        .map(|v| v.to_string().len())
        .unwrap_or(0);

    Ok(StoreMetadata {
        store_id,
        last_updated,
        size,
        version,
    })
}

/// List all available stores
#[command]
pub async fn store_list(_app: tauri::AppHandle) -> Result<Vec<String>, String> {
    // This is a simplified implementation
    // In a real scenario, you'd scan the store directory
    let known_stores = vec![
        "session".to_string(),
        "app_data".to_string(),
        "app_config".to_string(),
        "ui_state".to_string(),
        "api_cache".to_string(),
    ];

    Ok(known_stores)
}

/// Clear a specific store
#[command]
pub async fn store_clear(store_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let store_file = format!("{}.store", store_id);
    let store = app.store(&store_file).map_err(|e| e.to_string())?;

    store.clear();
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Backup a store to a specific location
#[command]
pub async fn store_backup(
    store_id: String,
    backup_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store_file = format!("{}.store", store_id);
    let backup_file = format!("{}_backup_{}.store", store_id, backup_name);
    
    let store = app.store(&store_file).map_err(|e| e.to_string())?;
    let backup_store = app.store(&backup_file).map_err(|e| e.to_string())?;

    // Copy all data from original to backup
    if let Some(data) = store.get("data") {
        backup_store.set("data", data.clone());
    }
    
    backup_store.set("backup_timestamp", serde_json::json!(chrono::Utc::now().timestamp_millis()));
    backup_store.set("original_store", serde_json::json!(store_id));
    
    backup_store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Restore a store from backup
#[command]
pub async fn store_restore(
    store_id: String,
    backup_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store_file = format!("{}.store", store_id);
    let backup_file = format!("{}_backup_{}.store", store_id, backup_name);
    
    let store = app.store(&store_file).map_err(|e| e.to_string())?;
    let backup_store = app.store(&backup_file).map_err(|e| e.to_string())?;

    // Copy data from backup to original
    if let Some(data) = backup_store.get("data") {
        store.set("data", data.clone());
        store.set("restored_from", serde_json::json!(backup_name));
        store.set("restored_at", serde_json::json!(chrono::Utc::now().timestamp_millis()));
        
        store.save().map_err(|e| e.to_string())?;
    } else {
        return Err("Backup contains no data".to_string());
    }

    Ok(())
}

/// Sync store data with external source (placeholder for future implementation)
#[command]
pub async fn store_sync(
    store_id: String,
    _sync_endpoint: String,
    app: tauri::AppHandle,
) -> Result<HashMap<String, Value>, String> {
    let store_file = format!("{}.store", store_id);
    let store = app.store(&store_file).map_err(|e| e.to_string())?;

    // This is a placeholder implementation
    // In a real scenario, this would sync with an external API
    
    let mut result = HashMap::new();
    result.insert("status".to_string(), serde_json::json!("success"));
    result.insert("synced_at".to_string(), serde_json::json!(chrono::Utc::now().timestamp_millis()));
    result.insert("store_id".to_string(), serde_json::json!(store_id));

    // Update sync metadata in store
    store.set("last_sync", serde_json::json!(chrono::Utc::now().timestamp_millis()));
    store.save().map_err(|e| e.to_string())?;

    Ok(result)
}

/// Validate store integrity
#[command]
pub async fn store_validate(store_id: String, app: tauri::AppHandle) -> Result<bool, String> {
    let store_file = format!("{}.store", store_id);
    let store = app.store(&store_file).map_err(|e| e.to_string())?;

    // Basic validation - check if store has data and required metadata
    let has_data = store.get("data").is_some();
    let has_timestamp = store.get("last_updated").is_some();

    Ok(has_data && has_timestamp)
}

/// Get store health information
#[command]
pub async fn store_health(app: tauri::AppHandle) -> Result<HashMap<String, Value>, String> {
    let mut health = HashMap::new();
    
    // Check each known store
    let stores = vec!["session", "app_data", "app_config"];
    let mut store_status = HashMap::new();
    
    for store_id in stores {
        let store_file = format!("{}.store", store_id);
        match app.store(&store_file) {
            Ok(store) => {
                let has_data = store.get("data").is_some();
                let last_updated = store.get("last_updated").and_then(|v| v.as_u64()).unwrap_or(0);
                
                store_status.insert(store_id.to_string(), serde_json::json!({
                    "exists": true,
                    "has_data": has_data,
                    "last_updated": last_updated,
                    "healthy": has_data
                }));
            }
            Err(_) => {
                store_status.insert(store_id.to_string(), serde_json::json!({
                    "exists": false,
                    "healthy": false
                }));
            }
        }
    }
    
    health.insert("stores".to_string(), serde_json::json!(store_status));
    health.insert("timestamp".to_string(), serde_json::json!(chrono::Utc::now().timestamp_millis()));
    
    Ok(health)
}
