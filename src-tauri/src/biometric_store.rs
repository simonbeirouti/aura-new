use serde::{Deserialize, Serialize};
use tauri::command;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BiometricSettings {
    pub enabled: bool,
    pub require_on_startup: bool,
    pub last_authenticated: Option<u64>,
    pub authentication_method: Option<String>, // "face_id", "touch_id", "fingerprint", etc.
}

impl Default for BiometricSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            require_on_startup: false,
            last_authenticated: None,
            authentication_method: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BiometricStatus {
    pub available: bool,
    pub enrolled: bool,
    pub error: Option<String>,
}

/// Get biometric settings from store
#[command]
pub async fn get_biometric_settings(app: tauri::AppHandle) -> Result<BiometricSettings, String> {
    let store = app.store("biometric.store").map_err(|e| e.to_string())?;
    
    match store.get("settings") {
        Some(value) => {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("Failed to deserialize biometric settings: {}", e))
        }
        None => Ok(BiometricSettings::default()),
    }
}

/// Update biometric settings in store
#[command]
pub async fn update_biometric_settings(
    settings: BiometricSettings,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store = app.store("biometric.store").map_err(|e| e.to_string())?;
    
    let settings_value = serde_json::to_value(&settings)
        .map_err(|e| format!("Failed to serialize biometric settings: {}", e))?;
    
    store.set("settings", settings_value);
    store.set("last_updated", serde_json::json!(chrono::Utc::now().timestamp_millis()));
    
    store.save().map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Check if biometric authentication is available on the device
#[command]
pub async fn check_biometric_availability(app: tauri::AppHandle) -> Result<BiometricStatus, String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_biometric::BiometricExt;
        
        match app.biometric().status() {
            Ok(status) => {
                Ok(BiometricStatus {
                    available: status.is_available,
                    enrolled: status.is_available, // If available, assume enrolled
                    error: status.error,
                })
            }
            Err(e) => Ok(BiometricStatus {
                available: false,
                enrolled: false,
                error: Some(e.to_string()),
            }),
        }
    }
    
    #[cfg(not(mobile))]
    {
        Ok(BiometricStatus {
            available: false,
            enrolled: false,
            error: Some("Biometric authentication not available on desktop".to_string()),
        })
    }
}

/// Perform biometric authentication
#[command]
pub async fn authenticate_biometric(
    reason: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_biometric::{BiometricExt, AuthOptions};
        
        let options = AuthOptions {
            allow_device_credential: false,
            cancel_title: Some("Authentication Required".to_string()),
            fallback_title: Some("Authentication failed".to_string()),
            title: Some("Aura Security".to_string()),
            subtitle: Some("Authenticate to access your secure data".to_string()),
            confirmation_required: Some(true),
        };
        
        match app.biometric().authenticate(reason, options) {
            Ok(_) => {
                // Update last authenticated timestamp
                let mut settings = get_biometric_settings(app.clone()).await?;
                settings.last_authenticated = Some(chrono::Utc::now().timestamp_millis() as u64);
                update_biometric_settings(settings, app).await?;
                
                Ok(true)
            }
            Err(e) => Err(format!("Biometric authentication failed: {}", e)),
        }
    }
    
    #[cfg(not(mobile))]
    {
        Err("Biometric authentication not available on desktop".to_string())
    }
}

/// Enable or disable biometric authentication
#[command]
pub async fn set_biometric_enabled(
    enabled: bool,
    require_on_startup: Option<bool>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut settings = get_biometric_settings(app.clone()).await?;
    
    settings.enabled = enabled;
    if let Some(require) = require_on_startup {
        settings.require_on_startup = require;
    }
    
    // If disabling, clear authentication method
    if !enabled {
        settings.authentication_method = None;
        settings.last_authenticated = None;
    }
    
    update_biometric_settings(settings, app).await
}

/// Check if user should be prompted for biometric authentication on startup
#[command]
pub async fn should_authenticate_on_startup(app: tauri::AppHandle) -> Result<bool, String> {
    let settings = get_biometric_settings(app.clone()).await?;
    
    if !settings.enabled || !settings.require_on_startup {
        return Ok(false);
    }
    
    // Check if biometric is available
    let status = check_biometric_availability(app).await?;
    
    Ok(status.available && status.enrolled)
}
