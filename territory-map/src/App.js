import React, { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist';
import './App.css';
import {
  client,
  useConfig,
  useElementColumns,
  useIncrementalElementData,
} from '@sigmacomputing/plugin';

// Categorical palette, one color per territory (assigned in sorted order so
// colors are stable across refreshes). Cycles if there are more territories.
const PALETTE = [
  '#1E6FD9', '#F5B335', '#EF5350', '#3FC1F5', '#1E8A5E', '#FF8F4D', '#6A47C9',
  '#7AD94A', '#F5428A', '#4DD9C0', '#2A5BC4', '#E8A020', '#E04545', '#35B0E8',
  '#16754F', '#F57C32',
];

const DEFAULT_CENTER = { lat: 39.8283, lon: -98.5795 };
const DEFAULT_ZOOM = 3.3;
const ZCTA_URL = `${process.env.PUBLIC_URL}/data/zcta.json`;

client.config.configureEditorPanel([
  { type: 'element', name: 'source' },
  { type: 'column', name: 'zipcode', source: 'source', allowMultiple: false },
  { type: 'column', name: 'territory', source: 'source', allowMultiple: false },
  { type: 'column', name: 'fw', source: 'source', allowMultiple: false },
  { type: 'column', name: 'mmOpp', source: 'source', allowMultiple: false },
  { type: 'column', name: 'mmSales', source: 'source', allowMultiple: false },
  { name: 'Options', type: 'group' },
  { name: 'ShowLegend', source: 'Options', type: 'toggle', defaultValue: true },
  { name: 'ShowLabels', source: 'Options', type: 'toggle', defaultValue: true },
  { name: 'FillOpacity', source: 'Options', type: 'text', defaultValue: '0.8' },
  { name: 'MapStyle', source: 'Options', type: 'text', defaultValue: 'light' },
  { name: 'MapCenterLat', source: 'Options', type: 'text', defaultValue: String(DEFAULT_CENTER.lat) },
  { name: 'MapCenterLon', source: 'Options', type: 'text', defaultValue: String(DEFAULT_CENTER.lon) },
  { name: 'MapZoom', source: 'Options', type: 'text', defaultValue: String(DEFAULT_ZOOM) },
  { name: 'MapboxAccessToken', type: 'text', secure: true },
]);

function normalizeZip(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).trim().match(/^\d+/);
  return m ? m[0].padStart(5, '0').slice(0, 5) : null;
}

const num = v => (typeof v === 'number' ? v : parseFloat(v)) || 0;

function money(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Zips with a location but no boundary polygon (PO-box / single-organization
// zips) are drawn as a small square so they still show up in their territory.
const FALLBACK_R = 0.03;
function geometryFor(f) {
  if (f.geometry) return f.geometry;
  const { lat, lon } = f.properties;
  const r = FALLBACK_R;
  return {
    type: 'Polygon',
    coordinates: [[[lon - r, lat - r], [lon - r, lat + r], [lon + r, lat + r], [lon + r, lat - r], [lon - r, lat - r]]],
  };
}

function numOr(v, d) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function App() {
  const config = useConfig();
  const [sigmaData, loadMoreData, dataInfo] = useIncrementalElementData(config.source);
  const columns = useElementColumns(config.source);
  const [zctaByZip, setZctaByZip] = useState(null);
  const [error, setError] = useState(null);
  const plotRef = useRef(null);
  const overlayRef = useRef(null);
  const labelsRef = useRef([]);
  const unbindRef = useRef(null);

  const token = config.MapboxAccessToken;
  const showLegend = config.ShowLegend !== false;
  const showLabels = config.ShowLabels !== false;

  // Pull every row, chunk by chunk.
  useEffect(() => {
    if (dataInfo && dataInfo.hasMoreData && !dataInfo.isFetching) loadMoreData();
  }, [dataInfo, loadMoreData]);

  useEffect(() => {
    let cancelled = false;
    fetch(ZCTA_URL)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        const m = new Map();
        json.features.forEach(f => m.set(f.properties.zip, f));
        setZctaByZip(m);
      })
      .catch(e => !cancelled && setError(`Could not load boundary data: ${e.message}`));
    return () => { cancelled = true; };
  }, []);

  // Roll rows up to one record per territory.
  const model = useMemo(() => {
    if (!sigmaData || !columns || !config.zipcode || !config.territory) return null;
    const zipCol = sigmaData[config.zipcode];
    const terrCol = sigmaData[config.territory];
    if (!zipCol || !terrCol) return null;
    const fwCol = config.fw ? sigmaData[config.fw] : null;
    const oppCol = config.mmOpp ? sigmaData[config.mmOpp] : null;
    const salesCol = config.mmSales ? sigmaData[config.mmSales] : null;

    const territories = new Map();
    for (let i = 0; i < zipCol.length; i++) {
      const t = terrCol[i];
      if (t === null || t === undefined || t === '') continue;
      const key = String(t);
      let rec = territories.get(key);
      if (!rec) {
        rec = { name: key, fw: '', opp: 0, sales: 0, zips: new Set() };
        territories.set(key, rec);
      }
      if (!rec.fw && fwCol && fwCol[i]) rec.fw = String(fwCol[i]);
      if (oppCol) rec.opp += num(oppCol[i]);
      if (salesCol) rec.sales += num(salesCol[i]);
      const z = normalizeZip(zipCol[i]);
      if (z) rec.zips.add(z);
    }
    return [...territories.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [sigmaData, columns, config.zipcode, config.territory, config.fw, config.mmOpp, config.mmSales]);

  const colors = useMemo(() => {
    const m = new Map();
    (model || []).forEach((t, i) => m.set(t.name, PALETTE[i % PALETTE.length]));
    return m;
  }, [model]);

  const missing = useMemo(() => {
    if (!model || !zctaByZip) return 0;
    let n = 0;
    model.forEach(t => t.zips.forEach(z => { if (!zctaByZip.has(z)) n++; }));
    return n;
  }, [model, zctaByZip]);

  useEffect(() => {
    if (!model || !zctaByZip || !plotRef.current) return;
    const opacity = Math.min(1, Math.max(0.05, numOr(config.FillOpacity, 0.8)));

    const traces = [];
    const labels = [];

    model.forEach(t => {
      const features = [];
      let sumLat = 0, sumLon = 0;
      t.zips.forEach(z => {
        const f = zctaByZip.get(z);
        if (!f) return;
        features.push({ type: 'Feature', id: z, properties: {}, geometry: geometryFor(f) });
        sumLat += f.properties.lat;
        sumLon += f.properties.lon;
      });
      if (!features.length) return;
      const color = colors.get(t.name);

      // No per-zip borders: the outline is the same color as the fill, so
      // neighbouring zips of one territory merge into a single solid block.
      traces.push({
        type: 'choroplethmapbox',
        geojson: { type: 'FeatureCollection', features },
        locations: features.map(f => f.id),
        z: features.map(() => 1),
        colorscale: [[0, color], [1, color]],
        showscale: false,
        marker: { opacity, line: { color, width: 2 } },
        hoverinfo: 'skip',
        showlegend: false,
      });

      // Anchor the label on the zip nearest the territory's mean center, so
      // it always sits inside the territory even if its shape is concave.
      const mLat = sumLat / features.length;
      const mLon = sumLon / features.length;
      let best = null, bestD = Infinity;
      features.forEach(f => {
        const p = zctaByZip.get(f.id).properties;
        const d = (p.lat - mLat) ** 2 + ((p.lon - mLon) * Math.cos(mLat * Math.PI / 180)) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      });
      const lines = [];
      if (t.fw) lines.push(t.fw);
      if (config.mmOpp) lines.push(money(t.opp));
      if (config.mmSales) lines.push(money(t.sales));
      lines.push(t.name);
      labels.push({ lon: best.lon, lat: best.lat, lines });
    });

    const style = ['light', 'dark', 'streets', 'outdoors', 'satellite', 'satellite-streets'].includes(config.MapStyle)
      ? config.MapStyle : 'light';

    const layout = {
      margin: { t: 0, r: 0, b: 0, l: 0 },
      showlegend: false,
      uirevision: 'keep',
      mapbox: {
        style: token ? style : 'white-bg',
        accesstoken: token || '',
        center: {
          lat: numOr(config.MapCenterLat, DEFAULT_CENTER.lat),
          lon: numOr(config.MapCenterLon, DEFAULT_CENTER.lon),
        },
        zoom: numOr(config.MapZoom, DEFAULT_ZOOM),
      },
    };
    const gd = plotRef.current;
    // Labels are plain HTML pinned to map coordinates (the Mapbox text layer
    // depends on basemap font files and can silently fail to draw).
    const overlay = overlayRef.current;
    if (unbindRef.current) { unbindRef.current(); unbindRef.current = null; }
    overlay.innerHTML = '';
    const els = showLabels ? labels.map(l => {
      const el = document.createElement('div');
      el.className = 'tlabel';
      l.lines.forEach(line => {
        const row = document.createElement('div');
        row.textContent = line;
        el.appendChild(row);
      });
      overlay.appendChild(el);
      return { el, l };
    }) : [];
    Plotly.react(gd, traces, layout, { responsive: true, displaylogo: false, displayModeBar: false }).then(() => {
      const map = gd._fullLayout && gd._fullLayout.mapbox && gd._fullLayout.mapbox._subplot && gd._fullLayout.mapbox._subplot.map;
      if (!map || typeof map.project !== 'function') return;
      const place = () => els.forEach(({ el, l }) => {
        const pt = map.project([l.lon, l.lat]);
        el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)`;
      });
      place();
      map.on('move', place);
      map.on('resize', place);
      unbindRef.current = () => { map.off('move', place); map.off('resize', place); };
    });
  }, [model, zctaByZip, colors, token, showLabels, config.FillOpacity, config.MapStyle,
      config.MapCenterLat, config.MapCenterLon, config.MapZoom, config.mmOpp, config.mmSales]);

  let message = null;
  if (error) message = error;
  else if (!config.source || !config.zipcode || !config.territory)
    message = 'Select a source, a Zip Code column and a Territory column in the editor panel.';
  else if (!token) message = null;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div id="territoryMap" ref={plotRef} />
      <div className="overlay" ref={overlayRef} />
      {message && <div className="msg">{message}</div>}
      {!token && !message && (
        <div className="note" style={{ left: 12, right: 'auto' }}>Add a Mapbox access token for a basemap</div>
      )}
      {showLegend && model && !message && (
        <div className="legend">
          {model.map(t => (
            <div className="legend-row" key={t.name}>
              <span className="legend-swatch" style={{ background: colors.get(t.name) }} />
              {t.name}
            </div>
          ))}
        </div>
      )}
      {missing > 0 && <div className="note">{missing} zip codes not shown</div>}
    </div>
  );
}

export default App;
