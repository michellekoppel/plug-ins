# Zip Code Lasso Map

A [Sigma Computing](https://www.sigmacomputing.com/) custom plugin that plots
rows from a Sigma element on a Mapbox map (one point per zip code) and lets
users lasso- or box-select a region of the map to filter the rest of the
workbook by the zip codes they selected.

This is a zip-code-oriented adaptation of
[tyleraspencer/lasso_map](https://github.com/tyleraspencer/lasso_map), which
does the same thing for raw latitude/longitude points. Instead of writing the
selected latitudes and longitudes back to Sigma variables, this plugin writes
the selected **zip codes** back to a single Sigma variable, which you can use
elsewhere in your workbook (e.g. as a filter on a table, `IN` condition on a
control, etc).

## How it works

1. Point the plugin at a Sigma element that has one row per zip code (or one
   row per record, each tagged with a zip code), with columns for the zip
   code and its latitude/longitude (e.g. joined from a zip-code lookup
   table).
2. The plugin plots one marker per row on a Mapbox map.
3. Lasso- or box-select markers on the map.
4. The plugin collects the unique zip codes among the selected markers and
   writes them (comma-separated) into the `filterZipcode` Sigma control
   variable.
5. Deselecting (clicking off the selection) clears the variable.

## Configuration

When you add this plugin to a Sigma workbook, the editor panel exposes:

| Field | Type | Description |
| --- | --- | --- |
| `source` | Element | The Sigma element supplying the data to plot. |
| `zipcode` | Column | The zip code for each row. |
| `latitude` | Column | The latitude for each row. |
| `longitude` | Column | The longitude for each row. |
| `legend` | Column (optional) | A column to color/group markers by (e.g. region, category). |
| `filterZipcode` | Control variable | The variable the plugin writes selected zip codes to, comma-separated. |
| `ShowLegend` | Toggle | Show/hide the map legend. Default: on. |
| `MapStyle` | Text | One of `light`, `dark`, `streets`, `outdoors`, `satellite`, `satellite-streets`. Default: `light`. |
| `MapboxAccessToken` | Secure text | Your [Mapbox access token](https://docs.mapbox.com/help/getting-started/access-tokens/), required to render the map. |

## Local development

```bash
npm install
npm start
```

This runs the plugin at `http://localhost:3000` in development mode, matching
the standard [Create React App](https://create-react-app.dev/) workflow. To
develop against a real Sigma workbook, follow Sigma's
[plugin development guide](https://help.sigmacomputing.com/docs/create-a-plugin)
to point a workbook's Plugin element at your local dev server URL.

## Deploying

```bash
npm run build
```

produces a static `build/` folder you can host anywhere (e.g. GitHub Pages,
Netlify, Vercel, S3) and then register as a Plugin URL in Sigma.
