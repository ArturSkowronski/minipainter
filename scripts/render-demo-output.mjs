import fs from 'node:fs/promises';
import path from 'node:path';

import { renderTui, createTuiState, applyTuiAction } from '../src/tui.mjs';
import { stripAnsi } from '../src/tui-theme.mjs';
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

const TERM_BG = '#17161b';
const PANEL_BG = '#100f13';
const DEFAULT_FG = '#ece5d2';

// Split one line of ANSI-coded text into styled runs.
function parseAnsiLine(line) {
  const runs = [];
  let fg = null;
  let bg = null;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let match;
  const push = (text) => { if (text) runs.push({ text, fg, bg, bold }); };

  while ((match = re.exec(line)) !== null) {
    push(line.slice(last, match.index));
    const code = match[1];
    let rgb;
    if (code === '0' || code === '') {
      fg = null; bg = null; bold = false;
    } else if (code === '1') {
      bold = true;
    } else if ((rgb = /^38;2;(\d+);(\d+);(\d+)$/.exec(code))) {
      fg = `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`;
    } else if ((rgb = /^48;2;(\d+);(\d+);(\d+)$/.exec(code))) {
      bg = `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`;
    }
    last = re.lastIndex;
  }
  push(line.slice(last));
  return runs;
}

function renderTerminalSvg(content, title = 'minipainter tui') {
  const lines = content.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, stripAnsi(line).length), 0);
  const charWidth = 9.6;
  const lineHeight = 20;
  const paddingX = 24;
  const top = 64; // space for the window chrome
  const paddingY = 20;
  const width = Math.ceil((longest * charWidth) + (paddingX * 2));
  const height = (lines.length * lineHeight) + top + paddingY + 12;

  // Place every glyph in its own fixed cell (x = col * charWidth, centered). This makes
  // alignment independent of the renderer's font metrics — the reason terminal art
  // garbles when box-drawing and ASCII glyphs advance differently in an <img> context.
  let rects = '';
  let texts = '';
  lines.forEach((line, index) => {
    if (stripAnsi(line).length === 0) return;
    const y = top + 4 + (index * lineHeight);
    let col = 0;
    for (const run of parseAnsiLine(line)) {
      const fill = run.fg || DEFAULT_FG;
      const weight = run.bold ? ' font-weight="700"' : '';
      for (const ch of Array.from(run.text)) {
        const cellX = paddingX + (col * charWidth);
        if (run.bg) {
          rects += `<rect x="${cellX.toFixed(1)}" y="${y - 14}" width="${charWidth}" height="${lineHeight}" fill="${run.bg}"/>`;
        }
        if (ch !== ' ') {
          const cx = cellX + (charWidth / 2);
          texts += `<text x="${cx.toFixed(1)}" y="${y}" text-anchor="middle" fill="${fill}"${weight}>${escapeSvg(ch)}</text>`;
        }
        col += 1;
      }
    }
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="16">`,
    `<rect width="100%" height="100%" rx="10" fill="${TERM_BG}"/>`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" fill="${PANEL_BG}" stroke="#2a2833" stroke-width="1"/>`,
    '<circle cx="24" cy="26" r="6" fill="#b6553f"/>',
    '<circle cx="44" cy="26" r="6" fill="#cca24c"/>',
    '<circle cx="64" cy="26" r="6" fill="#6f9463"/>',
    `<text x="92" y="31" fill="#9d967f" font-size="13" style="letter-spacing:2px">${escapeSvg(title.toUpperCase())}</text>`,
    `<line x1="0" y1="48" x2="${width}" y2="48" stroke="#221f2a" stroke-width="1"/>`,
    `<g xml:space="preserve">${rects}${texts}</g>`,
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

  // SVGs capture the real colored terminal (truecolor swatches, gold/green/red).
  const cliDemo = renderCliDemo(registry);
  const svgAssets = {
    'hero.svg': renderTerminalSvg(renderTui(heroState, { color: true }), 'minipainter tui — catalog'),
    'search.svg': renderTerminalSvg(renderTui(searchState, { color: true }), 'minipainter tui — search'),
    'owned.svg': renderTerminalSvg(renderTui(ownedState, { color: true }), 'minipainter tui — owned'),
    'cli.svg': renderTerminalSvg(cliDemo, 'minipainter cli'),
  };

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
