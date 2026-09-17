import React, { useEffect, useState } from 'react';
import Plotly from 'plotly.js-dist';
import './App.css';
import {
  client,
  useConfig,
  useElementData,
  useVariable,
} from "@sigmacomputing/plugin";

// Bright, cheerful categorical palette (violet, amber, sky blue, coral,
// blue, green, magenta, mint). Validated with the data-viz skill's palette
// validator: passes lightness band, chroma floor, colorblind-safe
// separation, and contrast on an adjacent-pair basis. With this many hues
// on a map, some pairs of territories can still land close in color if
// they happen to appear together (no qualitative set this size clears
// every possible pairing at once) -- the legend and per-zip hover tooltip
// are the backstop for that.
const COLOR_PALETTE = [
  '#8A5FD9', '#D98A2E', '#2A9FC4', '#E8654F',
  '#4A80D9', '#3FAE6E', '#C15A9E', '#2FB88F'
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
      const colorByTerritory = assignColors(sortedTerritories);

      // One filled trace per territory: concatenate every zip's outer ring
      // into a single scattermapbox trace, separated by null breaks so
      // Plotly draws each zip as its own closed shape within the trace.
      const fillTraces = sortedTerritories.map(t => {
        const color = colorByTerritory.get(t);
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
          fillcolor: hexToRgba(color, 0.35),
          line: { color, width: 1.25 },
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
        dotColors.push(colorByTerritory.get(territory[index]));
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
