#!/usr/bin/env node

/**
 * Calculate affordability ratios for each property type
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');

const PROPERTY_TYPES = ['all', 'detached', 'semi-detached', 'terraced', 'flats'];

/**
 * Read LA-level earnings AND region mapping
 */
function readLAEarningsAndRegions() {
  console.log('Reading LA-level earnings and region mappings...');
  
  const workbook = XLSX.readFile(path.join(DATA_DIR, 'aff2ratioofhousepricetoresidencebasedearnings.xlsx'));
  
  const earnings = {};
  const regions = {};
  
  // Sheet 5b: Median earnings + Region mapping
  const ws5b = workbook.Sheets['5b'];
  const range5b = XLSX.utils.decode_range(ws5b['!ref']);
  
  for (let row = 2; row <= range5b.e.r; row++) {
    const regionCode = ws5b[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v;
    const regionName = ws5b[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v;
    const laCode = ws5b[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v;
    const laName = ws5b[XLSX.utils.encode_cell({ r: row, c: 3 })]?.v;
    
    // Get latest year (last numeric column around column 30)
    let latestEarnings = null;
    for (let col = range5b.e.c; col >= 4; col--) {
      const cell = ws5b[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && typeof cell.v === 'number') {
        latestEarnings = Math.round(cell.v);
        break;
      }
    }
    
    if (laCode && typeof laCode === 'string') {
      if (!earnings[laCode]) {
        earnings[laCode] = { name: laName, median: null, lq: null, region_code: regionCode, region_name: regionName };
      }
      earnings[laCode].median = latestEarnings;
      regions[laCode] = { code: regionCode, name: regionName };
    }
  }
  
  // Sheet 6b: LQ earnings
  const ws6b = workbook.Sheets['6b'];
  if (ws6b) {
    const range6b = XLSX.utils.decode_range(ws6b['!ref']);
    for (let row = 2; row <= range6b.e.r; row++) {
      const laCode = ws6b[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v;
      
      let latestEarnings = null;
      for (let col = range6b.e.c; col >= 4; col--) {
        const cell = ws6b[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && typeof cell.v === 'number') {
          latestEarnings = Math.round(cell.v);
          break;
        }
      }
      
      if (laCode && typeof laCode === 'string' && latestEarnings) {
        if (!earnings[laCode]) {
          earnings[laCode] = { name: null, median: null, lq: null };
        }
        earnings[laCode].lq = latestEarnings;
      }
    }
  }
  
  console.log(`  Loaded earnings for ${Object.keys(earnings).length} LAs\n`);
  return { earnings, regions };
}

/**
 * Get latest value from time series
 */
function getLatestValue(timeSeries, priceLevel) {
  const series = timeSeries[priceLevel];
  if (!series || series.length === 0) return null;
  return series[series.length - 1];
}

/**
 * Calculate affordability and enrich LA files for a property type
 */
function enrichPropertyType(propType, earnings, regions) {
  console.log(`Calculating affordability for: ${propType}`);
  
  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');
  
  if (!fs.existsSync(laDir)) {
    console.log(`  Warning: ${typeDir} not found, skipping`);
    return;
  }
  
  const laFiles = fs.readdirSync(laDir).filter(f => f.endsWith('.json'));
  let processed = 0;
  const startTime = Date.now();
  
  for (const filename of laFiles) {
    const laCode = filename.replace('.json', '');
    const filePath = path.join(laDir, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    const laEarnings = earnings[laCode];
    const laRegion = regions[laCode];
    if (!laEarnings) continue;
    
    // Add region information to LA
    laData.region_code = laRegion?.code || null;
    laData.region_name = laRegion?.name || null;
    
    // Calculate affordability for each MSOA
    const laStats = { median: { prices: [], earnings_vals: [] }, lq: { prices: [], earnings_vals: [] } };
    
    for (const msoa of laData.msoas) {
      // Get latest median price
      const medianLatest = getLatestValue(msoa.timeSeries, 'median');
      if (medianLatest && medianLatest.price && laEarnings.median) {
        const ratio = medianLatest.price / laEarnings.median;
        msoa.affordability.median = {
          price: medianLatest.price,
          earnings: laEarnings.median,
          ratio: Math.round(ratio * 100) / 100
        };
        laStats.median.prices.push(medianLatest.price);
        laStats.median.earnings_vals.push(laEarnings.median);
      }
      
      // Get latest LQ price
      const lqLatest = getLatestValue(msoa.timeSeries, 'lq');
      if (lqLatest && lqLatest.price && laEarnings.lq) {
        const ratio = lqLatest.price / laEarnings.lq;
        msoa.affordability.lq = {
          price: lqLatest.price,
          earnings: laEarnings.lq,
          ratio: Math.round(ratio * 100) / 100
        };
        laStats.lq.prices.push(lqLatest.price);
        laStats.lq.earnings_vals.push(laEarnings.lq);
      }
    }
    
    // Calculate LA-level averages
    laData.affordability = {
      median: {},
      lq: {}
    };
    
    if (laStats.median.prices.length > 0) {
      const avgPrice = Math.round(laStats.median.prices.reduce((a, b) => a + b) / laStats.median.prices.length);
      const avgEarnings = Math.round(laStats.median.earnings_vals.reduce((a, b) => a + b) / laStats.median.earnings_vals.length);
      laData.affordability.median = {
        price: avgPrice,
        earnings: avgEarnings,
        ratio: Math.round((avgPrice / avgEarnings) * 100) / 100
      };
    }
    
    if (laStats.lq.prices.length > 0) {
      const avgPrice = Math.round(laStats.lq.prices.reduce((a, b) => a + b) / laStats.lq.prices.length);
      const avgEarnings = Math.round(laStats.lq.earnings_vals.reduce((a, b) => a + b) / laStats.lq.earnings_vals.length);
      laData.affordability.lq = {
        price: avgPrice,
        earnings: avgEarnings,
        ratio: Math.round((avgPrice / avgEarnings) * 100) / 100
      };
    }
    
    fs.writeFileSync(filePath, JSON.stringify(laData, null, 2));
    processed++;
    
    // Progress indicator every 50 files
    if (processed % 50 === 0) {
      const elapsedMs = Date.now() - startTime;
      const avgTimePerFile = elapsedMs / processed;
      const remainingFiles = laFiles.length - processed;
      const estimatedMs = remainingFiles * avgTimePerFile;
      const estimatedSec = Math.round(estimatedMs / 1000);
      const pct = Math.round((processed / laFiles.length) * 100);
      console.log(`  [${pct}%] ${processed}/${laFiles.length} | ETA: ${estimatedSec}s`);
    }
  }
  
  console.log(`  ✓ Updated ${processed} LA files\n`);
}

async function main() {
  console.log('Calculating affordability ratios\n');
  console.log('='.repeat(60) + '\n');
  
  try {
    const { earnings, regions } = readLAEarningsAndRegions();
    
    // Process each property type
    for (const propType of PROPERTY_TYPES) {
      enrichPropertyType(propType, earnings, regions);
    }
    
    console.log('='.repeat(60));
    console.log('✓ Affordability calculation complete!\n');
    console.log('Next: Run generate-msoas-latest.js and generate-national.js');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
