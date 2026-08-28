#!/usr/bin/env node

/**
 * Generate national aggregate files (england.json, wales.json)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const NATIONAL_DIR = path.join(OUTPUT_DIR, 'national');
const LA_OUTPUT_DIR = path.join(OUTPUT_DIR, 'la');

// Ensure national directory exists
if (!fs.existsSync(NATIONAL_DIR)) {
  fs.mkdirSync(NATIONAL_DIR, { recursive: true });
}

/**
 * Aggregate affordability data across all LAs
 * @param {Array} laDataArray - Array of LA data objects
 * @param {String} filterFunc - Function to filter LAs (returns true/false)
 */
function createAggregate(laDataArray, filterFunc) {
  const filtered = laDataArray.filter(filterFunc);
  
  const aggregate = {
    la_count: filtered.length,
    affordability: {}
  };
  
  // Initialize affordability structure
  if (filtered.length > 0) {
    const firstLA = filtered[0];
    for (const propType in firstLA.affordability || {}) {
      aggregate.affordability[propType] = {
        median: { price: 0, earnings: 0, count: 0 },
        lq: { price: 0, earnings: 0, count: 0 }
      };
    }
  }
  
  // Sum up values from all filtered LAs
  for (const laData of filtered) {
    for (const propType in laData.affordability || {}) {
      for (const priceLevel in laData.affordability[propType]) {
        const aff = laData.affordability[propType][priceLevel];
        if (aff && aff.price) {
          aggregate.affordability[propType][priceLevel].price += aff.price;
          aggregate.affordability[propType][priceLevel].earnings += aff.earnings;
          aggregate.affordability[propType][priceLevel].count++;
        }
      }
    }
  }
  
  // Calculate averages
  for (const propType in aggregate.affordability) {
    for (const priceLevel in aggregate.affordability[propType]) {
      const stats = aggregate.affordability[propType][priceLevel];
      if (stats.count > 0) {
        stats.price = Math.round(stats.price / stats.count);
        stats.earnings = Math.round(stats.earnings / stats.count);
        stats.ratio = Math.round((stats.price / stats.earnings) * 100) / 100;
        delete stats.count;
      }
    }
  }
  
  return aggregate;
}

async function generateNationalFiles() {
  console.log('Generating national aggregate files...\n');
  
  // Load all LA files
  const laFiles = fs.readdirSync(LA_OUTPUT_DIR).filter(f => f.endsWith('.json'));
  const allLAData = [];
  
  for (const filename of laFiles) {
    const filePath = path.join(LA_OUTPUT_DIR, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    allLAData.push(laData);
  }
  
  console.log(`Loaded ${allLAData.length} LA files\n`);
  
  // Generate England aggregate (codes starting with E)
  const englandData = createAggregate(allLAData, la => la.code.startsWith('E'));
  englandData.region = 'England';
  
  fs.writeFileSync(
    path.join(NATIONAL_DIR, 'england.json'),
    JSON.stringify(englandData, null, 2)
  );
  console.log(`✓ Generated england.json (${englandData.la_count} LAs)`);
  
  // Generate Wales aggregate (codes starting with W)
  const walesData = createAggregate(allLAData, la => la.code.startsWith('W'));
  walesData.region = 'Wales';
  
  fs.writeFileSync(
    path.join(NATIONAL_DIR, 'wales.json'),
    JSON.stringify(walesData, null, 2)
  );
  console.log(`✓ Generated wales.json (${walesData.la_count} LAs)`);
  
  console.log('\n');
}

generateNationalFiles().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
