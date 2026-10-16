# Territory Map

A [Sigma](https://www.sigmacomputing.com/) custom plugin that paints sales
territories as solid, arbitrarily-colored blocks on a Mapbox map, with one
label per territory showing **FW name, MM Opp, MM Sales and Territory**.

Unlike `zipcode-lasso-map`, there are no zip-level dots, tooltips, heat map or
lasso selection -- zip shapes are drawn without borders so each territory
reads as one block. This plugin is fully separate from `zipcode-lasso-map`.

## Editor panel

| Field | Description |
| --- | --- |
| `source` | Sigma element supplying the data (any number of rows per zip). |
| `zipcode` | 5-digit zip column. Used only to locate the territory on the map. |
| `territory` | Territory ID/name. Drives block color, legend and label. |
| `fw` | Optional. FW name (first non-empty value per territory). |
| `mmOpp` / `mmSales` | Optional numeric columns, summed per territory. |
| `ShowLegend` / `ShowLabels` | Toggles. Default on. |
| `FillOpacity` | 0.05-1, default `0.8`. |
| `MapStyle` | `light`, `dark`, `streets`, `outdoors`, `satellite`, `satellite-streets`. |
| `MapCenterLat` / `MapCenterLon` / `MapZoom` | Fixed view. Defaults to the continental US. |
| `MapboxAccessToken` | Secure text. Required for the basemap. |

Label order: FW name, MM Opp, MM Sales, Territory. Territory colors are
assigned in sorted order, so they stay stable between refreshes.

Boundary data (`public/data/zcta.json`) is derived from the Census 2020 ZCTA
cartographic boundaries. Zips without a boundary are counted in the
"N zip codes not shown" note.

## Develop / deploy

```bash
npm install
npm start          # local dev server
npm run build      # static build in build/
```

Hosted at `https://michellekoppel.github.io/plug-ins/territory-map/` (the
`territory-map/` folder on the `gh-pages` branch).
