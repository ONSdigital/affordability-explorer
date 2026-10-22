#!/usr/bin/env node

/**
 * Data Pipeline: Process ONS raw Excel files
 * Generates separate LA file sets for each property type
 * 
 * Output structure:
 * /static/data/all/la/
 * /static/data/detached/la/
 * /static/data/semi-detached/la/
 * /static/data/terraced/la/
 * /static/data/flats/la/
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');

// Property type mappings
const PROPERTY_TYPES = {
  'a': 'all',
  'b': 'detached',
  'c': 'semi-detached',
  'd': 'terraced',
  'e': 'flats'
};

const MONTH_TO_QUARTER = {
  Jan: 'Q1',
  Feb: 'Q1',
  Mar: 'Q1',
  Apr: 'Q2',
  May: 'Q2',
  Jun: 'Q2',
  Jul: 'Q3',
  Aug: 'Q3',
  Sep: 'Q3',
  Oct: 'Q4',
  Nov: 'Q4',
  Dec: 'Q4'
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseQuarterHeader(value) {
  if (typeof value !== 'string' || !value.includes('ending')) {
    return null;
  }

  const match = value.match(/Year ending (\w+) (\d{4})/);
  if (!match) {
    return null;
  }

  const month = match[1];
  const year = match[2];
  const quarter = MONTH_TO_QUARTER[month];
  if (!quarter) {
    return null;
  }

  return `${year}-${quarter}`;
}

function findHeaderRow(sheet, range, markerColumn, markerValue) {
  for (let row = range.s.r; row <= Math.min(range.e.r, 15); row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: markerColumn })];
    if (cell?.v === markerValue) {
      return row;
    }
  }

  return -1;
}

function readLatestQuarterColumn(sheet, range, headerRowIdx) {
  for (let col = range.e.c; col >= 4; col--) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: col })];
    const quarter = parseQuarterHeader(cell?.v);
    if (quarter) {
      return { col, quarter };
    }
  }
  throw new Error('No quarterly period found in source sheet');
}

/**
 * Read a single sheet and extract MSOA data
 */
function readSheet(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { blankCells: false, sheets: sheetName });
  const sheet = workbook.Sheets[sheetName];
  
  if (!sheet) {
    throw new Error(`Missing sheet ${sheetName} in ${filePath}`);
  }
  
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const headerRowIdx = findHeaderRow(sheet, range, 2, 'MSOA code');

  if (headerRowIdx === -1) throw new Error(`Missing MSOA header in ${filePath} ${sheetName}`);

  const { col, quarter } = readLatestQuarterColumn(sheet, range, headerRowIdx);
  
  // Parse data rows
  const result = {};
  for (let row = headerRowIdx + 1; row <= range.e.r; row++) {
    const msoaCodeCell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (!msoaCodeCell || !msoaCodeCell.v) continue;
    
    const laCodeCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const laNameCell = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    const msoaNameCell = sheet[XLSX.utils.encode_cell({ r: row, c: 3 })];
    
    const msoaCode = msoaCodeCell.v;
    result[msoaCode] = {
      code: msoaCode,
      name: msoaNameCell?.v,
      laCode: laCodeCell?.v,
      laName: laNameCell?.v,
      price: null
    };
    
    const valueCell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
    if (valueCell && typeof valueCell.v === 'number') {
      result[msoaCode].price = Math.round(valueCell.v);
    }
  }
  
  return {
    areas: result,
    latestPeriod: quarter
  };
}

async function processPropertyType(propType, sheetLetter) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${propType} (sheet 1${sheetLetter})`);
  console.log(`${'='.repeat(60)}`);
  
  const sheetName = `1${sheetLetter}`;
  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');
  
  ensureDir(laDir);
  
  // Read the latest period of both price series
  console.log('Reading median prices...');
  let startTime = Date.now();
  const medianResult = readSheet(path.join(DATA_DIR, 'medianpricepaidmsoa.xlsx'), sheetName);
  const medianData = medianResult.areas;
  console.log(`  ${Object.keys(medianData).length} MSOAs (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  console.log('Reading LQ prices...');
  startTime = Date.now();
  const lqResult = readSheet(path.join(DATA_DIR, 'lowerquartilepricepaidmsoa.xlsx'), sheetName);
  const lqData = lqResult.areas;
  console.log(`  (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  // Organize by LA
  console.log('Organizing by LA...');
  startTime = Date.now();
  const laMap = {};
  const latestPeriod = medianResult.latestPeriod;
  if (lqResult.latestPeriod !== latestPeriod) {
    throw new Error(`Source files have inconsistent latest periods for ${propType}: ${latestPeriod}, ${lqResult.latestPeriod}`);
  }
  
  for (const msoaCode in medianData) {
    const msoa = medianData[msoaCode];
    const laCode = msoa.laCode;
    const laName = msoa.laName;
    if (!laMap[laCode]) {
      laMap[laCode] = {
        code: laCode,
        name: laName,
        region_code: null,
        region_name: null,
        latest_period: latestPeriod,
        msoas: []
      };
    }
    
    laMap[laCode].msoas.push({
      code: msoaCode,
      name: msoa.name,
      affordability: {
        median: { price: msoa.price },
        lq: { price: lqData[msoaCode]?.price ?? null }
      }
    });
  }
  
  // Write LA files
  console.log(`Writing ${Object.keys(laMap).length} LA files...`);
  startTime = Date.now();
  let written = 0;
  for (const laCode in laMap) {
    const laData = laMap[laCode];
    fs.writeFileSync(
      path.join(laDir, `${laCode}.json`),
      JSON.stringify(laData, null, 2)
    );
    written++;
    if (written % 100 === 0) {
      console.log(`  [${Math.round((written / 318) * 100)}%] ${written}/318`);
    }
  }
  console.log(`  (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  // Write authorities index
  console.log('Writing authorities.json...');
  startTime = Date.now();
  const authorities = Object.values(laMap).map(la => ({
    code: la.code,
    name: la.name,
    region_code: la.region_code,
    region_name: la.region_name,
    msoa_count: la.msoas.length
  }));
  
  fs.writeFileSync(
    path.join(typeDir, 'authorities.json'),
    JSON.stringify({ authorities }, null, 2)
  );
  
  // Note: regions.json is now generated once in geography/ folder by generate-final-files.js
  
  console.log(`✓ Complete: /static/data/${propType}/`);
}

async function processData() {
  console.log('Starting data processing pipeline (by property type)\n');
  
  // Process each property type sequentially
  for (const [sheetLetter, propType] of Object.entries(PROPERTY_TYPES)) {
    await processPropertyType(propType, sheetLetter);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ Data processing complete!');
  console.log('='.repeat(60));
  console.log('\nGenerated directories:');
  for (const propType of Object.values(PROPERTY_TYPES)) {
    console.log(`  /static/data/${propType}/`);
  }
  console.log('\nNext: Run calculate-affordability-by-type.js to add earnings and ratios');
}

processData().catch(error => {
  console.error('Error processing data:', error);
  process.exit(1);
});
