#!/usr/bin/env node

/**
 * Optimized Data Pipeline: Process ONS raw Excel files with all property types
 * Memory-efficient: Processes one property type at a time
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const LA_OUTPUT_DIR = path.join(OUTPUT_DIR, 'la');

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
  console.log(`    Reading ${sheetName}...`);
  
  const workbook = XLSX.readFile(filePath, { blankCells: false });
  const sheet = workbook.Sheets[sheetName];
  
  if (!sheet) {
    console.warn(`    Warning: Sheet ${sheetName} not found`);
    return {};
  }
  
  // Find header row manually
  let headerRowIdx = -1;
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  
  for (let row = range.s.r; row <= Math.min(range.e.r, 10); row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (cell && cell.v === 'MSOA code') {
      headerRowIdx = row;
      break;
    }
  }
  
  if (headerRowIdx === -1) {
    console.warn(`    Warning: Could not find header in ${sheetName}`);
    return {};
  }
  
  // Extract header row to find quarter columns
  const headerRow = headerRowIdx;
  const quarters = [];
  
  for (let col = 4; col < range.e.c; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: col })];
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
        const q = monthToQ[month];
        quarters.push({ col, quarter: `${year}-${q}` });
      }
    }
  }
  
  // Parse data rows
  const result = {};
  for (let row = headerRowIdx + 1; row <= range.e.r; row++) {
    const laCodeCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const laNameCell = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    const msoaCodeCell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    const msoaNameCell = sheet[XLSX.utils.encode_cell({ r: row, c: 3 })];
    
    if (!msoaCodeCell || !msoaCodeCell.v) continue;
    
    const laCode = laCodeCell?.v;
    const laName = laNameCell?.v;
    const msoaCode = msoaCodeCell.v;
    const msoaName = msoaNameCell?.v;
    
    if (!result[msoaCode]) {
      result[msoaCode] = {
        code: msoaCode,
        name: msoaName,
        laCode,
        laName,
        data: []
      };
    }
    
    // Extract values
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

async function processData() {
  console.log('Starting optimized data processing pipeline...\n');
  
  ensureDir(OUTPUT_DIR);
  ensureDir(LA_OUTPUT_DIR);

  try {
    // Initialize LA map
    const laMap = {};

    // Process each property type
    for (const [sheetLetter, propType] of Object.entries(PROPERTY_TYPES)) {
      console.log(`\nProcessing property type: ${propType}`);
      
      const sheetName = `1${sheetLetter}`;
      
      // Read median prices
      console.log('  Median prices:');
      const medianData = readSheet(path.join(DATA_DIR, 'medianpricepaidmsoa.xlsx'), sheetName);
      
      // Read LQ prices
      console.log('  LQ prices:');
      const lqData = readSheet(path.join(DATA_DIR, 'lowerquartilepricepaidmsoa.xlsx'), sheetName);
      
      // Read sales
      console.log('  Sales:');
      const salesData = readSheet(path.join(DATA_DIR, 'salesmsoa.xlsx'), sheetName);
      
      // Merge into LA structure
      console.log('  Merging into LA structure...');
      
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
        
        // Find or create MSOA entry
        let msoaEntry = laMap[laCode].msoas.find(m => m.code === msoaCode);
        if (!msoaEntry) {
          msoaEntry = {
            code: msoaCode,
            name: msoa.name,
            affordability: {},
            timeSeries: {}
          };
          laMap[laCode].msoas.push(msoaEntry);
        }
        
        // Initialize structure
        if (!msoaEntry.affordability[propType]) {
          msoaEntry.affordability[propType] = {
            median: { price: null, ratio: null },
            lq: { price: null, ratio: null }
          };
        }
        
        if (!msoaEntry.timeSeries[propType]) {
          msoaEntry.timeSeries[propType] = {
            median: [],
            lq: []
          };
        }
        
        // Add median price time series with sales
        const medianTS = medianData[msoaCode]?.data || [];
        const salesTS = salesData[msoaCode]?.data || [];
        
        msoaEntry.timeSeries[propType].median = medianTS.map(p => {
          const s = salesTS.find(s => s.quarter === p.quarter);
          return {
            quarter: p.quarter,
            price: p.value,
            sales: s?.value || null
          };
        });
        
        // Add LQ price time series with sales
        const lqTS = lqData[msoaCode]?.data || [];
        msoaEntry.timeSeries[propType].lq = lqTS.map(p => {
          const s = salesTS.find(s => s.quarter === p.quarter);
          return {
            quarter: p.quarter,
            price: p.value,
            sales: s?.value || null
          };
        });
      }
      
      console.log(`  ✓ Processed ${Object.keys(medianData).length} MSOAs for ${propType}`);
    }
    
    // Write LA files
    console.log('\nWriting LA files...');
    let laCount = 0;
    for (const laCode in laMap) {
      const laData = laMap[laCode];
      const filePath = path.join(LA_OUTPUT_DIR, `${laCode}.json`);
      fs.writeFileSync(filePath, JSON.stringify(laData, null, 2));
      laCount++;
    }
    console.log(`✓ Written ${laCount} LA files\n`);
    
    // Write authorities
    console.log('Writing authorities index...');
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
    console.log('✓ Written authorities.json\n');
    
    // Write regions
    console.log('Writing regions...');
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
      path.join(OUTPUT_DIR, 'regions.json'),
      JSON.stringify({ regions: REGIONS }, null, 2)
    );
    console.log('✓ Written regions.json\n');
    
    console.log('✓ Data processing complete!');
    console.log(`  - ${laCount} LA files with all property types`);
    console.log(`  - authorities.json`);
    console.log(`  - regions.json`);
    console.log('\nNext: Run calculate-affordability.js to add earnings and ratios');

  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

processData();
