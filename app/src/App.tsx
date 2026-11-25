import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  AudioLines, ChevronDown, Folder, Heart, Home, Minus, Square, Copy,
  ListMusic, MoreHorizontal, Music2, Pause, Play, Plus, Search, Settings,
  SkipBack, SkipForward, SlidersHorizontal, Volume2, X, Shuffle, Repeat2,
  PanelRight, Check, Trash2, ImagePlus, Pencil,
} from 'lucide-react';

type Track = { id: string; title: string; artist: string; album: string; duration: string; folder: string; path?: string; modified?: number };
type Theme = 'graphite' | 'paper' | 'warm' | 'ash' | 'pearl' | 'glass' | 'studio' | 'mono' | 'slate' | 'chalk';
type RightPanel = 'nowPlaying' | 'history' | 'queue' | 'playlist';
type TopNavId = 'All tracks' | 'Albums' | 'Artists' | 'Playlists' | 'Favorites';
const topNavItems: { id: TopNavId; label: string }[] = [{ id: 'All tracks', label: 'Песни' }, { id: 'Albums', label: 'Альбомы' }, { id: 'Artists', label: 'Исполнители' }, { id: 'Playlists', label: 'Плейлисты' }, { id: 'Favorites', label: 'Избранное' }];
type SortMode = 'title' | 'artist' | 'album' | 'recent' | 'duration' | 'custom';
type Preferences = { reduceMotion: boolean; confirmBeforeDelete: boolean; panelOutline: boolean; secondaryOutline: boolean };
type Density = 'comfortable' | 'compact';
type ShortcutId = 'playPause' | 'previous' | 'next' | 'seekBack' | 'seekForward' | 'volumeUp' | 'volumeDown' | 'resetZoom';
type ShortcutMap = Record<ShortcutId, string>;
const shortcutItems: { id: ShortcutId; label: string; fallback: string }[] = [
  { id: 'playPause', label: 'Воспроизведение / пауза', fallback: 'Space' },
  { id: 'previous', label: 'Предыдущий трек', fallback: 'MediaTrackPrevious' },
  { id: 'next', label: 'Следующий трек', fallback: 'MediaTrackNext' },
  { id: 'seekBack', label: 'Перемотка назад на 5 секунд', fallback: 'Ctrl + ←' },
  { id: 'seekForward', label: 'Перемотка вперёд на 5 секунд', fallback: 'Ctrl + →' },
  { id: 'volumeUp', label: 'Увеличить громкость', fallback: '↑' },
  { id: 'volumeDown', label: 'Уменьшить громкость', fallback: '↓' },
  { id: 'resetZoom', label: 'Масштаб по умолчанию', fallback: 'Ctrl + 0' },
];
const defaultShortcuts: ShortcutMap = Object.fromEntries(shortcutItems.map((item) => [item.id, item.fallback])) as ShortcutMap;
function eventShortcut(event: KeyboardEvent) { const parts: string[] = []; if (event.ctrlKey) parts.push('Ctrl'); if (event.altKey) parts.push('Alt'); if (event.shiftKey) parts.push('Shift'); const key = event.key === ' ' ? 'Space' : ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' } as Record<string, string>)[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key); if (!['Control','Alt','Shift','Meta'].includes(key)) parts.push(key); return parts.join(' + '); }
function displayShortcut(value: string) { return value.split(' + ').join(' '); }
const rightPanelItems: { id: RightPanel; label: string }[] = [{ id: 'nowPlaying', label: 'Трек' }, { id: 'queue', label: 'Очередь' }, { id: 'history', label: 'История' }];
const defaultPreferences: Preferences = { reduceMotion: false, confirmBeforeDelete: true, panelOutline: false, secondaryOutline: false };
function readStored<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}

const initialTracks: Track[] = [
  { id: 'demo-1', title: 'After Hours', artist: 'The Weeknd', album: 'After Hours', duration: '6:01', folder: 'Music' },
  { id: 'demo-2', title: 'Nights', artist: 'Frank Ocean', album: 'Blonde', duration: '5:07', folder: 'Music' },
  { id: 'demo-3', title: '90210', artist: 'Travis Scott', album: 'Rodeo', duration: '5:39', folder: 'Downloads' },
  { id: 'demo-4', title: 'Self Control', artist: 'Frank Ocean', album: 'Blonde', duration: '4:09', folder: 'Music' },
  { id: 'demo-5', title: 'Location', artist: 'Playboi Carti', album: 'Playboi Carti', duration: '2:58', folder: 'Collection' },
  { id: 'demo-6', title: 'Sky', artist: 'Playboi Carti', album: 'Whole Lotta Red', duration: '3:13', folder: 'Collection' },
  { id: 'demo-7', title: 'Redbone', artist: 'Childish Gambino', album: 'Awaken, My Love!', duration: '5:26', folder: 'Downloads' },
];
const themeNames: { id: Theme; name: string; note: string }[] = [
  { id: 'graphite', name: 'Graphite', note: 'Глубокий графит и строгая сетка' },
  { id: 'paper', name: 'Paper', note: 'Чистая светлая редакционная тема' },
  { id: 'warm', name: 'Warm', note: 'Тёплые матовые поверхности' },
  { id: 'ash', name: 'Ash', note: 'Спокойная дымчато-серая палитра' },
  { id: 'glass', name: 'Glass', note: 'Сдержанные полупрозрачные панели' },
  { id: 'pearl', name: 'Pearl', note: 'Светлая жемчужная тема с мягким контрастом' },
  { id: 'studio', name: 'Studio', note: 'Плотный профессиональный интерфейс' },
  { id: 'mono', name: 'Mono', note: 'Почти чёрный фон и холодные серые поверхности' },
  { id: 'slate', name: 'Slate', note: 'Сланцевые оттенки с мягким светлым текстом' },
  { id: 'chalk', name: 'Chalk', note: 'Светлая бумажно-меловая тема с графитовым текстом' },
];

function Cover({ index, small = false, src }: { index: number | string; small?: boolean; src?: string }) {
  const seed = typeof index === 'number' ? index : Array.from(index).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return <div className={`cover cover-${seed % 6} ${small ? 'cover-small' : ''}`} aria-hidden="true">{src ? <img src={src} alt="" loading="lazy"/> : <span>{['A','N','9','S','L','R'][seed % 6]}</span>}</div>;
}

function TrackArtwork({ id, artwork, small = false }: { id: string; artwork: Record<string, string>; small?: boolean }) {
  const src = artwork[id];
  return src ? <div className={`cover artwork-cover ${small ? 'cover-small' : ''}`}><img src={src} alt="" loading="lazy"/></div> : <Cover index={id} small={small}/>;
}

export default function App() {
  const [windowMaximized, setWindowMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then((maximized) => { if (active) setWindowMaximized(maximized); }).catch(() => {});
    void appWindow.onResized(() => {
      void appWindow.isMaximized().then((maximized) => { if (active) setWindowMaximized(maximized); }).catch(() => {});
    }).then((stop) => { if (active) unlisten = stop; else stop(); }).catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, []);
  const [theme, setTheme] = useState<Theme>(() => { const value = localStorage.getItem('nekto-theme'); return (themeNames.some((item) => item.id === value) ? value : 'graphite') as Theme; });
  const [section, setSection] = useState(() => { const saved = localStorage.getItem('nekto-last-section') || 'Home'; return localStorage.getItem('nekto-remember-section') === 'false' || saved === 'Queue' ? 'Home' : saved; });
  const [tracks, setTracks] = useState<Track[]>(isTauri() ? [] : initialTracks);
  const [folders, setFolders] = useState<string[]>(() => readStored<string[]>('nekto-folders', []));
  const [playlists, setPlaylists] = useState<string[]>(() => readStored<string[]>('nekto-playlists', ['Late night', 'On repeat', 'Driving']));
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('title');
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const eqPreampRef = useRef<GainNode | null>(null);
  const eqOutputGainRef = useRef<GainNode | null>(null);
  const bypassGainRef = useRef<GainNode | null>(null);
  const [eqEnabled, setEqEnabled] = useState(false);
  const [eqGains, setEqGains] = useState<number[]>(() => { const saved = readStored<number[]>('nekto-eq-gains', []); if (saved.length >= 11) return saved.slice(0, 11); if (saved.length === 5) { const migrated = Array(11).fill(0); [2, 4, 6, 8, 10].forEach((target, index) => { migrated[target] = saved[index] ?? 0; }); return migrated; } return Array(11).fill(0); });
  const [position, setPosition] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('nekto-volume') || 72) / 100);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'context' | 'one'>('context');
  const [playbackContextIds, setPlaybackContextIds] = useState<string[]>([]);
  const [playbackContextLoops, setPlaybackContextLoops] = useState(false);
  const [playerAtTop, setPlayerAtTop] = useState(() => localStorage.getItem('nekto-player-position') === 'top');
  const [rememberLastSection, setRememberLastSection] = useState(() => localStorage.getItem('nekto-remember-section') !== 'false');
  const [history, setHistory] = useState<string[]>(() => readStored<string[]>('nekto-history', []));
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => readStored<Record<string, number>>('nekto-play-counts', {}));
  const [playError, setPlayError] = useState('');
  const [current, setCurrent] = useState(0);
  const [revealCurrentTrack, setRevealCurrentTrack] = useState(0);
  const [favorites, setFavorites] = useState<string[]>(() => readStored<string[]>('nekto-favorites', []));
  const [rightPanel, setRightPanel] = useState<RightPanel>(() => { const saved = localStorage.getItem('nekto-right-panel'); return rightPanelItems.some((item) => item.id === saved) ? saved as RightPanel : 'nowPlaying'; });
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('nekto-right-open') !== 'false');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(180, Math.min(360, Number(localStorage.getItem('nekto-sidebar-width') || 246))));
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('nekto-sidebar-hidden') === 'true');
  const [rightWidth, setRightWidth] = useState(() => Number(localStorage.getItem('nekto-right-width') || 270));
  const [density, setDensity] = useState<Density>(() => localStorage.getItem('nekto-density') === 'compact' ? 'compact' : 'comfortable');
  const [rightPanelVisibility, setRightPanelVisibility] = useState<Record<RightPanel, boolean>>(() => ({ nowPlaying: true, queue: true, history: true, playlist: true, ...readStored<Partial<Record<RightPanel, boolean>>>('nekto-right-tabs-visible', {}) }));
  const [topPanelVisibility, setTopPanelVisibility] = useState<Record<TopNavId, boolean>>(() => ({ 'All tracks': true, Albums: true, Artists: true, Playlists: true, Favorites: true, ...readStored<Partial<Record<TopNavId, boolean>>>('nekto-top-tabs-visible', {}) }));
  const [rightPanelOrder, setRightPanelOrder] = useState<RightPanel[]>(() => { const saved = readStored<RightPanel[]>('nekto-right-tabs-order', []); return [...saved.filter((id) => rightPanelItems.some((item) => item.id === id)), ...rightPanelItems.map((item) => item.id).filter((id) => !saved.includes(id))]; });
  const resizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null);
  const [playlistCovers, setPlaylistCovers] = useState<Record<string, string>>(() => readStored<Record<string, string>>('nekto-playlist-covers', {}));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('nekto-zoom') || 100));
  const [playlistTracks, setPlaylistTracks] = useState<Record<string, string[]>>(() => readStored<Record<string, string[]>>('nekto-playlist-tracks', {}));
  const [playlistDescriptions, setPlaylistDescriptions] = useState<Record<string, string>>(() => readStored<Record<string, string>>('nekto-playlist-descriptions', {}));
  const suppressPlaylistClick = useRef(false);
  type PointerDragItem = { kind: 'track'; id: string; sourceSection: string } | { kind: 'playlist'; name: string };
  const pendingPointerDrag = useRef<{ item: PointerDragItem; x: number; y: number; active: boolean } | null>(null);
  const [pointerDrag, setPointerDrag] = useState<{ item: PointerDragItem; x: number; y: number } | null>(null);
  const [dragOverPlaylist, setDragOverPlaylist] = useState<string | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [dragOverQueue, setDragOverQueue] = useState(false);
  const [dragPosition, setDragPosition] = useState<'before' | 'after'>('before');
  const [rightPlaylist, setRightPlaylist] = useState<string | null>(null);
  const [addTracksPlaylist, setAddTracksPlaylist] = useState<string | null>(null);
  const [addTracksQuery, setAddTracksQuery] = useState('');
  const [selectedAddTrackIds, setSelectedAddTrackIds] = useState<string[]>([]);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [playlistDraftName, setPlaylistDraftName] = useState('');
  const [playlistDraftDescription, setPlaylistDraftDescription] = useState('');
  const [playlistDraftCover, setPlaylistDraftCover] = useState<string | null>(null);
  const [editingPlaylist, setEditingPlaylist] = useState<string | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState('');
  const [editPlaylistDescription, setEditPlaylistDescription] = useState('');
  type DeleteRequest = { kind: 'folder'; name: string } | { kind: 'playlist'; name: string } | { kind: 'playlistTrack'; name: string; trackId: string } | { kind: 'queueTrack'; trackId: string };
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [loaderMinimumDone, setLoaderMinimumDone] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setLoaderMinimumDone(true), 520); return () => window.clearTimeout(timer); }, []);
  const [queueIds, setQueueIds] = useState<string[]>(() => readStored<string[]>('nekto-queue', []));
  const [preferences, setPreferences] = useState<Preferences>(() => ({ ...defaultPreferences, ...readStored<Partial<Preferences>>('nekto-preferences', {}) }));
  const [isScanning, setIsScanning] = useState(false);
  const scanLock = useRef(false);
  const [artwork, setArtwork] = useState<Record<string, string>>({});
  const [trackMenuId, setTrackMenuId] = useState<string | null>(null);
  const [trackMenuPosition, setTrackMenuPosition] = useState({ x: 0, y: 0 });
  const [toast, setToast] = useState('');
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => ({ ...defaultShortcuts, ...readStored<Partial<ShortcutMap>>('nekto-shortcuts', {}) }));
  const [capturingShortcut, setCapturingShortcut] = useState<ShortcutId | null>(null);
  const [playerHeight, setPlayerHeight] = useState(() => Math.min(180, Math.max(86, Number(localStorage.getItem('nekto-player-height') || 86))));
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = (message: string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2600); };
  useEffect(() => { localStorage.setItem('nekto-shortcuts', JSON.stringify(shortcuts)); }, [shortcuts]);
  useEffect(() => { localStorage.setItem('nekto-player-height', String(playerHeight)); }, [playerHeight]);
  const beginPlayerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation();
    const startY = event.clientY; const startHeight = playerHeight;
    const move = (moveEvent: PointerEvent) => { const delta = playerAtTop ? moveEvent.clientY - startY : startY - moveEvent.clientY; setPlayerHeight(Math.min(190, Math.max(86, startHeight + delta))); };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); window.addEventListener('pointercancel', stop, { once: true });
  };
  const captureShortcut = (id: ShortcutId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setCapturingShortcut(null); return; }
    if (['Control','Alt','Shift','Meta'].includes(event.key)) return;
    const value = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key === ' ' ? 'Space' : ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' } as Record<string, string>)[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)].filter(Boolean).join(' + ');
    setShortcuts((items) => ({ ...items, [id]: value })); setCapturingShortcut(null);
  };

  useEffect(() => {
    if (!isTauri()) { setDatabaseReady(true); return; }
    let active = true;
    void invoke<string | null>('database_load_state', { key: 'user-data' }).then((raw) => {
      if (!active) return;
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          if (saved.theme === 'brutalist') setTheme('pearl');
          else if (saved.theme === 'analog') setTheme('ash');
          else if (themeNames.some((item) => item.id === saved.theme)) setTheme(saved.theme);
          if (Array.isArray(saved.folders)) setFolders(saved.folders);
          if (Array.isArray(saved.playlists)) setPlaylists(saved.playlists);
          if (saved.playlistTracks && typeof saved.playlistTracks === 'object') setPlaylistTracks(saved.playlistTracks);
          if (saved.playlistDescriptions && typeof saved.playlistDescriptions === 'object') setPlaylistDescriptions(saved.playlistDescriptions);
          if (saved.playlistCovers && typeof saved.playlistCovers === 'object') setPlaylistCovers(saved.playlistCovers);
          setSidebarOpen(true);
          if (typeof saved.sidebarWidth === 'number') setSidebarWidth(Math.max(180, Math.min(360, saved.sidebarWidth)));
          if (typeof saved.sidebarHidden === 'boolean') setSidebarHidden(saved.sidebarHidden);
          if (typeof saved.rightWidth === 'number') setRightWidth(saved.rightWidth);
          if (saved.density === 'compact' || saved.density === 'comfortable') setDensity(saved.density);
          if (saved.rightPanelVisibility && typeof saved.rightPanelVisibility === 'object') setRightPanelVisibility((value) => ({ ...value, ...saved.rightPanelVisibility }));
          if (saved.topPanelVisibility && typeof saved.topPanelVisibility === 'object') setTopPanelVisibility((value) => ({ ...value, ...saved.topPanelVisibility }));
          if (Array.isArray(saved.rightPanelOrder)) setRightPanelOrder([...saved.rightPanelOrder.filter((id: RightPanel) => rightPanelItems.some((item) => item.id === id)), ...rightPanelItems.map((item) => item.id).filter((id) => !saved.rightPanelOrder.includes(id))]);
          if (Array.isArray(saved.favorites)) setFavorites(saved.favorites);
          if (Array.isArray(saved.history)) setHistory(saved.history);
          if (Array.isArray(saved.queueIds)) setQueueIds(saved.queueIds);
          if (typeof saved.volume === 'number') setVolume(saved.volume);
          if (typeof saved.zoom === 'number') setZoom(saved.zoom);
          if (saved.preferences && typeof saved.preferences === 'object') setPreferences({ ...defaultPreferences, ...saved.preferences });
        } catch (error) { console.error('Не удалось прочитать настройки медиатеки:', error); }
      }
    }).catch((error) => console.error('SQLite недоступна:', error)).finally(() => {
      if (active) setDatabaseReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isTauri() || !databaseReady) return;
    const value = JSON.stringify({ theme, folders, playlists, playlistTracks, playlistDescriptions, playlistCovers, favorites, history, volume, zoom, queueIds, preferences, sidebarOpen, sidebarWidth, sidebarHidden, rightWidth, density, rightPanelVisibility, rightPanelOrder, topPanelVisibility });
    void invoke('database_save_state', { key: 'user-data', value })
      .catch((error) => console.error('Не удалось сохранить состояние в SQLite:', error));
  }, [databaseReady, theme, folders, playlists, playlistTracks, playlistDescriptions, playlistCovers, favorites, history, volume, zoom, queueIds, preferences, sidebarOpen, sidebarWidth, sidebarHidden, rightWidth, density, rightPanelVisibility, rightPanelOrder, topPanelVisibility]);

  useEffect(() => { localStorage.setItem('nekto-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('nekto-folders', JSON.stringify(folders)); }, [folders]);
  useEffect(() => { localStorage.setItem('nekto-playlists', JSON.stringify(playlists)); }, [playlists]);
  useEffect(() => { localStorage.setItem('nekto-playlist-tracks', JSON.stringify(playlistTracks)); }, [playlistTracks]);
  useEffect(() => { localStorage.setItem('nekto-playlist-descriptions', JSON.stringify(playlistDescriptions)); }, [playlistDescriptions]);
  useEffect(() => { localStorage.setItem('nekto-favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem('nekto-right-panel', rightPanel); }, [rightPanel]);
  useEffect(() => { if (rightPanel !== 'playlist' && !rightPanelVisibility[rightPanel]) { const fallback = rightPanelOrder.find((id) => rightPanelVisibility[id]); if (fallback) setRightPanel(fallback); } }, [rightPanel, rightPanelVisibility, rightPanelOrder]);
  useEffect(() => { localStorage.setItem('nekto-right-open', String(rightOpen)); }, [rightOpen]);
  useEffect(() => { localStorage.setItem('nekto-sidebar-open', String(sidebarOpen)); }, [sidebarOpen]);
  useEffect(() => { localStorage.setItem('nekto-sidebar-width', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('nekto-sidebar-hidden', String(sidebarHidden)); }, [sidebarHidden]);
  useEffect(() => { localStorage.setItem('nekto-right-width', String(rightWidth)); }, [rightWidth]);
  useEffect(() => { localStorage.setItem('nekto-density', density); }, [density]);
  useEffect(() => { localStorage.setItem('nekto-right-tabs-visible', JSON.stringify(rightPanelVisibility)); }, [rightPanelVisibility]);
  useEffect(() => { localStorage.setItem('nekto-top-tabs-visible', JSON.stringify(topPanelVisibility)); }, [topPanelVisibility]);
  useEffect(() => { localStorage.setItem('nekto-right-tabs-order', JSON.stringify(rightPanelOrder)); }, [rightPanelOrder]);
  useEffect(() => { localStorage.setItem('nekto-playlist-covers', JSON.stringify(playlistCovers)); }, [playlistCovers]);
  useEffect(() => { localStorage.setItem('nekto-zoom', String(zoom)); }, [zoom]);
  useEffect(() => { localStorage.setItem('nekto-volume', String(Math.round(volume * 100))); }, [volume]);
  useEffect(() => { localStorage.setItem('nekto-history', JSON.stringify(history.slice(0, 100))); }, [history]);
  useEffect(() => { localStorage.setItem('nekto-play-counts', JSON.stringify(playCounts)); }, [playCounts]);
  useEffect(() => { localStorage.setItem('nekto-queue', JSON.stringify(queueIds)); }, [queueIds]);
  useEffect(() => { localStorage.setItem('nekto-preferences', JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion); }, [preferences.reduceMotion]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      if (active.side === 'left') {
        const next = Math.max(180, Math.min(360, active.startWidth + event.clientX - active.startX));
        setSidebarWidth(next);
        setSidebarOpen(true);
      } else {
        const next = Math.max(220, Math.min(420, active.startWidth - (event.clientX - active.startX)));
        setRightWidth(next);
        setRightOpen(true);
      }
    };
    const stop = () => { resizeRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
  }, []);
  const beginResize = (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? (sidebarOpen ? sidebarWidth : 34) : (rightOpen ? rightWidth : 270) };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };


  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        setZoom((value) => Math.min(150, Math.max(70, value + (event.deltaY < 0 ? 5 : -5))));
      }
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === 'Escape') { if (query) setQuery(''); if (settingsOpen) setSettingsOpen(false); if (capturingShortcut) setCapturingShortcut(null); return; }
      if (capturingShortcut) return;
      const pressed = eventShortcut(event);
      const action = (Object.keys(shortcuts) as ShortcutId[]).find((id) => shortcuts[id] === pressed);
      if (!action) return;
      if (typing && !['playPause','previous','next'].includes(action)) return;
      event.preventDefault();
      if (action === 'playPause') document.getElementById('player-toggle')?.click();
      else if (action === 'previous') document.getElementById('player-previous')?.click();
      else if (action === 'next') document.getElementById('player-next')?.click();
      else if (action === 'seekBack' && audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
      else if (action === 'seekForward' && audioRef.current) audioRef.current.currentTime = Math.min(durationSeconds, audioRef.current.currentTime + 5);
      else if (action === 'volumeUp') setVolume((value) => Math.min(1, value + 0.05));
      else if (action === 'volumeDown') setVolume((value) => Math.max(0, value - 0.05));
      else if (action === 'resetZoom') setZoom(100);
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); };
  }, [query, settingsOpen, durationSeconds, shortcuts, capturingShortcut]);

  const visibleTracks = useMemo(() => {
    let result = [...tracks];
    if (section.startsWith('Folder:')) result = result.filter((track) => track.folder === section.slice(7));
    if (section.startsWith('Album:')) { const album = section.slice(6); result = result.filter((track) => (track.album?.trim() || 'Неизвестный альбом') === album); }
    if (section.startsWith('Artist:')) result = result.filter((track) => track.artist === section.slice(7));
    if (section === 'Favorites') result = result.filter((track) => favorites.includes(track.id));
    if (section === 'Queue') result = queueIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track));
    if (section === 'Recent') result = history.map((id) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track));
    if (section.startsWith('Playlist:')) result = result.filter((track) => (playlistTracks[section.slice(9)] ?? []).includes(track.id));
    if (query.trim()) {
      const q = query.trim().toLocaleLowerCase();
      result = result.filter((track) => `${track.title} ${track.artist} ${track.album} ${track.folder}`.toLocaleLowerCase().includes(q));
    }
    if ((section.startsWith('Playlist:') || section === 'Queue') && !query.trim()) {
      const ids = section === 'Queue' ? queueIds : (playlistTracks[section.slice(9)] ?? []);
      const byId = new Map(result.map((track) => [track.id, track]));
      return ids.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));
    }
    const durationSeconds = (value: string) => { const parts = value.split(':').map(Number); return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : -1; };
    if (sortMode !== 'custom') result.sort((a, b) => {
      if (sortMode === 'artist') return a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      if (sortMode === 'album') return a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      if (sortMode === 'recent') return (b.modified ?? 0) - (a.modified ?? 0);
      if (sortMode === 'duration') return durationSeconds(b.duration) - durationSeconds(a.duration);
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
    return result;
  }, [tracks, section, favorites, playlistTracks, query, history, sortMode, queueIds]);

  const albumGroups = useMemo(() => {
    const groups = new Map<string, Track[]>();
    tracks.forEach((track) => {
      const albumName = track.album?.trim() || 'Неизвестный альбом';
      groups.set(albumName, [...(groups.get(albumName) ?? []), track]);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [tracks]);
  const artistGroups = useMemo(() => {
    const groups = new Map<string, Track[]>();
    tracks.forEach((track) => groups.set(track.artist || 'Неизвестный исполнитель', [...(groups.get(track.artist || 'Неизвестный исполнитель') ?? []), track]));
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [tracks]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void invoke<Track[]>('database_load_tracks').then((cached) => {
      if (active && cached.length) setTracks(cached);
    }).catch((error) => console.error('Не удалось загрузить кэш медиатеки:', error));
    return () => { active = false; };
  }, []);

  const refreshLibrary = async (paths = folders, clearWhenEmpty = false) => {
    if (!isTauri() || scanLock.current || (paths.length === 0 && !clearWhenEmpty)) return;
    scanLock.current = true;
    setIsScanning(true);
    try {
      const result = paths.length ? await invoke<Track[]>('scan_mp3_folders', { folders: paths }) : []; 
      setTracks(result);
      setQueueIds((items) => items.filter((id) => result.some((track) => track.id === id)));
      await invoke('database_save_tracks', { tracks: result });
      setPlayError('');
    } catch (error) {
      console.error('Не удалось обновить медиатеку:', error);
      setPlayError(`Не удалось обновить медиатеку: ${String(error)}`);
    } finally { scanLock.current = false; setIsScanning(false); }
  };
  const removeFolder = async (folder: string) => {
    if (preferences.confirmBeforeDelete) { setDeleteRequest({ kind: 'folder', name: folder }); return; }
    await confirmRemoveFolder(folder);
  };
  const confirmRemoveFolder = async (folder: string) => {
    const next = folders.filter((item) => item !== folder);
    setFolders(next);
    if (section === `Folder:${folder}`) setSection('All tracks');
    if (next.length === 0) {
      setTracks([]);
      setQueueIds([]);
      if (isTauri()) await invoke('database_save_tracks', { tracks: [] }).catch((error) => setPlayError(`Не удалось обновить кэш медиатеки: ${String(error)}`));
    } else { await refreshLibrary(next, true); }
  };
  const addFolder = async () => {
    if (!isTauri()) { window.alert('Выбор папок Windows доступен в установленном приложении Nekto.'); return; }
    const selected = await openDialog({ directory: true, multiple: true, title: 'Добавить музыкальную папку' });
    if (!selected) return;
    const additions = (Array.isArray(selected) ? selected : [selected]).filter((path) => !folders.includes(path));
    if (!additions.length) return;
    const next = [...folders, ...additions]; setFolders(next); await refreshLibrary(next);
  };
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    let debounce: number | undefined;
    void listen('library-changed', () => { if (!active) return; window.clearTimeout(debounce); debounce = window.setTimeout(() => { if (active) void refreshLibrary(); }, 450); }).then((off) => { if (active) unlisten = off; else off(); });
    void invoke('watch_library_folders', { folders }).catch((error) => console.warn('Файловый мониторинг недоступен, используется периодическое обновление:', error));
    void refreshLibrary();
    const fallback = window.setInterval(() => { if (active) void refreshLibrary(); }, 60000);
    return () => { active = false; unlisten?.(); window.clearTimeout(debounce); window.clearInterval(fallback); };
  }, [folders.join('\\')]);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return;
      const paths = event.payload.paths;
      const roots = paths.map((path) => /\.mp3$/i.test(path) ? path.replace(/[\\/][^\\/]+$/, '') : path);
      const next = [...folders, ...roots.filter((path) => !folders.includes(path))];
      if (next.length !== folders.length) { setFolders(next); void refreshLibrary(next); }
      else if (paths.length) void refreshLibrary();
    }).then((off) => { if (active) unlisten = off; else off(); });
    return () => { active = false; unlisten?.(); };
  }, [folders.join('\\')]);

  const createPlaylist = () => {
    setPlaylistDraftName('');
    setPlaylistDraftDescription('');
    setPlaylistDraftCover(null);
    setCreatePlaylistOpen(true);
  };
  const submitCreatePlaylist = () => {
    const clean = playlistDraftName.trim();
    if (!clean) { notify('Введи название плейлиста'); return; }
    if (playlists.some((item) => item.toLocaleLowerCase() === clean.toLocaleLowerCase())) { notify('Плейлист с таким названием уже существует'); return; }
    setPlaylists((items) => [...items, clean]);
    setPlaylistTracks((items) => ({ ...items, [clean]: [] }));
    setPlaylistDescriptions((items) => ({ ...items, [clean]: playlistDraftDescription.trim().slice(0, 240) }));
    if (playlistDraftCover) setPlaylistCovers((items) => ({ ...items, [clean]: playlistDraftCover }));
    setCreatePlaylistOpen(false);
    setSection(`Playlist:${clean}`);
    notify(`Плейлист «${clean}» создан`);
  };
  const chooseDraftPlaylistCover = async () => {
    if (!isTauri()) { notify('Выбор обложки доступен в установленном приложении'); return; }
    const selected = await openDialog({ multiple: false, directory: false, title: 'Обложка плейлиста', filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (typeof selected === 'string') setPlaylistDraftCover(selected);
  };
  const openPlaylistEditor = (name: string) => {
    setEditingPlaylist(name);
    setEditPlaylistName(name);
    setEditPlaylistDescription(playlistDescriptions[name] ?? '');
  };
  const savePlaylistEdits = () => {
    if (!editingPlaylist) return;
    const oldName = editingPlaylist;
    const nextName = editPlaylistName.trim();
    if (!nextName) { notify('Название плейлиста не может быть пустым'); return; }
    if (nextName !== oldName && playlists.some((item) => item.toLocaleLowerCase() === nextName.toLocaleLowerCase())) {
      notify('Плейлист с таким названием уже существует'); return;
    }
    if (nextName !== oldName) {
      setPlaylists((items) => items.map((item) => item === oldName ? nextName : item));
      setPlaylistTracks((items) => { const copy = { ...items, [nextName]: items[oldName] ?? [] }; delete copy[oldName]; return copy; });
      setPlaylistCovers((items) => { const copy = { ...items }; if (copy[oldName]) copy[nextName] = copy[oldName]; delete copy[oldName]; return copy; });
      if (rightPlaylist === oldName) setRightPlaylist(nextName);
      setSection(`Playlist:${nextName}`);
    }
    setPlaylistDescriptions((items) => { const copy = { ...items, [nextName]: editPlaylistDescription.trim().slice(0, 240) }; if (oldName !== nextName) delete copy[oldName]; return copy; });
    setEditingPlaylist(null);
    notify('Изменения плейлиста сохранены');
  };
  const deletePlaylist = (name: string) => setDeleteRequest({ kind: 'playlist', name });
  const confirmRequestedDelete = async () => {
    if (!deleteRequest) return;
    const request = deleteRequest;
    if (request.kind === 'folder') {
      await confirmRemoveFolder(request.name);
      notify(`Папка «${request.name.split(/[\\/]/).filter(Boolean).pop() || request.name}» отключена`);
    } else if (request.kind === 'playlist') {
      setPlaylists((items) => items.filter((item) => item !== request.name));
      setPlaylistTracks((items) => { const copy = { ...items }; delete copy[request.name]; return copy; });
      setPlaylistDescriptions((items) => { const copy = { ...items }; delete copy[request.name]; return copy; });
      setPlaylistCovers((items) => { const copy = { ...items }; delete copy[request.name]; return copy; });
      if (section === `Playlist:${request.name}`) setSection('Playlists');
      notify(`Плейлист «${request.name}» удалён`);
    } else if (request.kind === 'playlistTrack') {
      setPlaylistTracks((items) => ({ ...items, [request.name]: (items[request.name] ?? []).filter((id) => id !== request.trackId) }));
      const track = tracks.find((item) => item.id === request.trackId);
      notify(`«${track?.title ?? 'Песня'}» удалена из «${request.name}»`);
    } else {
      setQueueIds((items) => items.filter((id) => id !== request.trackId));
      const track = tracks.find((item) => item.id === request.trackId);
      notify(`«${track?.title ?? 'Песня'}» удалена из очереди`);
    }
    setDeleteRequest(null);
  };
  const addTrackToPlaylist = (name: string, id?: string) => {
    if (!id) return;
    setPlaylistTracks((items) => ({ ...items, [name]: (items[name] ?? []).includes(id) ? items[name] : [...(items[name] ?? []), id] }));
    setTrackMenuId(null);
    notify(`Добавлено в «${name}»`);
  };
  const reorderGlobalTrack = (sourceId: string, targetId: string, after: boolean) => {
    if (sourceId === targetId) return;
    setTracks((items) => { const next = [...items]; const from = next.findIndex((track) => track.id === sourceId); const to = next.findIndex((track) => track.id === targetId); if (from < 0 || to < 0) return items; const [moving] = next.splice(from, 1); const target = next.findIndex((track) => track.id === targetId); next.splice(target + (after ? 1 : 0), 0, moving); return next; });
  };
  const reorderPlaylistTrack = (name: string, sourceId: string, targetId: string, after = false) => {
    if (sourceId === targetId) return;
    setPlaylistTracks((items) => {
      const ids = [...(items[name] ?? [])];
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(targetId);
      if (to < 0) return items;
      if (from < 0) { ids.splice(to + (after ? 1 : 0), 0, sourceId); return { ...items, [name]: [...new Set(ids)] }; }
      const [moving] = ids.splice(from, 1);
      const targetIndex = ids.indexOf(targetId);
      ids.splice(targetIndex + (after ? 1 : 0), 0, moving);
      return { ...items, [name]: ids };
    });
  };
  const reorderQueue = (sourceId: string, targetId: string, after = false) => {
    if (sourceId === targetId) return;
    setQueueIds((items) => {
      const ids = [...items];
      const from = ids.indexOf(sourceId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return items;
      const [moving] = ids.splice(from, 1);
      ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, moving);
      return ids;
    });
  };
  const insertTrackIntoQueue = (sourceId: string, targetId?: string, after = false) => {
    setQueueIds((items) => {
      const ids = items.filter((id) => id !== sourceId);
      if (!targetId) return [...ids, sourceId];
      const targetIndex = ids.indexOf(targetId);
      if (targetIndex < 0) return [...ids, sourceId];
      ids.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
      return ids;
    });
    notify('Добавлено в очередь');
  };
  const choosePlaylistCover = async (name: string) => {
    if (!isTauri()) { window.alert('Выбор обложки доступен в установленном приложении.'); return; }
    const selected = await openDialog({ multiple: false, directory: false, title: 'Выбрать обложку плейлиста', filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (typeof selected === 'string') setPlaylistCovers((items) => ({ ...items, [name]: selected }));
  };
  const addPlaylistToQueue = (name: string) => {
    const ids = playlistTracks[name] ?? [];
    setQueueIds((items) => [...items, ...ids.filter((id) => !items.includes(id))]);
    setRightPanel('queue');
    setRightOpen(true);
  };
  const playPlaylist = (name: string) => {
    const ids = (playlistTracks[name] ?? []).filter((id) => tracks.some((track) => track.id === id));
    if (!ids.length) return;
    setPlaybackContextIds(ids);
    setPlaybackContextLoops(true);
    setQueueIds(ids);
    const firstIndex = tracks.findIndex((track) => track.id === ids[0]);
    if (firstIndex >= 0) playTrack(firstIndex);
    setSection(`Playlist:${name}`);
  };
  const toggleFavorite = (id: string) => { const exists = favorites.includes(id); setFavorites((items) => exists ? items.filter((x) => x !== id) : [...items, id]); notify(exists ? 'Песня удалена из избранного' : 'Песня добавлена в избранное'); };
  const currentTrack = tracks[current] ?? tracks[0] ?? { id: '', title: 'Ничего не играет', artist: 'Выбери трек из медиатеки', album: '—', duration: '—', folder: '—' };
  const mostPlayedTracks = useMemo(() => Object.entries(playCounts).sort((a, b) => Number(b[1]) - Number(a[1])).map(([id]) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)).slice(0, 5), [playCounts, tracks]);
  const favoriteTracks = useMemo(() => favorites.map((id) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)).slice(0, 5), [favorites, tracks]);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const playTrack = (index: number) => { if (!tracks.length || index < 0) return; if (audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume().catch(() => {}); const nextIndex = Math.max(0, Math.min(index, tracks.length - 1)); setCurrent(nextIndex); setPlayError(''); if (!tracks[nextIndex]?.path) { setPlaying(false); if (!isTauri()) setPlayError('Локальное воспроизведение доступно в установленном приложении Nekto.'); return; } const trackId = tracks[nextIndex].id; setPlayCounts((items) => ({ ...items, [trackId]: (items[trackId] ?? 0) + 1 })); setPlaying(true); };
  const playTrackInContext = (index: number, context: Track[]) => { const ids = context.map((track) => track.id); setPlaybackContextIds(ids.length ? ids : tracks.map((track) => track.id)); setPlaybackContextLoops(section.startsWith('Playlist:') || section.startsWith('Album:')); playTrack(index); };
  const addToQueue = (id: string) => setQueueIds((items) => items.includes(id) ? items : [...items, id]);
  const removeFromQueue = (id: string) => setDeleteRequest({ kind: 'queueTrack', trackId: id });
  const moveQueueItem = (id: string, direction: -1 | 1) => setQueueIds((items) => { const at = items.indexOf(id); const to = at + direction; if (at < 0 || to < 0 || to >= items.length) return items; const copy = [...items]; [copy[at], copy[to]] = [copy[to], copy[at]]; return copy; });
  const playQueueItem = (id: string) => { const index = tracks.findIndex((track) => track.id === id); if (index >= 0) { setPlaybackContextIds(queueIds); setPlaybackContextLoops(false); playTrack(index); } };
  const nextTrack = () => {
    if (!tracks.length) return;
    const context = (playbackContextIds.length ? playbackContextIds : tracks.map((track) => track.id)).map((id) => tracks.findIndex((track) => track.id === id)).filter((index) => index >= 0);
    if (!context.length) return;
    const pos = context.indexOf(current);
    if (shuffle && context.length > 1) {
      const candidates = context.filter((index) => index !== current);
      playTrack(candidates[Math.floor(Math.random() * candidates.length)]);
      return;
    }
    const nextPos = pos < 0 ? 0 : pos + 1;
    if (nextPos < context.length) playTrack(context[nextPos]);
    else if (playbackContextLoops) playTrack(context[0]);
    else setPlaying(false);
  };
  const previousTrack = () => {
    if (!tracks.length) return;
    if (position > 3) { if (audioRef.current) audioRef.current.currentTime = 0; setPosition(0); return; }
    const context = (playbackContextIds.length ? playbackContextIds : tracks.map((track) => track.id)).map((id) => tracks.findIndex((track) => track.id === id)).filter((index) => index >= 0);
    const pos = context.indexOf(current);
    if (pos > 0) playTrack(context[pos - 1]);
    else if (playbackContextLoops && context.length) playTrack(context[context.length - 1]);
    else { if (audioRef.current) audioRef.current.currentTime = 0; setPosition(0); }
  };
  useEffect(() => { const audio = audioRef.current; if (!audio) return; audio.volume = volume; }, [volume]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !eqEnabled || audioContextRef.current) return;
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      const preamp = context.createGain();
      const filters = frequencies.map((frequency, index) => {
        const filter = context.createBiquadFilter();
        filter.type = index === 0 ? 'lowshelf' : index === frequencies.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = frequency;
        filter.Q.value = 1;
        return filter;
      });
      const eqOutput = context.createGain();
      const bypassOutput = context.createGain();
      eqOutput.gain.value = eqEnabled ? 1 : 0;
      bypassOutput.gain.value = eqEnabled ? 0 : 1;
      source.connect(bypassOutput);
      bypassOutput.connect(context.destination);
      source.connect(preamp);
      preamp.connect(filters[0]);
      filters.forEach((filter, index) => { if (index < filters.length - 1) filter.connect(filters[index + 1]); });
      filters[filters.length - 1].connect(eqOutput);
      eqOutput.connect(context.destination);
      audioContextRef.current = context;
      eqPreampRef.current = preamp;
      eqFiltersRef.current = filters;
      eqOutputGainRef.current = eqOutput;
      bypassGainRef.current = bypassOutput;
    } catch (error) { console.error('Не удалось инициализировать эквалайзер:', error); }
    // Do not close this AudioContext in the effect cleanup. React.StrictMode
    // intentionally runs setup/cleanup/setup in development; a media element
    // can only be passed to createMediaElementSource() once. Closing here
    // leaves the element attached to a closed context and makes playback silent.
    // The context is owned by the app window and is released when the window closes.
  }, [eqEnabled]);
  useEffect(() => {
    if (eqPreampRef.current) eqPreampRef.current.gain.value = Math.pow(10, (eqGains[0] ?? 0) / 20);
    eqFiltersRef.current.forEach((filter, index) => { filter.gain.value = eqGains[index + 1] ?? 0; });
    if (eqOutputGainRef.current) eqOutputGainRef.current.gain.value = eqEnabled ? 1 : 0;
    if (bypassGainRef.current) bypassGainRef.current.gain.value = eqEnabled ? 0 : 1;
    localStorage.setItem('nekto-eq-enabled', String(eqEnabled));
    localStorage.setItem('nekto-eq-gains', JSON.stringify(eqGains));
  }, [eqEnabled, eqGains]);

  useEffect(() => {
    if (!isTauri() || tracks.length === 0) return;
    let active = true;
    const missing = tracks.filter((track): track is Track & { path: string } => Boolean(track.path) && !artwork[track.id]);
    const load = async () => {
      for (let i = 0; i < missing.length; i += 6) {
        const results = await Promise.all(missing.slice(i, i + 6).map(async (track) => {
          try { return [track.id, await invoke<string | null>('read_track_artwork', { path: track.path })] as const; }
          catch { return [track.id, null] as const; }
        }));
        if (!active) return;
        setArtwork((items) => {
          const next = { ...items };
          for (const [id, src] of results) if (src) next[id] = src;
          return next;
        });
      }
    };
    void load();
    return () => { active = false; };
  }, [tracks]);
  const durationScanRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isTauri() || !databaseReady || tracks.length === 0) return;
    let cancelled = false;
    const unknown = tracks.filter((track) => {
      if (!track.path || durationScanRef.current.has(track.id)) return false;
      const value = (track.duration || '').trim();
      return !/^\d{1,3}:\d{2}$/.test(value) || value === '0:00';
    });
    const inspect = async () => {
      const resolved = new Map<string, string>();
      for (let i = 0; i < unknown.length; i += 4) {
        if (cancelled) return;
        const batch = await Promise.all(unknown.slice(i, i + 4).map((track) => new Promise<[string, string | null]>((resolve) => {
          const probe = new Audio();
          probe.preload = 'metadata';
          let settled = false;
          let timeout: number | undefined;
          const finish = (duration: string | null) => {
            if (settled) return;
            settled = true;
            if (timeout !== undefined) window.clearTimeout(timeout);
            if (!cancelled) durationScanRef.current.add(track.id);
            probe.onloadedmetadata = null;
            probe.onerror = null;
            probe.removeAttribute('src');
            probe.load();
            resolve([track.id, duration]);
          };
          probe.onloadedmetadata = () => {
            const seconds = Number.isFinite(probe.duration) ? probe.duration : 0;
            finish(seconds > 0 ? formatTime(seconds) : null);
          };
          probe.onerror = () => finish(null);
          timeout = window.setTimeout(() => finish(null), 12000);
          probe.src = convertFileSrc(track.path!);
          probe.load();
        })));
        if (cancelled) return;
        batch.forEach(([id, duration]) => { if (duration) resolved.set(id, duration); });
      }
      if (cancelled || resolved.size === 0) return;
      const updated = tracks.map((track) => resolved.has(track.id) ? { ...track, duration: resolved.get(track.id)! } : track);
      setTracks(updated);
      void invoke('database_save_tracks', { tracks: updated }).catch((error) => console.warn('Не удалось сохранить определённые длительности треков:', error));
    };
    void inspect();
    return () => { cancelled = true; };
  }, [databaseReady, tracks]);

  useEffect(() => { const audio = audioRef.current; if (!audio) return; setPosition(0); setDurationSeconds(0); if (!currentTrack.path || !isTauri()) { audio.pause(); audio.removeAttribute('src'); audio.load(); if (playing) { setPlaying(false); if (isTauri()) setPlayError('Этот трек не связан с MP3-файлом. Добавь свою музыкальную папку.'); } return; } audio.pause(); audio.removeAttribute('crossorigin'); audio.preload = 'auto'; audio.muted = false; audio.src = convertFileSrc(currentTrack.path); audio.load(); }, [currentTrack.id]);
  useEffect(() => { const audio = audioRef.current; if (!audio) return; if (playing && currentTrack.path && isTauri()) { let cancelled = false; const startPlayback = async () => { try { const context = audioContextRef.current; if (context && context.state !== 'running') await context.resume(); if (!cancelled) await audio.play(); } catch { if (!cancelled) { setPlaying(false); setPlayError('Не удалось начать воспроизведение этого файла. Проверь доступ к файлу и громкость Windows.'); } } }; void startPlayback(); return () => { cancelled = true; }; } else audio.pause(); }, [playing, currentTrack.id]);
  useEffect(() => { if (playing && currentTrack.id) setHistory((items) => [currentTrack.id, ...items.filter((id) => id !== currentTrack.id)].slice(0, 100)); }, [currentTrack.id, playing]);
  useEffect(() => { if (!revealCurrentTrack || !currentTrack.id || section !== 'All tracks') return; const frame = window.requestAnimationFrame(() => { const row = document.querySelector<HTMLElement>(`.track-row[data-track-id=\"${CSS.escape(currentTrack.id)}\"]`); row?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (row) { row.classList.add('current-track-reveal'); window.setTimeout(() => row.classList.remove('current-track-reveal'), 1400); } }); return () => window.cancelAnimationFrame(frame); }, [revealCurrentTrack, currentTrack.id, section]);
  useEffect(() => { localStorage.setItem('nekto-player-position', playerAtTop ? 'top' : 'bottom'); }, [playerAtTop]);
  useEffect(() => { localStorage.setItem('nekto-remember-section', String(rememberLastSection)); }, [rememberLastSection]);
  useEffect(() => {
    if (!rememberLastSection) return;
    if (section !== 'Settings') localStorage.setItem('nekto-last-section', section);
  }, [section, rememberLastSection]);

  const openPlaylist = (name: string) => { setSection(`Playlist:${name}`); };
  const beginPointerDrag = (item: PointerDragItem, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (item.kind === 'track' && item.sourceSection !== 'Queue' && (event.target as HTMLElement).closest('button,input,a')) return;
    pendingPointerDrag.current = { item, x: event.clientX, y: event.clientY, active: false };
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const pending = pendingPointerDrag.current;
      if (!pending) return;
      const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (!pending.active && distance < 6) return;
      pending.active = true;
      setPointerDrag({ item: pending.item, x: event.clientX, y: event.clientY });
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const playlistTarget = target?.closest<HTMLElement>('[data-playlist-drop]');
      setDragOverPlaylist(playlistTarget?.dataset.playlistDrop ?? null);
      const queueTarget = target?.closest<HTMLElement>('[data-queue-drop]');
      setDragOverQueue(Boolean(queueTarget));
      const trackTarget = target?.closest<HTMLElement>('[data-track-id]');
      if (trackTarget && pending.item.kind === 'track' && trackTarget.dataset.trackId !== pending.item.id) {
        setDragOverTrackId(trackTarget.dataset.trackId ?? null);
        const rect = trackTarget.getBoundingClientRect();
        setDragPosition(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      } else setDragOverTrackId(null);
    };
    const finish = (event: PointerEvent) => {
      const pending = pendingPointerDrag.current;
      if (!pending) return;
      const wasDragging = pending.active;
      pendingPointerDrag.current = null;
      if (wasDragging) {
        const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        if (pending.item.kind === 'track') {
          const playlistTarget = target?.closest<HTMLElement>('[data-playlist-drop]');
          const queueTarget = target?.closest<HTMLElement>('[data-queue-drop]');
          const trackTarget = target?.closest<HTMLElement>('[data-track-id]');
          if (playlistTarget?.dataset.playlistDrop) {
            addTrackToPlaylist(playlistTarget.dataset.playlistDrop, pending.item.id);
          } else if (queueTarget) {
            setRightPanel('queue'); setRightOpen(true);
            if (trackTarget?.dataset.trackId && trackTarget.dataset.trackId !== pending.item.id) {
              const after = event.clientY > trackTarget.getBoundingClientRect().top + trackTarget.getBoundingClientRect().height / 2;
              if (pending.item.sourceSection === 'Queue') reorderQueue(pending.item.id, trackTarget.dataset.trackId, after);
              else insertTrackIntoQueue(pending.item.id, trackTarget.dataset.trackId, after);
            } else if (pending.item.sourceSection !== 'Queue') insertTrackIntoQueue(pending.item.id);
          } else if (trackTarget?.dataset.trackId && trackTarget.dataset.trackId !== pending.item.id) {
            const targetSection = trackTarget.closest<HTMLElement>('[data-list-section]')?.dataset.listSection ?? section;
            const after = event.clientY > trackTarget.getBoundingClientRect().top + trackTarget.getBoundingClientRect().height / 2;
            if (targetSection.startsWith('Playlist:')) reorderPlaylistTrack(targetSection.slice(9), pending.item.id, trackTarget.dataset.trackId, after);
            else if (targetSection === 'Queue') {
              if (pending.item.sourceSection === 'Queue') reorderQueue(pending.item.id, trackTarget.dataset.trackId, after);
              else insertTrackIntoQueue(pending.item.id, trackTarget.dataset.trackId, after);
            } else { reorderGlobalTrack(pending.item.id, trackTarget.dataset.trackId, after); setSortMode('custom'); }
          }
        } else {
          const rightTarget = target?.closest<HTMLElement>('[data-right-playlist-drop]');
          if (rightTarget) { setRightPlaylist(pending.item.name); setRightPanel('playlist'); setRightOpen(true); }
        }
      }
      if (wasDragging) { suppressPlaylistClick.current = true; window.setTimeout(() => { suppressPlaylistClick.current = false; }, 180); }
      setPointerDrag(null); setDragOverPlaylist(null); setDragOverTrackId(null); setDragOverQueue(false);
    };
    const cancel = () => { pendingPointerDrag.current = null; setPointerDrag(null); setDragOverPlaylist(null); setDragOverTrackId(null); setDragOverQueue(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); };
  }, [section, playlists, playlistTracks, tracks, queueIds]);

  const dragItem = pointerDrag?.item;

  return <div className={`app-shell ${playerAtTop ? 'player-at-top' : ''} ${preferences.panelOutline ? '' : 'panels-no-outline'} ${preferences.secondaryOutline ? '' : 'secondary-no-outline'}`} data-theme={theme} data-density={density} style={{ zoom: `${zoom}%`, width: `${10000 / zoom}vw`, height: `${10000 / zoom}vh`, minHeight: `${65000 / zoom}px` }} onClick={(event) => { if (toast && !(event.target as HTMLElement).closest('.toast-message')) setToast(''); }} onPointerDown={(event) => { const target = event.target as HTMLElement; if (!target.closest('.track-menu-wrap,.track-context-menu')) setTrackMenuId(null); }}>
    {(!databaseReady || !loaderMinimumDone) && <div className="startup-loader" role="status" aria-label="Загрузка Nekto"><div className="startup-loader-mark"><Music2 size={19}/></div><div className="startup-loader-track"><span/></div></div>}
    <header className="topbar" data-tauri-drag-region>
      <button className="brand" type="button" title="На главную" onClick={() => { setQuery(''); setSection('Home'); }}><div className="brand-mark"><img src="/icons/icon.png" alt=""/></div><span><b>Nekto</b></span></button>
      <div className="top-actions"><nav className="top-section-nav" aria-label="Разделы медиатеки">{topNavItems.filter((item) => topPanelVisibility[item.id]).map((item) => <button key={item.id} className={section === item.id || (item.id === 'Playlists' && section.startsWith('Playlist:')) ? 'active' : ''} onClick={() => { setQuery(''); setSection(item.id); }}>{item.label}</button>)}</nav><button className={`home-button ${section === "Home" ? "active" : ""}`} type="button" title="На главную" aria-label="На главную" onClick={() => { setQuery(""); setSection("Home"); }}><Home size={19} fill={section === "Home" ? "currentColor" : "none"} strokeWidth={2.1}/></button><label className="search-box"><Search size={18}/><input id="library-search" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim()) setSection('All tracks'); }} placeholder="Поиск по песням, исполнителям и альбомам"/></label><button className="icon-button settings-gear" onClick={() => setSettingsOpen(true)} title="Настройки"><Settings size={18}/></button></div>
      {isTauri() && <div className="window-controls" aria-label="Управление окном"><button type="button" title="Свернуть" aria-label="Свернуть окно" onClick={() => { void getCurrentWindow().minimize(); }}><Minus size={15}/></button><button type="button" title={windowMaximized ? "Восстановить окно" : "Развернуть окно"} aria-label={windowMaximized ? "Восстановить окно" : "Развернуть окно"} onClick={() => { void getCurrentWindow().toggleMaximize(); }} className="window-maximize">{windowMaximized ? <Copy size={14} strokeWidth={1.8} className="restore-window-icon"/> : <Square size={14} strokeWidth={1.8}/>}</button><button type="button" className="window-close" title="Закрыть" aria-label="Закрыть приложение" onClick={() => { void getCurrentWindow().close(); }}><X size={16}/></button></div>}
    </header>
    <div className="workspace" style={{ gridTemplateColumns: `${sidebarHidden ? '' : `${Math.max(180, Math.min(360, sidebarWidth))}px 8px `}minmax(0, 1fr)${rightOpen ? ` 8px minmax(220px, ${Math.max(220, Math.min(360, rightWidth))}px)` : ''}` }}>
      {!sidebarHidden && <aside className={`sidebar panel ${sidebarOpen ? '' : 'drawer-collapsed'}`}>
        <div className="side-scroll">
          <div className="section-heading"><span>ПЛЕЙЛИСТЫ</span><button className="tiny-icon" onClick={createPlaylist} title="Создать плейлист"><Plus size={17}/></button></div>
          <nav className="nav-list playlist-nav">
            {playlists.map((name, index) => <button key={name} className={`${section === `Playlist:${name}` ? 'nav-item active' : 'nav-item'} ${dragOverPlaylist === name ? 'drop-target' : ''}`} onClick={(event) => { if (suppressPlaylistClick.current) { event.preventDefault(); return; } openPlaylist(name); }} data-playlist-drop={name} onPointerDown={(event) => beginPointerDrag({ kind: 'playlist', name }, event)}><div className={`mini-playlist mini-${index % 4}`}>{playlistCovers[name] ? <img src={convertFileSrc(playlistCovers[name])} alt=""/> : <ListMusic size={13}/>}</div><span className="truncate">{name}</span></button>)}
          </nav>
          <div className="side-divider"/>
          <div className="section-heading"><span>{isScanning ? 'СКАНИРОВАНИЕ МЕДИАТЕКИ…' : 'ПАПКИ'}</span><button className="tiny-icon add-folder" onClick={addFolder} title="Добавить папку"><Plus size={17}/></button></div>
          <nav className="nav-list folder-nav">
            {folders.map((folder) => { const label = folder.split(/[\\/]/).filter(Boolean).pop() || folder; return <div className="folder-nav-row" key={folder}><button className={section === `Folder:${folder}` ? 'nav-item active' : 'nav-item'} onClick={() => setSection(`Folder:${folder}`)}><Folder size={16}/><span className="truncate" title={folder}>{label}</span><span className="folder-count">{tracks.filter((t) => t.folder === folder).length}</span></button><button className="tiny-icon folder-remove" title={`Отключить ${label}`} aria-label={`Отключить папку ${label}`} onClick={() => void removeFolder(folder)}><X size={13}/></button></div>; })}
          </nav>
        </div>
      </aside>}
      {!sidebarHidden && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Изменить ширину левой панели" onPointerDown={(event) => beginResize('left', event)} onDoubleClick={() => { setSidebarWidth(246); setSidebarOpen(true); }} />}

      <main className="main-panel panel" key={section}>
        <div className="main-scroll">
          {section === 'Home' ? <>
            <div className="welcome-row"><div><div className="eyebrow">ТВОЯ МУЗЫКА · ТВОИ ПРАВИЛА</div><h1>С возвращением.</h1><p>Твоя локальная коллекция — в одном месте.</p></div><button className="subtle-button" onClick={() => setSection('All tracks')}><Music2 size={16}/>Открыть медиатеку</button></div>
            <section className="content-section home-track-section"><div className="section-title-row"><div><div className="eyebrow">ТВОЯ СТАТИСТИКА</div><h2>Чаще всего слушаешь</h2></div></div>{mostPlayedTracks.length ? <div className="home-track-grid">{mostPlayedTracks.map((track) => <button className="home-track-card" key={track.id} onClick={() => { const index = tracks.findIndex((item) => item.id === track.id); if (index >= 0) playTrackInContext(index, tracks); }}><TrackArtwork id={track.id} artwork={artwork} small/><span><b>{track.title}</b><small>{track.artist}</small></span><Play size={15}/></button>)}</div> : <div className="home-empty-hint">Здесь появятся песни, которые ты чаще всего слушаешь.</div>}</section>
            <section className="content-section home-track-section"><div className="section-title-row"><div><div className="eyebrow">ТВОЯ КОЛЛЕКЦИЯ</div><h2>Избранное</h2></div><button className="text-button" onClick={() => setSection('Favorites')}>Все избранное <ChevronDown className="rotate-270" size={14}/></button></div>{favoriteTracks.length ? <div className="home-track-grid">{favoriteTracks.map((track) => <button className="home-track-card" key={track.id} onClick={() => { const index = tracks.findIndex((item) => item.id === track.id); if (index >= 0) playTrackInContext(index, favoriteTracks); }}><TrackArtwork id={track.id} artwork={artwork} small/><span><b>{track.title}</b><small>{track.artist}</small></span><Heart size={15} fill="currentColor"/></button>)}</div> : <div className="home-empty-hint">Добавляй песни в избранное — они появятся здесь.</div>}</section>
            <section className="content-section"><div className="section-title-row"><div><div className="eyebrow">ПРОДОЛЖИТЬ</div><h2>Недавно добавленное</h2></div><button className="text-button" onClick={() => setSection('All tracks')}>Все песни <ChevronDown className="rotate-270" size={14}/></button></div><div className="album-grid">{albumGroups.slice(0,4).map(([name, items]) => { const artists = [...new Set(items.map((track) => track.artist?.trim() || 'Неизвестный исполнитель'))]; return <button className="album-card" key={name} onClick={() => setSection(`Album:${name}`)}><Cover index={name} src={items.map((track) => artwork[track.id]).find(Boolean)}/><b>{name}</b><span>{artists.length > 3 ? `${artists.slice(0, 3).join(', ')} и ещё ${artists.length - 3}` : artists.join(', ')} · ${items.length} тр.</span></button>; })}</div></section>
            <section className="content-section"><div className="section-title-row"><div><div className="eyebrow">ТВОИ КОЛЛЕКЦИИ</div><h2>Плейлисты</h2></div><button className="text-button" onClick={() => setSection('Playlists')}>Все плейлисты <ChevronDown className="rotate-270" size={14}/></button></div><div className="playlist-grid">{playlists.slice(0,4).map((name, i) => <button className="playlist-card" key={name} onClick={() => openPlaylist(name)}>{playlistCovers[name] ? <div className="playlist-art"><img src={convertFileSrc(playlistCovers[name])} alt=""/></div> : <div className={`playlist-art art-${i%4}`}><ListMusic size={28}/></div>}<div><b>{name}</b><span>{(playlistTracks[name] ?? []).length} треков</span></div></button>)}<button className="playlist-card create-card" onClick={createPlaylist}><div className="create-art"><Plus size={25}/></div><div><b>Создать плейлист</b><span>Новая коллекция</span></div></button></div></section>
          </> : section === 'Settings' ? <SettingsContent rightOpen={rightOpen} setRightOpen={setRightOpen} sidebarHidden={sidebarHidden} setSidebarHidden={(hidden) => { setSidebarHidden(hidden); if (!hidden) { setSidebarWidth(246); setSidebarOpen(true); } }} theme={theme} setTheme={setTheme} rightPanel={rightPanel} setRightPanel={setRightPanel} density={density} setDensity={setDensity} rightPanelVisibility={rightPanelVisibility} setRightPanelVisibility={setRightPanelVisibility} rightPanelOrder={rightPanelOrder} topPanelVisibility={topPanelVisibility} setTopPanelVisibility={setTopPanelVisibility} preferences={preferences} setPreferences={setPreferences} eqEnabled={eqEnabled} setEqEnabled={setEqEnabled} eqGains={eqGains} setEqGains={setEqGains} rememberLastSection={rememberLastSection} setRememberLastSection={setRememberLastSection} playerAtTop={playerAtTop} setPlayerAtTop={setPlayerAtTop} shortcuts={shortcuts} capturingShortcut={capturingShortcut} setCapturingShortcut={setCapturingShortcut} captureShortcut={captureShortcut}/> : section === 'Albums' || section === 'Artists' || section === 'Playlists' ? <><div className="eyebrow">МЕДИАТЕКА</div><div className="collection-title-row"><h1>{section === 'Albums' ? 'Альбомы' : section === 'Artists' ? 'Исполнители' : 'Плейлисты'}</h1>{section === 'Playlists' && <button className="tiny-icon collection-add-button" type="button" title="Создать плейлист" aria-label="Создать плейлист" onClick={createPlaylist}><Plus size={20}/></button>}</div><p className="collection-summary">{section === 'Albums' ? `${albumGroups.length} альбомов · ${tracks.length} композиций` : section === 'Artists' ? `${artistGroups.length} исполнителей в медиатеке` : `${playlists.length} плейлистов`}</p><div className="album-grid">{(section === 'Playlists' ? playlists.map((name) => ({ name, subtitle: 'Плейлист', count: (playlistTracks[name] ?? []).length, key: name, route: name })) : section === 'Albums' ? albumGroups.map(([name, items]) => ({ name, subtitle: [...new Set(items.map((track) => track.artist?.trim() || 'Неизвестный исполнитель'))].join(', '), count: items.length, key: `album:${name}`, route: name })) : artistGroups.map(([name, items]) => ({ name, subtitle: 'Исполнитель', count: items.length, key: `artist:${name}`, route: name }))).map((item) => <button className="album-card" key={item.key} onClick={() => section === 'Playlists' ? openPlaylist(item.name) : setSection(`${section === 'Albums' ? 'Album' : 'Artist'}:${item.route}`)}>{section === 'Playlists' && playlistCovers[item.name] ? <div className="cover"><img src={convertFileSrc(playlistCovers[item.name])} alt=""/></div> : <Cover index={item.key} src={tracks.filter((track) => section === 'Albums' ? (track.album?.trim() || 'Неизвестный альбом') === item.name : track.artist === item.name).map((track) => artwork[track.id]).find(Boolean)}/>}<b>{item.name}</b><span>{item.subtitle ? `${item.subtitle} · ` : ''}{item.count} {item.count === 1 ? 'трек' : item.count > 1 && item.count < 5 ? 'трека' : 'треков'}</span></button>)}</div>{section !== 'Playlists' && (section === 'Albums' ? albumGroups.length : artistGroups.length) === 0 && <div className="empty-state"><Music2 size={28}/><b>Пока нет данных</b><span>Добавь папку с MP3-файлами — коллекции появятся автоматически.</span></div>}</> : <>
            <div className="page-heading">{section.startsWith('Playlist:') && <div className="playlist-page-cover">{playlistCovers[section.slice(9)] ? <img src={convertFileSrc(playlistCovers[section.slice(9)])} alt=""/> : <TrackArtwork id={(playlistTracks[section.slice(9)] ?? [])[0] ?? ''} artwork={artwork}/>}</div>}{section.startsWith('Album:') && <div className="playlist-page-cover album-page-cover"><TrackArtwork id={(tracks.find((track) => (track.album?.trim() || 'Неизвестный альбом') === section.slice(6))?.id ?? '')} artwork={artwork}/></div>}<div className="eyebrow">{section.startsWith('Folder:') ? 'ПАПКА · ЛОКАЛЬНАЯ БИБЛИОТЕКА' : section.startsWith('Playlist:') ? 'ТВОЯ КОЛЛЕКЦИЯ' : section.startsWith('Album:') ? 'АЛЬБОМ' : section.startsWith('Artist:') ? 'ИСПОЛНИТЕЛЬ' : 'МЕДИАТЕКА'}</div><div className="page-title-line"><h1>{section.startsWith('Folder:') ? (section.slice(7).split(/[\\/]/).filter(Boolean).pop() || section.slice(7)) : section.startsWith('Playlist:') ? section.slice(9) : section.startsWith('Album:') ? section.slice(6) : section.startsWith('Artist:') ? section.slice(7) : section === 'Queue' ? 'Очередь воспроизведения' : section === 'Favorites' ? 'Избранное' : section === 'Recent' ? 'Недавно прослушанные' : 'Все песни'}</h1>{section.startsWith('Playlist:') && <button className="tiny-icon playlist-edit-pencil" title="Изменить название, описание и обложку" aria-label="Редактировать плейлист" onClick={() => openPlaylistEditor(section.slice(9))}><Pencil size={15}/></button>}</div><p>{section.startsWith('Playlist:') ? `${visibleTracks.length} треков · Локальный плейлист` : `${visibleTracks.length} композиций в этом разделе`}</p>{section.startsWith('Playlist:') && playlistDescriptions[section.slice(9)] && <p className="playlist-description">{playlistDescriptions[section.slice(9)]}</p>}</div>
            {section.startsWith('Playlist:') && <div className="playlist-actions"><button className="primary-button" onClick={() => playPlaylist(section.slice(9))}><Play size={16} fill="currentColor"/>Воспроизвести</button><button className="subtle-button" onClick={() => { setAddTracksPlaylist(section.slice(9)); setAddTracksQuery(''); setSelectedAddTrackIds([]); }}><Plus size={16}/>Добавить песни</button><button className="subtle-button" onClick={() => setPlaylistTracks((items) => ({...items, [section.slice(9)]: [...(items[section.slice(9)] ?? [])].sort(() => Math.random() - .5)}))}><Shuffle size={16}/>Перемешать</button><button className="subtle-button" onClick={() => addPlaylistToQueue(section.slice(9))}><ListMusic size={16}/>В очередь</button><button className="tiny-icon danger-icon" title="Удалить плейлист" onClick={() => deletePlaylist(section.slice(9))}><Trash2 size={16}/></button></div>}
            <div className="track-toolbar"><span aria-hidden="true"></span><span className="table-muted">#</span><span>Название</span><span>Альбом</span><span>Папка</span><label className="sort-control"><span>Сортировка</span><span className="sort-select-wrap"><select aria-label="Сортировка композиций" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="title">По названию</option><option value="artist">По исполнителю</option><option value="album">По альбому</option><option value="recent">По дате изменения</option><option value="duration">По длительности</option><option value="custom">Вручную</option></select><ChevronDown size={13}/></span></label></div>
            <div className="track-list" data-list-section={section}>{visibleTracks.map((track, index) => <div className={`track-row ${currentTrack.id === track.id ? 'is-current' : ''} ${dragOverTrackId === track.id ? `drop-indicator drop-${dragPosition}` : ''}`} key={track.id} data-track-id={track.id} onPointerDown={(event) => beginPointerDrag({ kind: 'track', id: track.id, sourceSection: section }, event)} onContextMenu={(event) => { event.preventDefault(); const x = Math.max(8, Math.min(event.clientX + 8, window.innerWidth - 248)); const y = Math.max(8, Math.min(event.clientY + 8, window.innerHeight - 238)); setTrackMenuPosition({ x, y }); setTrackMenuId(track.id); }} onDoubleClick={() => playTrackInContext(tracks.findIndex((t) => t.id === track.id), visibleTracks)}><span className="track-index">{currentTrack.id === track.id && playing ? <AudioLines size={15}/> : index + 1}</span><TrackArtwork id={track.id} artwork={artwork} small/><div className="track-name"><b>{track.title}</b><span>{track.artist}</span></div><span className="track-album">{track.album}</span><span className="track-folder">{track.folder.split(/[\\/]/).filter(Boolean).pop() || track.folder}</span><div className="track-end"><button className={`tiny-icon ${favorites.includes(track.id) ? 'favorite-on' : ''}`} onClick={() => toggleFavorite(track.id)} title="В избранное"><Heart size={15} fill={favorites.includes(track.id) ? 'currentColor' : 'none'}/></button><span>{track.duration}</span>{section === 'Queue' ? <><button className="tiny-icon" title="Переместить выше" onClick={() => moveQueueItem(track.id, -1)}>↑</button><button className="tiny-icon" title="Переместить ниже" onClick={() => moveQueueItem(track.id, 1)}>↓</button><button className="tiny-icon" title="Убрать из очереди" onClick={() => removeFromQueue(track.id)}><X size={14}/></button></> : <button className="tiny-icon" title="Добавить в очередь" onClick={() => { addToQueue(track.id); notify('Добавлено в очередь'); }}><ListMusic size={15}/></button>}<div className="track-menu-wrap"><button className="tiny-icon" title="Действия с песней" aria-label={`Действия: ${track.title}`} onClick={(event) => { event.stopPropagation(); const x = Math.max(8, Math.min(event.clientX + 8, window.innerWidth - 248)); const y = Math.max(8, Math.min(event.clientY + 8, window.innerHeight - 238)); setTrackMenuPosition({ x, y }); setTrackMenuId(trackMenuId === track.id ? null : track.id); }}><MoreHorizontal size={16}/></button>{trackMenuId === track.id && createPortal(<div className="track-context-menu" data-theme={theme} onPointerDown={(event) => event.stopPropagation()} style={{ position: 'fixed', left: trackMenuPosition.x, top: trackMenuPosition.y, right: 'auto' }}><div className="track-submenu-wrap"><button className="track-submenu-trigger">Добавить в плейлист <span>›</span></button><div className="track-submenu">{playlists.map((name) => <button key={name} onClick={() => addTrackToPlaylist(name, track.id)}>{name}</button>)}</div></div><button onClick={() => { addToQueue(track.id); setTrackMenuId(null); notify('Добавлено в очередь'); }}>Добавить в очередь</button><button onClick={() => { setTrackMenuId(null); toggleFavorite(track.id); }}>Избранное</button>{section.startsWith('Playlist:') && <button onClick={() => { setDeleteRequest({ kind: 'playlistTrack', name: section.slice(9), trackId: track.id }); setTrackMenuId(null); }}>Убрать из плейлиста</button>}</div>, document.body)}</div></div></div>)}</div>
            {visibleTracks.length === 0 && <div className="empty-state"><Music2 size={28}/><b>Здесь пока пусто</b><span>Добавь музыку или измени поисковый запрос.</span></div>}
          </>}
        </div>
      </main>

      {rightOpen && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Изменить ширину правой панели" onPointerDown={(event) => beginResize('right', event)} onDoubleClick={() => { setRightWidth(270); setRightOpen(true); }} />}
      {rightOpen ? <aside className="right-panel panel" data-right-playlist-drop><div className="right-head"><div><div className="eyebrow">ТВОЯ СЕССИЯ</div><h3>{rightPanel === 'history' ? 'История' : rightPanel === 'queue' ? 'Очередь воспроизведения' : rightPanel === 'playlist' ? (rightPlaylist || 'Плейлист') : 'Сейчас играет'}</h3></div><div className="right-head-actions">{rightPanel === 'playlist' && rightPlaylist && <button className="tiny-icon" title="Вернуться к текущему треку" onClick={() => setRightPanel('nowPlaying')}><X size={15}/></button>}</div></div><div className="right-tabs">{rightPanelOrder.filter((id) => rightPanelVisibility[id]).map((id) => { const item = rightPanelItems.find((entry) => entry.id === id)!; return <button key={id} data-queue-drop={id === 'queue' ? '' : undefined} className={`${rightPanel === id ? 'selected' : ''} ${id === 'queue' && dragOverQueue ? 'queue-tab-drop-active' : ''}`} onClick={() => setRightPanel(id)}>{item.label}</button>; })}</div>{rightPanel === 'queue' ? <div className={`right-track-list queue-panel-list ${dragOverQueue ? 'queue-drop-active' : ''}`} data-list-section="Queue" data-queue-drop>{queueIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)).map((track, index) => <div className={`right-track ${currentTrack.id === track.id ? 'is-current' : ''} ${dragOverTrackId === track.id ? `drop-indicator drop-${dragPosition}` : ''}`} key={`${track.id}-${index}`} data-track-id={track.id} onPointerDown={(event) => beginPointerDrag({ kind: 'track', id: track.id, sourceSection: 'Queue' }, event)}><TrackArtwork id={track.id} artwork={artwork} small/><button className="right-track-copy" onClick={(event) => { if (suppressPlaylistClick.current) { event.preventDefault(); return; } playQueueItem(track.id); }}><b>{track.title}</b><span>{track.artist}</span></button><span className="right-track-duration">{track.duration}</span><button className="tiny-icon queue-remove" title="Убрать из очереди" onClick={(event) => { if (suppressPlaylistClick.current) { event.preventDefault(); return; } removeFromQueue(track.id); }}><X size={13}/></button></div>)}{queueIds.length === 0 && <div className="empty-state"><ListMusic size={24}/><b>Очередь пуста</b><span>Перетащи сюда песню или добавь её через меню трека</span></div>}</div> : rightPanel === 'nowPlaying' ? <div className="now-playing-card"><TrackArtwork id={currentTrack.id} artwork={artwork}/><h3>{currentTrack.title}</h3><p>{currentTrack.artist}</p><div className="detail-line"><span>Альбом</span><b>{currentTrack.album}</b></div><div className="detail-line"><span>Папка</span><b>{currentTrack.folder}</b></div></div> : rightPanel === 'playlist' && rightPlaylist ? <div className="right-track-list">{(playlistTracks[rightPlaylist] ?? []).map((id) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)).map((track) => <div className="right-track" key={track.id} onDoubleClick={() => playQueueItem(track.id)}><TrackArtwork id={track.id} artwork={artwork} small/><div onClick={() => playQueueItem(track.id)}><b>{track.title}</b><span>{track.artist}</span></div><span>{track.duration}</span></div>)}</div> : <div className="right-track-list">{tracks.filter((track) => history.includes(track.id)).slice(0, 30).map((track) => <div className="right-track" key={track.id} onDoubleClick={() => playQueueItem(track.id)}><TrackArtwork id={track.id} artwork={artwork} small/><div onClick={() => playQueueItem(track.id)}><b>{track.title}</b><span>{track.artist}</span></div><span>{track.duration}</span></div>)}</div>}</aside> : null}
    </div>
    <footer className="player-bar" style={{ height: `${playerHeight}px`, minHeight: `${playerHeight}px`, '--player-scale': 1 + (playerHeight - 86) / 104 * 0.34 } as CSSProperties}><div className={`player-resize-handle ${playerAtTop ? 'resize-bottom' : ''}`} role="separator" aria-label="Изменить высоту панели плеера" onPointerDown={beginPlayerResize} title="Потяни, чтобы изменить высоту плеера"/><div className="now-playing"><button type="button" className="player-track-link" title="Перейти к играющей песне" onClick={() => { setQuery(''); setSection('All tracks'); setRevealCurrentTrack((value) => value + 1); }}><span className="player-art-button" aria-hidden="true"><TrackArtwork id={currentTrack.id} artwork={artwork} small/></span><span className="player-track-copy"><b>{currentTrack.title}</b><span>{currentTrack.artist}</span></span></button><button className={`tiny-icon ${favorites.includes(currentTrack.id) ? 'favorite-on' : ''}`} onClick={() => toggleFavorite(currentTrack.id)} title="В избранное"><Heart size={16} fill={favorites.includes(currentTrack.id) ? 'currentColor' : 'none'}/></button></div><div className="player-center"><div className="player-controls"><button className={`icon-button ${shuffle ? 'control-active' : ''}`} onClick={() => setShuffle((v) => { notify(!v ? 'Перемешивание включено' : 'Перемешивание выключено'); return !v; })} title="Перемешивание"><Shuffle size={16}/></button><button id="player-previous" className="icon-button" onClick={previousTrack} title="Предыдущий трек" aria-label="Предыдущий трек"><SkipBack size={18} fill="currentColor"/></button><button id="player-toggle" className="play-button" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={() => { if (!currentTrack.path) { setPlayError(isTauri() ? 'Добавь папку с MP3-файлами, чтобы начать воспроизведение.' : 'Локальное воспроизведение доступно в установленном приложении Nekto.'); return; } setPlaying((v) => { const next = !v; if (next && audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume().catch(() => {}); return next; }); }}>{playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button><button id="player-next" className="icon-button" onClick={nextTrack} title="Следующий трек" aria-label="Следующий трек"><SkipForward size={18} fill="currentColor"/></button><button className={`icon-button control-active`} onClick={() => setRepeat((value) => { const next = value === 'one' ? 'context' : 'one'; notify(next === 'one' ? 'Повтор одной песни включён' : 'Последовательное воспроизведение альбома или плейлиста включено'); return next; })} title={repeat === 'one' ? 'Повтор одной песни' : 'Повтор текущего альбома или плейлиста'}><Repeat2 size={16}/>{repeat === 'one' && <small className="repeat-one">1</small>}</button></div><div className="progress-row"><span>{formatTime(position)}</span><input aria-label="Позиция воспроизведения" className="seek-range" type="range" min="0" max={durationSeconds || 0} step="0.1" value={Math.min(position, durationSeconds || 0)} onChange={(e) => { const value = Number(e.target.value); setPosition(value); if (audioRef.current) audioRef.current.currentTime = value; }} disabled={!durationSeconds}/><span>{durationSeconds ? formatTime(durationSeconds) : currentTrack.duration}</span></div></div><div className="player-extra"><Volume2 size={17}/><input aria-label="Громкость" type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)}/></div></footer>
    {pointerDrag && dragItem && <div className="pointer-drag-ghost" style={{ left: pointerDrag.x + 14, top: pointerDrag.y + 14 }} aria-hidden="true">{dragItem.kind === 'track' ? <><span className="pointer-drag-cover">{artwork[dragItem.id] ? <img src={artwork[dragItem.id]} alt=""/> : '♫'}</span><span><b>{tracks.find((track) => track.id === dragItem.id)?.title ?? 'Песня'}</b><small>{tracks.find((track) => track.id === dragItem.id)?.artist ?? ''}</small></span></> : <><span className="pointer-drag-cover"><ListMusic size={16}/></span><span><b>{dragItem.name}</b><small>Плейлист</small></span></>}</div>}
    <audio ref={audioRef} preload="auto" onPlay={() => { const context = audioContextRef.current; if (context && context.state !== 'running') void context.resume().catch((error) => console.error('AudioContext resume failed:', error)); }} onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { const seconds = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0; setDurationSeconds(seconds); if (seconds > 0 && currentTrack.id) { const value = formatTime(seconds); setTracks((items) => items.map((track) => track.id === currentTrack.id && track.duration !== value ? { ...track, duration: value } : track)); } }} onEnded={() => { if (repeat === 'one' && audioRef.current) { audioRef.current.currentTime = 0; void audioRef.current.play(); } else nextTrack(); }} onError={() => { if (playing) { setPlaying(false); setPlayError('Ошибка чтения MP3-файла. Возможно, формат или файл повреждён.'); } }} />
    {playError && <div className="play-error" role="status">{playError}<button onClick={() => setPlayError('')} aria-label="Закрыть"><X size={14}/></button></div>}

    {createPlaylistOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatePlaylistOpen(false); }}><div className="create-playlist-modal" role="dialog" aria-modal="true" aria-labelledby="create-playlist-title"><div className="modal-head"><div><div className="eyebrow">НОВАЯ КОЛЛЕКЦИЯ</div><h2 id="create-playlist-title">Создать плейлист</h2><p>Собери музыку под настроение, занятие или момент</p></div><button className="icon-button" onClick={() => setCreatePlaylistOpen(false)} aria-label="Закрыть"><X size={18}/></button></div><div className="create-playlist-body"><button className="playlist-cover-picker" onClick={() => void chooseDraftPlaylistCover()}>{playlistDraftCover ? <img src={convertFileSrc(playlistDraftCover)} alt="Обложка плейлиста"/> : <><ImagePlus size={25}/><span>Добавить обложку</span><small>PNG, JPG или WEBP</small></>}</button><div className="create-playlist-fields"><label><span>Название</span><input autoFocus maxLength={48} value={playlistDraftName} onChange={(event) => setPlaylistDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitCreatePlaylist(); }} placeholder="Например, Late night"/></label><label><span>Описание <small>необязательно</small></span><textarea maxLength={240} value={playlistDraftDescription} onChange={(event) => setPlaylistDraftDescription(event.target.value)} placeholder="Коротко опиши настроение плейлиста"/></label></div></div><div className="modal-foot"><button className="subtle-button" onClick={() => setCreatePlaylistOpen(false)}>Отмена</button><button className="primary-button" disabled={!playlistDraftName.trim()} onClick={submitCreatePlaylist}><Plus size={16}/>Создать плейлист</button></div></div></div>}
    {editingPlaylist && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingPlaylist(null); }}><div className="create-playlist-modal edit-playlist-modal" role="dialog" aria-modal="true" aria-labelledby="edit-playlist-title"><div className="modal-head"><div><div className="eyebrow">НАСТРОЙКИ КОЛЛЕКЦИИ</div><h2 id="edit-playlist-title">Редактировать плейлист</h2><p>Измени название, описание или обложку</p></div><button className="icon-button" onClick={() => setEditingPlaylist(null)} aria-label="Закрыть"><X size={18}/></button></div><div className="create-playlist-body"><button className="playlist-cover-picker" onClick={() => void choosePlaylistCover(editingPlaylist)}>{playlistCovers[editingPlaylist] ? <img src={convertFileSrc(playlistCovers[editingPlaylist])} alt="Обложка плейлиста"/> : <><ImagePlus size={25}/><span>Добавить обложку</span><small>PNG, JPG или WEBP</small></>}</button><div className="create-playlist-fields"><label><span>Название</span><input autoFocus maxLength={48} value={editPlaylistName} onChange={(event) => setEditPlaylistName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') savePlaylistEdits(); }} placeholder="Название плейлиста"/></label><label><span>Описание <small>необязательно</small></span><textarea maxLength={240} value={editPlaylistDescription} onChange={(event) => setEditPlaylistDescription(event.target.value)} placeholder="Коротко опиши настроение плейлиста"/></label></div></div><div className="modal-foot"><button className="subtle-button" onClick={() => setEditingPlaylist(null)}>Отмена</button><button className="primary-button" onClick={savePlaylistEdits}><Check size={16}/>Сохранить</button></div></div></div>}
    {deleteRequest && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteRequest(null); }}><div className="confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title"><div className="delete-modal-icon"><Trash2 size={22}/></div><div className="eyebrow">ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ</div><h2 id="delete-confirm-title">{deleteRequest.kind === 'folder' ? `Отключить папку «${deleteRequest.name.split(/[\\/]/).filter(Boolean).pop() || deleteRequest.name}»?` : deleteRequest.kind === 'playlist' ? `Удалить плейлист «${deleteRequest.name}»?` : 'Убрать песню?'}</h2><p>{deleteRequest.kind === 'folder' ? 'Папка будет отключена от медиатеки. Музыкальные файлы и сама папка останутся на диске.' : deleteRequest.kind === 'playlist' ? 'Плейлист и его список композиций будут удалены из Nekto. Исходные MP3-файлы останутся на компьютере.' : deleteRequest.kind === 'playlistTrack' ? `«${tracks.find((track) => track.id === deleteRequest.trackId)?.title ?? 'Песня'}» будет удалена из плейлиста «${deleteRequest.name}». Файл на диске не изменится.` : `«${tracks.find((track) => track.id === deleteRequest.trackId)?.title ?? 'Песня'}» будет удалена только из очереди воспроизведения.`}</p><div className="modal-foot"><button className="subtle-button" onClick={() => setDeleteRequest(null)}>Отмена</button><button className="danger-button" onClick={confirmRequestedDelete}><Trash2 size={15}/>{deleteRequest.kind === 'folder' ? 'Отключить папку' : 'Удалить'}</button></div></div></div>}
    {addTracksPlaylist && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddTracksPlaylist(null); }}><div className="add-tracks-modal"><div className="modal-head"><div><div className="eyebrow">ПЛЕЙЛИСТ</div><h2>Добавить песни</h2><p>Выбери композиции для «{addTracksPlaylist}»</p></div><button className="icon-button" onClick={() => setAddTracksPlaylist(null)}><X size={18}/></button></div><label className="add-track-search"><Search size={16}/><input autoFocus value={addTracksQuery} onChange={(event) => setAddTracksQuery(event.target.value)} placeholder="Поиск по названию или исполнителю"/></label><div className="add-track-picker">{tracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(addTracksQuery.toLowerCase())).map((track) => <label key={track.id} className="add-track-option"><input type="checkbox" checked={selectedAddTrackIds.includes(track.id) || (playlistTracks[addTracksPlaylist] ?? []).includes(track.id)} disabled={(playlistTracks[addTracksPlaylist] ?? []).includes(track.id)} onChange={(event) => setSelectedAddTrackIds((items) => event.target.checked ? [...items, track.id] : items.filter((id) => id !== track.id))}/><TrackArtwork id={track.id} artwork={artwork} small/><span><b>{track.title}</b><small>{track.artist} · {track.album}</small></span>{(playlistTracks[addTracksPlaylist] ?? []).includes(track.id) && <small>Уже добавлено</small>}</label>)}</div><div className="modal-foot"><span>Выбрано: {selectedAddTrackIds.length}</span><button className="primary-button" onClick={() => { selectedAddTrackIds.forEach((id) => addTrackToPlaylist(addTracksPlaylist, id)); setAddTracksPlaylist(null); }}>Добавить выбранные</button></div></div></div>}
    {toast && <div className="toast-message" role="status" aria-live="polite" onClick={() => setToast('')}>{toast}</div>}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={(e) => {if (e.target === e.currentTarget) setSettingsOpen(false)}}><div className="settings-modal"><div className="modal-head"><div><div className="eyebrow">ПЕРСОНАЛИЗАЦИЯ</div><h2>Настройки</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)}><X size={19}/></button></div><SettingsContent rightOpen={rightOpen} setRightOpen={setRightOpen} sidebarHidden={sidebarHidden} setSidebarHidden={(hidden) => { setSidebarHidden(hidden); if (!hidden) { setSidebarWidth(246); setSidebarOpen(true); } }} theme={theme} setTheme={setTheme} rightPanel={rightPanel} setRightPanel={setRightPanel} density={density} setDensity={setDensity} rightPanelVisibility={rightPanelVisibility} setRightPanelVisibility={setRightPanelVisibility} rightPanelOrder={rightPanelOrder} topPanelVisibility={topPanelVisibility} setTopPanelVisibility={setTopPanelVisibility} preferences={preferences} setPreferences={setPreferences} eqEnabled={eqEnabled} setEqEnabled={setEqEnabled} eqGains={eqGains} setEqGains={setEqGains} rememberLastSection={rememberLastSection} setRememberLastSection={setRememberLastSection} playerAtTop={playerAtTop} setPlayerAtTop={setPlayerAtTop} shortcuts={shortcuts} capturingShortcut={capturingShortcut} setCapturingShortcut={setCapturingShortcut} captureShortcut={captureShortcut}/><div className="modal-foot"><span>Масштаб: {zoom}% · Ctrl + колесо · Ctrl+0 сброс</span><button className="primary-button" onClick={() => setSettingsOpen(false)}>Готово</button></div></div></div>}
  </div>;
}

function SettingsContent({ rightOpen, setRightOpen, sidebarHidden, setSidebarHidden, theme, setTheme, rightPanel, setRightPanel, density, setDensity, rightPanelVisibility, setRightPanelVisibility, rightPanelOrder, topPanelVisibility, setTopPanelVisibility, preferences, setPreferences, eqEnabled, setEqEnabled, eqGains, setEqGains, rememberLastSection, setRememberLastSection, playerAtTop, setPlayerAtTop, shortcuts, capturingShortcut, setCapturingShortcut, captureShortcut }: {
  rightOpen: boolean; setRightOpen: (open: boolean) => void; sidebarHidden: boolean; setSidebarHidden: (hidden: boolean) => void;
  theme: Theme; setTheme: (t: Theme) => void; rightPanel: RightPanel; setRightPanel: (p: RightPanel) => void;
  density: Density; setDensity: (d: Density) => void; rightPanelVisibility: Record<RightPanel, boolean>;
  setRightPanelVisibility: (v: Record<RightPanel, boolean>) => void; rightPanelOrder: RightPanel[];
  topPanelVisibility: Record<TopNavId, boolean>; setTopPanelVisibility: (v: Record<TopNavId, boolean>) => void;
  preferences: Preferences; setPreferences: (p: Preferences) => void; eqEnabled: boolean; setEqEnabled: (enabled: boolean) => void;
  eqGains: number[]; setEqGains: (gains: number[] | ((current: number[]) => number[])) => void;
  rememberLastSection: boolean; setRememberLastSection: (v: boolean) => void; playerAtTop: boolean; setPlayerAtTop: (v: boolean) => void;
  shortcuts: ShortcutMap; capturingShortcut: ShortcutId | null; setCapturingShortcut: (id: ShortcutId | null) => void;
  captureShortcut: (id: ShortcutId, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  type SettingsTab = 'appearance' | 'navigation' | 'layout' | 'behavior' | 'equalizer';
  const tabs: { id: SettingsTab; label: string; description: string }[] = [
    { id: 'appearance', label: 'Внешний вид', description: 'Темы, контуры и анимации' },
    { id: 'navigation', label: 'Навигация', description: 'Разделы верхней и правой панели' },
    { id: 'layout', label: 'Компоновка', description: 'Размеры и расположение панелей' },
    { id: 'behavior', label: 'Поведение', description: 'Удобство, запуск и горячие клавиши' },
    { id: 'equalizer', label: 'Эквалайзер', description: 'Точная настройка звучания' },
  ];
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const bands = [
    { label: '32', unit: 'Hz' }, { label: '64', unit: 'Hz' }, { label: '125', unit: 'Hz' },
    { label: '250', unit: 'Hz' }, { label: '500', unit: 'Hz' }, { label: '1K', unit: '' },
    { label: '2K', unit: '' }, { label: '4K', unit: '' }, { label: '8K', unit: '' }, { label: '16K', unit: '' },
  ];
  const presets: { name: string; values: number[] }[] = [
    { name: 'Плоский', values: Array(11).fill(0) },
    { name: 'Dance', values: [0, 0, 4, 5, 3, 0, 2, 4, 5, 4, 0] },
    { name: 'Bass Boost', values: [2, 6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
    { name: 'Vocal', values: [0, -2, -1, 1, 3, 4, 3, 2, 0, -1, -2] },
    { name: 'Rock', values: [1, 4, 3, 1, -1, 0, 2, 3, 4, 4, 2] },
  ];
  const [preset, setPreset] = useState('Пользовательский');
  const updateGain = (index: number, value: number) => {
    setEqGains((current) => current.map((gain, i) => i === index ? value : gain));
    setPreset('Пользовательский');
  };
  const toggle = (title: string, description: string, checked: boolean, onChange: (value: boolean) => void) => (
    <label className="toggle-row" key={title}><span><b>{title}</b><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/></label>
  );
  return <div className="settings-content" data-tab={activeTab}>
    <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
      {tabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`settings-panel-${tab.id}`} id={`settings-tab-${tab.id}`} className={activeTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
    </div>
    <div className="settings-tab-intro"><h3>{tabs.find((tab) => tab.id === activeTab)?.label}</h3><p>{tabs.find((tab) => tab.id === activeTab)?.description}</p></div>

    {activeTab === 'appearance' && <section className="settings-section" id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
      <div className="settings-section-title"><div><h3>Оформление</h3><p>Выбери цветовую систему Nekto</p></div><SlidersHorizontal size={18}/></div>
      <div className="theme-grid">{themeNames.map((item) => <button type="button" key={item.id} className={`theme-option ${theme === item.id ? 'chosen' : ''}`} onClick={() => setTheme(item.id)}><div className={`theme-preview preview-${item.id}`}><i/><i/><i/></div><div className="theme-option-copy"><b>{item.name}</b><span>{item.note}</span></div>{theme === item.id && <Check size={16} className="theme-check"/>}</button>)}</div>
      <div className="settings-section-title"><div><h3>Границы и движение</h3><p>Настрой визуальную выразительность интерфейса</p></div></div>
      <div className="settings-option-list">
        {toggle('Обводка основных панелей', 'Тонкая рамка вокруг главных областей приложения', preferences.panelOutline, (value) => setPreferences({ ...preferences, panelOutline: value }))}
        {toggle('Обводка второстепенных элементов', 'Рамки карточек, кнопок и вложенных блоков', preferences.secondaryOutline, (value) => setPreferences({ ...preferences, secondaryOutline: value }))}
        {toggle('Уменьшить анимации', 'Отключить декоративные переходы и микровзаимодействия', preferences.reduceMotion, (value) => setPreferences({ ...preferences, reduceMotion: value }))}
      </div>
    </section>}

    {activeTab === 'navigation' && <section className="settings-section" id="settings-panel-navigation" role="tabpanel" aria-labelledby="settings-tab-navigation">
      <div className="settings-section-title"><div><h3>Верхняя панель</h3><p>Выбери разделы медиатеки, которые будут отображаться сверху</p></div></div>
      <div className="settings-option-list">{topNavItems.map((item) => toggle(item.label, 'Показывать этот раздел в верхней навигации', topPanelVisibility[item.id], (value) => { const next = { ...topPanelVisibility, [item.id]: value }; if (Object.values(next).some(Boolean)) setTopPanelVisibility(next); }))}</div>
      <div className="settings-section-title"><div><h3>Правая панель</h3><p>Какие инструменты доступны в панели текущей сессии</p></div><PanelRight size={18}/></div>
      <div className="settings-option-list">{rightPanelItems.map((item) => toggle(item.label === 'Трек' ? 'Информация о треке' : item.label, 'Показывать эту вкладку справа', rightPanelVisibility[item.id], (value) => { const next = { ...rightPanelVisibility, [item.id]: value }; if (!rightPanelOrder.some((id) => next[id])) return; setRightPanelVisibility(next); if (!next[rightPanel]) setRightPanel(rightPanelOrder.find((id) => next[id]) ?? 'nowPlaying'); }))}</div>
    </section>}

    {activeTab === 'layout' && <section className="settings-section" id="settings-panel-layout" role="tabpanel" aria-labelledby="settings-tab-layout">
      <div className="settings-section-title"><div><h3>Панели приложения</h3><p>Управляй видимостью и расположением областей</p></div><PanelRight size={18}/></div>
      <div className="settings-option-list">
        {toggle('Скрыть левую панель', 'Полностью убрать панель библиотеки. При повторном включении вернётся стандартная ширина.', sidebarHidden, setSidebarHidden)}
        {toggle('Скрыть правую панель', 'Убрать панель текущей сессии. При включении она вернётся в правую колонку.', !rightOpen, (value) => setRightOpen(!value))}
      </div>
      <div className="settings-section-title"><div><h3>Плотность интерфейса</h3><p>Выбери расстояние между элементами</p></div></div>
      <div className="density-choice"><button type="button" className={density === 'comfortable' ? 'choice-active' : ''} onClick={() => setDensity('comfortable')}>Комфортная плотность</button><button type="button" className={density === 'compact' ? 'choice-active' : ''} onClick={() => setDensity('compact')}>Компактная плотность</button></div>
      <div className="settings-section-title"><div><h3>Положение плеера</h3><p>Расположение панели воспроизведения</p></div></div>
      <div className="density-choice"><button type="button" className={!playerAtTop ? 'choice-active' : ''} onClick={() => setPlayerAtTop(false)}>Плеер снизу</button><button type="button" className={playerAtTop ? 'choice-active' : ''} onClick={() => setPlayerAtTop(true)}>Плеер сверху</button></div>
      <p className="layout-hint">Ширину боковых панелей можно менять перетаскиванием вертикального разделителя. Двойной щелчок возвращает стандартную ширину.</p>
    </section>}

    {activeTab === 'behavior' && <section className="settings-section" id="settings-panel-behavior" role="tabpanel" aria-labelledby="settings-tab-behavior">
      <div className="settings-section-title"><div><h3>Поведение приложения</h3><p>Настройки удобства и безопасности</p></div><Settings size={18}/></div>
      <div className="settings-option-list">
        {toggle('Подтверждать отключение папок', 'Спрашивать перед исключением папки из медиатеки', preferences.confirmBeforeDelete, (value) => setPreferences({ ...preferences, confirmBeforeDelete: value }))}
        {toggle('Запоминать последний раздел', 'Открывать тот же раздел при следующем запуске', rememberLastSection, setRememberLastSection)}
      </div>
      <div className="shortcut-list"><h4>Горячие клавиши</h4><p className="shortcut-hint">Нажми на сочетание и введи новое. Esc отменяет запись.</p>{shortcutItems.map((item) => <div className="shortcut-row" key={item.id}><span>{item.label}</span><button type="button" className={`shortcut-capture ${capturingShortcut === item.id ? 'is-recording' : ''}`} onClick={() => setCapturingShortcut(item.id)} onKeyDown={(event) => captureShortcut(item.id, event)}>{capturingShortcut === item.id ? 'Нажми клавиши…' : displayShortcut(shortcuts[item.id])}</button></div>)}<button type="button" className="shortcut-reset" onClick={() => { localStorage.removeItem('nekto-shortcuts'); window.location.reload(); }}>Сбросить сочетания</button></div>
    </section>}

    {activeTab === 'equalizer' && <section className="settings-section equalizer-section" id="settings-panel-equalizer" role="tabpanel" aria-labelledby="settings-tab-equalizer">
      <div className="settings-section-title"><div><h3>10-полосный эквалайзер</h3><p>От −12 dB до +12 dB · изменения применяются к текущему воспроизведению</p></div><AudioLines size={18}/></div>
      <div className="eq-toolbar">{toggle('Эквалайзер', 'Включить обработку частот', eqEnabled, setEqEnabled)}<label className="eq-preset"><span>Пресет</span><select value={preset} onChange={(event) => { const selected = presets.find((item) => item.name === event.target.value); if (selected) { setEqGains(selected.values); setPreset(selected.name); } }}><option value="Пользовательский">Пользовательский</option>{presets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label></div>
      <div className="eq-panel"><div className="eq-scale"><span>+12 dB</span><span>0 dB</span><span>−12 dB</span></div>
        <label className="eq-band eq-preamp"><span>Preamp</span><input aria-label="Предусилитель" type="range" min="-12" max="12" step="1" value={eqGains[0] ?? 0} disabled={!eqEnabled} onChange={(event) => updateGain(0, Number(event.target.value))}/><b>{eqGains[0] ?? 0} dB</b></label>
        {bands.map((band, index) => <label className="eq-band" key={band.label}><input aria-label={`${band.label} ${band.unit}`} type="range" min="-12" max="12" step="1" value={eqGains[index + 1] ?? 0} disabled={!eqEnabled} onChange={(event) => updateGain(index + 1, Number(event.target.value))}/><span>{band.label}{band.unit && <small> {band.unit}</small>}</span><b>{eqGains[index + 1] ?? 0} dB</b></label>)}
      </div>
      <div className="eq-footer"><span>Положение ползунка соответствует уровню усиления частоты</span><button type="button" className="shortcut-reset" onClick={() => { setEqGains(Array(11).fill(0)); setPreset('Плоский'); }}>Сбросить эквалайзер</button></div>
    </section>}
  </div>;
}
