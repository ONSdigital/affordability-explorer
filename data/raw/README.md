# Raw Data Files

These ONS Housing Affordability workbooks are the inputs to `npm run generate-data`.

- `medianpricepaidmsoa.xlsx` and `lowerquartilepricepaidmsoa.xlsx`: MSOA-level prices, sheets 1a-1e for all, detached, semi-detached, terraced and flats. Only the rightmost quarterly price column is used.
- `aff2ratioofhousepricetoresidencebasedearnings.xlsx`: latest available LA earnings (sheets 5b and 6b), regional and national earnings (sheets 1b and 2b), and LA-to-region mappings.
- `medianpricepaidforadministrativegeographies.xlsx` and `lowerquartilepricepaidforadministrativegeographies.xlsx`: latest regional and national prices (sheets 1a-1e).
- `salesmsoa.xlsx` and `salesforadministrativegeographies.xlsx`: retained as raw sources, but no longer used by the displayed snapshots.

The pipeline runs `process-by-property-type.js`, `calculate-affordability-by-type.js` and `generate-final-files.js` in that order. It writes latest-period MSOA and LA affordability, map-ready `msoas-latest.json`, region and national summaries, and shared geography under `static/data/`. Historical price and sales series are not exported.

Missing prices in the latest quarter remain missing rather than falling back to an older quarter. Regenerate the committed deployment data with:

```bash
npm run generate-data
npm run build:preview
```
