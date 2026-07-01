import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { searchPaints } from './search-engine.mjs';
import { renderBanner } from './tui-banner.mjs';
import { renderSection, renderSeparator } from './tui-frame.mjs';
import { createTheme, supportsColor } from './tui-theme.mjs';

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

export function renderTui(state, options = {}) {
  const theme = createTheme(Boolean(options.color));
  const selectedPaint = state.filteredPaints[state.selectedIndex];

  const listRows = state.filteredPaints.length > 0
    ? state.filteredPaints.map((paint, index) => {
      const selected = index === state.selectedIndex;
      const marker = selected ? theme.gold('>') : ' ';
      const name = selected ? theme.goldBold(paint.name) : theme.bone(paint.name);
      const status = paint.owned
        ? theme.green('BOUND TO INVENTORY')
        : theme.red('MISSING FROM STORES');
      return `${theme.swatch(paint.rgb)} ${marker} ${name} :: ${theme.dim(paint.provider)} :: ${status}`;
    })
    : [theme.dim('No pigments match the current query.')];

  const detailRows = selectedPaint
    ? [
      `${theme.dim('Name:')} ${theme.bone(selectedPaint.name)}`,
      `${theme.dim('Provider:')} ${theme.dim(selectedPaint.provider)}`,
      `${theme.dim('Status:')} ${selectedPaint.owned ? theme.green('OWNED') : theme.red('MISSING')}`,
      `${theme.dim('Usage:')} ${selectedPaint.usage_roles.join(', ')}`,
      `${theme.dim('Families:')} ${selectedPaint.color_families.join(', ')}`,
      `${theme.dim('RGB:')} ${theme.swatch(selectedPaint.rgb)} ${selectedPaint.rgb.r}, ${selectedPaint.rgb.g}, ${selectedPaint.rgb.b}`,
    ]
    : [theme.dim('No pigment selected.')];

  const commands = [
    `${theme.gold('search')} <text>   ${theme.gold('owned')}   ${theme.gold('catalog')}`,
    `${theme.gold('toggle')}          ${theme.gold('quit')}`,
  ];

  const ownedTotal = state.registry.catalog.paints.filter((paint) => paint.owned).length;
  const statusLine = [
    `${theme.dim('View:')} ${theme.bone(state.view.toUpperCase())}`,
    `${theme.dim('Visible:')} ${theme.bone(String(state.filteredPaints.length))}`,
    `${theme.dim('Owned:')} ${theme.bone(String(ownedTotal))}`,
    `${theme.dim('Search Query:')} ${state.query ? theme.gold(state.query) : theme.dim('(none)')}`,
  ].join(theme.dim('  |  '));

  return [
    renderBanner(theme),
    renderSeparator('FORGE STATUS', 78, theme),
    statusLine,
    '',
    renderSection(state.view === 'owned' ? 'OWNED VIALS' : 'FORGE CATALOG', listRows, 78, theme),
    '',
    renderSection('SELECTED PIGMENT', detailRows, 78, theme),
    '',
    renderSection('RITUAL COMMANDS', commands, 78, theme),
  ].join('\n');
}

export async function runTui(registry) {
  const rl = readline.createInterface({ input, output });
  let state = createTuiState(registry);
  const color = supportsColor(output);
  const prompt = color ? '\x1b[38;2;204;162;76mtui›\x1b[0m ' : 'tui> ';

  try {
    for (;;) {
      output.write(`${renderTui(state, { color })}\n\n`);
      const line = (await rl.question(prompt)).trim();

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
