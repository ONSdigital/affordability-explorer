#!/usr/bin/env node

/**
 * Data pipeline: Process ONS raw Excel files into static JSON for affordability explorer
 * 
 * Inputs: /data/raw/*.xlsx files (MSOA and LA level data)
 * Outputs: /static/data/*.json files organized by LA with all MSOAs
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const LA_OUTPUT_DIR = path.join(OUTPUT_DIR, 'la');

// Property types across files
const PROPERTY_TYPES = {
  '1': 'all',
  '2': 'detached',
  '3': 'semi-detached',
  '4': 'terraced',
  '5': 'flats'
};

const PRICE_LEVELS = {
  'a': 'median',
  'b': 'lq'  // lower quartile
};

// Region config from config.js
const REGIONS = [
  { cd: "E12000001", nm: "North East" },
  { cd: "E12000002", nm: "North West" },
  { cd: "E12000003", nm: "Yorkshire and The Humber" },
  { cd: "E12000004", nm: "East Midlands" },
  { cd: "E12000005", nm: "West Midlands" },
  { cd: "E12000006", nm: "East of England" },
  { cd: "E12000007", nm: "London" },
  { cd: "E12000008", nm: "South East" },
  { cd: "E12000009", nm: "South West" },
  { cd: "W92000004", nm: "Wales" }
];

// Create output directories
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read a sheet from Excel file and extract time series data
 * Header row format: "Year ending <month> <year>"
 * Data rows: LA code, LA name, MSOA code, MSOA name, then price values per quarter
 */
function readMsoaSheet(filePath, sheetName) {
  console.log(`  Reading ${sheetName}...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Skip title and source rows, find actual header
  let headerIdx = -1;
  let header = null;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    if (data[i][2] === 'MSOA code') {
      headerIdx = i;
      header = data[i];
      break;
    }
  }

  if (!header) {
    console.warn(`  Warning: Could not find header in ${sheetName}`);
    return null;
  }

  // Extract time period headers (from column 4 onwards)
  const quarters = [];
  for (let i = 4; i < header.length; i++) {
    const col = header[i];
    if (col && typeof col === 'string' && col.includes('ending')) {
      // Parse "Year ending Dec 2020" -> "2020-Q4"
      const match = col.match(/Year ending (\w+) (\d{4})/);
      if (match) {
        const month = match[1];
        const year = match[2];
        const monthToQ = {
          'Jan': 'Q1', 'Feb': 'Q1', 'Mar': 'Q1',
          'Apr': 'Q2', 'May': 'Q2', 'Jun': 'Q2',
          'Jul': 'Q3', 'Aug': 'Q3', 'Sep': 'Q3',
          'Oct': 'Q4', 'Nov': 'Q4', 'Dec': 'Q4'
        };
        const q = monthToQ[month];
        quarters.push({ index: i, quarter: `${year}-${q}`, label: col });
      }
    }
  }

  console.log(`    Found ${quarters.length} quarters from ${quarters[0]?.quarter} to ${quarters[quarters.length - 1]?.quarter}`);

  // Parse data rows
  const msoaData = {};
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row[2] || typeof row[2] !== 'string') continue;

    const laCode = row[0];
    const laName = row[1];
    const msoaCode = row[2];
    const msoaName = row[3];

    if (!msoaData[msoaCode]) {
      msoaData[msoaCode] = {
        code: msoaCode,
        name: msoaName,
        laCode,
        laName,
        timeSeries: []
      };
    }

    // Extract prices for this MSOA
    for (const { index, quarter } of quarters) {
      const price = row[index];
      if (typeof price === 'number') {
        msoaData[msoaCode].timeSeries.push({
          quarter,
          price: Math.round(price)
        });
      }
    }
  }

  return msoaData;
}

/**
 * Read sales data (number of property sales)
 */
function readSalesSheet(filePath, sheetName) {
  console.log(`  Reading ${sheetName}...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Find header row
  let headerIdx = -1;
  let header = null;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    if (data[i][2] === 'MSOA code') {
      headerIdx = i;
      header = data[i];
      break;
    }
  }

  if (!header) {
    console.warn(`  Warning: Could not find header in ${sheetName}`);
    return null;
  }

  // Extract time periods
  const quarters = [];
  for (let i = 4; i < header.length; i++) {
    const col = header[i];
    if (col && typeof col === 'string' && col.includes('ending')) {
      const match = col.match(/Year ending (\w+) (\d{4})/);
      if (match) {
        const month = match[1];
        const year = match[2];
        const monthToQ = {
          'Jan': 'Q1', 'Feb': 'Q1', 'Mar': 'Q1',
          'Apr': 'Q2', 'May': 'Q2', 'Jun': 'Q2',
          'Jul': 'Q3', 'Aug': 'Q3', 'Sep': 'Q3',
          'Oct': 'Q4', 'Nov': 'Q4', 'Dec': 'Q4'
        };
        const q = monthToQ[month];
        quarters.push({ index: i, quarter: `${year}-${q}` });
      }
    }
  }

  // Parse sales data
  const salesData = {};
  for (let i = headerIdx + 1; i < data.length; i++) {
    const row = data[i];
    if (!row[2] || typeof row[2] !== 'string') continue;

    const msoaCode = row[2];
    if (!salesData[msoaCode]) {
      salesData[msoaCode] = [];
    }

    for (const { index, quarter } of quarters) {
      const sales = row[index];
      if (typeof sales === 'number') {
        salesData[msoaCode].push({ quarter, sales: Math.round(sales) });
      }
    }
  }

  return salesData;
}

/**
 * Merge prices and sales into single time series
 */
function mergeTimeSeries(priceData, salesData) {
  const merged = {};

  for (const msoaCode in priceData) {
    const prices = priceData[msoaCode].timeSeries;
    const sales = salesData[msoaCode] || [];

    merged[msoaCode] = {
      ...priceData[msoaCode],
      timeSeries: prices.map(p => {
        const s = sales.find(s => s.quarter === p.quarter);
        return { ...p, sales: s?.sales || null };
      })
    };
  }

  return merged;
}

/**
 * Main processing function
 */
async function processData() {
  console.log('Starting data processing pipeline...\n');
  
  ensureDir(OUTPUT_DIR);
  ensureDir(LA_OUTPUT_DIR);

  try {
    // Step 1: Read all MSOA price and sales data
    console.log('Step 1: Reading MSOA price data...');
    const msoaPriceMedian = readMsoaSheet(path.join(DATA_DIR, 'medianpricepaidmsoa.xlsx'), '1a');
    const msoaPriceLQ = readMsoaSheet(path.join(DATA_DIR, 'lowerquartilepricepaidmsoa.xlsx'), '1a');

    console.log('\nStep 2: Reading MSOA sales data...');
    const msoaSalesAll = readSalesSheet(path.join(DATA_DIR, 'salesmsoa.xlsx'), '1a');

    // Step 3: Merge price and sales data
    console.log('\nStep 3: Merging price and sales data...');
    const msoaDataMedian = mergeTimeSeries(msoaPriceMedian, msoaSalesAll);
    const msoaDataLQ = mergeTimeSeries(msoaPriceLQ, msoaSalesAll);

    console.log(`\nProcessed ${Object.keys(msoaDataMedian).length} MSOAs\n`);

    // Step 4: Organize by LA
    console.log('Step 4: Organizing by Local Authority...');
    const laMap = {};

    for (const msoaCode in msoaDataMedian) {
      const msoa = msoaDataMedian[msoaCode];
      const laCode = msoa.laCode;
      const laName = msoa.laName;

      if (!laMap[laCode]) {
        laMap[laCode] = {
          code: laCode,
          name: laName,
          region_code: null,
          region_name: null,
          msoas: []
        };
      }

      laMap[laCode].msoas.push({
        code: msoaCode,
        name: msoa.name,
        affordability: {
          all: {
            median: { price: null, ratio: null },
            lq: { price: null, ratio: null }
          },
          detached: { median: { price: null, ratio: null }, lq: { price: null, ratio: null } },
          'semi-detached': { median: { price: null, ratio: null }, lq: { price: null, ratio: null } },
          terraced: { median: { price: null, ratio: null }, lq: { price: null, ratio: null } },
          flats: { median: { price: null, ratio: null }, lq: { price: null, ratio: null } }
        },
        timeSeries: {
          all: {
            median: msoaDataMedian[msoaCode]?.timeSeries || [],
            lq: msoaDataLQ[msoaCode]?.timeSeries || []
          },
          detached: { median: [], lq: [] },
          'semi-detached': { median: [], lq: [] },
          terraced: { median: [], lq: [] },
          flats: { median: [], lq: [] }
        }
      });
    }

    // Step 5: Write LA files
    console.log('Step 5: Writing LA JSON files...');
    let laCount = 0;
    for (const laCode in laMap) {
      const laData = laMap[laCode];
      const filePath = path.join(LA_OUTPUT_DIR, `${laCode}.json`);
      fs.writeFileSync(filePath, JSON.stringify(laData, null, 2));
      laCount++;
    }

    console.log(`  Written ${laCount} LA files\n`);

    // Step 6: Write authorities index
    console.log('Step 6: Writing authorities index...');
    const authorities = Object.values(laMap).map(la => ({
      code: la.code,
      name: la.name,
      region_code: la.region_code,
      region_name: la.region_name,
      msoa_count: la.msoas.length
    }));

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'authorities.json'),
      JSON.stringify({ authorities }, null, 2)
    );

    console.log('  Written authorities.json\n');

    // Step 7: Write regions
    console.log('Step 7: Writing regions index...');
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'regions.json'),
      JSON.stringify({ regions: REGIONS }, null, 2)
    );
    console.log('  Written regions.json\n');

    console.log('✓ Data processing complete!');
    console.log(`  - ${laCount} LA files`);
    console.log(`  - authorities.json`);
    console.log(`  - regions.json`);

  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

processData();
