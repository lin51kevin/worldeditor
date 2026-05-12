mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::parse_opendrive,
            commands::write_opendrive,
            commands::get_version,
            commands::wgs84_to_gcj02,
            commands::gcj02_to_wgs84,
            commands::geo_to_utm,
            commands::utm_to_geo,
            // Plugin management
            commands::plugin_list,
            commands::plugin_get_script,
            commands::plugin_enable,
            commands::plugin_disable,
            commands::plugin_install,
            commands::plugin_unload,
        ])
        .setup(|app| {
            // Set window icon explicitly so dev mode also shows the correct taskbar icon.
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.ico");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

            // Initialize plugin registry in the app data directory
            let plugins_dir = app
                .path()
                .app_data_dir()
                .map(|d| d.join("plugins"))
                .unwrap_or_else(|_| std::path::PathBuf::from("plugins"));

            if let Err(e) = std::fs::create_dir_all(&plugins_dir) {
                log::warn!("Could not create plugins directory {:?}: {}", plugins_dir, e);
            }

            let mut registry = we_plugin_core::PluginRegistry::new(&plugins_dir);
            registry.discover();
            app.manage(we_plugin_core::SharedPluginRegistry::new(registry));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


