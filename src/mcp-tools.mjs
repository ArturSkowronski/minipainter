import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  initPaintRegistry,
  listInventory,
  markInventoryOwned,
  markInventoryUnowned,
  matchPaintByColor,
  matchPaintByDescription,
  searchPaintCatalog,
  showPaint,
} from './paint-service.mjs';

function textResult(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}

async function withRegistryInit(options, fn) {
  if (options.initialize_registry) {
    await initPaintRegistry(options);
  }

  return fn(options);
}

export function createMcpToolHandlers(baseOptions = {}) {
  return {
    paint_search: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => searchPaintCatalog(options),
    ),
    paint_show: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => showPaint(options),
    ),
    inventory_list: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => listInventory(options),
    ),
    inventory_mark_owned: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => markInventoryOwned(options),
    ),
    inventory_mark_unowned: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => markInventoryUnowned(options),
    ),
    match_color: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => matchPaintByColor(options),
    ),
    match_describe: async (args = {}) => withRegistryInit(
      { ...baseOptions, ...args },
      (options) => matchPaintByDescription(options),
    ),
  };
}

export function getMcpToolDefinitions() {
  return [
    {
      name: 'paint_search',
      description: 'Search paints by name, alias, provider, owned state, role, or color family.',
      inputSchema: {
        query: z.string().default('').describe('Search query'),
        provider: z.string().optional().describe('Optional provider id'),
        owned: z.boolean().optional().describe('Optional owned filter'),
        usage_role: z.string().optional().describe('Optional usage role filter'),
        color_family: z.string().optional().describe('Optional color family filter'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
    {
      name: 'paint_show',
      description: 'Show one paint or return ambiguous/not_found resolution results.',
      inputSchema: {
        paint: z.string().describe('Paint name or id'),
        provider: z.string().optional().describe('Optional provider id'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
    {
      name: 'inventory_list',
      description: 'List owned paints from the local inventory.',
      inputSchema: {
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
    {
      name: 'inventory_mark_owned',
      description: 'Mark a paint as owned in the local inventory.',
      inputSchema: {
        paint: z.string().describe('Paint name or id'),
        provider: z.string().optional().describe('Optional provider id'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
    {
      name: 'inventory_mark_unowned',
      description: 'Mark a paint as not owned in the local inventory.',
      inputSchema: {
        paint: z.string().describe('Paint name or id'),
        provider: z.string().optional().describe('Optional provider id'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
    {
      name: 'match_color',
      description: 'Match paints by approximate color with owned-first ranking.',
      inputSchema: {
        hex: z.string().optional().describe('Hex color like #d2c29b'),
        rgb: z.object({
          r: z.number(),
          g: z.number(),
          b: z.number(),
        }).optional().describe('RGB object'),
        provider: z.string().optional().describe('Optional provider id'),
        owned: z.boolean().optional().describe('Optional owned filter'),
        usage_role: z.string().optional().describe('Optional usage role filter'),
        color_family: z.string().optional().describe('Optional color family filter'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
    {
      name: 'match_describe',
      description: 'Match paints from a semantic description like bone or silver metallic.',
      inputSchema: {
        query: z.string().describe('Semantic description'),
        provider: z.string().optional().describe('Optional provider id'),
        owned: z.boolean().optional().describe('Optional owned filter'),
        usage_role: z.string().optional().describe('Optional usage role filter'),
        color_family: z.string().optional().describe('Optional color family filter'),
        initialize_registry: z.boolean().optional().describe('Initialize the registry if it does not exist'),
      },
    },
  ];
}

export function createMcpServer(baseOptions = {}) {
  const server = new McpServer({
    name: 'warpaint',
    version: '0.1.0',
  });
  const handlers = createMcpToolHandlers(baseOptions);

  for (const definition of getMcpToolDefinitions()) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
      },
      async (args) => textResult(await handlers[definition.name](args)),
    );
  }

  return server;
}
