use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener};
use tauri_plugin_notification::{NotificationExt, PermissionState};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub show_badge: bool,
    pub play_sound: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationAction {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub requires_authentication: bool,
    #[serde(default)]
    pub foreground: bool,
    #[serde(default)]
    pub destructive: bool,
    #[serde(default)]
    pub input: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_button_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_placeholder: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionType {
    pub id: String,
    pub actions: Vec<NotificationAction>,
}


impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            show_badge: true,
            play_sound: true,
        }
    }
}

#[tauri::command]
pub async fn request_notification_permission(app: AppHandle) -> Result<bool, String> {
    match app.notification().permission_state() {
        Ok(PermissionState::Granted) => Ok(true),
        Ok(PermissionState::Denied) => Ok(false),
        Ok(PermissionState::Prompt) | Ok(PermissionState::PromptWithRationale) => {
            match app.notification().request_permission() {
                Ok(PermissionState::Granted) => Ok(true),
                _ => Ok(false),
            }
        }
        Err(e) => Err(format!("Failed to check permission: {}", e)),
    }
}

#[tauri::command]
pub async fn send_notification(
    app: AppHandle,
    title: String,
    body: String,
    icon: Option<String>,
) -> Result<(), String> {
    let settings = get_notification_settings_internal().await?;
    
    if !settings.enabled {
        return Ok(());
    }

    let mut builder = app.notification().builder()
        .title(title)
        .body(body);

    if let Some(icon_path) = icon {
        builder = builder.icon(icon_path);
    }

    if settings.play_sound {
        builder = builder.sound("default");
    }

    match builder.show() {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to send notification: {}", e)),
    }
}

#[tauri::command]
pub async fn register_action_types(
    app: AppHandle,
    action_types: Vec<ActionType>,
) -> Result<(), String> {
    // Store action types for later use
    // In a real implementation, you'd register these with the notification system
    let _ = app.emit("action-types-registered", serde_json::json!({
        "action_types": action_types,
        "timestamp": chrono::Utc::now().to_rfc3339()
    }));
    
    println!("Registered {} action types", action_types.len());
    Ok(())
}

#[tauri::command]
pub async fn send_action_notification(
    app: AppHandle,
    title: String,
    body: String,
    action_type_id: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    let settings = get_notification_settings_internal().await?;
    
    if !settings.enabled {
        return Ok(());
    }

    let mut builder = app.notification().builder()
        .title(title.clone())
        .body(body.clone());

    if let Some(icon_path) = icon {
        builder = builder.icon(icon_path);
    }

    if settings.play_sound {
        builder = builder.sound("default");
    }

    // Set action type if provided
    if let Some(action_id) = action_type_id.clone() {
        builder = builder.action_type_id(action_id);
    }

    match builder.show() {
        Ok(_) => {
            // Emit event for frontend tracking
            let _ = app.emit("notification-sent", serde_json::json!({
                "title": title,
                "body": body,
                "action_type_id": action_type_id,
                "timestamp": chrono::Utc::now().to_rfc3339()
            }));
            Ok(())
        }
        Err(e) => Err(format!("Failed to send action notification: {}", e)),
    }
}



#[tauri::command]
pub async fn get_notification_settings() -> Result<NotificationSettings, String> {
    get_notification_settings_internal().await
}

#[tauri::command]
pub async fn update_notification_settings(
    settings: serde_json::Value,
) -> Result<NotificationSettings, String> {
    // Get current settings
    let mut current_settings = get_notification_settings_internal().await?;
    
    // Update only the provided fields
    if let Some(enabled) = settings.get("enabled").and_then(|v| v.as_bool()) {
        current_settings.enabled = enabled;
    }
    if let Some(show_badge) = settings.get("showBadge").and_then(|v| v.as_bool()) {
        current_settings.show_badge = show_badge;
    }
    if let Some(play_sound) = settings.get("playSound").and_then(|v| v.as_bool()) {
        current_settings.play_sound = play_sound;
    }
    
    // In a real app, you'd save this to a persistent store
    // For now, we'll just return the updated settings
    Ok(current_settings)
}

// Internal helper function
async fn get_notification_settings_internal() -> Result<NotificationSettings, String> {
    // In a real app, you'd load this from a persistent store
    // For now, return default settings
    Ok(NotificationSettings::default())
}

// Event handlers for notification interactions
pub fn setup_notification_handlers(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle_1 = app.clone();
    let app_handle_2 = app.clone();

    // Listen for notification actions
    app.listen("tauri://notification-action", move |event| {
        println!("Notification action received: {:?}", event.payload());

        // Parse the payload and extract action details
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let action_id = payload.get("actionId")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            let input = payload.get("input")
                .and_then(|v| v.as_str());

            // Create a clean payload for the frontend
            let frontend_payload = serde_json::json!({
                "actionId": action_id,
                "input": input,
                "timestamp": chrono::Utc::now().to_rfc3339()
            });

            // Emit to frontend
            let _ = app_handle_1.emit("notification-action-performed", frontend_payload);
        } else {
            // Fallback if payload parsing fails
            let _ = app_handle_1.emit("notification-action-performed", event.payload());
        }
    });

    // Listen for notification clicks
    app.listen("tauri://notification-click", move |event| {
        println!("Notification clicked: {:?}", event.payload());

        // Emit to frontend
        let _ = app_handle_2.emit("notification-clicked", event.payload());
    });

    Ok(())
}
