const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const cacheKey = 'startpage-central-settings-v1';
const revision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.default.json'), 'utf8'));
const settings = (username, rev = revision) => ({ ...defaults, username, _revision: rev });
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });

function createRuntime(cached, useCache = true) {
  const values = new Map(cached ? [[cacheKey, JSON.stringify(cached)]] : []);
  const timers = new Map();
  const status = { dataset: {}, textContent: '' };
  const requests = [];
  const toasts = [];
  let fetchImpl = async () => response(settings('fresh'));
  const window = {
    STARTPAGE_USE_LOCAL_SETTINGS_CACHE: useCache,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    }
  };
  const context = vm.createContext({
    window,
    document: { getElementById: () => status },
    fetch: (url, options) => {
      requests.push({ url, ...options });
      return fetchImpl(url, options);
    },
    AbortController,
    TypeError,
    setTimeout: callback => { const id = {}; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    console: { warn: () => {} },
    THEMES: ['stylix'],
    showToast: (...args) => toasts.push(args)
  });
  for (const file of ['storage.js', 'runtime-settings.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script', file), 'utf8'), context, { filename: file });
  }
  return { context, values, window, status, requests, toasts, timers,
    fetch: implementation => { fetchImpl = implementation; } };
}

async function run() {
  // Initialization waits for fresh settings and applies them on the first load.
  const fresh = createRuntime(settings('cached'));
  let resolveFetch;
  fresh.fetch(() => new Promise(resolve => { resolveFetch = resolve; }));
  const loading = fresh.context.loadStartpageSettings();
  assert.equal(fresh.context.canSaveStartpageSettings(), false);
  assert.equal(fresh.status.dataset.state, 'loading');
  resolveFetch(response(settings('fresh')));
  await loading;
  assert.equal(fresh.window.STARTPAGE_SETTINGS.username, 'fresh');
  assert.equal(JSON.parse(fresh.values.get(cacheKey)).username, 'fresh');
  assert.equal(fresh.status.dataset.state, 'synced');
  assert.equal(fresh.context.canSaveStartpageSettings(), true);
  assert.equal(fresh.timers.size, 0);
  assert.equal(fresh.requests[0].url, '/api/settings');

  // A hung request is aborted, with a cache fallback at the deadline.
  const offline = createRuntime(settings('cached'));
  offline.fetch((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const timedLoad = offline.context.loadStartpageSettings();
  [...offline.timers.values()][0]();
  await timedLoad;
  assert.equal(offline.window.STARTPAGE_SETTINGS.username, 'cached');
  assert.equal(offline.status.dataset.state, 'offline');
  assert.equal(offline.context.canSaveStartpageSettings(), true);
  assert.equal(offline.timers.size, 0);

  // Legacy caches and a first offline visit cannot overwrite central settings.
  for (const cached of [null, { ...defaults, username: 'legacy' }]) {
    const runtime = createRuntime(cached);
    runtime.fetch(async () => { throw new TypeError('offline'); });
    await runtime.context.loadStartpageSettings();
    assert.equal(runtime.status.dataset.state, 'offline');
    assert.equal(runtime.context.canSaveStartpageSettings(), false);
    await assert.rejects(runtime.context.saveStartpageSettings({ username: 'edit' }), /Reload/);
    assert.equal(runtime.requests.length, 1);
  }

  // Hosted pages also fetch fresh settings, without enabling a browser cache.
  const hosted = createRuntime(null, false);
  await hosted.context.loadStartpageSettings();
  assert.equal(hosted.window.STARTPAGE_SETTINGS.username, 'fresh');
  assert.equal(hosted.values.size, 0);

  // Old APIs or malformed responses must not be treated as synced settings.
  for (const reply of [response(defaults), response({ error: 'old API' }, 405)]) {
    const runtime = createRuntime(settings('cached'));
    runtime.fetch(async () => reply);
    await runtime.context.loadStartpageSettings();
    assert.equal(runtime.window.STARTPAGE_SETTINGS.username, 'cached');
    assert.equal(runtime.status.dataset.state, 'offline');
  }

  // Returning to a stale tab detects changes without replacing open edits.
  const stale = createRuntime(null);
  await stale.context.loadStartpageSettings();
  stale.fetch(async () => response(settings('other machine', nextRevision)));
  await stale.context.checkStartpageSettings();
  assert.equal(stale.window.STARTPAGE_SETTINGS.username, 'fresh');
  assert.equal(JSON.parse(stale.values.get(cacheKey)).username, 'other machine');
  assert.equal(stale.status.dataset.state, 'stale');
  assert.equal(stale.context.canSaveStartpageSettings(), false);

  // A successful save sends the loaded revision and adopts the new one.
  fresh.fetch(async () => response({ ok: true, settings: settings('saved', nextRevision) }));
  await fresh.context.saveStartpageSettings({ username: 'saved' });
  assert.equal(JSON.parse(fresh.requests.at(-1).body)._revision, revision);
  assert.equal(fresh.window.STARTPAGE_SETTINGS._revision, nextRevision);
  assert.equal(JSON.parse(fresh.values.get(cacheKey)).username, 'saved');
  assert.equal(fresh.status.dataset.state, 'synced');

  // A conflicting save preserves local data, reports the conflict, and blocks retries.
  fresh.fetch(async () => response({ ok: false, error: 'Newer settings; reload before saving' }, 409));
  await assert.rejects(fresh.context.saveStartpageSettings({ username: 'lost edit' }), /reload/);
  assert.equal(fresh.window.STARTPAGE_SETTINGS.username, 'saved');
  assert.equal(JSON.parse(fresh.values.get(cacheKey)).username, 'saved');
  assert.equal(fresh.status.dataset.state, 'stale');
  assert.equal(fresh.context.canSaveStartpageSettings(), false);
  assert.match(fresh.toasts.at(-1)[0], /Could not save settings/);

  // A failed save never updates the cache or claims success.
  offline.fetch(async () => { throw new TypeError('offline'); });
  await assert.rejects(offline.context.saveStartpageSettings({ username: 'unsaved' }), /offline/);
  assert.equal(offline.status.dataset.state, 'offline');
  assert.equal(JSON.parse(offline.values.get(cacheKey)).username, 'cached');

  // A delayed check must not undo a save that completed after it started.
  const race = createRuntime(null);
  await race.context.loadStartpageSettings();
  race.fetch(() => new Promise(resolve => { resolveFetch = resolve; }));
  const checking = race.context.checkStartpageSettings();
  race.fetch(async () => response({ ok: true, settings: settings('saved', nextRevision) }));
  await race.context.saveStartpageSettings({ username: 'saved' });
  resolveFetch(response(settings('fresh')));
  await checking;
  assert.equal(race.status.dataset.state, 'synced');
  assert.equal(JSON.parse(race.values.get(cacheKey)).username, 'saved');

  // A check that finishes during a save cannot leave the successful save blocked.
  let resolveCheck;
  let resolveSave;
  race.fetch((url, options) => new Promise(resolve => {
    if (options.method === 'PUT') resolveSave = resolve;
    else resolveCheck = resolve;
  }));
  const midSaveCheck = race.context.checkStartpageSettings();
  const saving = race.context.saveStartpageSettings({ username: 'new save' });
  const newest = settings('new save', 'c'.repeat(64));
  resolveCheck(response(newest));
  await midSaveCheck;
  resolveSave(response({ ok: true, settings: newest }));
  await saving;
  assert.equal(race.status.dataset.state, 'synced');
  assert.equal(race.context.canSaveStartpageSettings(), true);
  console.log('Settings runtime regression tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
