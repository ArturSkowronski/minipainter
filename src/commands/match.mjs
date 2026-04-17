import { loadRegistry } from '../registry-store.mjs';
import { matchByColor, searchPaints } from '../search-engine.mjs';
import { findEquivalents } from '../equivalents-service.mjs';
import { formatEquivalentsText } from '../output.mjs';

function stripMatch(result) {
  return {
    id: result.paint.id,
    provider: result.paint.provider,
    name: result.paint.name,
    owned: result.paint.owned,
    usage_roles: result.paint.usage_roles,
    color_families: result.paint.color_families,
    rgb: result.paint.rgb,
    distance: result.distance ?? null,
    score: result.score ?? null,
  };
}

function stripPaint(paint) {
  return {
    id: paint.id,
    provider: paint.provider,
    name: paint.name,
    owned: paint.owned,
    aliases: paint.aliases,
    usage_roles: paint.usage_roles,
    color_families: paint.color_families,
    rgb: paint.rgb,
  };
}

function stripEntry(entry) {
  return { paint: stripPaint(entry.paint), distance: entry.distance };
}

function stripEquivalents(equivalents) {
  return {
    source: stripPaint(equivalents.source),
    owned: equivalents.owned.map(stripEntry),
    alternatives: equivalents.alternatives.map(stripEntry),
    thresholds: equivalents.thresholds,
    ...(equivalents.reason ? { reason: equivalents.reason } : {}),
  };
}

function parseHexColor(value) {
  const normalized = value.replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error('Color must be a 6-digit hex value');
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function parseEquivalentsFlags(args) {
  const positional = [];
  const options = {};
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === '--include-same-provider') {
      options.includeSameProvider = true;
      index += 1;
    } else if (arg === '--max-distance') {
      options.maxDistance = Number.parseFloat(args[index + 1]);
      index += 2;
    } else if (arg === '--limit') {
      options.limit = Number.parseInt(args[index + 1], 10);
      index += 2;
    } else {
      positional.push(arg);
      index += 1;
    }
  }

  return { positional, options };
}

function formatHeader(source) {
  const role = source.usage_roles?.[0] ?? '';
  const rgb = source.rgb ? `${source.rgb.r},${source.rgb.g},${source.rgb.b}` : 'n/a';
  return `Equivalents for: ${source.name} (${source.provider}) • role: ${role} • rgb: ${rgb}`;
}

export async function runMatchCommand(args, context) {
  const registry = await loadRegistry(context.registryPath);
  const [subcommand, ...rest] = args;

  if (subcommand === 'color') {
    const rgb = parseHexColor(rest[0]);
    return {
      message: 'Color matches',
      items: matchByColor(registry, rgb).map(stripMatch),
    };
  }

  if (subcommand === 'describe') {
    return {
      message: 'Described paint matches',
      items: searchPaints(registry, rest[0] || '').map(stripMatch),
    };
  }

  if (subcommand === 'equivalents') {
    const { positional, options } = parseEquivalentsFlags(rest);
    const target = positional[0];

    if (!target) {
      throw new Error('match equivalents requires a paint name');
    }

    const result = findEquivalents(registry, target, options);

    if (result.status === 'not_found' || result.status === 'ambiguous') {
      return {
        status: result.status,
        message: result.status === 'not_found' ? 'Paint not found' : 'Paint is ambiguous',
        items: (result.matches || []).map(stripPaint),
      };
    }

    const equivalents = stripEquivalents(result);
    const header = formatHeader(equivalents.source);
    const body = formatEquivalentsText(equivalents, { includeAlternatives: true });
    const message = body ? `${header}\n\n${body}` : header;

    return {
      message,
      equivalents,
      equivalents_text: '',
    };
  }

  throw new Error('Unknown match command');
}
