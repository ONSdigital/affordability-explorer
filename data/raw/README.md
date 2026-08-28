# Raw Data Files

This directory contains the raw source Excel files from the Office for National Statistics (ONS) Housing Affordability dataset.

## Files

### Price Data (MSOA Level)
- **medianpricepaidmsoa.xlsx** - Median house prices by MSOA (Middle layer Super Output Area), quarterly from 1995-Q4 to 2025-Q3
  - Sheet 1a: All property types
  - Sheets 1b-1e: Detached, semi-detached, terraced, flats & maisonettes

- **lowerquartilepricepaidmsoa.xlsx** - Lower quartile house prices by MSOA, quarterly from 1995-Q4 to 2025-Q3
  - Sheet 1a: All property types
  - Sheets 1b-1e: Detached, semi-detached, terraced, flats & maisonettes

### Sales Data (MSOA Level)
- **salesmsoa.xlsx** - Number of residential property sales by MSOA, quarterly from 1995-Q4 to 2025-Q3
  - Sheet 1a: All property types
  - Sheets 1b-1e: Detached, semi-detached, terraced, flats & maisonettes

### Affordability Ratio Data (LA and Regional Level)
- **aff2ratioofhousepricetoresidencebasedearnings.xlsx** - Earnings and affordability ratios
  - Tables 1a-1c: Country/Region level (Median)
  - Tables 2a-2c: Country/Region level (Lower Quartile)
  - Tables 3a-3c: County level (Median)
  - Tables 4a-4c: County level (Lower Quartile)
  - Tables 5a-5b: LA level (Median) - Used for extracting LA-level earnings
  - Tables 6a-6b: LA level (Lower Quartile) - Used for extracting LA-level earnings

### Price Data (Administrative Geographies / LA Level)
- **medianpricepaidforadministrativegeographies.xlsx** - Median house prices by LA, annual from 2002-2025
- **lowerquartilepricepaidforadministrativegeographies.xlsx** - Lower quartile house prices by LA, annual from 2002-2025
- **salesforadministrativegeographies.xlsx** - Sales by LA, annual from 2002-2025

## Data Processing Pipeline

The raw Excel files are processed by the following scripts (in `/scripts/`):

1. **process-affordability-data.js** - Parses raw Excel files and extracts MSOA-level price and sales data
   - Organizes data by Local Authority
   - Merges price and sales time series by quarter

2. **calculate-affordability.js** - Calculates affordability ratios
   - Reads LA-level earnings from the affordability ratio file
   - Computes house price to earnings ratios for each MSOA
   - Calculates LA-level averages across all MSOAs

3. **generate-msoas-latest.js** - Generates map data file
   - Extracts latest quarter affordability data for all 7,264 MSOAs
   - Creates single flat JSON file for map coloring

4. **generate-national.js** - Generates national aggregate files
   - Aggregates LA data to England and Wales level
   - Computes national affordability statistics

5. **enrich-regions.js** - Adds region information to LA files
   - Maps each LA to its ONS region
   - Updates all LA JSON files with region codes and names

## Generated Output Files

All generated files are saved to `/static/data/` and include:

- **authorities.json** - Index of all 318 Local Authorities with MSOA counts
- **regions.json** - List of 10 regions (9 England + Wales)
- **msoas-latest.json** - All 7,264 MSOAs with latest affordability ratios (9.4 MB) - Used for map
- **/la/{lacode}.json** - 318 files, one per LA containing:
  - LA-level affordability aggregates
  - All MSOAs within the LA with affordability ratios
  - Time series of prices and sales (quarterly, 120 quarters)
- **/national/england.json** - England-wide aggregates
- **/national/wales.json** - Wales-wide aggregates

## Data Structure

### MSOA Affordability Object
```json
{
  "code": "E1000001",
  "name": "MSOA Name",
  "la_code": "E06000001",
  "la_name": "Hartlepool",
  "region_code": "E12000001",
  "region_name": "North East",
  "affordability": {
    "all": {
      "median": {"price": 195000, "earnings": 30000, "ratio": 6.5},
      "lq": {"price": 115000, "earnings": 22000, "ratio": 5.23}
    },
    "detached": {...},
    "semi-detached": {...},
    "terraced": {...},
    "flats": {...}
  },
  "timeSeries": {
    "all": {
      "median": [
        {"quarter": "1995-Q4", "price": 50375, "sales": null},
        ...
        {"quarter": "2025-Q3", "price": 275000, "sales": 152}
      ],
      "lq": [...]
    }
  }
}
```

### Affordability Ratio
The affordability ratio is calculated as:
```
ratio = median_house_price / annual_earnings
```

- **Median**: Average affordability (typical buyer)
- **LQ (Lower Quartile)**: Entry-level affordability (first-time buyer)

The LA-level earnings are used for all MSOAs within that LA.

## Property Types

- **all** - All property types combined
- **detached** - Detached houses
- **semi-detached** - Semi-detached houses
- **terraced** - Terraced houses
- **flats** - Flats and maisonettes

## Time Series Coverage

- **MSOA-level price/sales data**: Quarterly from 1995-Q4 to 2025-Q3 (120 quarters)
- **LA-level earnings data**: Annual from 2002 to 2025

Missing data points (particularly for lower quartile and some property types in earlier periods) are represented as `null` in the time series.

## Quality Notes

- Some LA codes are missing from the earnings data (2 out of 318), resulting in no affordability ratios for those LAs
- Earlier quarters may have sparse data, particularly for lower quartile prices
- Some property types may not have data for all time periods
- '[x]' values in the source data are treated as missing

## Update Cadence

These raw files should be updated annually when ONS releases new Housing Affordability data (typically in Q1 for the previous year's Q3 data).

To regenerate all output files after updating raw data:
```bash
node scripts/process-affordability-data.js
node scripts/calculate-affordability.js
node scripts/enrich-regions.js
node scripts/generate-msoas-latest.js
node scripts/generate-national.js
```
