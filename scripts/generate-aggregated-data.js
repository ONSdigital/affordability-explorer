#!/usr/bin/env node

/**
 * Generate geographic aggregates (regions + national) for each property type
 * Creates single consolidated file per property type for efficient UI loading
 * Structure: /data/{propertyType}/geographic-summary.json
 * Contains: all 10 regions + 2 countries with median and LQ affordability
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');

// Property type mappings
const PROPERTY_TYPES = {
  'all': {
    median_la_ratio: 'all_median_la_ratio',
    lq_la_ratio: 'all_lq_la_ratio',
    median_region_ratio: 'all_median_regions_ratio',
    lq_region_ratio: 'all_lq_regions_ratio',
    median_country_ratio: 'all_median_country_ratio',
    lq_country_ratio: 'all_lq_country_ratio',
  },
  'detached': {
    median_la_ratio: 'detached_median_la_ratio',
    lq_la_ratio: 'detached_lq_la_ratio',
    median_region_ratio: 'detached_median_regions_ratio',
    lq_region_ratio: 'detached_lq_regions_ratio',
    median_country_ratio: 'detached_median_country_ratio',
    lq_country_ratio: 'detached_lq_country_ratio',
  },
  'semi-detached': {
    median_la_ratio: 'semi-detached_median_la_ratio',
    lq_la_ratio: 'semi-detached_lq_la_ratio',
    median_region_ratio: 'semi-detached_median_regions_ratio',
    lq_region_ratio: 'semi-detached_lq_regions_ratio',
    median_country_ratio: 'semi-detached_median_country_ratio',
    lq_country_ratio: 'semi-detached_lq_country_ratio',
  },
  'terraced': {
    median_la_ratio: 'terraced_median_la_ratio',
    lq_la_ratio: 'terraced_lq_la_ratio',
    median_region_ratio: 'terraced_median_regions_ratio',
    lq_region_ratio: 'terraced_lq_regions_ratio',
    median_country_ratio: 'terraced_median_country_ratio',
    lq_country_ratio: 'terraced_lq_country_ratio',
  },
  'flats': {
    median_la_ratio: 'flats/maisonettes_median_la_ratio',
    lq_la_ratio: 'flats/maisonettes_lq_la_ratio',
    median_region_ratio: 'flats/maisonettes_median_regions_ratio',
    lq_region_ratio: 'flats/maisonettes_lq_regions_ratio',
    median_country_ratio: 'flats/maisonettes_median_country_ratio',
    lq_country_ratio: 'flats/maisonettes_lq_country_ratio',
  }
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  fields.push(current.trim());
  return fields;
}

/**
 * Convert string value to number or null
 */
function parseValue(value) {
  if (!value || value === '[x]') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function generateGeographicSummaries() {
  console.log('Generating geographic summary files (regions + national per property type)\n');
  console.log('='.repeat(60));

  const csvPath = path.join(DATA_DIR, 'SAA Machine Readable.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV not found at ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');

  // Skip description rows and find header
  let headerLine = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Country Name')) {
      headerLine = i;
      break;
    }
  }

  if (headerLine === null) {
    console.error('Error: Could not find CSV header row');
    process.exit(1);
  }

  const headers = parseCSVLine(lines[headerLine]);
  const headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header.toLowerCase()] = index;
  });

  // Collect data by region and country
  const regionData = new Map();
  const countryData = {};

  // Process data rows
  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const regionCode = fields[headerMap['region code']] || '';
    const regionName = fields[headerMap['region name']] || '';
    const countryName = fields[headerMap['country name']] || '';
    const country = countryName.toLowerCase().includes('england') ? 'england' : 'wales';

    // Initialize region
    if (!regionData.has(regionCode)) {
      regionData.set(regionCode, {
        code: regionCode,
        name: regionName,
        country: country === 'england' ? 'England' : 'Wales',
        byType: {}
      });
    }

    // Initialize country
    if (!countryData[country]) {
      countryData[country] = {
        code: country === 'england' ? 'E92000001' : 'W92000004',
        name: country === 'england' ? 'England' : 'Wales',
        byType: {}
      };
    }

    // Collect ratios for each property type
    for (const [propType, columnNames] of Object.entries(PROPERTY_TYPES)) {
      if (!regionData.get(regionCode).byType[propType]) {
        regionData.get(regionCode).byType[propType] = {
          medianRatios: [],
          lqRatios: []
        };
      }

      if (!countryData[country].byType[propType]) {
        countryData[country].byType[propType] = {
          medianRatios: [],
          lqRatios: []
        };
      }

      const medianRegionRatioIdx = headerMap[columnNames.median_region_ratio.toLowerCase()];
      const lqRegionRatioIdx = headerMap[columnNames.lq_region_ratio.toLowerCase()];
      const medianCountryRatioIdx = headerMap[columnNames.median_country_ratio.toLowerCase()];
      const lqCountryRatioIdx = headerMap[columnNames.lq_country_ratio.toLowerCase()];

      // Region ratios
      const medianRegionRatio = parseValue(fields[medianRegionRatioIdx]);
      const lqRegionRatio = parseValue(fields[lqRegionRatioIdx]);
      
      if (medianRegionRatio !== null) {
        regionData.get(regionCode).byType[propType].medianRatios.push(medianRegionRatio);
      }
      if (lqRegionRatio !== null) {
        regionData.get(regionCode).byType[propType].lqRatios.push(lqRegionRatio);
      }

      // Country ratios
      const medianCountryRatio = parseValue(fields[medianCountryRatioIdx]);
      const lqCountryRatio = parseValue(fields[lqCountryRatioIdx]);
      
      if (medianCountryRatio !== null) {
        countryData[country].byType[propType].medianRatios.push(medianCountryRatio);
      }
      if (lqCountryRatio !== null) {
        countryData[country].byType[propType].lqRatios.push(lqCountryRatio);
      }
    }
  }

  // Generate period
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const period = `${now.getFullYear()}-Q${quarter}`;

  // Generate one file per property type containing all regions + national data
  for (const [propType] of Object.entries(PROPERTY_TYPES)) {
    console.log(`\nProcessing: ${propType}`);

    // Build geographic summary with regions and national
    const geographic = {
      period: period,
      regions: [],
      national: []
    };

    // Add regions (sorted by code)
    const sortedRegions = Array.from(regionData.values())
      .sort((a, b) => a.code.localeCompare(b.code));

    for (const region of sortedRegions) {
      const typeData = region.byType[propType];
      if (!typeData || typeData.medianRatios.length === 0) continue;

      geographic.regions.push({
        code: region.code,
        name: region.name,
        country: region.country,
        affordability: {
          median: typeData.medianRatios[0],
          lq: typeData.lqRatios[0]
        }
      });
    }

    // Add national (sorted: England first, then Wales)
    for (const country of ['england', 'wales']) {
      const data = countryData[country];
      const typeData = data.byType[propType];
      if (!typeData || typeData.medianRatios.length === 0) continue;

      geographic.national.push({
        code: data.code,
        name: data.name,
        affordability: {
          median: typeData.medianRatios[0],
          lq: typeData.lqRatios[0]
        }
      });
    }

    // Write single consolidated file
    const outputDir = path.join(OUTPUT_DIR, propType);
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, 'geographic-summary.json');
    fs.writeFileSync(outputPath, JSON.stringify(geographic, null, 2));

    console.log(`  ✓ geographic-summary.json`);
    console.log(`    Regions: ${geographic.regions.length}`);
    console.log(`    Countries: ${geographic.national.length}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✓ Geographic summary generation complete!');
  console.log('✓ One file per property type with all regions + national');
  console.log('✓ Organized for efficient UI loading by property type');
  console.log('='.repeat(60));
}

generateGeographicSummaries();

