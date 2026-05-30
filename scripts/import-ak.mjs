// scripts/import-ak.mjs
// Usage: node scripts/import-ak.mjs <source-dir> [output-file]
// <source-dir> must contain the 5 hobby AK files from alexparlett/hobby-desk-data:
//   ak_3gen.json ak_quick_gen.json ak_the_inks.json ak_acrylic_wash.json ak_deep_shades.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformCatalog } from './ak-transform.mjs';

const SOURCE_FILES = [
  'ak_3gen.json',
  'ak_quick_gen.json',
  'ak_the_inks.json',
  'ak_acrylic_wash.json',
  'ak_deep_shades.json',
];

const DEFAULT_OUT = fileURLToPath(new URL('../data/catalog/ak_interactive.json', import.meta.url));

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('usage: node scripts/import-ak.mjs <source-dir> [output-file]');
    process.exit(1);
  }
  const outFile = process.argv[3] || DEFAULT_OUT;

  const records = [];
  for (const file of SOURCE_FILES) {
    const raw = await fs.readFile(path.join(sourceDir, file), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${file}: invalid JSON — ${err.message}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array`);
    records.push(...parsed);
  }

  const catalog = transformCatalog(records);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.error(`wrote ${catalog.paints.length} paints to ${outFile}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
