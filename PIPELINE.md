# Affordability Explorer - Data Pipeline

## Overview
Complete data processing pipeline for ONS Housing Affordability data, transforming raw Excel files into static JSON organized by property type, local authority, and MSOA.

## Status: ✅ COMPLETE

All 7,264 MSOAs across 318 Local Authorities in England and Wales have been processed with affordability ratios and time series data.

## Data Structure

### Generated Files (in `static/data/`)
```
static/data/
├── all/
│   ├── la/                          (318 LA files)
│   ├── msoas-latest.json            (7,264 MSOAs with latest affordability)
│   ├── national/
│   │   ├── england.json
│   │   └── wales.json
│   ├── authorities.json
│   └── regions.json
├── detached/
│   ├── la/                          (318 LA files)
│   ├── msoas-latest.json
│   ├── national/...
│   └── ...
├── semi-detached/
├── terraced/
└── flats/
```

### Total Data
- **1,590 LA files** (318 LAs × 5 property types)
- **5 msoas-latest.json** (7,264 MSOAs each)
- **10 national files** (england.json + wales.json per property type)
- **834 MB total** (not committed to git; generate with scripts)

## Processing Pipeline

### 1. Data Parsing
**Script**: `scripts/process-by-property-type.js`

Reads 7 Excel files from `data/raw/`:
- `medianpricepaidmsoa.xlsx` - Median house prices by MSOA (sheets 1a-1e for property types)
- `lowerquartilepricepaidmsoa.xlsx` - Lower quartile prices by MSOA (sheets 1a-1e)
- `salesmsoa.xlsx` - Sales counts by quarter by MSOA (sheets 1a-1e)
- `aff2ratioofhousepricetoresidencebasedearnings.xlsx` - LA-level earnings (sheets 5b, 6b)

**Output**: LA files with time series data (median and LQ prices + sales counts) for each MSOA

### 2. Affordability Calculation
**Script**: `scripts/calculate-affordability-by-type.js`

Computes affordability ratios for each property type:
- **Median ratio** = Median house price ÷ Median earnings
- **LQ ratio** = Lower quartile price ÷ LQ earnings
- **LA average** = Mean of all MSOAs in LA
- LA-level earnings from Excel (1 year per LA)

**Output**: Enhanced LA files with affordability{median, lq} objects added to each MSOA

### 3. Map & National Files
**Script**: `scripts/generate-final-files.js`

- **msoas-latest.json** - Extract latest data for all MSOAs (for map layer)
- **england.json** - Aggregate affordability for all England LAs
- **wales.json** - Aggregate affordability for all Wales LAs

**Output**: Map-ready files with all 7,264 MSOAs + national comparisons

## Time Series Data

- **Duration**: 119 quarters (1995-Q4 to 2025-Q2)
- **Resolution**: Quarterly (Jan-Mar=Q1, Apr-Jun=Q2, Jul-Sep=Q3, Oct-Dec=Q4)
- **Metrics**: House price + sales count per quarter per MSOA
- **Availability**: Same for all property types except flats (starts 2005-Q2 due to data availability)

## Affordability Ratios

### Geographic Levels
1. **MSOA level** - Individual affordability ratios (7,264 locations)
2. **LA average** - Mean of all MSOAs in that LA (318 locations)
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
const propType = 'all';

// For map visualization
const msoasLatest = await fetch(`/static/data/${propType}/msoas-latest.json`).then(r => r.json());

// For LA view
const laData = await fetch(`/static/data/${propType}/la/{laCode}.json`).then(r => r.json());

// For national comparison
const national = await fetch(`/static/data/${propType}/national/england.json`).then(r => r.json());
```

### Filter & Display
- Use ButtonGroup to select property type (all/detached/semi-detached/terraced/flats)
- Use ButtonGroup to select price level (median/lower quartile)
- Load only the selected property type's data
- Display beeswarm of affordability ratios for all MSOAs in LA
- Show selected MSOA, LA average, regional, and national ratios
- Visualize price/sales history with time series chart

## Generation Instructions

### Prerequisites
```bash
npm install  # Installs xlsx dependency
```

### Generate All Data
```bash
node scripts/process-by-property-type.js
node scripts/calculate-affordability-by-type.js
node scripts/generate-final-files.js
```

**Total time**: ~5 minutes
**Output size**: 834 MB

### Regenerate After Raw Data Update
If `data/raw/` files are updated:
```bash
# Option 1: Fresh start
rm -rf static/data/*
# Then run scripts above

# Option 2: Just recalculate
node scripts/calculate-affordability-by-type.js
node scripts/generate-final-files.js
```

## Data Quality Notes

### Earnings Data
- LA-level only (not MSOA-level)
- Uses latest available year from Excel
- Same earnings applied to all MSOAs in LA
- Used for affordability ratio calculation

### Sales Data
- No median/lower quartile split
- Single sales count per MSOA per quarter
- Applied to both median and LQ price time series

### Time Series
- Earliest: 1995-Q4
- Latest: 2025-Q2
- Flats start later (2005-Q2)
- Monthly data converted to quarterly

### Missing Data
- Small LAs may have limited MSOA data
- Some property types may have fewer sales records historically
- Earnings data is annual (applied to all quarters for that year)

## Architecture Decisions

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

### Latest Data File (msoas-latest.json)
Separate file with all 7,264 MSOAs + latest affordability:
- **Reason**: Fast map layer initialization
- **Benefit**: No need to read 318 LA files to populate map
- **Trade-off**: Data duplication (~2% of total size)

## Next Steps for UI Integration

1. **Map Layer** - Use `msoas-latest.json` to display all MSOAs colored by affordability ratio
2. **PropertyType Filter** - ButtonGroup switches between directories (all/detached/etc)
3. **PriceLevel Filter** - ButtonGroup switches between ratio.median and ratio.lq
4. **LA Selection** - Load `la/{laCode}.json` to show all MSOAs + beeswarm
5. **MSOA Selection** - Extract specific MSOA from LA file, display with comparisons
6. **Time Series** - Plot `timeSeries[median|lq]` quarterly price history
7. **National Comparison** - Load `national/{england|wales}.json` for comparison ratios

## Troubleshooting

### Data Files Not Found
```bash
# Check if data was generated
ls -la static/data/all/la/ | wc -l  # Should show 318 LA files

# If not, regenerate
node scripts/process-by-property-type.js
node scripts/calculate-affordability-by-type.js
node scripts/generate-final-files.js
```

### Incorrect Affordability Ratios
```bash
# Verify earnings loaded correctly
jq '.affordability | keys' static/data/all/la/E06000001.json

# Check a specific MSOA
jq '.msoas[0].affordability' static/data/all/la/E06000001.json
```

### Missing Property Types
All 5 property types should have 318 LA files each:
```bash
for type in all detached semi-detached terraced flats; do
  count=$(ls static/data/$type/la/ | wc -l)
  echo "$type: $count LA files"
done
```

---

**Last Updated**: August 2026
**Data Version**: 2025-Q2 (latest available)
**Property Types**: 5 (all, detached, semi-detached, terraced, flats)
**MSOAs**: 7,264 (England: 6,791, Wales: 473)
**Local Authorities**: 318 (England: 296, Wales: 22)
