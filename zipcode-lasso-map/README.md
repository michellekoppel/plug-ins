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

`public/data/zcta.json` is an ~19 MB bundled dataset built from two sources
layered together:

1. **Boundary shapes**, for ~33,800 US Zip Code Tabulation Areas (ZCTAs), from
   the Census Bureau's
   [2020 cartographic boundary file](https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip)
   (`cb_2020_us_zcta520_500k`, public domain), simplified with
   [mapshaper](https://github.com/mbloch/mapshaper) using shared-topology
   simplification (`visvalingam keep-shapes 8%`) so adjacent zip shapes keep
   matching edges instead of drifting apart into gaps, the way simplifying
   each shape independently would.
2. **Centroid-only fallback points**, for ~7,800 additional US zip codes that
   are real, valid USPS zip codes but have no ZCTA at all — ZCTAs are built
   from populated census blocks, so a zip code assigned to a single
   organization, PO box, or military base (e.g. `59402`, Malmstrom AFB, MT)
   commonly has no residential census block behind it and gets no ZCTA,
   not just no shape. These come from
   [GeoNames' US postal code data](https://download.geonames.org/export/zip/)
   (CC BY 4.0), which covers the full set of ~41,500 USPS zip codes with at
   least a point location.

The plugin fetches this once per session (not bundled into the JS itself)
and looks up rows from your Sigma data against it by 5-digit zip code (zip
values are normalized first — a numeric column, a ZIP+4 suffix, or stray
whitespace won't break the match). A zip with no boundary polygon (from
either source above) renders as a small square at its centroid instead of a
full shape, so it's still visible on the map even without a real outline.

Zip codes with no entry in this dataset at all are skipped and counted in a
"N zip codes not shown" note in the bottom-right corner of the map, mirroring
Sigma's native region map. At this point that should only happen for non-US
zips or genuinely unpopulated land with no zip code assigned to it (e.g.
much of rural Nevada's federal/BLM land) — not something a bigger or
better dataset can fix, since there's no zip code to draw there. Getting
literally gap-free nationwide coverage over that unpopulated land (as
Sigma's built-in region map does) would require a licensed commercial
zip-boundary dataset, which isn't available through a public Mapbox access
token.

## Configuration

When you add this plugin to a Sigma workbook, the editor panel exposes:

| Field | Type | Description |
| --- | --- | --- |
| `source` | Element | The Sigma element supplying the data to plot. |
| `zipcode` | Column | The 5-digit zip code for each row. |
| `territory` | Column | The value used to color each zip's shape and dot (e.g. sales territory, region). |
| `tooltipFields` | Column (multiple) | Extra columns to show when hovering over a territory's shape (e.g. rep name, quota). Treated as per-territory attributes — shows the first non-empty value found among that territory's rows, not an aggregate across all its zips. |
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
