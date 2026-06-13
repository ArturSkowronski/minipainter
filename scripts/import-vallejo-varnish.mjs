// scripts/import-vallejo-varnish.mjs
// Usage: node scripts/import-vallejo-varnish.mjs <source-file> [vallejo-catalog-file]
// <source-file> is vallejo/vallejo_premium_color.json from
// alexparlett/hobby-desk-data (pinned commit 1bc4e09).
//
// Merges the Premium Color brush-on varnishes (records with type === "varnish") into
// data/catalog/vallejo.json. Idempotent: any previously-imported Vallejo varnish
// (the only Vallejo paints with the `technical` usage role) is dropped and re-derived,
// so re-running yields a stable result.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { transformVarnish } from './vallejo-varnish-transform.mjs';

const DEFAULT_CATALOG = fileURLToPath(new URL('../data/catalog/vallejo.json', import.meta.url));

function isVarnishPaint(paint) {
  return paint.provider === 'vallejo' && paint.usage_roles.includes('technical');
}

async function main() {
  const sourceFile = process.argv[2];
  if (!sourceFile) {
    console.error('usage: node scripts/import-vallejo-varnish.mjs <source-file> [vallejo-catalog-file]');
    process.exit(1);
  }
  const catalogFile = process.argv[3] || DEFAULT_CATALOG;

  const records = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  if (!Array.isArray(records)) throw new Error('source: expected a JSON array');
  const varnishes = records.filter((r) => r.type === 'varnish');
  if (varnishes.length === 0) throw new Error('source: no records with type "varnish" found');

  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const base = catalog.paints.filter((p) => !isVarnishPaint(p));
  const baseIds = new Set(base.map((p) => p.id));

  const imported = transformVarnish(varnishes, baseIds);
  catalog.paints = [...base, ...imported];

  await fs.writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.error(`merged ${imported.length} Vallejo varnishes into ${catalogFile} (total ${catalog.paints.length})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
