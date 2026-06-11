// scripts/import-vallejo-tmm.mjs
// Usage: node scripts/import-vallejo-tmm.mjs <source-file> [vallejo-catalog-file]
// <source-file> is vallejo/vallejo_true_metallic_metal.json from
// alexparlett/hobby-desk-data (pinned commit 1bc4e09).
//
// Merges the True Metallic Metal range into data/catalog/vallejo.json. Idempotent:
// any previously-imported TMM paints (the only Vallejo paints with the `metallic`
// usage role) are dropped and re-derived, so re-running yields a stable result.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { transformTmm } from './vallejo-tmm-transform.mjs';

const DEFAULT_CATALOG = fileURLToPath(new URL('../data/catalog/vallejo.json', import.meta.url));

function isTmmPaint(paint) {
  return paint.provider === 'vallejo' && paint.usage_roles.includes('metallic');
}

async function main() {
  const sourceFile = process.argv[2];
  if (!sourceFile) {
    console.error('usage: node scripts/import-vallejo-tmm.mjs <source-file> [vallejo-catalog-file]');
    process.exit(1);
  }
  const catalogFile = process.argv[3] || DEFAULT_CATALOG;

  const records = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  if (!Array.isArray(records)) throw new Error('source: expected a JSON array');

  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const base = catalog.paints.filter((p) => !isTmmPaint(p));
  const baseIds = new Set(base.map((p) => p.id));

  const tmm = transformTmm(records, baseIds);
  catalog.paints = [...base, ...tmm];

  await fs.writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.error(`merged ${tmm.length} True Metallic Metal paints into ${catalogFile} (total ${catalog.paints.length})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
