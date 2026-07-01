import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTuiAction,
  createTuiState,
  renderTui,
} from '../src/tui.mjs';
import { stripAnsi, visibleWidth } from '../src/tui-theme.mjs';

function makeRegistry() {
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
      ],
    },
  };
}

test('createTuiState starts in catalog view with searchable paints', () => {
  const state = createTuiState(makeRegistry());

  assert.equal(state.view, 'catalog');
  assert.equal(state.filteredPaints.length, 2);
  assert.equal(state.selectedIndex, 0);
});

test('applyTuiAction updates search and toggles between catalog and owned views', () => {
  const initial = createTuiState(makeRegistry());
  const searched = applyTuiAction(initial, { type: 'search', value: 'bone' });
  const switched = applyTuiAction(searched, { type: 'set-view', view: 'owned' });

  assert.deepEqual(searched.filteredPaints.map((paint) => paint.id), [
    'army_painter/pallid-bone',
  ]);
  assert.equal(switched.view, 'owned');
  assert.deepEqual(switched.filteredPaints.map((paint) => paint.id), [
    'army_painter/pallid-bone',
  ]);
});

test('applyTuiAction toggles ownership for the selected paint', () => {
  const initial = createTuiState(makeRegistry());
  const next = applyTuiAction(initial, { type: 'toggle-owned' });

  assert.equal(next.registry.catalog.paints[0].owned, true);
});

test('renderTui includes the current view, filters, and selected detail panel', () => {
  const state = applyTuiAction(createTuiState(makeRegistry()), {
    type: 'search',
    value: 'bone',
  });
  const rendered = renderTui(state);

  assert.match(rendered, /WARPAINT/);
  assert.match(rendered, /CATALOG/);
  assert.match(rendered, /SELECTED PAINT/);
  assert.match(rendered, /Search Query: bone/i);
  assert.match(rendered, /Pallid Bone/);
  assert.match(rendered, /Status: OWNED/i);
});

test('renderTui includes framed command legend and themed inventory labels', () => {
  const state = createTuiState(makeRegistry());
  const rendered = renderTui(state);

  assert.match(rendered, /COMMANDS/);
  assert.match(rendered, /MISSING|OWNED/);
  assert.match(rendered, /Visible:/);
});

test('renderTui plain output carries no ANSI escape codes', () => {
  const rendered = renderTui(createTuiState(makeRegistry()));
  assert.ok(!rendered.includes('\x1b['), 'plain render must not contain escape codes');
});

test('renderTui color output adds ANSI but stays visually equivalent to plain', () => {
  const state = createTuiState(makeRegistry());
  const plain = renderTui(state);
  const colored = renderTui(state, { color: true });

  assert.ok(colored.includes('\x1b['), 'color render should contain escape codes');
  assert.ok(colored.includes('\x1b[48;2;'), 'color render should include a truecolor swatch');
  // stripping the codes must reproduce the plain layout exactly (alignment safe)
  assert.equal(stripAnsi(colored), plain);
});

test('framed rows stay square once ANSI codes are stripped', () => {
  const colored = renderTui(createTuiState(makeRegistry()), { color: true });
  const catalogRows = colored
    .split('\n')
    .filter((line) => stripAnsi(line).startsWith('║'));
  const widths = new Set(catalogRows.map((line) => visibleWidth(line)));
  assert.equal(widths.size, 1, `all framed rows must share one visible width, got ${[...widths]}`);
});
