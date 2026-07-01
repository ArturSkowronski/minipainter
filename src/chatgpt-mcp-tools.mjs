import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  initPaintRegistry,
  matchPaintByColor,
  searchPaintCatalog,
  showPaint,
} from './paint-service.mjs';

const DEFAULT_SEARCH_LIMIT = 20;

// ---- pure helpers -----------------------------------------------------------

function paintUrl(baseUrl, id) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const encoded = String(id).split('/').map(encodeURIComponent).join('/');
  return `${base}/api/paints/${encoded}`;
}

function paintTitle(paint) {
  return `${paint.name} (${paint.provider})`;
}

function rgbHex(rgb) {
  if (!rgb) return null;
  const toHex = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function describePaint(paint) {
  const lines = [
    `${paint.name} — ${paint.provider}`,
    `Product format: ${paint.product_format ?? 'unknown'}`,
    `Usage roles: ${(paint.usage_roles ?? []).join(', ') || 'n/a'}`,
    `Color families: ${(paint.color_families ?? []).join(', ') || 'n/a'}`,
  ];
  const hex = rgbHex(paint.rgb);
  if (hex && paint.rgb) {
    lines.push(`RGB: ${hex} (${paint.rgb.r}, ${paint.rgb.g}, ${paint.rgb.b})`);
  }
  if (paint.aliases?.length) {
    lines.push(`Aliases: ${paint.aliases.join(', ')}`);
  }
  lines.push(`Owned: ${paint.owned ? 'yes' : 'no'}`);
  return lines.join('\n');
}

function paintMetadata(paint) {
  return {
    provider: String(paint.provider ?? ''),
    product_format: String(paint.product_format ?? ''),
    usage_roles: (paint.usage_roles ?? []).join(', '),
    color_families: (paint.color_families ?? []).join(', '),
    aliases: (paint.aliases ?? []).join(', '),
    rgb_hex: rgbHex(paint.rgb) ?? '',
    owned: paint.owned ? 'true' : 'false',
  };
}

export function buildSearchResults(catalogResult, { baseUrl, limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const items = catalogResult?.items ?? [];
  return {
    results: items.slice(0, limit).map((item) => ({
      id: item.id,
      title: paintTitle(item),
      url: paintUrl(baseUrl, item.id),
    })),
  };
}

export function buildFetchResult(showResult, requestedId, { baseUrl } = {}) {
  if (showResult?.status === 'resolved' && showResult.item) {
    const paint = showResult.item;
    return {
      id: paint.id,
      title: paintTitle(paint),
      text: describePaint(paint),
      url: paintUrl(baseUrl, paint.id),
      metadata: paintMetadata(paint),
    };
  }

  const matches = showResult?.matches ?? [];
  const text = showResult?.status === 'ambiguous'
    ? `Ambiguous id "${requestedId}". Candidates: ${matches.map((m) => m.id).join(', ')}.`
    : `No paint found for id "${requestedId}".`;

  return {
    id: requestedId,
    title: requestedId,
    text,
    url: paintUrl(baseUrl, requestedId),
    metadata: { status: showResult?.status ?? 'not_found' },
  };
}

// ---- MCP wiring -------------------------------------------------------------

function jsonTextResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function createChatGptToolHandlers(baseOptions = {}) {
  const { baseUrl, searchLimit = DEFAULT_SEARCH_LIMIT, ...serviceOptions } = baseOptions;

  return {
    search: async ({ query = '' } = {}) => {
      const catalog = await searchPaintCatalog({ ...serviceOptions, query });
      return jsonTextResult(buildSearchResults(catalog, { baseUrl, limit: searchLimit }));
    },
    fetch: async ({ id } = {}) => {
      const show = await showPaint({ ...serviceOptions, paint: id });
      return jsonTextResult(buildFetchResult(show, id, { baseUrl }));
    },
    match_color: async (args = {}) => {
      const result = await matchPaintByColor({ ...serviceOptions, ...args });
      return jsonTextResult(result);
    },
  };
}

export function getChatGptToolDefinitions() {
  return [
    {
      name: 'search',
      description:
        'Search the miniature-paint catalog by name, alias, color family, or usage role. '
        + 'Returns a list of matching paints with ids to pass to fetch.',
      inputSchema: {
        query: z.string().default('').describe('Search query, e.g. "nuln oil" or "silver metallic"'),
      },
    },
    {
      name: 'fetch',
      description: 'Fetch the full record for one paint by its id (e.g. "citadel/nuln-oil").',
      inputSchema: {
        id: z.string().describe('Paint id returned by search'),
      },
    },
    {
      name: 'match_color',
      description: 'Find paints closest to a target color, owned-first, by hex or RGB.',
      inputSchema: {
        hex: z.string().optional().describe('Hex color like #d2c29b'),
        rgb: z.object({ r: z.number(), g: z.number(), b: z.number() }).optional().describe('RGB object'),
        provider: z.string().optional().describe('Optional provider id'),
        owned: z.boolean().optional().describe('Optional owned filter'),
        usage_role: z.string().optional().describe('Optional usage role filter'),
        color_family: z.string().optional().describe('Optional color family filter'),
      },
    },
  ];
}

export function createChatGptMcpServer(baseOptions = {}) {
  const server = new McpServer({
    name: `${process.env.MCP_SERVER_NAME || 'paint-inventory'}-chatgpt`,
    version: '0.3.0',
  });
  const handlers = createChatGptToolHandlers(baseOptions);

  for (const definition of getChatGptToolDefinitions()) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.inputSchema },
      async (args) => handlers[definition.name](args),
    );
  }

  return server;
}
