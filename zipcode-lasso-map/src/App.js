import React, { useEffect, useState } from 'react';
import Plotly from 'plotly.js-dist';
import './App.css';
import {
  client,
  useConfig,
  useElementData,
  useVariable,
} from "@sigmacomputing/plugin";

// Plotly's default qualitative palette, reused here so we can assign colors
// ourselves instead of letting Plotly cycle them by trace order.
const COLOR_PALETTE = [
  '#636EFA', '#EF553B', '#00CC96', '#AB63FA', '#FFA15A',
  '#19D3F3', '#FF6692', '#B6E880', '#FF97FF', '#FECB52'
];

// Deterministic string -> palette index, so a given legend value (e.g. a
// region name) always gets the same color no matter what order the query
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

// Roughly centers and frames the continental US. Used as the fixed map view
// so the map doesn't re-center/re-zoom to fit whatever subset of data (e.g.
// after a lasso selection filters the source) happens to be loaded.
const DEFAULT_MAP_CENTER_LAT = 39.8283;
const DEFAULT_MAP_CENTER_LON = -98.5795;
const DEFAULT_MAP_ZOOM = 3.3;

client.config.configureEditorPanel([
  { type: "element", name: "source" },
  { type: "column", name: "zipcode", source: "source", allowMultiple: false },
  { type: "column", name: "latitude", source: "source", allowMultiple: false },
  { type: "column", name: "longitude", source: "source", allowMultiple: false },
  { type: "column", name: "legend", source: "source", allowMultiple: false },
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
    if (sigmaData && JSON.stringify(sigmaData) !== JSON.stringify(prevSigmaData)) {
      setPrevSigmaData(sigmaData);

      const graphDiv = document.getElementById('myDiv');

      let names = config.legend ? sigmaData[config.legend] : null;
      const zip = sigmaData[config.zipcode];
      const lat = sigmaData[config.latitude];
      const lon = sigmaData[config.longitude];

      if (!zip || !lat || !lon) {
        return;
      }

      if (!names) {
        names = Array.from({ length: zip.length }, () => null);
      }

      const uniqueNames = Array.from(new Set(names)).sort((a, b) =>
        String(a).localeCompare(String(b))
      );

      const plotData = uniqueNames.map(uniqueName => {
        const indices = names.reduce((acc, val, index) => {
          if (val === uniqueName) {
            acc.push(index);
          }
          return acc;
        }, []);

        const zipsForName = indices.map(i => zip[i]);
        const latitudesForName = indices.map(i => lat[i]);
        const longitudesForName = indices.map(i => lon[i]);

        return {
          type: 'scattermapbox',
          name: uniqueName,
          lat: latitudesForName,
          lon: longitudesForName,
          customdata: zipsForName,
          text: zipsForName,
          hovertemplate: '%{text}<extra></extra>',
          marker: uniqueName !== null ? { color: colorForName(uniqueName) } : undefined
        };
      });

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
          ? eventData.points.map(pt => pt.customdata)
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
  }, [sigmaData, config, filterZipcode, prevSigmaData, mapboxAccessToken, setFilterZipcode]);

  return (
    <div id='myDiv'></div>
  );
}

export default App;
