#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod library;
mod database;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database = database::initialize(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(database);
            app.manage(std::sync::Mutex::<Option<notify::RecommendedWatcher>>::new(None));
            if let Some(window) = app.get_webview_window("main") {
                let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
                window.set_icon(icon).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::scan_mp3_folders,
            library::read_track_artwork,
            library::read_track_lyrics,
            library::watch_library_folders,
            database::database_save_tracks,
            database::database_load_tracks,
            database::database_save_state,
            database::database_load_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEKTO");
}
