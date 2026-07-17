// scripts/prune-unbacked.mjs
// Usage: node scripts/prune-unbacked.mjs <upstream-dir> [--keep id1,id2,...]
//
// Removes catalog entries that have no backing in the upstream
// (alexparlett/hobby-desk-data — pass a checkout or a flat dump of its JSON
// files) or in a pinned hand-curated source (scripts/vallejo-game-inks.source.json).
// Backing is a per-brand normalized-name match; discontinued upstream records
// still count as backing.
//
// Rationale: the original citadel/army_painter catalogs were model-generated
// (commit 6c06ffb) and contained names from other brands (Vallejo, Reaper) or
// from no brand at all. Owned paints should never be pruned blindly — pass
// their ids via --keep after reviewing them.
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeText } from '../src/normalize.mjs';

const CATALOG_DIR = fileURLToPath(new URL('../data/catalog', import.meta.url));
const INKS_SOURCE = fileURLToPath(new URL('./vallejo-game-inks.source.json', import.meta.url));

// upstream folder / file prefix -> our provider id
const BRAND_MAP = {
  'games-workshop': 'citadel',
  'army-painter': 'army_painter',
  vallejo: 'vallejo',
  'ak-interactive': 'ak_interactive',
};

function providerForUpstreamFile(filePath) {
  const segments = filePath.split(path.sep);
  const base = path.basename(filePath);
  for (const [prefix, provider] of Object.entries(BRAND_MAP)) {
    if (segments.includes(prefix) || base.startsWith(`${prefix}_`)) return provider;
  }
  return null;
}

async function collectJsonFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectJsonFiles(full)));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

export function partitionBacked(paints, backingNames, keepIds = new Set()) {
  const kept = [];
  const removed = [];
  for (const paint of paints) {
    if (backingNames.has(normalizeText(paint.name)) || keepIds.has(paint.id)) kept.push(paint);
    else removed.push(paint);
  }
  return { kept, removed };
}

async function main() {
  const upstreamDir = process.argv[2];
  if (!upstreamDir) {
    console.error('usage: node scripts/prune-unbacked.mjs <upstream-dir> [--keep id1,id2,...]');
    process.exit(1);
  }
  const keepFlag = process.argv.indexOf('--keep');
  const keepIds = new Set(keepFlag > -1 ? (process.argv[keepFlag + 1] || '').split(',').filter(Boolean) : []);

  const backing = Object.fromEntries(Object.values(BRAND_MAP).map((p) => [p, new Set()]));
  for (const file of await collectJsonFiles(upstreamDir)) {
    const provider = providerForUpstreamFile(file);
    if (!provider) continue;
    const records = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (record?.name) backing[provider].add(normalizeText(record.name));
    }
  }

  const inkSource = JSON.parse(await fs.readFile(INKS_SOURCE, 'utf8'));
  for (const record of inkSource.records) {
    backing.vallejo.add(normalizeText(record.name));
    for (const alias of record.aliases || []) backing.vallejo.add(normalizeText(alias));
  }

  for (const provider of Object.values(BRAND_MAP)) {
    const file = path.join(CATALOG_DIR, `${provider}.json`);
    const catalog = JSON.parse(await fs.readFile(file, 'utf8'));
    const { kept, removed } = partitionBacked(catalog.paints, backing[provider], keepIds);
    if (removed.length === 0) {
      console.error(`${provider}: all ${kept.length} paints backed, nothing to prune`);
      continue;
    }
    catalog.paints = kept;
    await fs.writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    console.error(`${provider}: pruned ${removed.length} unbacked paints (${kept.length} remain)`);
    for (const paint of removed) console.error(`  - ${paint.id}`);
  }
}

// realpath before comparing — see src/cli.mjs::isMainModule (bin-symlink gotcha).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
