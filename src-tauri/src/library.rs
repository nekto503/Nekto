use std::{collections::HashSet, fs, path::{Path, PathBuf}, time::UNIX_EPOCH};
use lofty::{prelude::*, probe::Probe, tag::ItemKey};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: String,
    pub folder: String,
    pub path: String,
    pub modified: u64,
}

fn collect_mp3(dir: &Path, library_root: &Path, output: &mut Vec<LibraryTrack>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Не удалось прочитать {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() { continue; }
        if kind.is_dir() {
            let _ = collect_mp3(&path, library_root, output);
            continue;
        }
        if !kind.is_file() || !path.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("mp3")).unwrap_or(false) { continue; }
        let Some(stem) = path.file_stem().and_then(|x| x.to_str()) else { continue };
        let parsed = Probe::open(&path).ok().and_then(|probe| probe.read().ok());
        let tag = parsed.as_ref().and_then(|file| file.primary_tag().or_else(|| file.first_tag()));
        let title = tag.and_then(|tag| tag.get_string(&ItemKey::TrackTitle)).unwrap_or(stem).to_string();
        let artist = tag.and_then(|tag| tag.get_string(&ItemKey::TrackArtist)).unwrap_or("Неизвестный исполнитель").to_string();
        let album = tag.and_then(|tag| tag.get_string(&ItemKey::AlbumTitle)).unwrap_or("Неизвестный альбом").to_string();
        // Duration is read from the MP3 audio frames via Lofty's audio properties,
        // not from ID3 tags. It therefore remains available even when the file has
        // no duration tag; the HTML audio element provides a second fallback at playback.
        let duration = parsed.as_ref()
            .map(|file| file.properties().duration().as_secs_f64().round() as u64)
            .filter(|secs| *secs > 0)
            .map(|secs| format!("{}:{:02}", secs / 60, secs % 60))
            .unwrap_or_else(|| "—".into());
        let full = path.to_string_lossy().to_string();
        let id = format!("{:016x}", full.bytes().fold(14695981039346656037u64, |h, b| (h ^ b as u64).wrapping_mul(1099511628211)));
        let modified = fs::metadata(&path).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        output.push(LibraryTrack { id, title, artist, album, duration, folder: library_root.to_string_lossy().to_string(), path: full, modified });
    }
    Ok(())
}

#[tauri::command]
pub fn scan_mp3_folders(folders: Vec<String>) -> Result<Vec<LibraryTrack>, String> {
    let mut tracks = Vec::new();
    let mut seen_paths = HashSet::new();
    for folder in folders {
        let path = PathBuf::from(&folder);
        if !path.is_dir() { continue; }
        collect_mp3(&path, &path, &mut tracks)?;
    }

    // Selected folders may overlap (for example, Music and Music\Downloads).
    // Canonical paths prevent the same physical MP3 from appearing twice.
    tracks.retain(|track| {
        let path = Path::new(&track.path);
        let identity = path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy().replace('/', "\\").to_lowercase();
        seen_paths.insert(identity)
    });
    tracks.sort_by(|a, b| {
        a.title.to_lowercase().cmp(&b.title.to_lowercase())
            .then_with(|| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()))
            .then_with(|| a.album.to_lowercase().cmp(&b.album.to_lowercase()))
    });
    Ok(tracks)
}


#[tauri::command]
pub fn read_track_artwork(path: String) -> Result<Option<String>, String> {
    let parsed = Probe::open(&path).map_err(|e| e.to_string())?
        .read().map_err(|e| e.to_string())?;
    let Some(tag) = parsed.primary_tag().or_else(|| parsed.first_tag()) else {
        return Ok(None);
    };
    let Some(picture) = tag.pictures().first() else {
        return Ok(None);
    };
    let mime = picture.mime_type().map(|m| m.as_str()).unwrap_or("image/jpeg");
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(picture.data());
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}


#[tauri::command]
pub fn read_track_lyrics(path: String) -> Result<Option<String>, String> {
    let audio_path = PathBuf::from(&path);
    let Some(stem) = audio_path.file_stem() else { return Ok(None); };
    let Some(parent) = audio_path.parent() else { return Ok(None); };
    let lrc_path = parent.join(stem).with_extension("lrc");
    if !lrc_path.is_file() { return Ok(None); }
    let bytes = fs::read(&lrc_path).map_err(|e| format!("Не удалось прочитать текст песни: {e}"))?;
    let (text, _, had_errors) = encoding_rs::UTF_8.decode(&bytes);
    if had_errors {
        let (decoded, _, _) = encoding_rs::WINDOWS_1251.decode(&bytes);
        return Ok(Some(decoded.into_owned()));
    }
    Ok(Some(text.into_owned()))
}

#[tauri::command]
pub fn watch_library_folders(
    folders: Vec<String>,
    app: tauri::AppHandle,
    watcher_state: tauri::State<'_, std::sync::Mutex<Option<notify::RecommendedWatcher>>>,
) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tauri::Emitter::emit(&app, "library-changed", ());
        }
    }).map_err(|e| format!("Не удалось запустить мониторинг папок: {e}"))?;
    for folder in folders {
        let path = PathBuf::from(folder);
        if path.is_dir() {
            watcher.watch(&path, RecursiveMode::Recursive)
                .map_err(|e| format!("Не удалось отслеживать {}: {e}", path.display()))?;
        }
    }
    *watcher_state.lock().map_err(|_| "Состояние файлового мониторинга недоступно".to_string())? = Some(watcher);
    Ok(())
}
