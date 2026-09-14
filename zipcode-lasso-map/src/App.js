import React, { useEffect, useState } from 'react';
import Plotly from 'plotly.js-dist';
import './App.css';
import {
  client,
  useConfig,
  useElementData,
  useVariable,
} from "@sigmacomputing/plugin";

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

      const uniqueNames = Array.from(new Set(names));

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
          hovertemplate: '%{text}<extra></extra>'
        };
      });

      const centerLat = lat.reduce((a, b) => a + b, 0) / lat.length;
      const centerLon = lon.reduce((a, b) => a + b, 0) / lon.length;

      const maxLatDiff = Math.max(...lat) - Math.min(...lat);
      const maxLonDiff = Math.max(...lon) - Math.min(...lon);

      const latZoom = Math.log2(360 / maxLatDiff);
      const lonZoom = Math.log2(180 / maxLonDiff);

      const zoom = Math.min(latZoom, lonZoom);

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
