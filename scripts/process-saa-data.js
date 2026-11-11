#!/usr/bin/env node

/**
 * Data Pipeline: Process SAA Machine Readable.csv as single source of truth
 * Generates LA file sets for each property type with prices, earnings, and ratios
 * 
 * CSV is the definitive source for:
 * - House prices (median and lower quartile) at MSOA and LA levels
 * - House prices by property type (all, detached, semi-detached, terraced, flats)
 * - LA-level earnings
 * - Affordability ratios
 * 
 * Output structure:
 * /static/data/all/la/
 * /static/data/detached/la/
 * /static/data/semi-detached/la/
 * /static/data/terraced/la/
 * /static/data/flats/la/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');

// Property type mappings - maps to CSV column indices
const PROPERTY_TYPES = {
  'all': {
    median_la: 'all_median_la_hp',
    lq_la: 'all_lq_la_hp',
    median_msoa: 'all_median_msoa_hp',
    lq_msoa: 'all_lq_msoa_hp',
    median_la_ratio: 'all_median_la_ratio',
    lq_la_ratio: 'all_lq_la_ratio',
    median_msoa_ratio: 'all_median_msoa_ratio',
    lq_msoa_ratio: 'all_lq_msoa_ratio'
  },
  'detached': {
    median_la: 'detached_median_la_hp',
    lq_la: 'detached_lq_la_hp',
    median_msoa: 'detached_median_msoa_hp',
    lq_msoa: 'detached_lq_msoa_hp',
    median_la_ratio: 'detached_median_la_ratio',
    lq_la_ratio: 'detached_lq_la_ratio',
    median_msoa_ratio: 'detached_median_msoa_ratio',
    lq_msoa_ratio: 'detached_lq_msoa_ratio'
  },
  'semi-detached': {
    median_la: 'semi-detached_median_la_hp',
    lq_la: 'semi-detached_lq_la_hp',
    median_msoa: 'semi-detached_median_msoa_hp',
    lq_msoa: 'semi-detached_lq_msoa_hp',
    median_la_ratio: 'semi-detached_median_la_ratio',
    lq_la_ratio: 'semi-detached_lq_la_ratio',
    median_msoa_ratio: 'semi-detached_median_msoa_ratio',
    lq_msoa_ratio: 'semi-detached_lq_msoa_ratio'
  },
  'terraced': {
    median_la: 'terraced_median_la_hp',
    lq_la: 'terraced_lq_la_hp',
    median_msoa: 'terraced_median_msoa_hp',
    lq_msoa: 'terraced_lq_msoa_hp',
    median_la_ratio: 'terraced_median_la_ratio',
    lq_la_ratio: 'terraced_lq_la_ratio',
    median_msoa_ratio: 'terraced_median_msoa_ratio',
    lq_msoa_ratio: 'terraced_lq_msoa_ratio'
  },
  'flats': {
    median_la: 'flats/maisonettes_median_la_hp',
    lq_la: 'flats/maisonettes_lq_la_hp',
    median_msoa: 'flats/maisonettes_median_msoa_hp',
    lq_msoa: 'flats/maisonettes_lq_msoa_hp',
    median_la_ratio: 'flats/maisonettes_median_la_ratio',
    lq_la_ratio: 'flats/maisonettes_lq_la_ratio',
    median_msoa_ratio: 'flats/maisonettes_median_msoa_ratio',
    lq_msoa_ratio: 'flats/maisonettes_lq_msoa_ratio'
  }
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Simple CSV parser for quoted fields
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
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse price value from CSV (handles [x] for missing data)
 */
function parsePrice(value) {
  if (value === '[x]' || value === '' || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : null;
}

/**
 * Parse ratio value from CSV
 */
function parseRatio(value) {
  if (value === '[x]' || value === '' || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse earnings value from CSV
 */
function parseEarnings(value) {
  if (value === '[x]' || value === '' || value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : null;
}

/**
 * Read and process SAA Machine Readable.csv
 */
function readSAAData() {
  console.log('Reading SAA Machine Readable.csv...');
  const startTime = Date.now();

  const filePath = path.join(DATA_DIR, 'SAA Machine Readable.csv');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Skip first 5 lines (metadata)
  const headerLine = parseCSVLine(lines[4]);
  const data = [];

  // Create header index map
  const headerMap = {};
  for (let i = 0; i < headerLine.length; i++) {
    headerMap[headerLine[i]] = i;
  }

  // Parse data rows (starting from line 5)
  for (let i = 5; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    
    const fields = parseCSVLine(lines[i]);
    const row = {};
    
    for (const [key, index] of Object.entries(headerMap)) {
      row[key] = fields[index];
    }
    
    if (row['Local authority code'] && row['MSOA code']) {
      data.push(row);
    }
  }

  console.log(
    `  Read ${data.length} rows (${Math.round((Date.now() - startTime) / 1000)}s)`
  );

  return { data, headerMap };
}

/**
 * Process a single property type from the CSV data
 */
function processPropertyType(propType, columns, csvData) {
  console.log(`\nProcessing: ${propType}`);

  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');

  ensureDir(laDir);

  // Organize by LA
  const laMap = {};

  for (const row of csvData) {
    const laCode = row['Local authority code'];
    const laName = row['Local authority name'];
    const msoaCode = row['MSOA code'];
    const msoaName = row['MSOA name'];
    const regionCode = row['Region code'];
    const regionName = row['Region name'];
    const earnings = parseEarnings(row['median_earnings_la']);

    if (!laCode || !msoaCode) continue;

    if (!laMap[laCode]) {
      laMap[laCode] = {
        code: laCode,
        name: laName,
        region_code: regionCode,
        region_name: regionName,
        earnings: earnings,
        affordability: {
          median: {
            price: parsePrice(row[columns.median_la]),
            ratio: parseRatio(row[columns.median_la_ratio])
          },
          lq: {
            price: parsePrice(row[columns.lq_la]),
            ratio: parseRatio(row[columns.lq_la_ratio])
          }
        },
        msoas: []
      };
    }

    // Get prices for this property type
    const medianPrice = parsePrice(row[columns.median_msoa]);
    const lqPrice = parsePrice(row[columns.lq_msoa]);
    const medianRatio = parseRatio(row[columns.median_msoa_ratio]);
    const lqRatio = parseRatio(row[columns.lq_msoa_ratio]);

    // Skip if both prices are missing
    if (medianPrice === null && lqPrice === null) {
      continue;
    }

    laMap[laCode].msoas.push({
      code: msoaCode,
      name: msoaName,
      affordability: {
        median: {
          price: medianPrice,
          ratio: medianRatio
        },
        lq: {
          price: lqPrice,
          ratio: lqRatio
        }
      }
    });
  }

  // Write LA files
  console.log(`  Writing ${Object.keys(laMap).length} LA files...`);
  const startTime = Date.now();
  let written = 0;

  for (const laCode in laMap) {
    const laData = laMap[laCode];
    fs.writeFileSync(
      path.join(laDir, `${laCode}.json`),
      JSON.stringify(laData, null, 2)
    );
    written++;
    if (written % 100 === 0) {
      console.log(
        `    [${Math.round((written / Object.keys(laMap).length) * 100)}%] ${written}/${
          Object.keys(laMap).length
        }`
      );
    }
  }
  console.log(
    `    Wrote ${written} files (${Math.round((Date.now() - startTime) / 1000)}s)`
  );

  // Write authorities index
  console.log(`  Writing authorities.json...`);
  const authorities = Object.values(laMap).map((la) => ({
    code: la.code,
    name: la.name,
    region_code: la.region_code,
    region_name: la.region_name,
    earnings: la.earnings,
    msoa_count: la.msoas.length
  }));

  fs.writeFileSync(
    path.join(typeDir, 'authorities.json'),
    JSON.stringify({ authorities }, null, 2)
  );

  console.log(`✓ Complete: /static/data/${propType}/`);
}

async function processData() {
  console.log(
    'Starting data processing pipeline (from SAA Machine Readable.csv)\n'
  );
  console.log('='.repeat(60) + '\n');

  try {
    const { data: csvData } = readSAAData();

    // Process each property type
    for (const [propType, columns] of Object.entries(PROPERTY_TYPES)) {
      processPropertyType(propType, columns, csvData);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✓ Data processing complete!');
    console.log('='.repeat(60));
    console.log('\nGenerated directories:');
    for (const propType of Object.keys(PROPERTY_TYPES)) {
      console.log(`  /static/data/${propType}/`);
    }
    console.log(
      '\nSource: data/raw/SAA Machine Readable.csv (single source of truth)'
    );
  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

processData();
