import fs from 'node:fs/promises';

import { loadOverlay, enrichPaint } from './overrides.mjs';

const CATALOG_FILES = [
  new URL('../data/catalog/army_painter.json', import.meta.url),
  new URL('../data/catalog/citadel.json', import.meta.url),
];

export async function loadBuiltInCatalog() {
  const [overlay, ...entries] = await Promise.all([
    loadOverlay(),
    ...CATALOG_FILES.map(async (fileUrl) => JSON.parse(await fs.readFile(fileUrl, 'utf8'))),
  ]);

  return {
    providers: entries
      .map((entry) => entry.provider)
      .sort((left, right) => left.id.localeCompare(right.id)),
    paints: entries.flatMap((entry) => entry.paints).map((paint) => enrichPaint(paint, overlay)),
  };
}
