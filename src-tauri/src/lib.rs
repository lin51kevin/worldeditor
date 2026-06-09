mod commands;
mod pointcloud;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            commands::set_window_theme,
            commands::show_main_window,
            // Point cloud pipeline
            pointcloud::point_cloud_load,
            pointcloud::point_cloud_load_dir,
            pointcloud::point_cloud_free,
            pointcloud::point_cloud_render_buffer,
            pointcloud::point_cloud_extract_ground,
            pointcloud::point_cloud_extract_markings,
            pointcloud::point_cloud_vectorize,
            pointcloud::point_cloud_sample_ground,
        ])
        .setup(|app| {
            // Create the main window programmatically so we can call
            // disable_drag_drop_handler(), which prevents WebView2 from intercepting
            // OS-level file drops. Without this, HTML5 dragenter/dragover events for
            // in-app drag-and-drop (e.g. template panel → viewport) never fire in Tauri.
            //
            // The native title-bar theme is restored from the persisted preference so
            // the window opens with the correct colour on the first frame (no dark→light
            // flash), and the window starts hidden so the user never sees an unthemed
            // white flash before the webview paints — it is revealed by the frontend via
            // `show_main_window` once the first themed frame is rendered. The window AND
            // webview background colours are also set to the theme surface so even the
            // very first composited frame is never white.
            let (initial_theme, bg_color) =
                match commands::read_persisted_theme(app.handle()).as_str() {
                    "light" => (
                        tauri::Theme::Light,
                        tauri::window::Color(243, 243, 243, 255),
                    ),
                    _ => (tauri::Theme::Dark, tauri::window::Color(30, 30, 30, 255)),
                };
            //
            // NOTE: the window is intentionally built WITHOUT `.maximized(true)`. On
            // Windows the OS momentarily shows a hidden window to apply the maximized
            // state, which produced a "double launch" flash (window appears, disappears,
            // then reappears). Instead, `show_main_window` maximizes the still-hidden
            // window and reveals it in a single step once the UI is ready.
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("WorldEditor")
            .inner_size(1400.0, 900.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true)
            .visible(false)
            .theme(Some(initial_theme))
            .background_color(bg_color)
            .disable_drag_drop_handler()
            .build()?;

            // Safety net: if the frontend never calls `show_main_window` (e.g. an early
            // render error), reveal the window after a short delay so it can't stay
            // permanently hidden. `maximize()`/`show()` are idempotent.
            let fallback_window = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let _ = fallback_window.maximize();
                let _ = fallback_window.show();
            });

            // Set window icon explicitly so dev mode also shows the correct taskbar icon.
            let icon_bytes = include_bytes!("../icons/icon.ico");
            if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                let _ = window.set_icon(icon);
            }

            // Initialize plugin registry in the app data directory. Discovery scans the
            // filesystem for plugin manifests, so it runs on a background thread to keep
            // it off the startup critical path.
            let plugins_dir = app
                .path()
                .app_data_dir()
                .map(|d| d.join("plugins"))
                .unwrap_or_else(|_| std::path::PathBuf::from("plugins"));

            if let Err(e) = std::fs::create_dir_all(&plugins_dir) {
                log::warn!(
                    "Could not create plugins directory {:?}: {}",
                    plugins_dir,
                    e
                );
            }

            let shared_registry = we_plugin_core::SharedPluginRegistry::new(
                we_plugin_core::PluginRegistry::new(&plugins_dir),
            );
            let registry_handle = shared_registry.inner().clone();
            app.manage(shared_registry);
            std::thread::spawn(move || {
                registry_handle.write().discover();
            });

            // Backend store for loaded point clouds (keyed by opaque handle).
            app.manage(pointcloud::PointCloudStore::default());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
