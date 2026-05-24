#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { resolveRegistryPath, resolveRemotesPath } from './config.mjs';
import { renderResult } from './output.mjs';
import { runCatalogCommand } from './commands/catalog.mjs';
import { runPaintCommand } from './commands/paint.mjs';
import { runInventoryCommand } from './commands/inventory.mjs';
import { runMatchCommand } from './commands/match.mjs';
import { runSyncCommand } from './commands/sync.mjs';
import { loadRegistry, saveRegistry } from './registry-store.mjs';
import { runTui } from './tui.mjs';

async function runTuiCommand(_args, context) {
  const registry = await loadRegistry(context.registryPath);
  const result = await runTui(registry);
  await saveRegistry(context.registryPath, result.registry);

  return {
    message: 'TUI session ended',
  };
}

const COMMANDS = {
  catalog: runCatalogCommand,
  paint: runPaintCommand,
  inventory: runInventoryCommand,
  match: runMatchCommand,
  tui: runTuiCommand,
  sync: (args, context) => runSyncCommand(args, {
    inventoryPath: context.registryPath,
    remotesPath: context.remotesPath,
  }),
};

function splitJsonFlag(args) {
  return {
    json: args.includes('--json'),
    args: args.filter((arg) => arg !== '--json'),
  };
}

export async function runCli(argv, options = {}) {
  const { json, args } = splitJsonFlag(argv);
  const cwd = options.cwd || process.cwd();
  const [command, ...rest] = args;
  const handler = COMMANDS[command];

  if (!handler) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Unknown command\n',
    };
  }

  try {
    const result = await handler(rest, {
      cwd,
      registryPath: resolveRegistryPath(options.cwd ? { cwd: options.cwd } : {}),
      remotesPath: resolveRemotesPath(options.cwd ? { cwd: options.cwd } : {}),
    });

    return {
      exitCode: 0,
      stdout: renderResult(result, { json }),
      stderr: '',
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error.message}\n`,
    };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
