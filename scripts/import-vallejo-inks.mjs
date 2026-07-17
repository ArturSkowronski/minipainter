// scripts/import-vallejo-inks.mjs
// Usage: node scripts/import-vallejo-inks.mjs [source-file] [vallejo-catalog-file]
// [source-file] defaults to scripts/vallejo-game-inks.source.json (hand-curated,
// see its provenance block — hobby-desk-data carries no Game Ink line).
//
// Merges the Game Color Ink range into data/catalog/vallejo.json. Idempotent:
// any previously-imported ink (the only Vallejo paints with the `ink` usage
// role) is dropped and re-derived, so re-running yields a stable result.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { transformInks } from './vallejo-inks-transform.mjs';

const DEFAULT_SOURCE = fileURLToPath(new URL('./vallejo-game-inks.source.json', import.meta.url));
const DEFAULT_CATALOG = fileURLToPath(new URL('../data/catalog/vallejo.json', import.meta.url));

function isInkPaint(paint) {
  return paint.provider === 'vallejo' && paint.usage_roles.includes('ink');
}

async function main() {
  const sourceFile = process.argv[2] || DEFAULT_SOURCE;
  const catalogFile = process.argv[3] || DEFAULT_CATALOG;

  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const records = Array.isArray(source) ? source : source.records;
  if (!Array.isArray(records)) throw new Error('source: expected a JSON array or { records: [...] }');

  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const base = catalog.paints.filter((p) => !isInkPaint(p));
  const baseIds = new Set(base.map((p) => p.id));

  const inks = transformInks(records, baseIds);
  catalog.paints = [...base, ...inks];

  await fs.writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.error(`merged ${inks.length} Game Color Ink paints into ${catalogFile} (total ${catalog.paints.length})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
