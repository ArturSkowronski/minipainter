// scripts/generate-site-paints.mjs
// Usage: node scripts/generate-site-paints.mjs [out-file]
//
// Regenerates docs/assets/paints.js (the GitHub Pages paint-rack dataset) from
// the built-in catalog + the local inventory's owned flags. Compact schema per
// paint: i=id, n=name, p=provider, f=product_format, c=[r,g,b], o=owned(0|1).
// Providers keep the site's original order; paints sort by raw name within a
// provider. Run after any catalog change so the site never drifts from the data.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { resolveInventoryPath } from '../src/config.mjs';
import { createJsonInventoryRepository } from '../src/infrastructure/inventory/json-inventory-repository.mjs';

const DEFAULT_OUT = fileURLToPath(new URL('../docs/assets/paints.js', import.meta.url));
const PROVIDER_ORDER = ['citadel', 'army_painter', 'vallejo', 'ak_interactive'];

async function main() {
  const outFile = process.argv[2] || DEFAULT_OUT;
  const catalog = await loadBuiltInCatalog();
  const repository = createJsonInventoryRepository({ inventoryPath: resolveInventoryPath() });
  const inventory = await repository.load();
  const owned = new Set(inventory.owned || []);

  const paints = [...catalog.paints].sort((a, b) => {
    const provider = PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider);
    return provider !== 0 ? provider : a.name.localeCompare(b.name);
  });

  const rows = paints.map((p) => ({
    i: p.id,
    n: p.name,
    p: p.provider,
    f: p.product_format,
    c: [p.rgb.r, p.rgb.g, p.rgb.b],
    o: owned.has(p.id) ? 1 : 0,
  }));

  await fs.writeFile(outFile, `window.PAINTS=${JSON.stringify(rows)};\n`, 'utf8');
  console.error(`wrote ${rows.length} paints (${[...owned].length} owned ids in inventory) to ${outFile}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
