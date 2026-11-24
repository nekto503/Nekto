use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

pub struct Database(pub Mutex<Connection>);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTrack {
    pub id: String, pub title: String, pub artist: String, pub album: String,
    pub duration: String, pub folder: String, pub path: String, pub modified: u64,
}

pub fn initialize(app: &AppHandle) -> Result<Database, String> {
    let dir: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("nekto-music.sqlite3")).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS tracks (
           id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
           album TEXT NOT NULL, duration TEXT NOT NULL, folder TEXT NOT NULL,
           path TEXT NOT NULL UNIQUE, modified INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS app_state (
           key TEXT PRIMARY KEY, value TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );"
    ).map_err(|e| e.to_string())?;
    Ok(Database(Mutex::new(conn)))
}

#[tauri::command]
pub fn database_save_tracks(state: State<'_, Database>, tracks: Vec<StoredTrack>) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tracks", []).map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO tracks (id,title,artist,album,duration,folder,path,modified)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, artist=excluded.artist,
             album=excluded.album, duration=excluded.duration, folder=excluded.folder,
             path=excluded.path, modified=excluded.modified"
        ).map_err(|e| e.to_string())?;
        for t in tracks {
            stmt.execute(params![t.id,t.title,t.artist,t.album,t.duration,t.folder,t.path,t.modified])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn database_load_tracks(state: State<'_, Database>) -> Result<Vec<StoredTrack>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id,title,artist,album,duration,folder,path,modified FROM tracks ORDER BY title COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(StoredTrack {
        id:r.get(0)?, title:r.get(1)?, artist:r.get(2)?, album:r.get(3)?,
        duration:r.get(4)?, folder:r.get(5)?, path:r.get(6)?, modified:r.get(7)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn database_save_state(state: State<'_, Database>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO app_state(key,value) VALUES(?1,?2)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        params![key,value]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn database_load_state(state: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT value FROM app_state WHERE key=?1", [key], |r| r.get(0))
        .optional().map_err(|e| e.to_string())
}
