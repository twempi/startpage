// ========================================
// Runtime Settings
// ========================================

const STARTPAGE_SETTINGS_URL = STARTPAGE_SETTINGS_API_URL;
const STARTPAGE_USE_LOCAL_SETTINGS_CACHE = window.STARTPAGE_USE_LOCAL_SETTINGS_CACHE === true;
const STARTPAGE_SETTINGS_CACHE_KEY = 'startpage-central-settings-v1';
const STARTPAGE_SETTINGS_TIMEOUT_MS = 2000;

window.STARTPAGE_SETTINGS = {};
let _startpageSettingsCanSave = false;
let _startpageSettingsChecking = false;

function setStartpageSyncStatus(state, message) {
  const status = document.getElementById('settings-sync-status');
  if (!status) return;
  status.dataset.state = state;
  status.textContent = message;
}

function markStartpageSettingsStale() {
  _startpageSettingsCanSave = false;
  setStartpageSyncStatus('stale', 'Newer settings available — reload before saving');
}

function markStartpageSettingsSynced() {
  _startpageSettingsCanSave = !!window.STARTPAGE_SETTINGS._revision;
  setStartpageSyncStatus('synced', 'Synced');
}

function _cloneSettingValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function _isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function _cleanString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function _normalizeBookmarkList(value, fallback) {
  if (!Array.isArray(value)) return _cloneSettingValue(fallback);
  const bookmarks = value
    .filter(item => _isPlainObject(item))
    .map(item => {
      const href = _cleanString(item.href);
      const title = _cleanString(item.title, href);
      const category = _cleanString(item.category);
      if (!href || !title) return null;
      return {
        href,
        title,
        ...(category ? { category } : {})
      };
    })
    .filter(Boolean);
  return bookmarks.length ? bookmarks : _cloneSettingValue(fallback);
}

function _normalizeOptionalBookmarkList(value, fallback = []) {
  if (!Array.isArray(value)) return _cloneSettingValue(fallback);
  return value
    .filter(item => _isPlainObject(item))
    .map(item => {
      const href = _cleanString(item.href);
      const title = _cleanString(item.title, href);
      const category = _cleanString(item.category);
      if (!href || !title) return null;
      return {
        href,
        title,
        ...(category ? { category } : {})
      };
    })
    .filter(Boolean);
}

function _normalizeStringMap(value) {
  if (!_isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, val]) => [String(key).trim(), typeof val === 'string' ? val.trim() : ''])
      .filter(([key, val]) => key && val)
  );
}

function _normalizeSyntaxColors(value) {
  if (!_isPlainObject(value)) return {};
  const validKeys = Object.keys(DEFAULT_SYNTAX_COLORS);
  const colors = {};
  validKeys.forEach(key => {
    const color = value[key];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim())) {
      colors[key] = color.trim().toLowerCase();
    }
  });
  return colors;
}

function _normalizeCustomTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => _isPlainObject(item))
    .map(item => {
      const prefix = _cleanString(item.prefix).toLowerCase().replace(/[^a-z0-9]/g, '');
      const url = _cleanString(item.url);
      return prefix && url ? { prefix, url } : null;
    })
    .filter(Boolean);
}

function _normalizeDirExtensions(value) {
  if (!_isPlainObject(value)) return {};
  const result = {};
  Object.entries(value).forEach(([key, exts]) => {
    if (!Array.isArray(exts)) return;
    const cleanExts = exts
      .map(ext => String(ext || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    if (cleanExts.length) result[key] = [...new Set(cleanExts)];
  });
  return result;
}

function _normalizePromptList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(prompt => typeof prompt === 'string' ? prompt.trim() : '')
    .filter(Boolean);
}

function normalizeStartpageSettings(raw) {
  const input = _isPlainObject(raw) ? raw : {};
  const weatherUnit = String(input.weatherUnit || '').toLowerCase();
  const badgeMode = String(input.aiRouteBadgeMode || '').toLowerCase();
  const searchEngine = String(input.searchEngine || '').toLowerCase();
  const theme = String(input.theme || '').toLowerCase();

  return {
    _schemaVersion: 1,
    ...(typeof input._revision === 'string' && /^[a-f0-9]{64}$/.test(input._revision)
      ? { _revision: input._revision } : {}),
    username: _cleanString(input.username, DEFAULT_USERNAME),
    weatherLocation: _cleanString(input.weatherLocation, DEFAULT_WEATHER_LOCATION),
    weatherUnit: ['celsius', 'fahrenheit'].includes(weatherUnit) ? weatherUnit : DEFAULT_WEATHER_UNIT,
    timezone: input.timezone === null ? DEFAULT_TIMEZONE : _cleanString(input.timezone, DEFAULT_TIMEZONE),
    aiModeEnabled: typeof input.aiModeEnabled === 'boolean' ? input.aiModeEnabled : DEFAULT_AI_MODE_ENABLED,
    aiRouteBadgeMode: ['live', 'route', 'off'].includes(badgeMode) ? badgeMode : DEFAULT_AI_ROUTE_BADGE_MODE,
    searchEngine: isValidSearchEngine(searchEngine) ? searchEngine : DEFAULT_SEARCH_ENGINE,
    theme: THEMES.includes(theme) ? theme : DEFAULT_THEME,
    bookmarks: _normalizeBookmarkList(input.bookmarks, DEFAULT_BOOKMARKS),
    shelfBookmarks: _normalizeOptionalBookmarkList(input.shelfBookmarks, DEFAULT_SHELF_BOOKMARKS),
    syntaxColors: _normalizeSyntaxColors(input.syntaxColors),
    searchOverrides: _normalizeStringMap(input.searchOverrides),
    customTags: _normalizeCustomTags(input.customTags),
    dirExtensions: _normalizeDirExtensions(input.dirExtensions),
    terminalPrompts: _normalizePromptList(input.terminalPrompts)
  };
}

function _readCachedStartpageSettings() {
  if (!STARTPAGE_USE_LOCAL_SETTINGS_CACHE) return null;
  try {
    const raw = window.localStorage.getItem(STARTPAGE_SETTINGS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return _isPlainObject(cached) ? cached : null;
  } catch (err) {
    console.warn(`Ignoring cached startpage settings: ${err.message}`);
    return null;
  }
}

function cacheStartpageSettings(raw) {
  if (!STARTPAGE_USE_LOCAL_SETTINGS_CACHE) return;
  try {
    window.localStorage.setItem(
      STARTPAGE_SETTINGS_CACHE_KEY,
      JSON.stringify(normalizeStartpageSettings(raw))
    );
  } catch (err) {
    console.warn(`Could not cache startpage settings: ${err.message}`);
  }
}

function clearStartpageSettingsCache() {
  if (!STARTPAGE_USE_LOCAL_SETTINGS_CACHE) return;
  window.localStorage.removeItem(STARTPAGE_SETTINGS_CACHE_KEY);
  _startpageSettingsCanSave = false;
}

function canSaveStartpageSettings() {
  return _startpageSettingsCanSave;
}

async function _fetchStartpageSettings() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STARTPAGE_SETTINGS_TIMEOUT_MS);
  try {
    const res = await fetch(STARTPAGE_SETTINGS_URL, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const settings = await res.json();
    if (!_isPlainObject(settings) || typeof settings._revision !== 'string'
      || !/^[a-f0-9]{64}$/.test(settings._revision)) {
      throw new Error('Settings revision is missing');
    }
    return settings;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkStartpageSettings() {
  if (_startpageSettingsChecking) return;
  _startpageSettingsChecking = true;
  const revision = window.STARTPAGE_SETTINGS._revision;
  try {
    const fresh = await _fetchStartpageSettings();
    // A save may have completed while this request was in flight.
    if (window.STARTPAGE_SETTINGS._revision !== revision) return;
    cacheStartpageSettings(fresh);
    if (fresh._revision !== revision) {
      markStartpageSettingsStale();
    } else {
      markStartpageSettingsSynced();
    }
  } catch (err) {
    if (window.STARTPAGE_SETTINGS._revision === revision) {
      setStartpageSyncStatus('offline', 'Using local settings — server unavailable');
    }
  } finally {
    _startpageSettingsChecking = false;
  }
}

async function loadStartpageSettings() {
  _startpageSettingsCanSave = false;
  setStartpageSyncStatus('loading', 'Syncing settings…');
  let raw;
  try {
    raw = await _fetchStartpageSettings();
    cacheStartpageSettings(raw);
    setStartpageSyncStatus('synced', 'Synced');
  } catch (err) {
    const cached = _readCachedStartpageSettings();
    raw = cached || {};
    setStartpageSyncStatus('offline', cached
      ? 'Using cached settings — server unavailable'
      : 'Using defaults — server unavailable; reload before saving');
    console.warn(`Could not load startpage settings: ${err.message}`);
  }

  window.STARTPAGE_SETTINGS = normalizeStartpageSettings(raw);
  _startpageSettingsCanSave = !!window.STARTPAGE_SETTINGS._revision;
  return window.STARTPAGE_SETTINGS;
}
