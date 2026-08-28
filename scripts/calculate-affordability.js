#!/usr/bin/env node

/**
 * Step 2: Calculate affordability ratios and enrich LA files
 * Uses LA-level earnings from affordability ratio file to calculate:
 * ratio = house_price / annual_earnings
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const LA_OUTPUT_DIR = path.join(OUTPUT_DIR, 'la');

/**
 * Read LA-level earnings from affordability ratio file
 * Returns: { laCode: { median: latestEarnings, lq: latestEarnings } }
 */
function readLAEarnings() {
  console.log('Reading LA-level earnings data...');
  
  const workbook = XLSX.readFile(path.join(DATA_DIR, 'aff2ratioofhousepricetoresidencebasedearnings.xlsx'));
  
  const earnings = {};
  
  // Sheet 5b: Median earnings by LA
  const ws5b = workbook.Sheets['5b'];
  const data5b = XLSX.utils.sheet_to_json(ws5b, { header: 1 });
  
  // Header is at row 1: ['Region code', 'Region name', 'LA code', 'LA name', '2002', '2003', ...]
  const headerRow = 1;
  const header = data5b[headerRow];
  
  if (!header || header[2] !== 'Local authority code') {
    console.error('Could not find proper header in sheet 5b');
    return {};
  }
  
  // Columns: 0=Region code, 1=Region name, 2=LA code, 3=LA name, 4+=year data
  const laCodeCol = 2;
  const laNameCol = 3;
  
  // Find latest year column (last numeric column with data)
  let latestCol = header.length - 1;
  while (latestCol > laNameCol && !header[latestCol]) {
    latestCol--;
  }
  
  console.log(`  Sheet 5b: Found years from ${header[4]} to ${header[latestCol]}`);
  
  // Parse LA earnings
  for (let i = headerRow + 1; i < data5b.length; i++) {
    const row = data5b[i];
    const laCode = row[laCodeCol];
    const laName = row[laNameCol];
    const medianEarnings = row[latestCol];
    
    if (!laCode || typeof laCode !== 'string' || !medianEarnings || medianEarnings === '[x]') continue;
    
    if (!earnings[laCode]) {
      earnings[laCode] = { name: laName, median: null, lq: null };
    }
    earnings[laCode].median = Math.round(medianEarnings);
  }
  
  // Sheet 6b: Lower quartile earnings by LA
  const ws6b = workbook.Sheets['6b'];
  const data6b = XLSX.utils.sheet_to_json(ws6b, { header: 1 });
  
  if (data6b && data6b[1]) {
    const header6b = data6b[1];
    let latestCol = header6b.length - 1;
    while (latestCol > 3 && !header6b[latestCol]) {
      latestCol--;
    }
    
    for (let i = 2; i < data6b.length; i++) {
      const row = data6b[i];
      const laCode = row[2];
      const lqEarnings = row[latestCol];
      
      if (!laCode || typeof laCode !== 'string' || !lqEarnings || lqEarnings === '[x]') continue;
      
      if (!earnings[laCode]) {
        earnings[laCode] = { name: row[3], median: null, lq: null };
      }
      earnings[laCode].lq = Math.round(lqEarnings);
    }
  }
  
  console.log(`  Loaded earnings for ${Object.keys(earnings).length} LAs\n`);
  return earnings;
}

/**
 * Get latest quarter/year from a time series
 */
function getLatestValue(timeSeries) {
  if (!timeSeries || timeSeries.length === 0) return null;
  return timeSeries[timeSeries.length - 1];
}

/**
 * Calculate affordability ratio and enrich LA files
 */
function enrichLAFiles(earnings) {
  console.log('Enriching LA files with affordability ratios...\n');
  
  const laFiles = fs.readdirSync(LA_OUTPUT_DIR).filter(f => f.endsWith('.json'));
  let processed = 0;
  
  for (const filename of laFiles) {
    const laCode = filename.replace('.json', '');
    const filePath = path.join(LA_OUTPUT_DIR, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Get earnings for this LA
    const laEarnings = earnings[laCode];
    if (!laEarnings) {
      console.warn(`  Warning: No earnings data for LA ${laCode}`);
      continue;
    }
    
    // Enrich each MSOA with affordability ratios
    for (const msoa of laData.msoas) {
      // For each property type and price level
      for (const propType in msoa.affordability) {
        for (const priceLevel in msoa.affordability[propType]) {
          const timeSeries = msoa.timeSeries[propType]?.[priceLevel] || [];
          const latest = getLatestValue(timeSeries);
          
          if (latest && latest.price) {
            const earnings_val = priceLevel === 'median' ? laEarnings.median : laEarnings.lq;
            if (earnings_val) {
              const ratio = latest.price / earnings_val;
              msoa.affordability[propType][priceLevel] = {
                price: latest.price,
                earnings: earnings_val,
                ratio: Math.round(ratio * 100) / 100  // 2 decimal places
              };
            }
          }
        }
      }
    }
    
    // Calculate LA-level averages (mean of all MSOAs)
    const laAffordability = {};
    if (laData.msoas.length > 0) {
      const sampleMsoa = laData.msoas[0];
      for (const propType of Object.keys(sampleMsoa.affordability || {})) {
        laAffordability[propType] = { median: { price: 0, earnings: 0, count: 0 }, lq: { price: 0, earnings: 0, count: 0 } };
      }
    }
    
    for (const msoa of laData.msoas) {
      for (const propType in msoa.affordability) {
        for (const priceLevel in msoa.affordability[propType]) {
          const aff = msoa.affordability[propType][priceLevel];
          if (aff.price) {
            laAffordability[propType][priceLevel].price += aff.price;
            laAffordability[propType][priceLevel].earnings += aff.earnings;
            laAffordability[propType][priceLevel].count++;
          }
        }
      }
    }
    
    // Calculate averages
    for (const propType in laAffordability) {
      for (const priceLevel in laAffordability[propType]) {
        const stats = laAffordability[propType][priceLevel];
        if (stats.count > 0) {
          stats.price = Math.round(stats.price / stats.count);
          stats.earnings = Math.round(stats.earnings / stats.count);
          stats.ratio = Math.round((stats.price / stats.earnings) * 100) / 100;
          delete stats.count;
        }
      }
    }
    
    laData.affordability = laAffordability;
    
    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(laData, null, 2));
    processed++;
    
    if (processed % 50 === 0) {
      console.log(`  Processed ${processed}/${laFiles.length} LA files...`);
    }
  }
  
  console.log(`\n✓ Enriched ${processed} LA files with affordability ratios\n`);
}

async function main() {
  console.log('Step 2: Calculate affordability ratios\n');
  console.log('='.repeat(60));
  
  try {
    const earnings = readLAEarnings();
    enrichLAFiles(earnings);
    
    console.log('✓ Affordability calculation complete!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
