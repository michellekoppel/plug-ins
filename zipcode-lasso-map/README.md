# Zip Code Lasso Map

A [Sigma Computing](https://www.sigmacomputing.com/) custom plugin that
renders each zip code in a Sigma element as a filled shape on a Mapbox map,
colored by a territory/region column, with a small dot at each zip's
centroid. Lasso- or box-selecting dots filters the rest of the workbook by
the zip codes selected.

This started as a zip-code-oriented adaptation of
[tyleraspencer/lasso_map](https://github.com/tyleraspencer/lasso_map), which
does the same lasso-to-filter interaction for raw latitude/longitude points.
Instead of writing selected latitudes/longitudes back to Sigma variables,
this plugin writes the selected **zip codes** back to a single Sigma
variable, which you can use elsewhere in your workbook (e.g. as a filter on
a table, `IN` condition on a control, etc).

## How it works

1. Point the plugin at a Sigma element with one row per zip code, with a zip
   code column and a territory/region column (used purely for coloring).
   Sigma doesn't need to supply any geographic data — the plugin bundles its
   own zip code (ZCTA) boundary shapes.
2. The plugin looks up each zip's boundary polygon and centroid from that
   bundled dataset, fills each zip's shape with a color derived from its
   territory value, and plots a small dot at each zip's centroid on top.
3. Lasso- or box-select the dots on the map (Plotly's map lasso/box select
   only works on point markers, not filled shapes, which is why the dots
   exist — they're the actual selection target, styled to sit unobtrusively
   inside each colored shape).
4. The plugin collects the unique zip codes among the selected dots and
   writes them (comma-separated) into the `filterZipcode` Sigma control
   variable.
5. Deselecting (clicking off the selection) clears the variable.

### Zip code boundary data

`public/data/zcta.json` is a ~9 MB bundled dataset of every US Zip Code
Tabulation Area (ZCTA): a simplified boundary polygon plus a centroid for
each. It's derived from US Census TIGER/Line data (public domain), via the
simplified export at
[ndrezn/zip-code-geojson](https://github.com/ndrezn/zip-code-geojson). The
plugin fetches it once per session (not bundled into the JS itself) and
looks up rows from your Sigma data against it by 5-digit zip code. Zip codes
not found in this dataset (e.g. non-US zips) are silently skipped.

## Configuration

When you add this plugin to a Sigma workbook, the editor panel exposes:

| Field | Type | Description |
| --- | --- | --- |
| `source` | Element | The Sigma element supplying the data to plot. |
| `zipcode` | Column | The 5-digit zip code for each row. |
| `territory` | Column | The value used to color each zip's shape and dot (e.g. sales territory, region). |
| `filterZipcode` | Control variable | The variable the plugin writes selected zip codes to, comma-separated. |
| `ShowLegend` | Toggle | Show/hide the map legend. Default: on. |
| `MapStyle` | Text | One of `light`, `dark`, `streets`, `outdoors`, `satellite`, `satellite-streets`. Default: `light`. |
| `MapCenterLat` / `MapCenterLon` / `MapZoom` | Text | Fixed map view so it doesn't jump to fit whatever data is currently loaded. Defaults to framing the continental US. |
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
