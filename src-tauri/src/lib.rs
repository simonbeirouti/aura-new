// Session management module
mod session;
// Database management module
mod database;
// Enhanced store management module
mod enhanced_store;
// IAP database management module
mod iap_database;
// Purchases management module
mod purchases;
// Biometric store management module
mod biometric_store;
// Notifications management module
mod notifications;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct PlatformInfo {
    os: String,
    arch: String,
}

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    let target_os = if cfg!(target_os = "ios") {
        "ios"
    } else if cfg!(target_os = "android") {
        "android"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        std::env::consts::OS
    };

    PlatformInfo {
        os: target_os.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_iap::init())
        .setup(|app| {
            #[cfg(mobile)]
            let _ = app.handle().plugin(tauri_plugin_biometric::init());
            
            // Setup notification handlers
            let _ = notifications::setup_notification_handlers(&app.handle());
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Platform information command
            get_platform_info,
            // Session management commands
            session::store_tokens,
            session::check_session,
            session::get_tokens,
            session::logout,
            session::update_tokens,
            // Database management commands
            database::init_database,
            database::test_database_connection,
            database::get_user_profile,
            database::update_user_profile,
            database::create_user_profile,
            database::check_username_availability,
            database::get_database_status,
            // Enhanced store management commands
            enhanced_store::store_get,
            enhanced_store::store_set,
            enhanced_store::store_get_metadata,
            enhanced_store::store_list,
            enhanced_store::store_clear,
            enhanced_store::store_backup,
            enhanced_store::store_restore,
            enhanced_store::store_sync,
            enhanced_store::store_validate,
            enhanced_store::store_health,
            // IAP database management commands
            iap_database::save_iap_transaction,
            iap_database::save_user_subscription,
            iap_database::save_token_transaction,
            iap_database::get_user_token_balance,
            iap_database::get_user_subscriptions,
            iap_database::check_transaction_exists,
            iap_database::update_subscription_data,
            iap_database::update_subscription_status,
            iap_database::get_user_iap_transactions,
            // Purchase management commands
            purchases::get_products,
            purchases::purchase_product,
            purchases::get_user_purchases,
            purchases::can_purchase_product,
            // Biometric store management commands
            biometric_store::get_biometric_settings,
            biometric_store::update_biometric_settings,
            biometric_store::check_biometric_availability,
            biometric_store::authenticate_biometric,
            biometric_store::set_biometric_enabled,
            biometric_store::should_authenticate_on_startup,
            // Notification management commands
            notifications::request_notification_permission,
            notifications::send_notification,
            notifications::send_action_notification,
            notifications::register_action_types,
            notifications::get_notification_settings,
            notifications::update_notification_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
