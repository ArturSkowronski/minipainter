// scripts/import-tone-pro.mjs
// Usage: node scripts/import-tone-pro.mjs [source-file] [citadel-catalog-file]
// [source-file] defaults to scripts/warhammer-tone-pro.source.json (hand-curated,
// see its provenance block — hobby-desk-data predates the range).
//
// Merges the Warhammer Tone Pro range into data/catalog/citadel.json.
// Idempotent: every id the source would produce is dropped first and re-derived,
// so re-running yields a stable result.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { tonePaintId, transformTonePro, TONES_PER_FAMILY } from './tone-pro-transform.mjs';

const DEFAULT_SOURCE = fileURLToPath(new URL('./warhammer-tone-pro.source.json', import.meta.url));
const DEFAULT_CATALOG = fileURLToPath(new URL('../data/catalog/citadel.json', import.meta.url));

async function main() {
  const sourceFile = process.argv[2] || DEFAULT_SOURCE;
  const catalogFile = process.argv[3] || DEFAULT_CATALOG;

  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  if (!Array.isArray(source.families)) throw new Error('source: expected { families: [...] }');

  const toneIds = new Set();
  for (const family of source.families) {
    for (let tone = 1; tone <= TONES_PER_FAMILY; tone += 1) toneIds.add(tonePaintId(family.name, tone));
  }

  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const base = catalog.paints.filter((p) => !toneIds.has(p.id));
  const tones = transformTonePro(source.families, new Set(base.map((p) => p.id)));
  catalog.paints = [...base, ...tones];

  await fs.writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.error(`merged ${tones.length} Tone Pro paints into ${catalogFile} (total ${catalog.paints.length})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
