import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { searchPaints } from './search-engine.mjs';
import { renderBanner } from './tui-banner.mjs';
import { renderSection, renderSeparator } from './tui-frame.mjs';

function applyFilters(registry, view, query) {
  const paints = view === 'owned'
    ? registry.catalog.paints.filter((paint) => paint.owned)
    : registry.catalog.paints;

  if (!query) {
    return [...paints];
  }

  return searchPaints(
    {
      ...registry,
      catalog: {
        ...registry.catalog,
        paints,
      },
    },
    query,
  ).map((result) => result.paint);
}

function cloneRegistry(registry) {
  return {
    ...registry,
    catalog: {
      ...registry.catalog,
      paints: registry.catalog.paints.map((paint) => ({
        ...paint,
        aliases: [...paint.aliases],
        usage_roles: [...paint.usage_roles],
        color_families: [...paint.color_families],
        rgb: { ...paint.rgb },
      })),
    },
  };
}

function clampSelectedIndex(index, paints) {
  if (paints.length === 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, paints.length - 1));
}

function deriveState(state) {
  const filteredPaints = applyFilters(state.registry, state.view, state.query);

  return {
    ...state,
    filteredPaints,
    selectedIndex: clampSelectedIndex(state.selectedIndex, filteredPaints),
  };
}

export function createTuiState(registry) {
  return deriveState({
    registry: cloneRegistry(registry),
    view: 'catalog',
    query: '',
    selectedIndex: 0,
    filteredPaints: [],
  });
}

export function applyTuiAction(state, action) {
  if (action.type === 'search') {
    return deriveState({
      ...state,
      query: action.value,
      selectedIndex: 0,
    });
  }

  if (action.type === 'set-view') {
    return deriveState({
      ...state,
      view: action.view,
      selectedIndex: 0,
    });
  }

  if (action.type === 'toggle-owned') {
    const selectedPaint = state.filteredPaints[state.selectedIndex];

    if (!selectedPaint) {
      return state;
    }

    const registry = cloneRegistry(state.registry);
    const paint = registry.catalog.paints.find((entry) => entry.id === selectedPaint.id);
    paint.owned = !paint.owned;

    return deriveState({
      ...state,
      registry,
    });
  }

  return state;
}

export function renderTui(state) {
  const selectedPaint = state.filteredPaints[state.selectedIndex];
  const listRows = state.filteredPaints.length > 0
    ? state.filteredPaints.map((paint, index) => [
      `${index === state.selectedIndex ? '>' : ' '} ${paint.name}`,
      `  ${paint.provider}`,
      `  ${paint.owned ? 'BOUND TO INVENTORY' : 'MISSING FROM STORES'}`,
    ].join(' :: '))
    : ['No pigments match the current query.'];

  const detailRows = selectedPaint
    ? [
      `Name: ${selectedPaint.name}`,
      `Provider: ${selectedPaint.provider}`,
      `Status: ${selectedPaint.owned ? 'OWNED' : 'MISSING'}`,
      `Usage: ${selectedPaint.usage_roles.join(', ')}`,
      `Families: ${selectedPaint.color_families.join(', ')}`,
      `RGB: ${selectedPaint.rgb.r}, ${selectedPaint.rgb.g}, ${selectedPaint.rgb.b}`,
    ]
    : ['No pigment selected.'];

  const commands = [
    'search <text>   owned   catalog',
    'toggle          quit',
  ];

  return [
    renderBanner(),
    renderSeparator('FORGE STATUS'),
    `View: ${state.view.toUpperCase()}  |  Visible: ${state.filteredPaints.length}  |  Owned: ${state.registry.catalog.paints.filter((paint) => paint.owned).length}  |  Search Query: ${state.query || '(none)'}`,
    '',
    renderSection(state.view === 'owned' ? 'OWNED VIALS' : 'FORGE CATALOG', listRows, 78),
    '',
    renderSection('SELECTED PIGMENT', detailRows, 78),
    '',
    renderSection('RITUAL COMMANDS', commands, 78),
  ].join('\n');
}

export async function runTui(registry) {
  const rl = readline.createInterface({ input, output });
  let state = createTuiState(registry);

  try {
    for (;;) {
      output.write(`${renderTui(state)}\n\n`);
      const line = (await rl.question('tui> ')).trim();

      if (line === 'quit' || line === 'exit') {
        return { registry: state.registry };
      }

      if (line === 'owned') {
        state = applyTuiAction(state, { type: 'set-view', view: 'owned' });
        continue;
      }

      if (line === 'catalog') {
        state = applyTuiAction(state, { type: 'set-view', view: 'catalog' });
        continue;
      }

      if (line === 'toggle') {
        state = applyTuiAction(state, { type: 'toggle-owned' });
        continue;
      }

      if (line.startsWith('search ')) {
        state = applyTuiAction(state, { type: 'search', value: line.slice(7) });
      }
    }
  } finally {
    rl.close();
  }
}
