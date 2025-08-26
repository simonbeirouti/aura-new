use serde::{Deserialize, Serialize};
use tauri::command;
use tauri_plugin_store::StoreExt;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokensRequest {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Serialize, Deserialize)]
pub struct TokensResponse {
    pub access_token: String,
    pub refresh_token: String,
}

/// Store authentication tokens in the secure store
#[command]
pub async fn store_tokens(tokens: TokensRequest, app: tauri::AppHandle) -> Result<(), String> {
    let access_token = tokens.access_token;
    let refresh_token = tokens.refresh_token;

    let store = app.store("session.store").map_err(|e| e.to_string())?;

    store.set("sb-access-token", serde_json::json!(access_token));
    store.set("sb-refresh-token", serde_json::json!(refresh_token));

    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Check if a session exists in the store
#[command]
pub async fn check_session(app: tauri::AppHandle) -> Result<bool, String> {
    let store = app.store("session.store").map_err(|e| e.to_string())?;

    let has_access = store.get("sb-access-token").is_some();
    let has_refresh = store.get("sb-refresh-token").is_some();

    let result = has_access && has_refresh;

    Ok(result)
}

/// Retrieve stored tokens
#[command]
pub async fn get_tokens(app: tauri::AppHandle) -> Result<TokensResponse, String> {
    let store = app.store("session.store").map_err(|e| e.to_string())?;

    let access_token = store
        .get("sb-access-token")
        .and_then(|v| v.as_str().map(String::from))
        .ok_or_else(|| "No access token found".to_string())?;

    let refresh_token = store
        .get("sb-refresh-token")
        .and_then(|v| v.as_str().map(String::from))
        .ok_or_else(|| "No refresh token found".to_string())?;

    Ok(TokensResponse {
        access_token,
        refresh_token,
    })
}

/// Clear stored session data (logout)
#[command]
pub async fn logout(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store("session.store").map_err(|e| e.to_string())?;

    store.delete("sb-access-token");
    store.delete("sb-refresh-token");
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Update stored tokens (for token refresh)
#[command]
pub async fn update_tokens(tokens: TokensRequest, app: tauri::AppHandle) -> Result<(), String> {
    // This is essentially the same as store_tokens, but semantically different
    store_tokens(tokens, app).await
}
