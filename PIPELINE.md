# Affordability Explorer - Data Pipeline

## Overview

Complete data processing pipeline for ONS Housing Affordability data, transforming a single CSV source (SAA Machine Readable.csv) into static JSON organized by property type, local authority, and MSOA.

## Status: ✅ COMPLETE

All 7,264 MSOAs across 318 Local Authorities in England and Wales have been processed with affordability ratios.

## Single Source of Truth

**`data/raw/SAA Machine Readable.csv`** - Comprehensive ONS data file containing:
- House prices (median and lower quartile) at MSOA and LA levels
- House prices for all 5 property types (all, detached, semi-detached, terraced, flats/maisonettes)
- LA-level median earnings
- Pre-calculated affordability ratios for all geographies and property types

This CSV replaces the previous multi-file Excel-based pipeline and serves as the definitive data source.

## Data Structure

### Generated Files (in `static/data/`)

```
static/data/
├── geography/                       (Shared across all property types)
│   └── regions.json                 (10 regions: 9 England + Wales)
├── all/
│   ├── la/                          (318 LA files with latest affordability data)
│   ├── geographic-summary.json      (10 regions + 2 countries, median + LQ)
│   └── msoas-map.json               (Lightweight for mapping: 7,264 MSOAs, ratios only)
├── detached/
│   ├── la/                          (318 LA files)
│   ├── geographic-summary.json      (10 regions + 2 countries, median + LQ)
│   └── msoas-map.json
├── semi-detached/
│   ├── la/
│   ├── geographic-summary.json      (10 regions + 2 countries, median + LQ)
│   └── msoas-map.json
├── terraced/
│   ├── la/
│   ├── geographic-summary.json      (10 regions + 2 countries, median + LQ)
│   └── msoas-map.json
└── flats/
    ├── la/
    ├── geographic-summary.json      (10 regions + 2 countries, median + LQ)
    └── msoas-map.json
```

### Total Data

- **Shared geography**: 1 file (regions.json with 10 regions)
- **1,590 LA files** (318 LAs × 5 property types)
- **5 geographic-summary.json files** (consolidated regions + national data per property type)
- **5 msoas-map.json files** (lightweight, ratios only)
- **1,601 JSON files total** in `static/data/`

## Processing Pipeline

### 1. Parse SAA Machine Readable.csv

**Script**: `scripts/process-saa-data.js`

Reads the CSV from `data/raw/SAA Machine Readable.csv` and:

- Parses all 7,264 MSOA rows
- Extracts house prices for all 5 property types (median + lower quartile)
- Extracts LA-level earnings for affordability calculation
- Groups MSOAs by Local Authority
- Pre-calculated affordability ratios from the CSV

**Output**: LA JSON files with:
- LA-level affordability data (median and LQ prices + ratios)
- All MSOAs in that LA with their affordability data
- Region and earnings information

Example LA file structure (`static/data/all/la/E06000001.json`):
```json
{
  "code": "E06000001",
  "name": "Hartlepool",
  "region_code": "E12000001",
  "region_name": "North East",
  "earnings": 32600,
  "affordability": {
    "median": { "price": 158822, "ratio": 4.87 },
    "lq": { "price": 100000, "ratio": 3.07 }
  },
  "msoas": [
    {
      "code": "E02002483",
      "name": "Clavering",
      "affordability": {
        "median": { "price": 165000, "ratio": 5.06 },
        "lq": { "price": 122750, "ratio": 3.77 }
      }
    }
  ]
}
```

### 2. Generate Map & Aggregation Files

**Script**: `scripts/generate-final-files.js`

Processes LA files to create:

- **msoas-latest.json** - All 7,264 MSOAs with full affordability data for map visualization
- **msoas-map.json** - Lightweight version with only ratio data (faster loading)
- **Shared geography files** - Creates single authorities.json and regions.json in geography/ folder

### 3. Generate Geographic Summary Data

**Script**: `scripts/generate-aggregated-data.js`

Extracts pre-calculated regional and national affordability data from CSV and consolidates into efficient single files:

- **geographic-summary.json** (1 file per property type) - Contains:
  - All 10 regions (E12000001-E12000009 + W92000004)
  - 2 countries (England, Wales)
  - Both median and LQ affordability ratios
  - Organized for efficient UI loading by property type

Structure: `/data/{propertyType}/geographic-summary.json`

This approach is efficient because:
- ✓ 1 HTTP request per property type (instead of 10-50)
- ✓ Aligned with UI controls (users select property type, then filter by price level)
- ✓ Single file in browser cache per property type
- ✓ Negligible payload (2 KB per file)

## Geographic Data

### Shared Geography Files

Located in `static/data/geography/` (shared across all property types):

**authorities.json** - 318 Local Authorities with region information

```json
{
  "authorities": [
    {
      "code": "E06000001",
      "name": "Hartlepool",
      "region_code": "E12000001",
      "region_name": "North East",
      "earnings": 32600,
      "msoa_count": 11
    }
  ]
}
```

**regions.json** - 10 regions with country hierarchy

```json
{
  "regions": [
    {
      "code": "E12000001",
      "name": "North East",
      "country_code": "E92000001",
      "country_name": "England"
    },
    {
      "code": "W92000004",
      "name": "Wales",
      "country_code": "W92000004",
      "country_name": "Wales"
    }
  ]
}
```

### Region Codes (ONS Standard)

- `E12000001-E12000009` - English regions
- `W92000004` - Wales

## CSV Column Mappings

The SAA Machine Readable.csv contains these key columns:

```
Local authority code
Local authority name
Region code
Region name
MSOA code
MSOA name
median_earnings_la

Property type prices (LA level):
- all_median_la_hp, all_lq_la_hp
- detached_median_la_hp, detached_lq_la_hp
- semi-detached_median_la_hp, semi-detached_lq_la_hp
- terraced_median_la_hp, terraced_lq_la_hp
- flats/maisonettes_median_la_hp, flats/maisonettes_lq_la_hp

Property type prices (MSOA level):
- all_median_msoa_hp, all_lq_msoa_hp
- detached_median_msoa_hp, detached_lq_msoa_hp
- semi-detached_median_msoa_hp, semi-detached_lq_msoa_hp
- terraced_median_msoa_hp, terraced_lq_msoa_hp
- flats/maisonettes_median_msoa_hp, flats/maisonettes_lq_msoa_hp

Affordability ratios (pre-calculated):
- all_median_la_ratio, all_lq_la_ratio
- detached_median_la_ratio, detached_lq_la_ratio
- semi-detached_median_la_ratio, semi-detached_lq_la_ratio
- terraced_median_la_ratio, terraced_lq_la_ratio
- flats/maisonettes_median_la_ratio, flats/maisonettes_lq_la_ratio
- all_median_msoa_ratio, all_lq_msoa_ratio
- detached_median_msoa_ratio, detached_lq_msoa_ratio
- semi-detached_median_msoa_ratio, semi-detached_lq_msoa_ratio
- terraced_median_msoa_ratio, terraced_lq_msoa_ratio
- flats/maisonettes_median_msoa_ratio, flats/maisonettes_lq_msoa_ratio
```

Missing values are marked as `[x]` in the CSV and converted to `null` in JSON.

## Affordability Ratios

### Geographic Levels

1. **MSOA level** - Individual affordability ratios (7,264 locations)
2. **LA level** - LA affordability data (318 locations)
3. **Regional** - Derived from LA data (10 regions)
4. **National** - England and Wales aggregates

### Price Levels

- **Median** - Average property price affordability (for established buyers)
- **Lower Quartile** - Entry-level affordability (for first-time buyers)

### Property Types

1. All properties
2. Detached
3. Semi-detached
4. Terraced
5. Flats and maisonettes

## Usage in UI

### Load Data

```javascript
// For selected property type (e.g., 'all')
const propType = "all";

// Load geography (shared across all property types)
const authorities = await fetch(`/static/data/geography/authorities.json`).then(
  (r) => r.json(),
);
const regions = await fetch(`/static/data/geography/regions.json`).then((r) =>
  r.json(),
);

// For map visualization
const msoasLatest = await fetch(
  `/static/data/${propType}/msoas-latest.json`,
).then((r) => r.json());

// For LA view
const laData = await fetch(`/static/data/${propType}/la/{laCode}.json`).then(
  (r) => r.json(),
);
```

### Filter & Display

- Use ButtonGroup to select property type (all/detached/semi-detached/terraced/flats)
- Use ButtonGroup to select price level (median/lower quartile)
- Load only the selected property type's data
- Display beeswarm of affordability ratios for all MSOAs in LA
- Show selected MSOA, LA average, and regional/national ratios
- Display the selected area's latest price and affordability ratio

## Generation Instructions

### Prerequisites

```bash
npm install  # Installs dependencies
```

### Generate All Data

```bash
npm run generate-data
```

This runs in sequence:
1. `scripts/process-saa-data.js` - Parse CSV and generate LA files with median and LQ affordability
2. `scripts/generate-final-files.js` - Generate msoas-latest.json and geography files
3. `scripts/generate-aggregated-data.js` - Generate consolidated geographic-summary.json files

Data is organized by property type to match UI controls for efficient loading.

### Regenerate After Raw Data Update

If `data/raw/SAA Machine Readable.csv` is updated:

```bash
npm run generate-data
npm run build:preview
```

## Data Quality Notes

### Earnings Data

- LA-level only (not MSOA-level)
- From `median_earnings_la` column in CSV
- Same earnings applied to all MSOAs in LA
- Used for affordability ratio verification (ratios are pre-calculated in CSV)

### Missing Data

- Marked as `[x]` in CSV, converted to `null` in JSON
- MSOAs with no price data for a property type are excluded
- Missing values are preserved (not filled with estimates)

### Affordability Ratios

All affordability ratios are pre-calculated in the CSV source:
- Ratio = House price ÷ LA median earnings
- Both median and lower-quartile ratios are provided

## Architecture Decisions

### Single CSV Source

- **Reason**: Eliminates complexity of managing multiple Excel files and synchronization
- **Benefit**: Faster processing, simpler maintenance, single point of truth
- **Trade-off**: CSV must be kept up-to-date by data provider

### CSV Parsing

- **Implementation**: Manual CSV parsing (no external dependencies required)
- **Reason**: Handles quoted fields and edge cases; `xlsx` library no longer needed
- **Benefit**: Lightweight, fast, no binary file format complexity

### Property-Type-Specific Directories

Each property type has its own directory tree instead of combining all in one:

- **Reason**: UI loads only selected property type (smaller payload)
- **Benefit**: Faster initial load, cleaner data structure
- **Trade-off**: 5× the disk space (but only generated, not all committed)

### LA-Level Files

Data organized at LA level (318 files) rather than MSOA level (7,264 files):

- **Reason**: All MSOAs in an LA typically viewed together
- **Benefit**: Fewer files to manage, better aggregation performance
- **Trade-off**: Must deserialize entire LA for single MSOA lookup

## Troubleshooting

### Data Files Not Found

```bash
# Check if data was generated
ls -la static/data/all/la/ | wc -l  # Should show 318 LA files

# If not, regenerate
npm run generate-data
```

### Incorrect Data Values

Verify the CSV file is present and correctly formatted:

```bash
# Check CSV exists
ls -la data/raw/SAA\ Machine\ Readable.csv

# View first few rows
head -10 data/raw/SAA\ Machine\ Readable.csv
```

### Missing Property Types

All 5 property types should have LA files:

```bash
for type in all detached semi-detached terraced flats; do
  count=$(ls static/data/$type/la/ 2>/dev/null | wc -l)
  echo "$type: $count LA files"
done
```

---

**Last Updated**: November 2026
**Data Source**: `data/raw/SAA Machine Readable.csv`
**Processing Scripts**: `scripts/process-saa-data.js`, `scripts/generate-final-files.js`
**Property Types**: 5 (all, detached, semi-detached, terraced, flats/maisonettes)
**MSOAs**: 7,264 (England: 6,791, Wales: 473)
**Local Authorities**: 318 (England: 296, Wales: 22)
