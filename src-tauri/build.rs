fn main() {
    // Load environment variables at build time for cross-platform compatibility
    dotenv::dotenv().ok();

    tauri_build::build()
}
