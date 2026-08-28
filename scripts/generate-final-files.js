#!/usr/bin/env node

/**
 * Generate msoas-latest.json and national files for each property type
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../static/data');

const PROPERTY_TYPES = ['all', 'detached', 'semi-detached', 'terraced', 'flats'];

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

function generateForPropertyType(propType) {
  console.log(`\nProcessing: ${propType}`);
  
  const typeDir = path.join(OUTPUT_DIR, propType);
  const laDir = path.join(typeDir, 'la');
  const nationalDir = path.join(typeDir, 'national');
  
  if (!fs.existsSync(laDir)) {
    console.log('  Skipped (directory not found)');
    return;
  }
  
  if (!fs.existsSync(nationalDir)) {
    fs.mkdirSync(nationalDir, { recursive: true });
  }
  
  // Generate msoas-latest.json
  const msoas = [];
  const laFiles = fs.readdirSync(laDir).filter(f => f.endsWith('.json'));
  
  for (const filename of laFiles) {
    const filePath = path.join(laDir, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    for (const msoa of laData.msoas) {
      msoas.push({
        code: msoa.code,
        name: msoa.name,
        la_code: laData.code,
        la_name: laData.name,
        region_code: laData.region_code,
        region_name: laData.region_name,
        affordability: msoa.affordability
      });
    }
  }
  
  msoas.sort((a, b) => {
    if (a.region_code !== b.region_code) return a.region_code.localeCompare(b.region_code);
    if (a.la_code !== b.la_code) return a.la_code.localeCompare(b.la_code);
    return a.code.localeCompare(b.code);
  });
  
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const generatedDate = `${now.getFullYear()}-Q${quarter}`;
  
  const msoasLatest = {
    generated_date: generatedDate,
    msoa_count: msoas.length,
    msoas
  };
  
  fs.writeFileSync(
    path.join(typeDir, 'msoas-latest.json'),
    JSON.stringify(msoasLatest, null, 2)
  );
  
  console.log(`  ✓ msoas-latest.json (${msoas.length} MSOAs)`);
  
  // Generate national files
  // England: E codes
  const englandLAs = laFiles
    .map(f => JSON.parse(fs.readFileSync(path.join(laDir, f), 'utf-8')))
    .filter(la => la.code.startsWith('E'));
  
  const englandAff = aggregateAffordability(englandLAs);
  fs.writeFileSync(
    path.join(nationalDir, 'england.json'),
    JSON.stringify({
      region: 'England',
      la_count: englandLAs.length,
      affordability: englandAff
    }, null, 2)
  );
  
  console.log(`  ✓ england.json (${englandLAs.length} LAs)`);
  
  // Wales: W codes
  const walesLAs = laFiles
    .map(f => JSON.parse(fs.readFileSync(path.join(laDir, f), 'utf-8')))
    .filter(la => la.code.startsWith('W'));
  
  const walesAff = aggregateAffordability(walesLAs);
  fs.writeFileSync(
    path.join(nationalDir, 'wales.json'),
    JSON.stringify({
      region: 'Wales',
      la_count: walesLAs.length,
      affordability: walesAff
    }, null, 2)
  );
  
  console.log(`  ✓ wales.json (${walesLAs.length} LAs)`);
}

function aggregateAffordability(laDataArray) {
  const agg = {
    median: { price: 0, earnings: 0, ratio: 0, count: 0 },
    lq: { price: 0, earnings: 0, ratio: 0, count: 0 }
  };
  
  for (const laData of laDataArray) {
    const aff = laData.affordability;
    
    if (aff.median && aff.median.price) {
      agg.median.price += aff.median.price;
      agg.median.earnings += aff.median.earnings;
      agg.median.count++;
    }
    
    if (aff.lq && aff.lq.price) {
      agg.lq.price += aff.lq.price;
      agg.lq.earnings += aff.lq.earnings;
      agg.lq.count++;
    }
  }
  
  // Calculate averages
  const result = {
    median: {},
    lq: {}
  };
  
  if (agg.median.count > 0) {
    result.median = {
      price: Math.round(agg.median.price / agg.median.count),
      earnings: Math.round(agg.median.earnings / agg.median.count),
      ratio: Math.round((agg.median.price / agg.median.earnings) * 100) / 100
    };
  }
  
  if (agg.lq.count > 0) {
    result.lq = {
      price: Math.round(agg.lq.price / agg.lq.count),
      earnings: Math.round(agg.lq.earnings / agg.lq.count),
      ratio: Math.round((agg.lq.price / agg.lq.earnings) * 100) / 100
    };
  }
  
  return result;
}

async function main() {
  console.log('Generating msoas-latest and national files\n');
  console.log('='.repeat(60));
  
  for (const propType of PROPERTY_TYPES) {
    generateForPropertyType(propType);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ Generation complete!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
