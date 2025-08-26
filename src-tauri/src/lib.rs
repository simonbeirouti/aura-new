// Session management module
mod session;
// Database management module
mod database;
// Enhanced store management module
mod enhanced_store;

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

// Import required for environment variable loading
#[cfg(not(target_os = "ios"))]
use dotenv;

// Load environment variables with cross-platform handling
fn load_environment_variables() {
    #[cfg(debug_assertions)]
    println!("Loading environment variables for cross-platform compatibility");
    
    // On desktop platforms, try to load .env file at runtime
    #[cfg(not(target_os = "ios"))]
    {
        let env_paths = [
            ".env",           // Current directory
            "../.env",        // Parent directory (common for Tauri apps)
            "../../.env",     // Two levels up
            "src-tauri/.env", // From project root
        ];
        
        let mut loaded = false;
        
        // Try each path until one works
        for path in &env_paths {
            if let Ok(_) = dotenv::from_path(path) {
                #[cfg(debug_assertions)]
                println!("Loaded runtime environment variables from: {}", path);
                loaded = true;
                break;
            }
        }
        
        if !loaded {
            #[cfg(debug_assertions)]
            println!("No .env file found at runtime, using compile-time variables");
        }
    }
    
    // On iOS and other mobile platforms, rely on compile-time variables
    #[cfg(target_os = "ios")]
    {
        #[cfg(debug_assertions)]
        println!("iOS platform detected - using compile-time environment variables");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file with platform-specific handling
    load_environment_variables();
    
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init());
    
    // Enable IAP plugin for mobile platforms
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        builder = builder.plugin(tauri_plugin_iap::init());
        #[cfg(debug_assertions)]
        println!("IAP plugin enabled for mobile platform");
    }
    
    // Disable IAP plugin for desktop platforms to prevent Swift concurrency crashes
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        #[cfg(debug_assertions)]
        println!("IAP plugin disabled on desktop platforms to prevent Swift concurrency crashes");
    }
    
    builder
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
            enhanced_store::store_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
