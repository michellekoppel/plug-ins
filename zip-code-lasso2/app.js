import { Map as MapLibreMap, NavigationControl } from 'https://unpkg.com/maplibre-gl@6.9.0/dist/maplibre-gl.mjs';

const client = window.SigmaPlugin.client;

const CONFIG_SOURCE = 'source';
const CONFIG_ZIP_COLUMN = 'zipColumn';
const CONFIG_COLOR_COLUMN = 'colorColumn';
const CONFIG_SELECTED_ZIPS = 'selectedZips';

const DEFAULT_FILL_COLOR = '#2a78d6';
const UNMATCHED_FILL_COLOR = '#c9c8c2';
// Validated categorical palette (dataviz skill, references/palette.md).
const BASE_PALETTE = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
];

client.config.configureEditorPanel([
  { name: CONFIG_SOURCE, type: 'element', label: 'Zip code data' },
  {
    name: CONFIG_ZIP_COLUMN,
    type: 'column',
    source: CONFIG_SOURCE,
    allowMultiple: false,
    label: 'Zip code column',
  },
  {
    name: CONFIG_COLOR_COLUMN,
    type: 'column',
    source: CONFIG_SOURCE,
    allowMultiple: false,
    label: 'Color by column (optional)',
  },
  {
    name: CONFIG_SELECTED_ZIPS,
    type: 'variable',
    allowedTypes: ['text-list'],
    label: 'Selected zip codes control',
  },
]);

client.config.setLoadingState(true);

const lassoBtn = document.getElementById('lasso-btn');
const clearBtn = document.getElementById('clear-btn');
const statusText = document.getElementById('status-text');
const legendEl = document.getElementById('legend');
const emptyStateEl = document.getElementById('empty-state');
const lassoSvg = document.getElementById('lasso-svg');
const lassoPath = document.getElementById('lasso-path');

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

const map = new MapLibreMap({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-98.5, 39.5],
  zoom: 3.2,
  attributionControl: true,
});
map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

let mapLoaded = false;
let zctaIndex = null;
let currentConfig = {};
let latestData = {};
let renderedFeatures = [];
let selectedZips = new Set();
let dataSummaryText = '';
let lastZipHash = '';

map.on('load', () => {
  map.addSource('zips', { type: 'geojson', data: EMPTY_FC, promoteId: 'zip' });
  map.addLayer({
    id: 'zips-fill',
    type: 'fill',
    source: 'zips',
    paint: { 'fill-color': DEFAULT_FILL_COLOR, 'fill-opacity': 0.7 },
  });
  map.addLayer({
    id: 'zips-outline',
    type: 'line',
    source: 'zips',
    paint: { 'line-color': '#ffffff', 'line-width': 0.6, 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: 'zips-selected-outline',
    type: 'line',
    source: 'zips',
    paint: {
      'line-color': '#0b0b0b',
      // Width driven purely by feature-state so toggling selection never
      // requires rebuilding the GeoJSON source.
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0],
    },
  });
  mapLoaded = true;
  refreshMapData();
});

fetch('./data/zcta.json')
  .then((res) => res.json())
  .then((geojson) => {
    const idx = new Map();
    for (const feature of geojson.features) {
      const zip = normalizeZip(feature.properties && feature.properties.zip);
      if (zip) idx.set(zip, feature);
    }
    zctaIndex = idx;
    refreshMapData();
  })
  .catch((err) => {
    console.error('Failed to load zip code boundary data', err);
    dataSummaryText = 'Failed to load zip code boundary data.';
    renderStatus();
  });

// The host can push its initial config before this module finishes loading
// (maplibre-gl and turf are large imports), so the one-time initial 'config'
// event can fire before subscribe() below is registered. Read the
// already-current value directly as well so that race never drops it.
currentConfig = client.config.get() || {};
client.config.subscribe((cfg) => {
  currentConfig = cfg || {};
  refreshMapData();
});
client.elements.subscribeToElementData(CONFIG_SOURCE, (data) => {
  latestData = data || {};
  refreshMapData();
});

function resolveColId(configValue) {
  if (configValue == null) return null;
  return Array.isArray(configValue) ? configValue[0] : configValue;
}

function normalizeZip(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  s = s.split(/[-\s]/)[0].replace(/\D/g, '');
  if (!s) return null;
  return s.slice(0, 5).padStart(5, '0');
}

function tintHex(hex, amount) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const mix = (v) => Math.round(v + (255 - v) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function colorForIndex(i) {
  const base = BASE_PALETTE[i % BASE_PALETTE.length];
  const cycle = Math.floor(i / BASE_PALETTE.length);
  return cycle === 0 ? base : tintHex(base, Math.min(cycle * 0.3, 0.7));
}

function buildCategoryColorMap(features) {
  const categories = Array.from(
    new Set(features.map((f) => f.properties.colorVal).filter((v) => v != null)),
  ).sort();
  const map = new Map();
  categories.forEach((cat, i) => map.set(cat, colorForIndex(i)));
  return map;
}

function updateFillPaint(colorMap) {
  if (!colorMap || colorMap.size === 0) {
    map.setPaintProperty('zips-fill', 'fill-color', DEFAULT_FILL_COLOR);
    return;
  }
  const expr = ['match', ['get', 'colorVal']];
  colorMap.forEach((color, cat) => expr.push(cat, color));
  expr.push(UNMATCHED_FILL_COLOR);
  map.setPaintProperty('zips-fill', 'fill-color', expr);
}

function updateLegend(colorMap) {
  legendEl.innerHTML = '';
  if (!colorMap || colorMap.size === 0) {
    legendEl.classList.add('hidden');
    return;
  }
  legendEl.classList.remove('hidden');
  colorMap.forEach((color, cat) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(cat));
    legendEl.appendChild(item);
  });
}

function renderStatus() {
  const parts = [];
  if (dataSummaryText) parts.push(dataSummaryText);
  if (selectedZips.size) {
    parts.push(`${selectedZips.size.toLocaleString()} selected`);
  }
  statusText.textContent = parts.join(' · ');
}

function setSourceData(fc) {
  const src = map.getSource('zips');
  if (src) src.setData(fc);
}

function fitToFeatures(fc) {
  const hash = fc.features.map((f) => f.properties.zip).sort().join(',');
  if (hash === lastZipHash || fc.features.length === 0) return;
  lastZipHash = hash;
  const bbox = turf.bbox(fc);
  if (bbox.every(Number.isFinite)) {
    map.fitBounds(bbox, { padding: 40, duration: 600, maxZoom: 12 });
  }
}

function reapplySelectionState() {
  for (const zip of selectedZips) {
    map.setFeatureState({ source: 'zips', id: zip }, { selected: true });
  }
}

function refreshMapData() {
  if (!mapLoaded || !zctaIndex) return;

  const zipColId = resolveColId(currentConfig[CONFIG_ZIP_COLUMN]);
  const colorColId = resolveColId(currentConfig[CONFIG_COLOR_COLUMN]);
  emptyStateEl.classList.toggle('hidden', !!zipColId);

  if (!zipColId) {
    renderedFeatures = [];
    lastZipHash = '';
    setSourceData(EMPTY_FC);
    updateFillPaint(null);
    updateLegend(null);
    dataSummaryText = '';
    renderStatus();
    client.config.setLoadingState(false);
    return;
  }

  const zipsRaw = latestData[zipColId] || [];
  const colorsRaw = colorColId ? latestData[colorColId] || [] : [];

  const featureByZip = new Map();
  for (let i = 0; i < zipsRaw.length; i++) {
    const zip = normalizeZip(zipsRaw[i]);
    if (!zip || featureByZip.has(zip)) continue;
    const geoFeature = zctaIndex.get(zip);
    const colorVal = colorColId && colorsRaw[i] != null ? String(colorsRaw[i]) : null;
    featureByZip.set(
      zip,
      geoFeature
        ? { type: 'Feature', geometry: geoFeature.geometry, properties: { zip, colorVal } }
        : null,
    );
  }

  const features = [];
  let unmatched = 0;
  for (const feature of featureByZip.values()) {
    if (feature) features.push(feature);
    else unmatched++;
  }
  const total = featureByZip.size;
  dataSummaryText = total
    ? `${total.toLocaleString()} zip code${total === 1 ? '' : 's'}` +
      (unmatched ? ` · ${unmatched.toLocaleString()} not found` : '')
    : '';

  renderedFeatures = features;

  const fc = { type: 'FeatureCollection', features };
  setSourceData(fc);

  const colorMap = colorColId ? buildCategoryColorMap(features) : null;
  updateFillPaint(colorMap);
  updateLegend(colorMap);

  const currentZipSet = new Set(features.map((f) => f.properties.zip));
  const prunedSelection = new Set([...selectedZips].filter((z) => currentZipSet.has(z)));
  if (prunedSelection.size !== selectedZips.size) {
    updateSelection(prunedSelection);
  } else {
    reapplySelectionState();
  }

  renderStatus();
  fitToFeatures(fc);
  client.config.setLoadingState(false);
}

function updateSelection(next) {
  for (const zip of selectedZips) {
    if (!next.has(zip)) map.setFeatureState({ source: 'zips', id: zip }, { selected: false });
  }
  for (const zip of next) {
    if (!selectedZips.has(zip)) map.setFeatureState({ source: 'zips', id: zip }, { selected: true });
  }
  selectedZips = next;
  renderStatus();
  client.config.setVariable(CONFIG_SELECTED_ZIPS, ...Array.from(selectedZips));
}

function clearSelection() {
  updateSelection(new Set());
}

// --- Lasso drawing -----------------------------------------------------

let lassoModeOn = false;
let drawing = false;
let dragPoints = [];

function setLassoMode(on) {
  lassoModeOn = on;
  lassoBtn.classList.toggle('active', on);
  lassoSvg.classList.toggle('active', on);
  if (!on) resetDragPath();
}

function resetDragPath() {
  drawing = false;
  dragPoints = [];
  lassoPath.setAttribute('points', '');
}

function pointFromEvent(e) {
  const rect = lassoSvg.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function updatePathElement() {
  lassoPath.setAttribute('points', dragPoints.map((p) => p.join(',')).join(' '));
}

function finishLasso(e) {
  const pts = dragPoints;
  resetDragPath();
  if (pts.length < 3) return;

  const ring = pts.map((p) => {
    const ll = map.unproject(p);
    return [ll.lng, ll.lat];
  });
  ring.push(ring[0]);

  let lassoPolygon;
  try {
    lassoPolygon = turf.polygon([ring]);
  } catch (err) {
    return;
  }

  const hit = new Set();
  for (const feature of renderedFeatures) {
    try {
      if (turf.booleanIntersects(feature, lassoPolygon)) hit.add(feature.properties.zip);
    } catch (err) {
      // skip malformed geometry
    }
  }

  let next;
  if (e.shiftKey) {
    next = new Set(selectedZips);
    hit.forEach((z) => next.add(z));
  } else if (e.altKey) {
    next = new Set(selectedZips);
    hit.forEach((z) => next.delete(z));
  } else {
    next = hit;
  }
  updateSelection(next);
}

lassoBtn.addEventListener('click', () => setLassoMode(!lassoModeOn));
clearBtn.addEventListener('click', clearSelection);

lassoSvg.addEventListener('mousedown', (e) => {
  if (!lassoModeOn) return;
  drawing = true;
  dragPoints = [pointFromEvent(e)];
  updatePathElement();
});
lassoSvg.addEventListener('mousemove', (e) => {
  if (!drawing) return;
  dragPoints.push(pointFromEvent(e));
  updatePathElement();
});
window.addEventListener('mouseup', (e) => {
  if (!drawing) return;
  finishLasso(e);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drawing) resetDragPath();
  else if (lassoModeOn) setLassoMode(false);
});
