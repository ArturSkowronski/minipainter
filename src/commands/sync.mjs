import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveRemote, saveRemote } from '../remotes-store.mjs';

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function pushInventory({ inventoryPath, remote }) {
  const raw = await fs.readFile(inventoryPath, 'utf8');
  const body = JSON.parse(raw);
  const response = await fetch(`${remote.url.replace(/\/$/, '')}/inventory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(remote.token ? { Authorization: `Bearer ${remote.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await readJsonResponse(response).catch(() => null);
    throw new Error(`push failed: ${response.status} ${detail ? JSON.stringify(detail) : ''}`);
  }
  return { status: 'pushed', remote: remote.url, owned: body.owned.length };
}

async function pullInventory({ inventoryPath, remote }) {
  const response = await fetch(`${remote.url.replace(/\/$/, '')}/inventory`, {
    method: 'GET',
    headers: remote.token ? { Authorization: `Bearer ${remote.token}` } : {},
  });
  if (!response.ok) {
    const detail = await readJsonResponse(response).catch(() => null);
    throw new Error(`pull failed: ${response.status} ${detail ? JSON.stringify(detail) : ''}`);
  }
  const body = await readJsonResponse(response);
  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(inventoryPath, JSON.stringify(body, null, 2));
  return { status: 'pulled', remote: remote.url, owned: body.owned.length };
}

export async function runSyncCommand(args, context) {
  const [sub, ...rest] = args;
  const { positional, flags } = parseFlags(rest);

  if (sub === 'add') {
    const [name] = positional;
    if (!name) throw new Error('sync add: remote name required');
    if (!flags.url) throw new Error('sync add: --url required');
    await saveRemote(context.remotesPath, name, { url: flags.url, token: flags.token || null });
    return { status: 'added', name, url: flags.url };
  }

  const remote = await resolveRemote(context.remotesPath, flags.remote || null);
  if (flags.token) remote.token = flags.token;

  if (sub === 'push') {
    return pushInventory({ inventoryPath: context.inventoryPath, remote });
  }

  if (sub === 'pull') {
    if (!flags.force) {
      throw new Error('sync pull requires --force (no interactive prompts at the command layer)');
    }
    return pullInventory({ inventoryPath: context.inventoryPath, remote });
  }

  throw new Error(`unknown sync subcommand: ${sub}`);
}
