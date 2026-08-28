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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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
  
  // Find header row
  let headerRowIdx = -1;
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  
  for (let row = range.s.r; row <= Math.min(range.e.r, 10); row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (cell && cell.v === 'MSOA code') {
      headerRowIdx = row;
      break;
    }
  }
  
  if (headerRowIdx === -1) return {};
  
  // Extract quarters from header
  const quarters = [];
  for (let col = 4; col < range.e.c; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRowIdx, c: col })];
    if (cell && typeof cell.v === 'string' && cell.v.includes('ending')) {
      const match = cell.v.match(/Year ending (\w+) (\d{4})/);
      if (match) {
        const month = match[1];
        const year = match[2];
        const monthToQ = {
          'Jan': 'Q1', 'Feb': 'Q1', 'Mar': 'Q1',
          'Apr': 'Q2', 'May': 'Q2', 'Jun': 'Q2',
          'Jul': 'Q3', 'Aug': 'Q3', 'Sep': 'Q3',
          'Oct': 'Q4', 'Nov': 'Q4', 'Dec': 'Q4'
        };
        quarters.push({ col, quarter: `${year}-${monthToQ[month]}` });
      }
    }
  }
  
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
  const medianData = readSheet(path.join(DATA_DIR, 'medianpricepaidmsoa.xlsx'), sheetName);
  console.log(`  ${Object.keys(medianData).length} MSOAs`);
  
  console.log('Reading LQ prices...');
  const lqData = readSheet(path.join(DATA_DIR, 'lowerquartilepricepaidmsoa.xlsx'), sheetName);
  
  console.log('Reading sales...');
  const salesData = readSheet(path.join(DATA_DIR, 'salesmsoa.xlsx'), sheetName);
  
  // Organize by LA
  console.log('Organizing by LA...');
  const laMap = {};
  
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
        msoas: []
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
  for (const laCode in laMap) {
    const laData = laMap[laCode];
    fs.writeFileSync(
      path.join(laDir, `${laCode}.json`),
      JSON.stringify(laData, null, 2)
    );
  }
  
  // Write authorities index
  console.log('Writing authorities.json...');
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
  
  // Write regions
  console.log('Writing regions.json...');
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
  
  fs.writeFileSync(
    path.join(typeDir, 'regions.json'),
    JSON.stringify({ regions: REGIONS }, null, 2)
  );
  
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
