import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDemoRegistry, renderDemoAssets } from '../scripts/render-demo-output.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'minipainting-demo-'));
}

test('createDemoRegistry creates stable demo state with owned paints', () => {
  const registry = createDemoRegistry();

  assert.equal(registry.version, 1);
  assert.ok(registry.catalog.paints.some((paint) => paint.owned));
  assert.ok(registry.catalog.paints.some((paint) => !paint.owned));
});

test('renderDemoAssets generates all required README asset captures', async () => {
  const outputDir = await makeTempDir();

  const generated = await renderDemoAssets(outputDir);

  assert.deepEqual(generated.sort(), [
    'cli.svg',
    'cli.txt',
    'hero.svg',
    'hero.txt',
    'owned.svg',
    'owned.txt',
    'search.svg',
    'search.txt',
  ]);

  for (const file of generated) {
    const content = await fs.readFile(path.join(outputDir, file), 'utf8');
    assert.ok(content.length > 40);
  }
});

test('generated assets include forge ledger presentation and command output', async () => {
  const outputDir = await makeTempDir();

  await renderDemoAssets(outputDir);

  const hero = await fs.readFile(path.join(outputDir, 'hero.txt'), 'utf8');
  const search = await fs.readFile(path.join(outputDir, 'search.txt'), 'utf8');
  const owned = await fs.readFile(path.join(outputDir, 'owned.txt'), 'utf8');
  const cli = await fs.readFile(path.join(outputDir, 'cli.txt'), 'utf8');
  const heroSvg = await fs.readFile(path.join(outputDir, 'hero.svg'), 'utf8');

  assert.match(hero, /MINIPAINTER/);
  assert.match(hero, /CATALOG/);
  assert.match(search, /Search Query: bone/i);
  assert.match(owned, /OWNED PAINTS/);
  assert.match(cli, /inventory own/i);
  assert.match(heroSvg, /<svg/);
  // colored capture: gold banner text + a truecolor swatch rect
  assert.match(heroSvg, /fill="rgb\(204,162,76\)"/);
  assert.match(heroSvg, /<rect[^>]*fill="rgb\(/);
});

test('README references all generated demo assets and showcase sections', async () => {
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /docs\/assets\/hero\.svg/);
  assert.match(readme, /docs\/assets\/search\.svg/);
  assert.match(readme, /docs\/assets\/owned\.svg/);
  assert.match(readme, /docs\/assets\/cli\.svg/);
  assert.match(readme, /## Why This Exists/);
  assert.match(readme, /## Feature Highlights/);
  assert.match(readme, /## Screenshots/);
  assert.match(readme, /## Quickstart/);
  assert.match(readme, /## TUI Workflow/);
  assert.match(readme, /## Project Direction/);
});
