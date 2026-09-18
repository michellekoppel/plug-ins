# Zip Code Lasso 2

A Sigma custom plugin that plots zip codes as real geographic shapes (ZCTA
boundaries, not dots) on a map and lets users lasso-select them. The selected
zip codes are written to a Sigma control.

Rebuilt from scratch to fix the zip code boundary coverage problems in the
`zipcode-lasso-map` plugin — this version bundles the same boundary dataset
but ships as plain, readable source (no build step) so it's easy to debug,
and reports how many of the input zip codes didn't match a known boundary
directly in the toolbar.

## Hosting

Static files only — no build step. Once pushed to `gh-pages`, the plugin is
served at:

```
https://michellekoppel.github.io/plug-ins/zip-code-lasso2/
```

Register that URL as both the **Production URL** and **Development URL**
when adding the plugin in Sigma's Admin Portal → Account → Custom Plugins.

## Set up in a workbook

1. Add a **List Values** control to the workbook/page (any control backed by
   a `text-list` variable). This is the control the plugin will populate —
   it does not need a default value or a source.
2. Add the plugin element and open its editor panel:
   - **Zip code data** — the table/element with the zip codes to plot.
   - **Zip code column** — the column containing 5-digit zip codes (numbers
     or text; leading zeros and ZIP+4 suffixes are handled automatically).
   - **Color by column** (optional) — a categorical column (e.g. territory
     ID) to color-code the shapes and generate a legend, matching the
     reference screenshot.
   - **Selected zip codes control** — pick the List Values control from step 1.
3. Reference that control anywhere else in the workbook (filters, other
   elements, actions) the same way you would any other control.

## Using the lasso

- Click **Lasso select**, then click-drag a freehand loop over the shapes you
  want. Releasing the mouse selects every zip code whose shape the loop
  touches.
  - Hold **Shift** while drawing to add to the current selection.
  - Hold **Alt/Option** while drawing to remove from the current selection.
  - **Esc** cancels the loop in progress, or turns off lasso mode if nothing
    is being drawn.
- **Clear selection** empties the selection (and the linked control).
- The toolbar reports how many zip codes are plotted, how many (if any)
  didn't match a boundary, and how many are currently selected.

## Data

`data/zcta.json` is a full US ZIP Code Tabulation Area boundary set
(~41.6k zip codes, one `Polygon` per zip with a `zip`/`lat`/`lon` property)
bundled with the plugin so rendering never depends on a third-party vector
tile service. The basemap tiles (roads, labels) come from CARTO's free
Positron style via MapLibre GL JS and require no API key.
