mod commands;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
