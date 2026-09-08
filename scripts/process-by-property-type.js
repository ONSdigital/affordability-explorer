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

function readQuarterColumns(sheet, range, headerRowIdx) {
  const quarters = [];
  for (let col = 4; col <= range.e.c; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: col })];
    const quarter = parseQuarterHeader(cell?.v);
    if (quarter) {
      quarters.push({ col, quarter });
    }
  }
  return quarters;
}

/**
 * Read a single sheet and extract MSOA data
 */
function readSheet(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { blankCells: false });
  const sheet = workbook.Sheets[sheetName];
  
  if (!sheet) {
    return {};
  }
  
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const headerRowIdx = findHeaderRow(sheet, range, 2, 'MSOA code');

  if (headerRowIdx === -1) return {};

  const quarters = readQuarterColumns(sheet, range, headerRowIdx);
  
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
      data: []
    };
    
    for (const { col, quarter } of quarters) {
      const valueCell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (valueCell && typeof valueCell.v === 'number') {
        result[msoaCode].data.push({
          quarter,
          value: Math.round(valueCell.v)
        });
      }
    }
  }
  
  return result;
}

/**
 * Read a single administrative geography sheet (LA-level)
 */
function readAdministrativeSheet(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { blankCells: false });
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return {};
  }

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const headerRowIdx = findHeaderRow(sheet, range, 2, 'Local authority code');

  if (headerRowIdx === -1) {
    return {};
  }

  const quarters = readQuarterColumns(sheet, range, headerRowIdx);
  const result = {};

  for (let row = headerRowIdx + 1; row <= range.e.r; row++) {
    const laCodeCell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (!laCodeCell || !laCodeCell.v || typeof laCodeCell.v !== 'string') continue;

    const regionCodeCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const regionNameCell = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    const laNameCell = sheet[XLSX.utils.encode_cell({ r: row, c: 3 })];

    const laCode = laCodeCell.v;
    result[laCode] = {
      code: laCode,
      name: laNameCell?.v ?? null,
      regionCode: regionCodeCell?.v ?? null,
      regionName: regionNameCell?.v ?? null,
      data: []
    };

    for (const { col, quarter } of quarters) {
      const valueCell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (valueCell && typeof valueCell.v === 'number') {
        result[laCode].data.push({
          quarter,
          value: Math.round(valueCell.v)
        });
      }
    }
  }

  return result;
}

async function processPropertyType(propType, sheetLetter) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${propType} (sheet 1${sheetLetter})`);
  console.log(`${'='.repeat(60)}`);
  
  const sheetName = `1${sheetLetter}`;
  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');
  
  ensureDir(laDir);
  
  // Read all three files
  console.log('Reading median prices...');
  let startTime = Date.now();
  const medianData = readSheet(path.join(DATA_DIR, 'medianpricepaidmsoa.xlsx'), sheetName);
  console.log(`  ${Object.keys(medianData).length} MSOAs (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  console.log('Reading LQ prices...');
  startTime = Date.now();
  const lqData = readSheet(path.join(DATA_DIR, 'lowerquartilepricepaidmsoa.xlsx'), sheetName);
  console.log(`  (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  console.log('Reading sales...');
  startTime = Date.now();
  const salesData = readSheet(path.join(DATA_DIR, 'salesmsoa.xlsx'), sheetName);
  console.log(`  (${Math.round((Date.now() - startTime) / 1000)}s)`);

  // Read LA-level administrative geography time series
  const adminSheetName = `2${sheetLetter}`;

  console.log(`Reading LA median prices (table ${adminSheetName})...`);
  startTime = Date.now();
  const laMedianData = readAdministrativeSheet(
    path.join(DATA_DIR, 'medianpricepaidforadministrativegeographies.xlsx'),
    adminSheetName
  );
  console.log(`  ${Object.keys(laMedianData).length} LAs (${Math.round((Date.now() - startTime) / 1000)}s)`);

  console.log(`Reading LA LQ prices (table ${adminSheetName})...`);
  startTime = Date.now();
  const laLqData = readAdministrativeSheet(
    path.join(DATA_DIR, 'lowerquartilepricepaidforadministrativegeographies.xlsx'),
    adminSheetName
  );
  console.log(`  ${Object.keys(laLqData).length} LAs (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  // Organize by LA
  console.log('Organizing by LA...');
  startTime = Date.now();
  const laMap = {};
  
  for (const msoaCode in medianData) {
    const msoa = medianData[msoaCode];
    const laCode = msoa.laCode;
    const laName = msoa.laName;
    const laMedianSeries = laMedianData[laCode]?.data || [];
    const laLqSeries = laLqData[laCode]?.data || [];
    const regionCode = laMedianData[laCode]?.regionCode || null;
    const regionName = laMedianData[laCode]?.regionName || null;
    
    if (!laMap[laCode]) {
      laMap[laCode] = {
        code: laCode,
        name: laName,
        region_code: regionCode,
        region_name: regionName,
        msoas: [],
        timeSeries: {
          median: laMedianSeries.map(point => ({
            quarter: point.quarter,
            price: point.value,
            sales: null
          })),
          lq: laLqSeries.map(point => ({
            quarter: point.quarter,
            price: point.value,
            sales: null
          }))
        }
      };
    }
    
    const medianTS = medianData[msoaCode]?.data || [];
    const lqTS = lqData[msoaCode]?.data || [];
    const salesTS = salesData[msoaCode]?.data || [];
    
    // Merge time series with sales
    const medianWithSales = medianTS.map(p => {
      const s = salesTS.find(s => s.quarter === p.quarter);
      return { quarter: p.quarter, price: p.value, sales: s?.value || null };
    });
    
    const lqWithSales = lqTS.map(p => {
      const s = salesTS.find(s => s.quarter === p.quarter);
      return { quarter: p.quarter, price: p.value, sales: s?.value || null };
    });
    
    laMap[laCode].msoas.push({
      code: msoaCode,
      name: msoa.name,
      affordability: {
        median: { price: null, ratio: null },
        lq: { price: null, ratio: null }
      },
      timeSeries: {
        median: medianWithSales,
        lq: lqWithSales
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
    try {
      await processPropertyType(propType, sheetLetter);
    } catch (error) {
      console.error(`Error processing ${propType}:`, error);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ Data processing complete!');
  console.log('='.repeat(60));
  console.log('\nGenerated directories:');
  for (const propType of Object.values(PROPERTY_TYPES)) {
    console.log(`  /static/data/${propType}/`);
  }
  console.log('\nNext: Run calculate-affordability.js to add earnings and ratios');
}

processData();
