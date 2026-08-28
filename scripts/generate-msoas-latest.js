#!/usr/bin/env node

/**
 * Generate msoas-latest.json for map coloring
 * Extracts latest affordability data for all MSOAs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../static/data');
const LA_OUTPUT_DIR = path.join(OUTPUT_DIR, 'la');

async function generateMsoasLatest() {
  console.log('Generating msoas-latest.json...\n');
  
  const msoas = [];
  const laFiles = fs.readdirSync(LA_OUTPUT_DIR).filter(f => f.endsWith('.json'));
  
  for (const filename of laFiles) {
    const filePath = path.join(LA_OUTPUT_DIR, filename);
    const laData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Extract MSOA data for map
    for (const msoa of laData.msoas || []) {
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
  
  // Sort by region, then LA, then MSOA code
  msoas.sort((a, b) => {
    if (a.region_code !== b.region_code) return a.region_code.localeCompare(b.region_code);
    if (a.la_code !== b.la_code) return a.la_code.localeCompare(b.la_code);
    return a.code.localeCompare(b.code);
  });
  
  // Get the current date for generated_date field
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const generatedDate = `${now.getFullYear()}-Q${quarter}`;
  
  const output = {
    generated_date: generatedDate,
    msoa_count: msoas.length,
    msoas
  };
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'msoas-latest.json'),
    JSON.stringify(output, null, 2)
  );
  
  console.log(`✓ Generated msoas-latest.json with ${msoas.length} MSOAs`);
  console.log(`  File size: ${Math.round(fs.statSync(path.join(OUTPUT_DIR, 'msoas-latest.json')).size / 1024)}KB\n`);
}

generateMsoasLatest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
