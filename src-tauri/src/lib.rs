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
            // Create the main window programmatically so we can call
            // disable_drag_drop_handler(), which prevents WebView2 from intercepting
            // OS-level file drops. Without this, HTML5 dragenter/dragover events for
            // in-app drag-and-drop (e.g. template panel → viewport) never fire in Tauri.
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("WorldEditor")
            .inner_size(1400.0, 900.0)
            .min_inner_size(800.0, 600.0)
            .maximized(true)
            .resizable(true)
            .disable_drag_drop_handler()
            .build()?;

            // Set window icon explicitly so dev mode also shows the correct taskbar icon.
            let icon_bytes = include_bytes!("../icons/icon.ico");
            if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                let _ = window.set_icon(icon);
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


