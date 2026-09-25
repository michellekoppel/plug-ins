import React, { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist';
import './App.css';
import {
  client,
  useConfig,
  useElementColumns,
  useIncrementalElementData,
  useVariable,
} from "@sigmacomputing/plugin";

// Bright, cheerful 14-color categorical palette (petrol, magenta, coral,
// teal, gold, violet, orange, sky blue, brick, purple, green, blue, pink,
// tan), sized for up to ~14 distinct territories. Validated with the
// data-viz skill's palette validator: passes lightness band, chroma floor,
// colorblind-safe separation, and contrast on an adjacent-pair basis. With
// this many hues on a map, some pairs of territories can still land close
// in color if they happen to appear together (no qualitative set this size
// clears every possible pairing at once) -- the legend and per-zip hover
// tooltip are the backstop for that.
const COLOR_PALETTE = [
  '#1E85AC', '#C7519E', '#E85A3A', '#2FB79A', '#D9A62E', '#8A5FD9', '#E08830',
  '#2A9FC4', '#A8342E', '#A84FC7', '#4CAF50', '#3E6FD9', '#E8709E', '#A67A2E'
];

function hashIndex(name, modulus) {
  const str = String(name);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % modulus;
}

// Assigns each name a palette color, hashed so a given name normally lands
// on the same color across refreshes. If two names hash to the same slot,
// the alphabetically-first one keeps it and the other is bumped to the next
// free slot -- so as long as there are no more distinct names than palette
// colors, every name currently on screen gets a distinct color, not just a
// probably-distinct one.
function assignColors(names) {
  const sorted = [...names].sort((a, b) => String(a).localeCompare(String(b)));
  const used = new Set();
  const colorByName = new Map();

  sorted.forEach(name => {
    let index = hashIndex(name, COLOR_PALETTE.length);
    let attempts = 0;
    while (used.has(index) && attempts < COLOR_PALETTE.length) {
      index = (index + 1) % COLOR_PALETTE.length;
      attempts++;
    }
    used.add(index);
    colorByName.set(name, COLOR_PALETTE[index]);
  });

  return colorByName;
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Zip codes come from Sigma in whatever format the source column happens to
// use -- a number (dropping a leading zero, e.g. "01001" -> 1001), a
// ZIP+4 like "89701-1234", or with stray whitespace. Normalizing to a plain
// 5-digit string before matching against the bundled dataset (which is
// keyed by clean 5-digit strings) means those don't silently fail to match
// and vanish from the map. The *filter* variable written back to Sigma
// still uses each row's original, unmodified zip value, so it keeps
// matching whatever format the user's own data uses elsewhere.
function normalizeZip(rawZip) {
  if (rawZip === null || rawZip === undefined) {
    return null;
  }
  const digits = String(rawZip).trim().match(/^\d+/);
  return digits ? digits[0].padStart(5, '0').slice(0, 5) : null;
}

// The heat map metric picker is a Sigma variable set by a control (e.g. a
// button set) the user builds elsewhere in the workbook -- it's expected to
// hold one of these three labels, matched case-insensitively. "MM Opp" wins
// on anything unrecognized (including the variable being unset), so the
// heat map still shows something reasonable before a control is wired up.
function metricKeyFromLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized === 'mm sales') return 'mmSales';
  if (normalized === 'mtgs') return 'mtgs';
  return 'mmOpp';
}

// Roughly centers and frames the continental US. Used as the fixed map view
// so the map doesn't re-center/re-zoom to fit whatever subset of data (e.g.
// after a lasso selection filters the source) happens to be loaded.
const DEFAULT_MAP_CENTER_LAT = 39.8283;
const DEFAULT_MAP_CENTER_LON = -98.5795;
const DEFAULT_MAP_ZOOM = 3.3;
const DEFAULT_HEATMAP_RADIUS = 20;

// Plotly's densitymapbox colors the entire kernel-density surface,
// including near-zero density -- with an ordinary colorscale that paints
// low density as a solid color too, so instead of isolated blobs you get
// one continuous wash covering the whole area between points, hiding
// whatever's underneath (the territory shapes and dots). Fading the low
// end to fully transparent lets the map underneath show through wherever
// there isn't real density, so only the actual hot spots read as blobs.
const HEATMAP_COLORSCALE = [
  [0, 'rgba(0,0,255,0)'],
  [0.15, 'rgba(0,0,255,0.55)'],
  [0.35, 'rgba(0,200,255,0.65)'],
  [0.55, 'rgba(0,220,120,0.7)'],
  [0.7, 'rgba(255,235,0,0.8)'],
  [0.85, 'rgba(255,140,0,0.85)'],
  [1, 'rgba(230,20,20,0.9)']
];

// densitymapbox's radius is a constant number of screen pixels, which
// covers a shrinking geographic area as you zoom in -- but not fast
// enough to stay within a single zip once you're zoomed in past a
// regional view, so a zip's heat visibly bleeds into its neighbors'.
// Below this zoom, the configured radius is used as-is (a wide, blended
// look is what you want at state/national zoom). Above it, radius is
// halved every 2 zoom levels on top of that natural shrinkage, so heat
// stays roughly confined to the zip it belongs to once you're zoomed in
// far enough to see individual zip shapes.
const HEATMAP_RADIUS_REFERENCE_ZOOM = 8;
const HEATMAP_RADIUS_MIN = 4;

function radiusForZoom(baseRadius, zoom) {
  if (!Number.isFinite(zoom) || zoom <= HEATMAP_RADIUS_REFERENCE_ZOOM) return baseRadius;
  const zoomDelta = zoom - HEATMAP_RADIUS_REFERENCE_ZOOM;
  return Math.max(HEATMAP_RADIUS_MIN, baseRadius / Math.pow(2, zoomDelta / 2));
}

// Zip code (ZCTA) boundary + centroid lookup, bundled with the plugin so
// Sigma only needs to supply a zip code and a territory per row -- no
// latitude/longitude columns required. See README.md for the dataset's
// full lineage (Census cartographic boundary file, plus a GeoNames-derived
// fallback for zip codes with no ZCTA at all).
const ZCTA_DATA_URL = `${process.env.PUBLIC_URL}/data/zcta.json`;

// Only the outer ring of each polygon is used (holes are ignored) -- at this
// simplification level ZCTA shapes essentially never have meaningful holes.
function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0]];
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map(polygon => polygon[0]);
  }
  return [];
}

// Some zips in the bundled dataset have a centroid but no boundary polygon
// (e.g. PO-box-only or single-organization zip codes with no ZCTA at all).
// Without this, those zips would render as an invisible gap in an otherwise
// filled territory even though they're valid rows in the source data. Draw
// a small square centered on the centroid instead, so there's at least a
// visible patch of color rather than an unexplained hole.
const FALLBACK_SHAPE_RADIUS_DEG = 0.025;

function ringsForZip(entry) {
  if (entry.rings.length) {
    return entry.rings;
  }
  const { lat, lon } = entry;
  const r = FALLBACK_SHAPE_RADIUS_DEG;
  return [[
    [lon - r, lat - r],
    [lon - r, lat + r],
    [lon + r, lat + r],
    [lon + r, lat - r],
    [lon - r, lat - r]
  ]];
}

client.config.configureEditorPanel([
  { type: "element", name: "source" },
  { type: "column", name: "zipcode", source: "source", allowMultiple: false },
  { type: "column", name: "territory", source: "source", allowMultiple: false },
  { type: "column", name: "channel", source: "source", allowMultiple: false },
  { type: "column", name: "mmOpp", source: "source", allowMultiple: false },
  { type: "column", name: "mmSales", source: "source", allowMultiple: false },
  { type: "column", name: "mtgs", source: "source", allowMultiple: false },
  { type: "column", name: "tooltipFields", source: "source", allowMultiple: true },
  { type: "variable", name: "filterZipcode" },
  { type: "variable", name: "heatmapMetric" },
  { name: "Variables", type: 'group' },
  { name: 'ShowLegend', source: "Variables", type: "toggle", defaultValue: true },
  { name: 'ShowHeatmap', source: "Variables", type: "toggle", defaultValue: false },
  { name: 'HeatmapRadius', source: "Variables", type: 'text', defaultValue: String(DEFAULT_HEATMAP_RADIUS) },
  { name: 'MapStyle', source: "Variables", type: 'text', defaultValue: "light" },
  { name: 'MapCenterLat', source: "Variables", type: 'text', defaultValue: String(DEFAULT_MAP_CENTER_LAT) },
  { name: 'MapCenterLon', source: "Variables", type: 'text', defaultValue: String(DEFAULT_MAP_CENTER_LON) },
  { name: 'MapZoom', source: "Variables", type: 'text', defaultValue: String(DEFAULT_MAP_ZOOM) },
  { name: 'MapboxAccessToken', type: 'text', secure: true },
]);

function App() {
  const config = useConfig();
  const mapboxAccessToken = config.MapboxAccessToken;
  // useElementData caps out at 25,000 rows and silently truncates anything
  // past that -- a source with multiple rows per zip (one per channel,
  // product line, etc.) can run past that easily, so
  // useIncrementalElementData (no row cap, fetched in chunks via
  // loadMoreData) is used instead to make sure every row makes it through.
  const [sigmaData, loadMoreData, dataInfo] = useIncrementalElementData(config.source);
  const columns = useElementColumns(config.source);
  const [filterZipcode, setFilterZipcode] = useVariable(config.filterZipcode);
  // Set by a Sigma control (e.g. a button set) built elsewhere in the
  // workbook -- the plugin only reads this, it never writes it.
  const [heatmapMetric] = useVariable(config.heatmapMetric);
  const [prevSigmaData, setPrevSigmaData] = useState(null);
  const prevColumnsRef = useRef(null);
  const [zctaByZip, setZctaByZip] = useState(null);

  // Keep requesting the next chunk until the host reports every row has
  // been delivered.
  useEffect(() => {
    if (config.source && !dataInfo.isComplete) {
      loadMoreData();
    }
  }, [config.source, dataInfo.isComplete, dataInfo.rowCount, loadMoreData]);

  useEffect(() => {
    let cancelled = false;

    // no-store: this file has changed several times during development and
    // an iframe-embedded plugin can end up pinned to a stale cached copy
    // (browser or Sigma's own resource cache) longer than the server's
    // Cache-Control max-age would suggest -- bypass HTTP caching entirely
    // rather than rely on revalidation.
    fetch(ZCTA_DATA_URL, { cache: 'no-store' })
      .then(res => res.json())
      .then(geojson => {
        if (cancelled) return;

        const byZip = new Map();
        geojson.features.forEach(feature => {
          const { zip, lat, lon } = feature.properties;
          byZip.set(zip, {
            rings: outerRings(feature.geometry),
            lat,
            lon
          });
        });

        setZctaByZip(byZip);
      })
      .catch(err => {
        console.error('Failed to load zip code boundary data', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updatePlotSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      Plotly.relayout('myDiv', { width: width, height: height });
    };

    window.addEventListener('resize', updatePlotSize);

    return () => {
      window.removeEventListener('resize', updatePlotSize);
    };
  }, []);

  useEffect(() => {
    // Compared by content (JSON.stringify), not object identity: the SDK
    // can hand back a new sigmaData/columns object on every internal update
    // even when nothing actually changed, and gating on reference equality
    // instead would re-run the full Plotly.newPlot redraw on every one of
    // those ticks -- visible as the whole map flashing/rebuilding in a loop.
    const columnsKey = JSON.stringify(columns);
    if (
      zctaByZip &&
      sigmaData &&
      (JSON.stringify(sigmaData) !== JSON.stringify(prevSigmaData) ||
        columnsKey !== prevColumnsRef.current)
    ) {
      setPrevSigmaData(sigmaData);
      prevColumnsRef.current = columnsKey;

      const graphDiv = document.getElementById('myDiv');

      const zip = sigmaData[config.zipcode];
      const territory = sigmaData[config.territory];

      if (!zip || !territory) {
        return;
      }

      // The channel/metric columns are optional -- without them the plugin
      // still works exactly as before (one shape+dot per zip, no
      // per-channel breakdown, no heat map).
      const channelCol = config.channel ? sigmaData[config.channel] : null;
      const mmOppCol = config.mmOpp ? sigmaData[config.mmOpp] : null;
      const mmSalesCol = config.mmSales ? sigmaData[config.mmSales] : null;
      const mtgsCol = config.mtgs ? sigmaData[config.mtgs] : null;

      const normalizedZip = zip.map(normalizeZip);

      // A zip code can appear on many rows (one per channel, product line,
      // etc.), so every row is first folded into one aggregate per zip:
      // its territory, plus MM Opp / MM Sales / Mtgs summed per channel
      // and overall (the overall totals drive the heat map; the
      // per-channel totals drive the dot tooltip). Zip codes with no entry
      // in the bundled dataset are collected separately for the
      // "not shown" note -- as a set, so a zip missing across many rows
      // is still counted once, matching what the note says.
      const zipAgg = new Map();
      const unmatchedZips = new Set();

      zip.forEach((rawZip, index) => {
        const normZip = normalizedZip[index];
        if (!zctaByZip.has(normZip)) {
          unmatchedZips.add(rawZip);
          return;
        }

        if (!zipAgg.has(normZip)) {
          zipAgg.set(normZip, {
            rawZip,
            firstIndex: index,
            territory: territory[index],
            channelTotals: new Map(),
            totals: { mmOpp: 0, mmSales: 0, mtgs: 0 }
          });
        }
        const agg = zipAgg.get(normZip);

        const opp = mmOppCol ? Number(mmOppCol[index]) || 0 : 0;
        const sales = mmSalesCol ? Number(mmSalesCol[index]) || 0 : 0;
        const mtg = mtgsCol ? Number(mtgsCol[index]) || 0 : 0;

        agg.totals.mmOpp += opp;
        agg.totals.mmSales += sales;
        agg.totals.mtgs += mtg;

        const ch = channelCol ? channelCol[index] : null;
        if (ch !== null && ch !== undefined && ch !== '') {
          if (!agg.channelTotals.has(ch)) {
            agg.channelTotals.set(ch, { mmOpp: 0, mmSales: 0, mtgs: 0 });
          }
          const chTotal = agg.channelTotals.get(ch);
          chTotal.mmOpp += opp;
          chTotal.mmSales += sales;
          chTotal.mtgs += mtg;
        }
      });

      const unmappedCount = unmatchedZips.size;
      if (unmappedCount > 0) {
        console.warn(
          `Zip Code Lasso Map: ${unmappedCount} distinct zip value(s) did not match the boundary dataset. First 20:`,
          Array.from(unmatchedZips).slice(0, 20)
        );
      }

      // Group unique zips by territory for the filled shapes.
      const zipsByTerritory = new Map();
      zipAgg.forEach((agg, normZip) => {
        const t = agg.territory;
        if (!zipsByTerritory.has(t)) {
          zipsByTerritory.set(t, []);
        }
        zipsByTerritory.get(t).push(normZip);
      });

      const sortedTerritories = Array.from(zipsByTerritory.keys()).sort((a, b) =>
        String(a).localeCompare(String(b))
      );
      const colorByTerritory = assignColors(sortedTerritories);

      const tooltipFieldIds = Array.isArray(config.tooltipFields) ? config.tooltipFields : [];

      // Per-territory tooltip text (first non-empty tooltipFields value
      // found among that territory's rows) -- shared by every zip shape
      // in the territory.
      const tooltipTextByTerritory = new Map();
      sortedTerritories.forEach(t => {
        const zipsInTerritory = zipsByTerritory.get(t);
        const firstIndex = zipAgg.get(zipsInTerritory[0]).firstIndex;
        const tooltipLines = [`<b>${t}</b>`];
        tooltipFieldIds.forEach(fieldId => {
          const columnValues = sigmaData[fieldId];
          if (!columnValues) return;
          const value = columnValues[firstIndex];
          if (value === null || value === undefined || value === '') return;
          const label = (columns[fieldId] && columns[fieldId].name) || fieldId;
          tooltipLines.push(`${label}: ${value}`);
        });
        tooltipTextByTerritory.set(t, tooltipLines.join('<br>'));
      });

      // Territory shapes are drawn as a single choroplethmapbox trace
      // rather than one scattermapbox fill-to-self trace per territory.
      // Plotly's mapbox engine hardcodes its layer stacking order --
      // choroplethmapbox always below densitymapbox always below
      // scattermapbox, regardless of trace array order -- so this is the
      // only way to get the heat map to render on top of the territory
      // coloring instead of underneath it.
      const territoryIndex = new Map(sortedTerritories.map((t, i) => [t, i]));
      const territoryCount = sortedTerritories.length;

      const choroplethFeatures = [];
      const choroplethLocations = [];
      const choroplethZ = [];
      const choroplethText = [];

      zipAgg.forEach((agg, normZip) => {
        const rings = ringsForZip(zctaByZip.get(normZip));
        choroplethFeatures.push({
          type: 'Feature',
          id: normZip,
          geometry: { type: 'MultiPolygon', coordinates: rings.map(ring => [ring]) }
        });
        choroplethLocations.push(normZip);
        // +0.5 lands each zip solidly inside its territory's color band
        // rather than exactly on the boundary between two bands.
        choroplethZ.push(territoryIndex.get(agg.territory) + 0.5);
        choroplethText.push(tooltipTextByTerritory.get(agg.territory));
      });

      // A flat, stepped colorscale so each territory's index band renders
      // as that territory's exact assigned color, not a gradient.
      const territoryColorscale = [];
      sortedTerritories.forEach((t, i) => {
        const color = colorByTerritory.get(t);
        territoryColorscale.push([i / territoryCount, color]);
        territoryColorscale.push([(i + 1) / territoryCount, color]);
      });

      const choroplethTrace = territoryCount > 0 ? {
        type: 'choroplethmapbox',
        geojson: { type: 'FeatureCollection', features: choroplethFeatures },
        locations: choroplethLocations,
        z: choroplethZ,
        zmin: 0,
        zmax: territoryCount,
        colorscale: territoryColorscale,
        showscale: false,
        marker: { opacity: 0.4, line: { color: 'rgba(255,255,255,0.6)', width: 0.5 } },
        text: choroplethText,
        hoverinfo: 'text',
        showlegend: false
      } : null;

      // Dummy invisible point traces purely to give each territory its
      // own legend swatch -- choroplethmapbox only supports a single
      // continuous colorscale legend, not one per category.
      const legendTraces = sortedTerritories.map(t => ({
        type: 'scattermapbox',
        mode: 'markers',
        lon: [DEFAULT_MAP_CENTER_LON],
        lat: [DEFAULT_MAP_CENTER_LAT],
        marker: { size: 8, color: colorByTerritory.get(t), opacity: 0 },
        name: t,
        showlegend: true,
        hoverinfo: 'skip'
      }));

      // Single trace of centroid dots across all zips -- this is what
      // actually receives lasso/box selection (Plotly doesn't support
      // lasso-selecting filled map shapes), colored to match each zip's
      // territory fill. Its hover shows the per-channel MM Opp/MM
      // Sales/Mtgs breakdown when those columns are configured.
      const dotLons = [];
      const dotLats = [];
      const dotColors = [];
      const dotZips = [];
      const dotLabels = [];

      zipAgg.forEach((agg, normZip) => {
        const entry = zctaByZip.get(normZip);
        dotLons.push(entry.lon);
        dotLats.push(entry.lat);
        dotColors.push(colorByTerritory.get(agg.territory));
        dotZips.push(agg.rawZip);

        const lines = [`<b>${agg.rawZip}</b> — ${agg.territory}`];
        const sortedChannels = Array.from(agg.channelTotals.keys()).sort((a, b) =>
          String(a).localeCompare(String(b))
        );
        sortedChannels.forEach(ch => {
          const chTotal = agg.channelTotals.get(ch);
          const parts = [];
          if (mmOppCol) parts.push(`MM Opp: ${formatNumber(chTotal.mmOpp)}`);
          if (mmSalesCol) parts.push(`MM Sales: ${formatNumber(chTotal.mmSales)}`);
          if (mtgsCol) parts.push(`Mtgs: ${formatNumber(chTotal.mtgs)}`);
          if (parts.length) {
            lines.push(`${ch}: ${parts.join(', ')}`);
          }
        });
        dotLabels.push(lines.join('<br>'));
      });

      const dotTrace = {
        type: 'scattermapbox',
        mode: 'markers',
        name: 'Zip codes',
        lon: dotLons,
        lat: dotLats,
        marker: { size: 4, color: dotColors },
        customdata: dotZips,
        text: dotLabels,
        hovertemplate: '%{text}<extra></extra>',
        showlegend: false
      };

      // Fixed map view (defaults to framing the continental US) so the map
      // doesn't jump to fit whatever subset of data is currently loaded.
      const parsedCenterLat = parseFloat(config.MapCenterLat);
      const parsedCenterLon = parseFloat(config.MapCenterLon);
      const parsedZoom = parseFloat(config.MapZoom);

      const centerLat = Number.isFinite(parsedCenterLat) ? parsedCenterLat : DEFAULT_MAP_CENTER_LAT;
      const centerLon = Number.isFinite(parsedCenterLon) ? parsedCenterLon : DEFAULT_MAP_CENTER_LON;
      const zoom = Number.isFinite(parsedZoom) ? parsedZoom : DEFAULT_MAP_ZOOM;

      // Optional heat map layer, drawn on top of the territory shapes and
      // dots. Its intensity per zip is that zip's total (summed across all
      // channels) for whichever of MM Opp / MM Sales / Mtgs the
      // heatmapMetric Sigma variable currently selects.
      let heatmapTrace = null;
      let baseHeatmapRadius = DEFAULT_HEATMAP_RADIUS;
      if (config.ShowHeatmap && (mmOppCol || mmSalesCol || mtgsCol)) {
        const metricKey = metricKeyFromLabel(heatmapMetric);
        const heatLons = [];
        const heatLats = [];
        const heatWeights = [];

        zipAgg.forEach((agg, normZip) => {
          const weight = agg.totals[metricKey];
          if (!weight || weight <= 0) return;
          const entry = zctaByZip.get(normZip);
          heatLons.push(entry.lon);
          heatLats.push(entry.lat);
          heatWeights.push(weight);
        });

        if (heatLons.length) {
          const parsedRadius = parseFloat(config.HeatmapRadius);
          baseHeatmapRadius = Number.isFinite(parsedRadius) ? parsedRadius : DEFAULT_HEATMAP_RADIUS;
          heatmapTrace = {
            type: 'densitymapbox',
            lon: heatLons,
            lat: heatLats,
            z: heatWeights,
            radius: radiusForZoom(baseHeatmapRadius, zoom),
            colorscale: HEATMAP_COLORSCALE,
            // Opacity is already baked into each colorscale stop above, so
            // this stays at 1 rather than dimming everything a second time.
            opacity: 1,
            showscale: false,
            hoverinfo: 'skip'
          };
        }
      }

      const plotData = [
        ...(choroplethTrace ? [choroplethTrace] : []),
        ...legendTraces,
        dotTrace,
        ...(heatmapTrace ? [heatmapTrace] : [])
      ];

      // Check if MapStyle is valid, if not, use the default value
      const validMapStyles = ['light', 'dark', 'streets', 'outdoors', 'satellite', 'satellite-streets'];
      const mapStyle = validMapStyles.includes(config.MapStyle) ? config.MapStyle : 'light';

      const layout = {
        dragmode: 'lasso',
        mapbox: {
          center: {
            lat: centerLat,
            lon: centerLon
          },
          domain: {
            x: [0, 1],
            y: [0, 1]
          },
          style: mapStyle,
          zoom: zoom
        },
        margin: {
          r: 0,
          t: 0,
          b: 0,
          l: 0,
          pad: 0
        },
        paper_bgcolor: '#191A1A',
        plot_bgcolor: '#191A1A',
        autosize: true,
        legend: {
          x: 0.01,
          y: 0.98,
          bgcolor: 'rgba(0,0,0,0.5)',
          font: { color: 'white' },
          visible: config.ShowLegend
        },
        annotations: unmappedCount > 0 ? [{
          text: `${unmappedCount} zip code${unmappedCount === 1 ? '' : 's'} not shown`,
          showarrow: false,
          xref: 'paper',
          yref: 'paper',
          x: 0.99,
          y: 0.02,
          xanchor: 'right',
          yanchor: 'bottom',
          font: { size: 11, color: '#ccc' },
          bgcolor: 'rgba(0,0,0,0.5)'
        }] : []
      };

      Plotly.setPlotConfig({ mapboxAccessToken: mapboxAccessToken });
      Plotly.newPlot('myDiv', plotData, layout, { displayModeBar: true });

      graphDiv.on('plotly_selected', function (eventData) {
        const selectedZipcodes = eventData && eventData.points
          ? eventData.points
            .map(pt => pt.customdata)
            .filter(z => z !== undefined && z !== null)
          : [];

        const uniqueSelectedZipcodes = Array.from(new Set(selectedZipcodes));

        if (uniqueSelectedZipcodes.length) {
          setFilterZipcode(uniqueSelectedZipcodes.join(","));
        } else {
          setFilterZipcode(null);
        }
      });

      graphDiv.on('plotly_deselect', function () {
        setFilterZipcode(null);
      });

      // Re-scale the heat map's radius live as the viewer zooms, so it
      // stays roughly confined to each zip instead of bleeding into its
      // neighbors once you're zoomed in past a regional view.
      if (heatmapTrace) {
        const heatmapTraceIndex = plotData.length - 1;
        graphDiv.on('plotly_relayout', function (relayoutData) {
          const newZoom = relayoutData && relayoutData['mapbox.zoom'];
          if (typeof newZoom !== 'number') return;
          Plotly.restyle(graphDiv, { radius: [radiusForZoom(baseHeatmapRadius, newZoom)] }, [heatmapTraceIndex]);
        });
      }
    }
  }, [sigmaData, config, filterZipcode, heatmapMetric, prevSigmaData, mapboxAccessToken, setFilterZipcode, zctaByZip, columns]);

  return (
    <div id='myDiv'></div>
  );
}

export default App;
