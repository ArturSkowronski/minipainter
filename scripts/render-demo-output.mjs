import fs from 'node:fs/promises';
import path from 'node:path';

import { renderTui, createTuiState, applyTuiAction } from '../src/tui.mjs';
import { renderResult } from '../src/output.mjs';
import { searchPaints, matchByColor } from '../src/search-engine.mjs';
import { markOwned } from '../src/inventory-service.mjs';

export function createDemoRegistry() {
  return {
    version: 1,
    catalog: {
      providers: [
        { id: 'citadel', name: 'Citadel' },
        { id: 'army_painter', name: 'Army Painter' },
      ],
      paints: [
        {
          id: 'citadel/abaddon-black',
          provider: 'citadel',
          name: 'Abaddon Black',
          normalized_name: 'abaddon black',
          aliases: ['black'],
          usage_roles: ['base'],
          color_families: ['black'],
          rgb: { r: 20, g: 20, b: 20 },
          owned: true,
        },
        {
          id: 'citadel/leadbelcher',
          provider: 'citadel',
          name: 'Leadbelcher',
          normalized_name: 'leadbelcher',
          aliases: ['silver metallic'],
          usage_roles: ['metallic'],
          color_families: ['steel', 'metallic', 'silver'],
          rgb: { r: 120, g: 124, b: 128 },
          owned: true,
        },
        {
          id: 'citadel/skeleton-horde',
          provider: 'citadel',
          name: 'Skeleton Horde',
          normalized_name: 'skeleton horde',
          aliases: [],
          usage_roles: ['contrast'],
          color_families: ['bone', 'brown'],
          rgb: { r: 170, g: 135, b: 88 },
          owned: false,
        },
        {
          id: 'army_painter/pallid-bone',
          provider: 'army_painter',
          name: 'Pallid Bone',
          normalized_name: 'pallid bone',
          aliases: ['bone'],
          usage_roles: ['layer'],
          color_families: ['bone'],
          rgb: { r: 209, g: 193, b: 157 },
          owned: true,
        },
        {
          id: 'army_painter/dark-tone',
          provider: 'army_painter',
          name: 'Dark Tone',
          normalized_name: 'dark tone',
          aliases: [],
          usage_roles: ['shade'],
          color_families: ['black', 'brown'],
          rgb: { r: 61, g: 50, b: 41 },
          owned: false,
        },
      ],
    },
  };
}

function renderCliDemo(registry) {
  const search = searchPaints(registry, 'bone').map((result) => ({
    id: result.paint.id,
    name: result.paint.name,
    owned: result.paint.owned,
  }));

  const ownResult = markOwned(registry, 'Skeleton Horde');
  const match = matchByColor(ownResult.registry, { r: 210, g: 194, b: 155 }).slice(0, 3).map((result) => ({
    id: result.paint.id,
    name: result.paint.name,
    owned: result.paint.owned,
  }));

  return [
    '$ node src/cli.mjs paint search bone',
    renderResult({ message: 'Found paint matches', items: search }).trimEnd(),
    '',
    '$ node src/cli.mjs inventory own "Skeleton Horde"',
    renderResult({
      message: 'Skeleton Horde ownership updated',
      item: {
        id: ownResult.paint.id,
        name: ownResult.paint.name,
        owned: ownResult.paint.owned,
      },
    }).trimEnd(),
    '',
    '$ node src/cli.mjs match color "#d2c29b"',
    renderResult({ message: 'Color matches', items: match }).trimEnd(),
  ].join('\n');
}

function escapeSvg(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderTerminalSvg(content) {
  const lines = content.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const charWidth = 9;
  const lineHeight = 20;
  const paddingX = 24;
  const paddingY = 28;
  const width = (longest * charWidth) + (paddingX * 2);
  const height = (lines.length * lineHeight) + (paddingY * 2) + 20;

  const text = lines.map((line, index) => {
    const y = paddingY + 16 + (index * lineHeight);
    return `<text x="${paddingX}" y="${y}">${escapeSvg(line)}</text>`;
  }).join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#120f0d"/>',
    `<rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="10" fill="#1a1512" stroke="#6a5842" stroke-width="2"/>`,
    `<circle cx="28" cy="28" r="5" fill="#8a3b2e"/>`,
    `<circle cx="46" cy="28" r="5" fill="#a17a39"/>`,
    `<circle cx="64" cy="28" r="5" fill="#4f6b45"/>`,
    `<text x="${paddingX}" y="56" fill="#d9ccb8" font-family="Menlo, Consolas, monospace" font-size="14">warpaint-cli :: forge ledger capture</text>`,
    `<g fill="#efe0c8" font-family="Menlo, Consolas, monospace" font-size="16" xml:space="preserve">${text}</g>`,
    '</svg>',
  ].join('');
}

export async function renderDemoAssets(outputDir) {
  const registry = createDemoRegistry();

  const heroState = createTuiState(registry);
  const searchState = applyTuiAction(heroState, { type: 'search', value: 'bone' });
  const ownedState = applyTuiAction(heroState, { type: 'set-view', view: 'owned' });

  const textAssets = {
    'hero.txt': renderTui(heroState),
    'search.txt': renderTui(searchState),
    'owned.txt': renderTui(ownedState),
    'cli.txt': renderCliDemo(registry),
  };

  const svgAssets = Object.fromEntries(
    Object.entries(textAssets).map(([file, content]) => [
      file.replace(/\.txt$/, '.svg'),
      renderTerminalSvg(content),
    ]),
  );

  const assets = {
    ...textAssets,
    ...svgAssets,
  };

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(
    Object.entries(assets).map(([file, content]) => fs.writeFile(path.join(outputDir, file), `${content}\n`)),
  );

  return Object.keys(assets);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputDir = process.argv[2] || path.resolve(process.cwd(), 'docs/assets');
  await renderDemoAssets(outputDir);
}
