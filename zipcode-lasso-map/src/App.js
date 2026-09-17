import React, { useEffect, useState } from 'react';
import Plotly from 'plotly.js-dist';
import './App.css';
import {
  client,
  useConfig,
  useElementData,
  useVariable,
} from "@sigmacomputing/plugin";

// Muted categorical palette (blue, rose, steel cyan, tan, teal, terracotta,
// purple, olive, navy, green). Validated with the data-viz skill's palette
// validator: passes lightness band, chroma floor, colorblind-safe
// separation, and contrast on an adjacent-pair basis. With this many hues
// on a map, some pairs of territories can still land close in color if
// they happen to appear together (no qualitative set this size clears
// every possible pairing at once) -- the legend and per-zip hover tooltip
// are the backstop for that.
const COLOR_PALETTE = [
  '#3D74B0', '#B94F6B', '#1E93AE', '#C9963D', '#1F9C89',
  '#C05A3A', '#7A5FA0', '#8B9B3D', '#25659A', '#4F9350'
];

// Deterministic string -> palette index, so a given legend value (e.g. a
// territory name) always gets the same color no matter what order the query
// results come back in or which other values are present.
function colorForName(name) {
  const str = String(name);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Roughly centers and frames the continental US. Used as the fixed map view
// so the map doesn't re-center/re-zoom to fit whatever subset of data (e.g.
// after a lasso selection filters the source) happens to be loaded.
const DEFAULT_MAP_CENTER_LAT = 39.8283;
const DEFAULT_MAP_CENTER_LON = -98.5795;
const DEFAULT_MAP_ZOOM = 3.3;

// Zip code (ZCTA) boundary + centroid lookup, bundled with the plugin so
// Sigma only needs to supply a zip code and a territory per row -- no
// latitude/longitude columns required. Derived from Census TIGER ZCTA
// boundaries (public domain), simplified via
// https://github.com/ndrezn/zip-code-geojson.
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

client.config.configureEditorPanel([
  { type: "element", name: "source" },
  { type: "column", name: "zipcode", source: "source", allowMultiple: false },
  { type: "column", name: "territory", source: "source", allowMultiple: false },
  { type: "variable", name: "filterZipcode" },
  { name: "Variables", type: 'group' },
  { name: 'ShowLegend', source: "Variables", type: "toggle", defaultValue: true },
  { name: 'MapStyle', source: "Variables", type: 'text', defaultValue: "light" },
  { name: 'MapCenterLat', source: "Variables", type: 'text', defaultValue: String(DEFAULT_MAP_CENTER_LAT) },
  { name: 'MapCenterLon', source: "Variables", type: 'text', defaultValue: String(DEFAULT_MAP_CENTER_LON) },
  { name: 'MapZoom', source: "Variables", type: 'text', defaultValue: String(DEFAULT_MAP_ZOOM) },
  { name: 'MapboxAccessToken', type: 'text', secure: true },
]);

function App() {
  const config = useConfig();
  const mapboxAccessToken = config.MapboxAccessToken;
  const sigmaData = useElementData(config.source);
  const [filterZipcode, setFilterZipcode] = useVariable(config.filterZipcode);
  const [prevSigmaData, setPrevSigmaData] = useState(null);
  const [zctaByZip, setZctaByZip] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetch(ZCTA_DATA_URL)
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
    if (
      zctaByZip &&
      sigmaData &&
      JSON.stringify(sigmaData) !== JSON.stringify(prevSigmaData)
    ) {
      setPrevSigmaData(sigmaData);

      const graphDiv = document.getElementById('myDiv');

      const zip = sigmaData[config.zipcode];
      const territory = sigmaData[config.territory];

      if (!zip || !territory) {
        return;
      }

      // Group row indices by territory, keeping only zips we have shapes for.
      const indicesByTerritory = new Map();
      zip.forEach((z, index) => {
        if (!zctaByZip.has(z)) {
          return;
        }
        const t = territory[index];
        if (!indicesByTerritory.has(t)) {
          indicesByTerritory.set(t, []);
        }
        indicesByTerritory.get(t).push(index);
      });

      const sortedTerritories = Array.from(indicesByTerritory.keys()).sort((a, b) =>
        String(a).localeCompare(String(b))
      );

      // One filled trace per territory: concatenate every zip's outer ring
      // into a single scattermapbox trace, separated by null breaks so
      // Plotly draws each zip as its own closed shape within the trace.
      const fillTraces = sortedTerritories.map(t => {
        const color = colorForName(t);
        const lons = [];
        const lats = [];

        indicesByTerritory.get(t).forEach(index => {
          const { rings } = zctaByZip.get(zip[index]);
          rings.forEach(ring => {
            if (lons.length) {
              lons.push(null);
              lats.push(null);
            }
            ring.forEach(([lon, lat]) => {
              lons.push(lon);
              lats.push(lat);
            });
          });
        });

        return {
          type: 'scattermapbox',
          mode: 'lines',
          name: t,
          lon: lons,
          lat: lats,
          fill: 'toself',
          fillcolor: hexToRgba(color, 0.6),
          line: { color, width: 1 },
          hoverinfo: 'skip',
          showlegend: true
        };
      });

      // Single trace of centroid dots across all zips -- this is what
      // actually receives lasso/box selection (Plotly doesn't support
      // lasso-selecting filled map shapes), colored to match each zip's
      // territory fill.
      const dotLons = [];
      const dotLats = [];
      const dotColors = [];
      const dotZips = [];
      const dotLabels = [];

      zip.forEach((z, index) => {
        const entry = zctaByZip.get(z);
        if (!entry) return;
        dotLons.push(entry.lon);
        dotLats.push(entry.lat);
        dotColors.push(colorForName(territory[index]));
        dotZips.push(z);
        dotLabels.push(`${z} — ${territory[index]}`);
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

      const plotData = [...fillTraces, dotTrace];

      // Fixed map view (defaults to framing the continental US) so the map
      // doesn't jump to fit whatever subset of data is currently loaded.
      const parsedCenterLat = parseFloat(config.MapCenterLat);
      const parsedCenterLon = parseFloat(config.MapCenterLon);
      const parsedZoom = parseFloat(config.MapZoom);

      const centerLat = Number.isFinite(parsedCenterLat) ? parsedCenterLat : DEFAULT_MAP_CENTER_LAT;
      const centerLon = Number.isFinite(parsedCenterLon) ? parsedCenterLon : DEFAULT_MAP_CENTER_LON;
      const zoom = Number.isFinite(parsedZoom) ? parsedZoom : DEFAULT_MAP_ZOOM;

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
        }
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
    }
  }, [sigmaData, config, filterZipcode, prevSigmaData, mapboxAccessToken, setFilterZipcode, zctaByZip]);

  return (
    <div id='myDiv'></div>
  );
}

export default App;
