#!/usr/bin/env node

/**
 * Data Pipeline: Process smallareamap.xlsx as source of truth
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
  'all': { median: 'all_median', lq: 'all_lq' },
  'detached': { median: 'detached_median', lq: 'detached_lq' },
  'semi-detached': { median: 'semi-detached_median', lq: 'semi-detached_lq' },
  'terraced': { median: 'terraced_median', lq: 'terraced_lq' },
  'flats': { median: 'flats/maisonettes_median', lq: 'flats/maisonettes_lq' }
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read smallareamap.xlsx and organize by LA and property type
 */
function readSmallAreaMap() {
  console.log('Reading smallareamap.xlsx...');
  const startTime = Date.now();
  
  const workbook = XLSX.readFile(path.join(DATA_DIR, 'smallareamap.xlsx'));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  
  if (!sheet) {
    throw new Error('No sheets found in smallareamap.xlsx');
  }
  
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`  Read ${data.length} MSOAs (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  return data;
}

/**
 * Process a single property type
 */
function processPropertyType(propType, priceColumns, msoaData) {
  console.log(`\nProcessing: ${propType}`);
  
  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');
  
  ensureDir(laDir);
  
  // Organize by LA
  const laMap = {};
  
  for (const row of msoaData) {
    const laCode = row['Local authority code'];
    const laName = row['Local authority name'];
    const msoaCode = row['MSOA code'];
    const msoaName = row['MSOA name'];
    const regionCode = row['Country/Region code'];
    const regionName = row['Country/Region name'];
    
    if (!laCode || !msoaCode) continue;
    
    if (!laMap[laCode]) {
      laMap[laCode] = {
        code: laCode,
        name: laName,
        region_code: regionCode,
        region_name: regionName,
        msoas: []
      };
    }
    
    // Get prices for this property type
    const medianPrice = row[priceColumns.median];
    const lqPrice = row[priceColumns.lq];
    
    // Skip if both prices are missing (marked as [x])
    if (medianPrice === '[x]' && lqPrice === '[x]') {
      continue;
    }
    
    laMap[laCode].msoas.push({
      code: msoaCode,
      name: msoaName,
      affordability: {
        median: { 
          price: medianPrice === '[x]' ? null : (typeof medianPrice === 'number' ? Math.round(medianPrice) : null)
        },
        lq: { 
          price: lqPrice === '[x]' ? null : (typeof lqPrice === 'number' ? Math.round(lqPrice) : null)
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
      console.log(`    [${Math.round((written / Object.keys(laMap).length) * 100)}%] ${written}/${Object.keys(laMap).length}`);
    }
  }
  console.log(`    Wrote ${written} files (${Math.round((Date.now() - startTime) / 1000)}s)`);
  
  // Write authorities index
  console.log(`  Writing authorities.json...`);
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
  
  console.log(`✓ Complete: /static/data/${propType}/`);
}

async function processData() {
  console.log('Starting data processing pipeline (from smallareamap.xlsx)\n');
  console.log('='.repeat(60) + '\n');
  
  try {
    const msoaData = readSmallAreaMap();
    
    // Process each property type
    for (const [propType, priceColumns] of Object.entries(PROPERTY_TYPES)) {
      processPropertyType(propType, priceColumns, msoaData);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✓ Data processing complete!');
    console.log('='.repeat(60));
    console.log('\nGenerated directories:');
    for (const propType of Object.keys(PROPERTY_TYPES)) {
      console.log(`  /static/data/${propType}/`);
    }
    console.log('\nNext: Run calculate-affordability-by-type.js to add earnings and ratios');
  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

processData();
