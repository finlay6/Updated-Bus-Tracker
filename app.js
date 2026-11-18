import { n as maplibre } from './assets/maplibre-E2rbe4Uv.js';

maplibre.setWorkerUrl(new URL('./assets/maplibre-gl-worker-BslLc_p7.js', import.meta.url).href);

const WORKER_DEFAULT = 'https://holy-sun-5af1.finlaynicholl1.workers.dev';
const STORAGE = {
  worker: 'bus-tracker:worker',
  oldSettings: 'bus-tracker:v1',
  favorites: 'bus-tracker:favorites',
  period: 'bus-tracker:period',
};
const apiMemory = new Map();
const pendingRequests = new Map();
const fmtNumber = new Intl.NumberFormat('en-GB');
const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
});
const dateLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/London',
});

function readLegacy() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.oldSettings) || 'null') || {};
  } catch {
    return {};
  }
}

const legacy = readLegacy();
function normalizeWorkerBase(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href.replace(/\/+$/, '') : WORKER_DEFAULT;
  } catch {
    return WORKER_DEFAULT;
  }
}
// Prefer the current Worker configured by this project. An older app may have
// left a retired proxy URL in `bus-tracker:v1`; keep it available only if the
// user explicitly saves it in this app's Settings.
let workerBase = normalizeWorkerBase(localStorage.getItem(STORAGE.worker) || WORKER_DEFAULT);
let savedFavorites;
try {
  savedFavorites = JSON.parse(localStorage.getItem(STORAGE.favorites) || 'null');
} catch {
  savedFavorites = null;
}
if (!Array.isArray(savedFavorites)) savedFavorites = legacy.routes || [];
let favorites = savedFavorites.filter((r) => r && Number.isInteger(Number(r.id)) && r.slug);
let historyPeriod = Number(localStorage.getItem(STORAGE.period)) || 30;
if (![7, 14, 30, 90, 180, 365].includes(historyPeriod)) historyPeriod = 30;

const state = {
  view: location.hash === '#routes' ? 'routes' : location.hash === '#setup' ? 'setup' : 'map',
  routes: [],
  searchTimer: 0,
  searchAbort: null,
  selectedRoute: null,
  routeTab: 'live',
  routeLive: [],
  routeVehicles: new Map(),
  routeLiveAbort: null,
  routeLiveBusy: false,
  routeLiveError: '',
  routeLiveLoaded: false,
  history: null,
  historyBusy: false,
  historyAbort: null,
  mapRoute: null,
  mapBuses: [],
  mapBusy: false,
  mapError: '',
  mapUpdated: 0,
  mapReady: false,
  mapController: null,
  mapRefreshTimer: 0,
  mapRequestTimer: 0,
};

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#map" data-action="navigate" data-view="map" aria-label="Bus Tracker home">
        <span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 5h18a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/><path d="M6 17h20M8 9h16M9 26v2m14-2v2"/><circle cx="10" cy="22" r="1.3"/><circle cx="22" cy="22" r="1.3"/></svg></span>
        <span class="brand-name">BUS<span>TRACKER</span></span>
      </a>
      <nav class="primary-nav" aria-label="Main navigation">
        <button data-action="navigate" data-view="map" class="nav-button"><span class="nav-dot"></span>Live map</button>
        <button data-action="navigate" data-view="routes" class="nav-button"><span class="nav-dot"></span>Routes</button>
        <button data-action="navigate" data-view="setup" class="nav-button"><span class="nav-dot"></span>Settings</button>
      </nav>
      <div class="topbar-status"><i class="status-dot"></i><span id="connection-label">Connecting</span></div>
    </header>

    <main class="main-content">
      <section class="view map-view" id="view-map" aria-label="Live map">
        <div id="map" class="map-canvas" aria-label="Live bus map"></div>
        <div class="map-topline">
          <div>
            <span class="eyebrow">LIVE NETWORK</span>
            <h1>Bus map</h1>
          </div>
          <div class="map-top-actions">
            <span id="map-time" class="map-updated">Waiting for buses</span>
            <button class="square-button" data-action="map-refresh" aria-label="Refresh buses" title="Refresh buses"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L4 8m0-5v5h5M4 13a8 8 0 0 0 14 5l2-2m0 5v-5h-5"/></svg></button>
          </div>
        </div>
        <div class="map-count" id="map-count"><span class="live-pulse"></span><strong>—</strong> buses in view</div>
        <div class="map-controls">
          <button class="square-button" data-action="map-locate" aria-label="Locate me" title="Locate me"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button>
          <button id="map-clear-route" class="square-button" data-action="map-clear-route" aria-label="Show all nearby buses" title="Show all nearby buses" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
        <aside class="map-dock" aria-label="Buses currently in view">
          <div class="dock-heading"><div><span class="eyebrow">IN THIS AREA</span><h2 id="dock-title">Nearby buses</h2></div><button class="text-button" data-action="navigate" data-view="routes">Browse routes</button></div>
          <div id="map-message" class="map-message" role="status">Loading live positions…</div>
          <div id="map-bus-list" class="map-bus-list"></div>
        </aside>
      </section>

      <section class="view content-view" id="view-routes" aria-label="Routes">
        <div class="page-intro"><div><span class="eyebrow">ROUTE OBSERVATIONS</span><h1>Routes</h1><p>Search a route to see the buses running now and every model and livery recorded in the period you choose.</p></div></div>
        <div class="route-search-wrap">
          <label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input id="route-search" type="search" autocomplete="off" placeholder="Search route number or destination" aria-label="Search routes"><kbd>↵</kbd></label>
          <div id="route-search-status" class="search-status" role="status">Search routes across the network.</div>
          <div id="route-results" class="route-results"></div>
        </div>
        <div id="route-detail" class="route-detail"></div>
      </section>

      <section class="view content-view setup-view" id="view-setup" aria-label="Settings">
        <div class="page-intro"><div><span class="eyebrow">CONNECTION</span><h1>Settings</h1><p>This site is static. Your Worker handles data requests and keeps provider credentials off GitHub Pages.</p></div></div>
        <section class="setup-card">
          <span class="eyebrow">CLOUDFLARE WORKER</span><h2>Data connection</h2>
          <p>Use the base URL of your Worker. The current project Worker is filled in for you.</p>
          <label for="worker-url">Worker URL</label>
          <div class="worker-input-row"><input id="worker-url" type="url" spellcheck="false" value="${escapeHTML(workerBase)}" placeholder="https://your-worker.workers.dev"><button class="button dark" data-action="save-worker">Save &amp; check</button></div>
          <div id="worker-feedback" class="worker-feedback" role="status">No API credentials are stored in this website.</div>
        </section>
        <section class="setup-card source-card"><span class="eyebrow">DATA NOTES</span><h2>Where the records come from</h2><p>Live positions and historical vehicle journeys use the project’s Bustimes Worker. The route history is read a day at a time, with every available page collected automatically and saved locally for quicker repeat visits.</p><p>The <a href="https://www.gov.uk/guidance/find-and-use-bus-open-data" target="_blank" rel="noreferrer">Department for Transport’s Bus Open Data guide</a> describes real-time vehicle locations and timetables, plus historic punctuality data. Its published guide does not document an equivalent archive of vehicle and livery journeys, so BODS is not a drop-in replacement for this route history.</p></section>
        <p class="setup-footnote">Satellite imagery is served by Esri and attribution stays visible on the map. <a href="https://www.esri.com/en-us/legal/terms/web-site-service" target="_blank" rel="noreferrer">Check Esri’s terms</a> before commercial use.</p>
      </section>
    </main>

    <nav class="mobile-nav" aria-label="Main navigation">
      <button data-action="navigate" data-view="map" class="mobile-nav-button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z"/><path d="M9 4v13.5M15 6.5V20"/></svg><span>Map</span></button>
      <button data-action="navigate" data-view="routes" class="mobile-nav-button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h11M4 19h16"/><circle cx="18" cy="12" r="2"/></svg><span>Routes</span></button>
      <button data-action="navigate" data-view="setup" class="mobile-nav-button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.5 2.6-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.9h-3l-.3-1.9a8 8 0 0 1-1.7-1l-1.7.7-1.5-2.6 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.5-2.6 1.7.7a8 8 0 0 1 1.7-1l.3-1.9h3l.3 1.9a8 8 0 0 1 1.7 1l1.7-.7 1.5 2.6-1.4 1.1a7 7 0 0 1 0 2Z"/></svg><span>Settings</span></button>
    </nav>
  </div>`;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const mapCount = $('#map-count');
const mapMessage = $('#map-message');
const mapBusList = $('#map-bus-list');
const routeResults = $('#route-results');
const routeDetail = $('#route-detail');

function setHidden(selector, hidden, root = document) {
  const element = $(selector, root);
  if (element) element.hidden = Boolean(hidden);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function currentWorkerURL() {
  return String(workerBase || '').trim().replace(/\/+$/, '');
}

function makeURL(kind, path, params = {}) {
  let raw;
  const base = currentWorkerURL();
  if (base) raw = `${base}/${kind}${path.startsWith('/') ? path : `/${path}`}`;
  else raw = `${kind === 'bt' ? 'https://bustimes.org' : 'https://api.tfl.gov.uk'}${path}`;
  const url = new URL(raw);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

class DataError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function apiGet(kind, path, params = {}, { ttl = 0, signal, text = false, retry = true } = {}) {
  const url = makeURL(kind, path, params);
  const key = url.href + (text ? '|text' : '');
  const cached = apiMemory.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (!signal && pendingRequests.has(key)) return pendingRequests.get(key);
  const task = (async () => {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const response = await fetch(url, {
          headers: { Accept: text ? 'text/html' : 'application/json' },
          signal: controller.signal,
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          let body = {};
          try { body = await response.json(); } catch {}
          const retryHeader = response.headers.get('retry-after') || '';
          const retrySeconds = Number(retryHeader);
          const delay = Number.isFinite(retrySeconds)
            ? retrySeconds * 1000
            : Date.parse(retryHeader) - Date.now();
          const message = response.status === 404
            ? body.error === 'Endpoint not allowed.'
              ? `The Worker rejected ${url.pathname}. Deploy the current worker/index.js, then check the Worker URL in Settings.`
              : `The Worker returned 404 for ${url.pathname}. Check that the Worker URL points to the deployed API Worker.`
            : body.error || (response.status === 429 ? 'The data provider is busy.' : `Data service returned ${response.status}.`);
          const error = new DataError(
            message,
            response.status,
            Number.isFinite(delay) && delay > 0 ? delay : 0,
          );
          if (retry && [429, 502, 503, 504].includes(error.status) && attempt < 3) {
            attempt++;
            await wait(Math.max(error.retryAfter, 800 * 2 ** (attempt - 1)), signal);
            continue;
          }
          throw error;
        }
        const value = text ? await response.text() : await response.json();
        if (ttl > 0) apiMemory.set(key, { value, until: Date.now() + ttl });
        if (apiMemory.size > 700) apiMemory.delete(apiMemory.keys().next().value);
        return value;
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error instanceof DataError) throw error;
        if (attempt < 2 && retry) {
          attempt++;
          await wait(700 * attempt, signal);
          continue;
        }
        throw new DataError(currentWorkerURL()
          ? 'The data service could not be reached. Check the Worker URL in Settings.'
          : 'Direct provider access was blocked. Add your Worker URL in Settings.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    }
  })();
  if (!signal) pendingRequests.set(key, task);
  try {
    return await task;
  } finally {
    if (!signal) pendingRequests.delete(key);
  }
}

let databasePromise;
function openDatabase() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (!databasePromise) databasePromise = new Promise((resolve) => {
    const request = indexedDB.open('bus-tracker-static', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('cache')) request.result.createObjectStore('cache', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return databasePromise;
}

async function savedGet(key) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction('cache', 'readonly');
    const request = tx.objectStore('cache').get(key);
    request.onsuccess = () => {
      const record = request.result;
      if (!record || record.expiresAt < Date.now()) {
        if (record) savedDelete(key);
        resolve(null);
      } else resolve(record.value);
    };
    request.onerror = () => resolve(null);
  });
}

async function savedPut(key, value, ttl) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ key, value, expiresAt: Date.now() + ttl });
    tx.oncomplete = tx.onerror = () => resolve();
  });
}

async function savedDelete(key) {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction('cache', 'readwrite');
  tx.objectStore('cache').delete(key);
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function datesBack(days) {
  const [year, month, day] = londonToday().split('-').map(Number);
  const today = Date.UTC(year, month - 1, day, 12);
  return Array.from({ length: days }, (_, i) => new Date(today - i * 86400000).toISOString().slice(0, 10));
}

function isValidNext(next, endpoint, expected = {}) {
  if (!next) return null;
  const url = new URL(String(next), 'https://bustimes.org');
  if (url.origin !== 'https://bustimes.org' || url.pathname !== endpoint) throw new DataError('The provider returned an unexpected page link.');
  for (const [key, value] of Object.entries(expected)) {
    if (url.searchParams.get(key) !== String(value)) throw new DataError('The provider changed the scope of this request.');
  }
  return url.pathname + url.search;
}

function vehicleId(value) {
  if (value?.id !== undefined && value?.id !== null) return String(value.id);
  const match = String(value?.url || '').match(/\/vehicles\/([^/?#]+)/);
  return match?.[1] || String(value?.slug || value?.reg || '');
}

function routeOperatorIds(route, detail = null) {
  let raw = route?.operator || detail?.operator || [];
  if (!Array.isArray(raw)) raw = [raw];
  return [...new Set(raw.map((item) => typeof item === 'string' ? item : item?.slug || item?.id || item?.operator).filter((id) => /^[a-z0-9_-]+$/i.test(String(id || ''))).map(String))];
}

async function loadFleet(route, force = false, signal) {
  let detail = null;
  let operators = routeOperatorIds(route);
  if (!operators.length) {
    detail = await apiGet('bt', `/api/services/${route.id}/`, {}, { ttl: 3600000, signal });
    operators = routeOperatorIds(route, detail);
  }
  const records = new Map();
  for (const operator of operators.slice(0, 6)) {
    const key = `fleet:${operator}`;
    const cached = !force ? await savedGet(key) : null;
    let fleet = Array.isArray(cached) ? cached : null;
    if (!fleet) {
      fleet = [];
      let path = '/api/vehicles/';
      let params = { operator, limit: 1000 };
      for (let page = 0; page < 50; page++) {
        const data = await apiGet('bt', path, params, { ttl: 3600000, signal });
        params = {};
        if (!Array.isArray(data.results)) throw new DataError('The fleet list had an unexpected format.');
        fleet.push(...data.results);
        const next = isValidNext(data.next, '/api/vehicles/', { operator });
        if (!next) break;
        path = next;
      }
      await savedPut(key, fleet, 12 * 3600000);
    }
    for (const vehicle of fleet) {
      const id = vehicleId(vehicle);
      if (id) records.set(id, vehicle);
    }
  }
  return records;
}

async function hydrateVehicles(rows, vehicles, signal) {
  const missing = [...new Set(rows.map((row) => vehicleId(row.vehicle)).filter((id) => id && !vehicles.has(id)))];
  for (let start = 0; start < missing.length; start += 40) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const ids = missing.slice(start, start + 40);
    try {
      const data = await apiGet('bt', '/api/vehicles/', { id__in: ids.join(','), limit: 1000 }, { signal });
      for (const vehicle of data.results || []) {
        const id = vehicleId(vehicle);
        if (id && ids.includes(id)) vehicles.set(id, vehicle);
      }
    } catch {}
  }
  const unresolved = [...new Set(rows.map((row) => vehicleId(row.vehicle)).filter((id) => id && !vehicles.has(id)))].slice(0, 60);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, unresolved.length) }, async () => {
    while (cursor < unresolved.length && !signal?.aborted) {
      const id = unresolved[cursor++];
      try {
        const vehicle = await apiGet('bt', `/api/vehicles/${encodeURIComponent(id)}/`, {}, { signal, ttl: 86400000 });
        vehicles.set(vehicleId(vehicle) || id, vehicle);
      } catch {}
    }
  }));
  const liveryIds = [...new Set([...vehicles.values()].map((vehicle) => typeof vehicle.livery === 'number' ? vehicle.livery : null).filter(Boolean))];
  if (liveryIds.length) {
    try {
      const data = await apiGet('bt', '/api/liveries/', { id__in: liveryIds.join(','), limit: 1000 }, { signal, ttl: 86400000 });
      const liveries = new Map((data.results || []).map((item) => [String(item.id), item]));
      for (const [id, vehicle] of vehicles) if (typeof vehicle.livery === 'number' && liveries.has(String(vehicle.livery))) vehicles.set(id, { ...vehicle, livery: liveries.get(String(vehicle.livery)) });
    } catch {}
  }
}

function safePaint(value) {
  const paint = String(value || '').trim();
  if (paint.length > 400 || /[;{}<>]|url\s*\(|var\s*\(|expression/i.test(paint)) return '';
  return /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|linear-gradient\([\w\s#(),.%+-]+\)|repeating-linear-gradient\([\w\s#(),.%+-]+\))$/i.test(paint) ? paint : '';
}

function vehiclePaint(vehicle) {
  const livery = vehicle?.livery;
  return safePaint(livery?.left_css || livery?.left || vehicle?.css || vehicle?.colour) || '#df1717';
}

function vehicleTypeName(vehicle) {
  const type = vehicle?.vehicle_type;
  return typeof type === 'string' ? type : type?.name || '';
}

function liveryInfo(vehicle) {
  const livery = vehicle?.livery;
  if (!livery || typeof livery === 'number') return { name: 'Livery not recorded', key: 'unknown', paint: vehiclePaint(vehicle) };
  const name = String(livery.name || 'Livery not recorded');
  const css = String(livery.left_css || livery.left || '') + '|' + String(livery.right_css || livery.right || '');
  return { name, key: livery.id ? String(livery.id) : `${name.toLowerCase()}|${css}`, paint: vehiclePaint(vehicle) };
}

function groupRecords(rows, vehicles) {
  const groups = new Map();
  const deduped = new Map();
  for (const row of rows) if (row && row.id !== undefined) deduped.set(String(row.id), row);
  for (const row of deduped.values()) {
    const id = vehicleId(row.vehicle);
    const vehicle = id ? vehicles.get(id) : null;
    const model = vehicleTypeName(vehicle) || 'Model not identified';
    const livery = liveryInfo(vehicle);
    const modelKey = vehicle?.vehicle_type?.id || model.toLowerCase();
    const key = `${modelKey}|${livery.key}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, model, livery: livery.name, paint: livery.paint, journeys: 0, days: new Set(), vehicles: new Set(), lastSeen: '' };
      groups.set(key, group);
    }
    group.journeys++;
    if (row.date) group.days.add(row.date);
    if (id) group.vehicles.add(id);
    if (row.datetime > group.lastSeen) group.lastSeen = row.datetime;
  }
  return [...groups.values()].sort((a, b) => b.journeys - a.journeys || a.model.localeCompare(b.model));
}

function modelCard(group, mode = 'history') {
  const days = group.days.size;
  const seenLabel = mode === 'live' ? `${fmtNumber.format(group.vehicles.size)} bus${group.vehicles.size === 1 ? '' : 'es'} tracked` : `${fmtNumber.format(group.journeys)} recorded journeys`;
  return `<article class="model-card">
    <div class="model-card-top"><span class="livery-swatch" style="background:${escapeHTML(group.paint)}"></span><span class="model-ident"><strong>${escapeHTML(group.model)}</strong><span>${escapeHTML(group.livery)}</span></span><span class="model-last">${mode === 'live' ? 'LIVE' : escapeHTML(seenLabel)}</span></div>
    <div class="model-card-bottom"><span>${escapeHTML(seenLabel)}</span><span>${mode === 'live' ? 'Now' : `${fmtNumber.format(days)} day${days === 1 ? '' : 's'} in period`}</span></div>
  </article>`;
}

function renderRouteResults(routes, message = '') {
  state.routes = routes;
  $('#route-search-status').textContent = message;
  routeResults.innerHTML = routes.map((route) => `<button class="route-result" data-action="select-route" data-id="${escapeHTML(route.id)}">
    <span class="route-badge">${escapeHTML(route.line_name)}</span><span class="route-result-copy"><strong>${escapeHTML(route.description || route.line_name)}</strong><small>${escapeHTML(route.region_id || 'UK')} · ${escapeHTML((route.operator || []).join?.(', ') || 'Bus route')}</small></span><span class="result-arrow">↗</span></button>`).join('');
}

function findRoute(id) {
  return state.routes.find((route) => String(route.id) === String(id)) || favorites.find((route) => String(route.id) === String(id)) || state.selectedRoute;
}

function switchView(view) {
  if (!['map', 'routes', 'setup'].includes(view)) view = 'map';
  if (view !== 'map') state.mapController?.abort();
  state.view = view;
  for (const section of $$('.view')) section.classList.toggle('active', section.id === `view-${view}`);
  for (const button of $$('[data-view]')) button.classList.toggle('active', button.dataset.view === view);
  document.body.dataset.view = view;
  history.replaceState(null, '', `#${view}`);
  if (view === 'map' && state.mapReady) setTimeout(() => { map?.resize(); refreshMapBuses(); }, 50);
  if (view === 'setup') {
    const workerInput = $('#worker-url');
    if (workerInput) workerInput.value = workerBase;
  }
}

function saveFavorites() {
  localStorage.setItem(STORAGE.favorites, JSON.stringify(favorites));
}

function setFavorite(route) {
  const exists = favorites.some((item) => String(item.id) === String(route.id));
  favorites = exists ? favorites.filter((item) => String(item.id) !== String(route.id)) : [route, ...favorites].slice(0, 40);
  saveFavorites();
  renderRouteDetail();
}

function routeDetailMarkup(route) {
  const favorite = favorites.some((item) => String(item.id) === String(route.id));
  return `<div class="route-detail-heading">
    <button class="text-button back-link" data-action="clear-route">← All results</button>
    <div class="route-title-row"><span class="route-badge large">${escapeHTML(route.line_name)}</span><div class="route-title-copy"><span class="eyebrow">${escapeHTML(route.region_id || 'BUS ROUTE')}</span><h2>${escapeHTML(route.description || route.line_name)}</h2></div><button class="button subtle" data-action="favorite-route">${favorite ? 'Saved route' : 'Save route'}</button></div>
    <div class="route-action-row"><button class="button dark" data-action="map-route">Show on map</button><span class="small-note">Recorded service data · Bustimes</span></div>
  </div>
  <div class="route-tabs" role="tablist"><button role="tab" aria-selected="${state.routeTab === 'live'}" class="route-tab ${state.routeTab === 'live' ? 'active' : ''}" data-action="route-tab" data-tab="live">Buses now</button><button role="tab" aria-selected="${state.routeTab === 'history'}" class="route-tab ${state.routeTab === 'history' ? 'active' : ''}" data-action="route-tab" data-tab="history">Models &amp; liveries</button></div>
  <section class="route-panel ${state.routeTab === 'live' ? 'active' : ''}" id="route-live-panel" ${state.routeTab !== 'live' ? 'hidden' : ''}>
    <div class="panel-heading"><div><span class="eyebrow">CURRENT OBSERVATIONS</span><h3>Models running now</h3></div><button class="text-button" data-action="refresh-route-live">Refresh</button></div>
    <div id="route-live-status" class="inline-status" role="status"></div><div id="route-live-cards" class="model-grid"></div>
  </section>
  <section class="route-panel ${state.routeTab === 'history' ? 'active' : ''}" id="route-history-panel" ${state.routeTab !== 'history' ? 'hidden' : ''}>
    <div class="panel-heading history-heading"><div><span class="eyebrow">ARCHIVED JOURNEYS</span><h3>Every model and livery found</h3><p>All available pages are collected automatically. Different liveries stay separate.</p></div><div class="history-tools"><label class="period-picker"><span>Period</span><select id="history-period">${[7,14,30,90,180,365].map((days) => `<option value="${days}" ${days === historyPeriod ? 'selected' : ''}>${days} days</option>`).join('')}</select></label><button class="button subtle" data-action="refresh-history">Refresh</button></div></div>
    <div class="history-progress-wrap" id="history-progress-wrap" hidden><div class="history-progress-label"><span id="history-progress-text">Preparing</span><button class="text-button" data-action="cancel-history">Cancel</button></div><div class="progress-track"><i id="history-progress-bar"></i></div></div>
    <div id="history-stats" class="history-stats"></div><div id="history-error" class="history-error" role="alert"></div>
    <div id="history-cards" class="model-grid history-grid"></div><div id="history-empty" class="empty-state" hidden></div>
    <p class="history-footnote">The archive reflects recorded journeys and current fleet details. Some older records may no longer include a model or livery.</p>
  </section>`;
}

function renderRouteDetail() {
  if (!state.selectedRoute) {
    routeDetail.innerHTML = favorites.length ? `<div class="saved-routes"><div class="section-heading"><div><span class="eyebrow">QUICK ACCESS</span><h2>Saved routes</h2></div></div><div class="saved-route-list">${favorites.map((r) => `<button class="route-result" data-action="select-route" data-id="${escapeHTML(r.id)}"><span class="route-badge">${escapeHTML(r.line_name)}</span><span class="route-result-copy"><strong>${escapeHTML(r.description || r.line_name)}</strong><small>Saved route</small></span><span class="result-arrow">↗</span></button>`).join('')}</div></div>` : '';
    return;
  }
  routeDetail.innerHTML = routeDetailMarkup(state.selectedRoute);
  if (state.routeTab === 'live') renderRouteLive();
  if (state.routeTab === 'history') renderHistoryPanel();
}

function renderRouteLive() {
  const status = $('#route-live-status', routeDetail || document);
  const cards = $('#route-live-cards', routeDetail || document);
  if (!status || !cards) return;

  const rows = state.routeLive.map((bus, index) => ({
    id: bus.id || bus.journey_id || index,
    date: londonToday(),
    datetime: bus.datetime,
    vehicle: { id: vehicleId(bus.vehicle) },
  }));
  const groups = groupRecords(rows, state.routeVehicles);
  if (state.routeLiveBusy && !state.routeLive.length) {
    status.textContent = 'Reading current positions…';
    cards.innerHTML = '<div class="loading-card"><i></i><i></i><i></i></div>';
    return;
  }
  if (state.routeLiveError && !state.routeLive.length) {
    status.textContent = state.routeLiveError;
    cards.innerHTML = '';
    return;
  }
  status.textContent = groups.length
    ? `${fmtNumber.format(state.routeLive.length)} live buses · updated ${clock.format(new Date())}`
    : state.routeLiveBusy ? 'Reading model and livery details…' : 'No recent live positions for this route.';
  cards.innerHTML = groups.map((group) => modelCard(group, 'live')).join('')
    || (state.routeLiveBusy ? '<div class="loading-card"><i></i><i></i><i></i></div>' : '<div class="empty-state">No current model records are available.</div>');
}

function selectRoute(route) {
  if (!route) return;
  state.routeLiveAbort?.abort();
  state.historyAbort?.abort();
  state.historyBusy = false;
  state.history = null;
  state.selectedRoute = route;
  state.routeTab = 'live';
  state.routeLiveLoaded = false;
  state.routeLive = [];
  state.routeVehicles = new Map();
  state.routeLiveError = '';
  renderRouteDetail();
  switchView('routes');
  loadRouteLive();
  setTimeout(() => routeDetail.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
}

async function searchRoutes(query) {
  state.searchAbort?.abort();
  const controller = new AbortController();
  state.searchAbort = controller;
  if (!query.trim()) {
    renderRouteResults([], 'Search routes across the network.');
    return;
  }
  $('#route-search-status').textContent = 'Searching…';
  try {
    const data = await apiGet('bt', '/api/services/', { search: query.trim(), mode: 'bus', limit: 100 }, { ttl: 300000, signal: controller.signal });
    if (controller.signal.aborted) return;
    const routes = (data.results || []).filter((route) => route.mode === 'bus' && Number.isInteger(Number(route.id)) && route.slug).sort((a, b) => Number(b.line_name?.toLowerCase() === query.trim().toLowerCase()) - Number(a.line_name?.toLowerCase() === query.trim().toLowerCase()) || String(a.line_name).localeCompare(String(b.line_name), undefined, { numeric: true }));
    renderRouteResults(routes, routes.length ? `${fmtNumber.format(routes.length)} routes found` : 'No routes matched that search.');
  } catch (error) {
    if (controller.signal.aborted) return;
    renderRouteResults([], error.message || 'Route search failed.');
  }
}

async function loadRouteLive(force = false) {
  const route = state.selectedRoute;
  if (!route) return;
  state.routeLiveAbort?.abort();
  const controller = new AbortController();
  state.routeLiveAbort = controller;
  state.routeLiveBusy = true;
  state.routeLiveError = '';
  renderRouteLive();
  try {
    const [data, vehicles] = await Promise.all([
      apiGet('bt', '/vehicles.json', { service: route.id }, { ttl: force ? 5000 : 15000, signal: controller.signal }),
      loadFleet(route, false, controller.signal).catch((error) => {
        if (controller.signal.aborted) throw error;
        return new Map();
      }),
    ]);
    if (controller.signal.aborted || state.selectedRoute?.id !== route.id) return;
    state.routeLive = validLiveRows(data);
    state.routeLiveLoaded = true;
    const rows = state.routeLive.map((bus, index) => ({ id: bus.id || bus.journey_id || index, date: londonToday(), datetime: bus.datetime, vehicle: { id: vehicleId(bus.vehicle) } }));
    await hydrateVehicles(rows, vehicles, controller.signal);
    if (controller.signal.aborted || state.selectedRoute?.id !== route.id) return;
    state.routeVehicles = vehicles;
  } catch (error) {
    if (!controller.signal.aborted && state.selectedRoute?.id === route.id) state.routeLiveError = error.message;
  } finally {
    if (state.routeLiveAbort === controller) {
      state.routeLiveBusy = false;
      state.routeLiveAbort = null;
      renderRouteLive();
    }
  }
}

function historyEntries() {
  return state.history?.days || [];
}

function renderHistoryPanel() {
  if (!state.selectedRoute || state.routeTab !== 'history') return;
  const history = state.history;
  const days = historyEntries();
  const loadedDays = days.filter((day) => day.complete && !day.error).length;
  const rows = days.flatMap((day) => day.rows || []);
  const vehicles = history?.vehicles || new Map();
  const groups = groupRecords(rows, vehicles);
  const progressWrap = $('#history-progress-wrap');
  if (!progressWrap) return;
  progressWrap.hidden = !state.historyBusy;
  const progressText = $('#history-progress-text');
  const progressBar = $('#history-progress-bar');
  if (progressText) progressText.textContent = `${fmtNumber.format(loadedDays)} of ${fmtNumber.format(history?.totalDays || historyPeriod)} days read · ${fmtNumber.format(rows.length)} journeys found`;
  if (progressBar) progressBar.style.width = `${Math.min(100, loadedDays / Math.max(1, history?.totalDays || historyPeriod) * 100)}%`;
  const stats = $('#history-stats');
  if (stats) stats.innerHTML = history ? `<span><strong>${fmtNumber.format(rows.length)}</strong> journeys</span><span><strong>${fmtNumber.format(groups.length)}</strong> model &amp; livery records</span><span><strong>${fmtNumber.format(loadedDays)}</strong> days read</span>` : '';
  const errors = days.filter((day) => day.error);
  const errorElement = $('#history-error');
  if (errorElement) errorElement.textContent = errors.length ? `${errors.length} day${errors.length === 1 ? '' : 's'} could not be read. Retry to fill in missing records. ${errors[0].error}` : '';
  const cards = $('#history-cards');
  if (cards) cards.innerHTML = groups.map((group) => modelCard(group)).join('');
  const empty = $('#history-empty');
  if (empty) {
    empty.hidden = !!rows.length || state.historyBusy;
    empty.textContent = errors.length ? 'No saved journeys yet. Retry after the provider is available.' : 'No vehicle journeys were returned for this route and period.';
  }
}

async function fetchHistoryDay(route, date, signal) {
  let path = '/api/vehiclejourneys/';
  let params = { service: route.id, date, limit: 1000 };
  const rows = new Map();
  const visited = new Set();
  for (let page = 0; page < 1000; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (visited.has(path)) throw new DataError(`The provider repeated a history page for ${date}.`);
    visited.add(path);
    const data = await apiGet('bt', path, params, { signal, retry: true });
    params = {};
    if (!Array.isArray(data.results)) throw new DataError('The history response had an unexpected format.');
    for (const row of data.results) {
      if (row.date !== date || !Number.isInteger(Number(row.id)) || !row.vehicle || !vehicleId(row.vehicle)) continue;
      if (row.route_name && String(row.route_name).toLowerCase() !== String(route.line_name).toLowerCase()) continue;
      if (Number.isFinite(Date.parse(row.datetime)) && Date.parse(row.datetime) > Date.now() + 60000) continue;
      rows.set(String(row.id), row);
    }
    const next = isValidNext(data.next, '/api/vehiclejourneys/', { service: route.id, date });
    if (!next) return { date, rows: [...rows.values()], complete: true, error: '' };
    path = next;
  }
  throw new DataError(`Too many history pages returned for ${date}.`);
}

async function loadHistory(force = false) {
  const route = state.selectedRoute;
  if (!route || state.historyBusy) return;
  state.historyAbort?.abort();
  const controller = new AbortController();
  state.historyAbort = controller;
  state.historyBusy = true;
  const dates = datesBack(historyPeriod);
  let vehicles = new Map();
  const entries = await Promise.all(dates.map(async (date) => {
    const key = `history:${route.id}:${date}`;
    const cached = await savedGet(key);
    if (cached) {
      vehicles = new Map([...vehicles, ...(cached.vehicles || [])]);
      return { ...cached.day, stale: force };
    }
    return { date, rows: [], complete: false, error: '', stale: true };
  }));
  state.history = { routeId: route.id, totalDays: dates.length, days: entries, vehicles };
  renderHistoryPanel();

  const fleetPromise = loadFleet(route, false, controller.signal).then((fleet) => {
    state.history.vehicles = new Map([...state.history.vehicles, ...fleet]);
  }).catch((error) => {
    state.history.fleetError = error.message;
  });
  const queue = dates.map((date, index) => ({ date, index })).filter(({ date, index }) => {
    const entry = entries[index];
    const ttl = date === londonToday() ? 60000 : 14 * 86400000;
    return force || !entry.complete || entry.fetchedAt + ttl < Date.now();
  });
  let cursor = 0;
  let completed = entries.filter((entry) => entry.complete && !entry.stale).length;
  const totalRows = () => state.history.days.reduce((sum, day) => sum + (day.rows?.length || 0), 0);
  renderHistoryPanel();
  const worker = async () => {
    while (cursor < queue.length && !controller.signal.aborted) {
      const { date, index } = queue[cursor++];
      const cached = entries[index];
      try {
        const day = await fetchHistoryDay(route, date, controller.signal);
        day.fetchedAt = Date.now();
        entries[index] = day;
        const ttl = date === londonToday() ? 60000 : 14 * 86400000;
        await savedPut(`history:${route.id}:${date}`, { day, vehicles: [] }, ttl);
        completed++;
      } catch (error) {
        if (controller.signal.aborted) break;
        entries[index] = { ...cached, date, error: error.message || 'History unavailable.', complete: false };
      }
      state.history.days = entries;
      renderHistoryPanel();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    if (!controller.signal.aborted) {
      await fleetPromise;
      const rows = entries.flatMap((entry) => entry.rows || []);
      await hydrateVehicles(rows, state.history.vehicles, controller.signal);
      state.history.days = entries;
      state.history.vehicles = new Map(state.history.vehicles);
      for (const day of entries) if (day.complete && !day.error) {
        await savedPut(`history:${route.id}:${day.date}`, { day, vehicles: [] }, day.date === londonToday() ? 60000 : 14 * 86400000);
      }
    }
  } finally {
    if (state.historyAbort === controller) state.historyBusy = false;
    renderHistoryPanel();
  }
}

function validLiveRows(raw) {
  if (!Array.isArray(raw)) return [];
  const unique = new Map();
  for (const row of raw) {
    if (!Array.isArray(row.coordinates) || !Number.isFinite(Number(row.coordinates[0])) || !Number.isFinite(Number(row.coordinates[1]))) continue;
    const age = Date.now() - Date.parse(row.datetime);
    if (!Number.isFinite(age) || age > 10 * 60000 || age < -60000) continue;
    const key = vehicleId(row.vehicle) || String(row.id || row.journey_id || '');
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || Date.parse(row.datetime) > Date.parse(previous.datetime)) unique.set(key, row);
  }
  return [...unique.values()];
}

function busKey(bus) { return vehicleId(bus.vehicle) || String(bus.id || bus.journey_id || ''); }

function routeBadgeColor(line) {
  const value = String(line || '').trim().toUpperCase();
  if (/^(N|NX)/.test(value)) return '#202020';
  if (/^(U|DLR)/.test(value)) return '#8bbf38';
  if (/^(X|E)/.test(value)) return '#177fa0';
  return '#e21a1a';
}

function busMarker(bus) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'bus-marker';
  el.setAttribute('aria-label', `Route ${bus.service?.line_name || 'bus'}${bus.destination ? ` to ${bus.destination}` : ''}`);
  const line = String(bus.service?.line_name || '?').slice(0, 8);
  const paint = safePaint(bus.vehicle?.css || bus.vehicle?.colour) || routeBadgeColor(line);
  const ink = paint.startsWith('#') && paint.length === 7 && (() => {
    const hex = paint.slice(1);
    const brightness = (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587 + parseInt(hex.slice(4, 6), 16) * 114) / 1000;
    return brightness > 165;
  })() ? '#111' : '#fff';
  el.innerHTML = `<span class="bus-plate" style="background:${escapeHTML(paint)};color:${ink}">${escapeHTML(line)}</span><svg class="bus-arrow" viewBox="0 0 12 20" aria-hidden="true"><path d="M1 1 10 10 1 19Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="miter"/></svg>`;
  return el;
}

function renderMapBuses() {
  const buses = state.mapBuses;
  const count = state.mapRoute ? `${fmtNumber.format(buses.length)} on route ${state.mapRoute.line_name}` : `${fmtNumber.format(buses.length)} buses in view`;
  mapCount.innerHTML = `<span class="live-pulse"></span><strong>${fmtNumber.format(buses.length)}</strong> ${state.mapRoute ? `on route ${escapeHTML(state.mapRoute.line_name)}` : 'buses in view'}`;
  $('#map-time').textContent = state.mapUpdated ? `Updated ${clock.format(state.mapUpdated)}` : 'Waiting for buses';
  $('#dock-title').textContent = state.mapRoute ? `Route ${state.mapRoute.line_name}` : 'Nearby buses';
  setHidden('#map-clear-route', !state.mapRoute);
  const status = state.mapError ? state.mapError : state.mapBusy && !buses.length ? 'Loading live positions…' : !buses.length ? 'No recent buses in this map area.' : '';
  mapMessage.textContent = status;
  if (mapMessage) mapMessage.hidden = !status;
  mapBusList.innerHTML = buses.slice(0, 18).map((bus) => {
    const key = busKey(bus);
    return `<button class="map-bus-row" data-action="focus-bus" data-id="${escapeHTML(key)}"><span class="route-badge small-badge">${escapeHTML(bus.service?.line_name || '?')}</span><span class="bus-row-copy"><strong>${escapeHTML(bus.destination || bus.service?.description || 'In service')}</strong><small>${escapeHTML(bus.service?.line_name ? `Route ${bus.service.line_name}` : 'Live bus')} · ${clock.format(new Date(bus.datetime))}</small></span><span class="row-arrow">↗</span></button>`;
  }).join('');
}

let map;
const markers = new Map();
const mapBusesByKey = new Map();
let mapPopup;
let lastMapBoundsKey = '';

function initMap() {
  try {
    map = new maplibre.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          imagery: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          },
          labels: {
            type: 'raster',
            tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Labels © Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors, and the GIS User Community',
          },
        },
        layers: [
          { id: 'satellite', type: 'raster', source: 'imagery', minzoom: 0, maxzoom: 19 },
          { id: 'satellite-labels', type: 'raster', source: 'labels', minzoom: 0, maxzoom: 19, paint: { 'raster-opacity': 0.9 } },
        ],
      },
      center: [-0.12, 51.51],
      zoom: 13.6,
      minZoom: 5,
      maxZoom: 19,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: false },
    });
    map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
    mapPopup = new maplibre.Popup({ closeButton: false, closeOnClick: true, maxWidth: '250px' });
    map.on('load', () => {
      state.mapReady = true;
      map.resize();
      refreshMapBuses();
    });
    map.on('moveend', () => {
      clearTimeout(state.mapRequestTimer);
      state.mapRequestTimer = setTimeout(refreshMapBuses, 450);
    });
    map.on('error', (event) => {
      if (event?.error && !state.mapReady) {
        if (mapMessage) {
          mapMessage.textContent = 'Satellite tiles could not be reached. Check your connection.';
          mapMessage.hidden = false;
        }
      }
    });
  } catch (error) {
    if (mapMessage) {
      mapMessage.textContent = 'The map could not be started. Refresh the page to try again.';
      mapMessage.hidden = false;
    }
  }
}

function mapQuery() {
  if (state.mapRoute) return { path: '/vehicles.json', params: { service: state.mapRoute.id } };
  if (!map) return null;
  const b = map.getBounds();
  const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
  if (east - west > 0.65 || north - south > 0.45) throw new DataError('Zoom in to a smaller area to load buses.');
  const round = (value) => Number(value.toFixed(4));
  return { path: '/vehicles.json', params: { xmin: round(west), ymin: round(south), xmax: round(east), ymax: round(north) } };
}

async function refreshMapBuses() {
  if (!state.mapReady || state.view !== 'map' || document.hidden) return;
  let query;
  try { query = mapQuery(); } catch (error) {
    state.mapController?.abort();
    state.mapController = null;
    state.mapBusy = false;
    state.mapError = error.message;
    renderMapBuses();
    return;
  }
  if (!query) return;
  const boundsKey = JSON.stringify([state.mapRoute?.id || '', query.params]);
  if (state.mapBusy && boundsKey === lastMapBoundsKey) return;
  state.mapController?.abort();
  const controller = new AbortController();
  state.mapController = controller;
  if (boundsKey !== lastMapBoundsKey) {
    lastMapBoundsKey = boundsKey;
    state.mapBuses = [];
    renderMapBuses();
  }
  state.mapBusy = true;
  state.mapError = '';
  renderMapBuses();
  try {
    const data = await apiGet('bt', query.path, query.params, { ttl: 12000, signal: controller.signal });
    if (controller.signal.aborted) return;
    state.mapBuses = validLiveRows(data);
    state.mapUpdated = new Date();
    syncMarkers(state.mapBuses);
  } catch (error) {
    if (!controller.signal.aborted) state.mapError = error.message || 'Could not refresh bus positions.';
  } finally {
    if (state.mapController === controller) {
      state.mapBusy = false;
      renderMapBuses();
    }
  }
}

function syncMarkers(buses) {
  const visible = new Set();
  for (const bus of buses) {
    const key = busKey(bus);
    if (!key) continue;
    visible.add(key);
    mapBusesByKey.set(key, bus);
    const signature = `${bus.service?.line_name || ''}|${bus.destination || ''}|${bus.vehicle?.css || bus.vehicle?.colour || ''}`;
    let entry = markers.get(key);
    if (!entry || entry.signature !== signature) {
      entry?.marker.remove();
      const element = busMarker(bus);
      const marker = new maplibre.Marker({ element, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat(bus.coordinates);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = mapBusesByKey.get(key);
        if (!current || !mapPopup) return;
        mapPopup.setLngLat(current.coordinates).setHTML(`<div class="bus-popup"><span class="route-badge">${escapeHTML(current.service?.line_name || '?')}</span><strong>${escapeHTML(current.destination || 'In service')}</strong><small>${escapeHTML(current.service?.description || '')}</small></div>`).addTo(map);
      });
      marker.addTo(map);
      entry = { marker, signature };
      markers.set(key, entry);
    }
    const heading = Number(bus.heading);
    entry.marker.setLngLat(bus.coordinates).setRotation(Number.isFinite(heading) ? heading - 90 : 0);
  }
  for (const [key, entry] of markers) if (!visible.has(key)) {
    entry.marker.remove();
    markers.delete(key);
    mapBusesByKey.delete(key);
  }
}

function locateMap() {
  if (!navigator.geolocation) {
    if (mapMessage) {
      mapMessage.textContent = 'Location is not available in this browser.';
      mapMessage.hidden = false;
    }
    return;
  }
  if (mapMessage) {
    mapMessage.textContent = 'Finding your location…';
    mapMessage.hidden = false;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    state.mapRoute = null;
    map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: Math.max(map.getZoom(), 13), duration: 650 });
    if (mapMessage) mapMessage.hidden = true;
  }, () => {
    if (mapMessage) mapMessage.textContent = 'Location permission was unavailable. Move the map to your area instead.';
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

async function checkWorker() {
  const label = $('#connection-label');
  const dot = $('.status-dot');
  try {
    const response = await fetch(`${currentWorkerURL()}/health`, { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Worker unavailable');
    const body = await response.json();
    label.textContent = body.ok ? 'Data connected' : 'Worker check failed';
    dot.classList.toggle('offline', !body.ok);
    return !!body.ok;
  } catch {
    label.textContent = 'Connection needed';
    dot.classList.add('offline');
    return false;
  }
}

async function saveWorker() {
  const input = $('#worker-url');
  const feedback = $('#worker-feedback');
  let url;
  try {
    url = new URL(input.value.trim());
    if (url.protocol !== 'https:' || !url.hostname) throw new Error();
  } catch {
    feedback.textContent = 'Enter a complete HTTPS Worker URL.';
    feedback.classList.add('error-text');
    return;
  }
  workerBase = url.href.replace(/\/+$/, '');
  localStorage.setItem(STORAGE.worker, workerBase);
  apiMemory.clear();
  feedback.classList.remove('error-text');
  feedback.textContent = 'Checking Worker…';
  const okay = await checkWorker();
  feedback.textContent = okay ? 'Connected. No API secrets are stored in this website.' : 'The Worker did not respond. Confirm its deployment and allowed origin.';
  if (okay) {
    state.mapError = '';
    if (state.selectedRoute && state.routeTab === 'live') loadRouteLive(true);
    refreshMapBuses();
  }
}

document.addEventListener('input', (event) => {
  if (event.target.id === 'route-search') {
    const query = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchRoutes(query), 240);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'history-period') {
    historyPeriod = Number(event.target.value);
    localStorage.setItem(STORAGE.period, String(historyPeriod));
    state.historyAbort?.abort();
    state.historyBusy = false;
    state.history = null;
    loadHistory();
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'navigate') switchView(button.dataset.view);
  if (action === 'select-route') selectRoute(findRoute(button.dataset.id));
  if (action === 'clear-route') {
    state.routeLiveAbort?.abort();
    state.routeLiveAbort = null;
    state.routeLiveBusy = false;
    state.selectedRoute = null;
    state.historyAbort?.abort();
    state.historyBusy = false;
    state.history = null;
    renderRouteDetail();
  }
  if (action === 'route-tab') {
    state.routeTab = button.dataset.tab;
    $$('.route-tab', routeDetail).forEach((tab) => {
      const active = tab.dataset.tab === state.routeTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    setHidden('#route-live-panel', state.routeTab !== 'live', routeDetail);
    setHidden('#route-history-panel', state.routeTab !== 'history', routeDetail);
    if (state.routeTab === 'live' && !state.routeLiveLoaded) loadRouteLive();
    if (state.routeTab === 'history' && !state.history) loadHistory();
  }
  if (action === 'favorite-route' && state.selectedRoute) setFavorite(state.selectedRoute);
  if (action === 'map-route' && state.selectedRoute) {
    state.mapRoute = state.selectedRoute;
    switchView('map');
    renderMapBuses();
    refreshMapBuses();
  }
  if (action === 'refresh-route-live') loadRouteLive(true);
  if (action === 'cancel-history') {
    state.historyAbort?.abort();
    state.historyBusy = false;
    renderHistoryPanel();
  }
  if (action === 'refresh-history') {
    state.historyAbort?.abort();
    state.historyBusy = false;
    state.history = null;
    loadHistory(true);
  }
  if (action === 'map-refresh') {
    lastMapBoundsKey = '';
    apiMemory.clear();
    refreshMapBuses();
  }
  if (action === 'map-locate') locateMap();
  if (action === 'map-clear-route') {
    state.mapRoute = null;
    lastMapBoundsKey = '';
    renderMapBuses();
    refreshMapBuses();
  }
  if (action === 'focus-bus') {
    const bus = mapBusesByKey.get(button.dataset.id);
    if (bus) map.flyTo({ center: bus.coordinates, zoom: Math.max(map.getZoom(), 15), duration: 500 });
  }
  if (action === 'save-worker') saveWorker();
});

function startClock() {
  setInterval(() => {
    if (state.mapUpdated) $('#map-time').textContent = `Updated ${clock.format(state.mapUpdated)}`;
  }, 30000);
}

switchView(state.view);
renderRouteDetail();
initMap();
checkWorker();
startClock();
state.mapRefreshTimer = setInterval(() => {
  if (!document.hidden && state.view === 'map') refreshMapBuses();
}, 25000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (state.mapReady && state.view === 'map') refreshMapBuses();
    if (state.selectedRoute && state.routeTab === 'live') loadRouteLive();
  }
});
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (['map', 'routes', 'setup'].includes(view)) switchView(view);
});

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
