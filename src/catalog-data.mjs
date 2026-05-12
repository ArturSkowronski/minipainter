import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadOverlay, enrichPaint } from './overrides.mjs';

const CATALOG_DIR = new URL('../data/catalog/', import.meta.url);

async function discoverCatalogFiles() {
  const entries = await fs.readdir(fileURLToPath(CATALOG_DIR));
  return entries
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => new URL(f, CATALOG_DIR));
}

export async function loadBuiltInCatalog() {
  const catalogFiles = await discoverCatalogFiles();
  const [overlay, ...entries] = await Promise.all([
    loadOverlay(),
    ...catalogFiles.map(async (fileUrl) => JSON.parse(await fs.readFile(fileUrl, 'utf8'))),
  ]);

  return {
    providers: entries
      .map((entry) => entry.provider)
      .sort((left, right) => left.id.localeCompare(right.id)),
    paints: entries.flatMap((entry) => entry.paints).map((paint) => enrichPaint(paint, overlay)),
  };
}
