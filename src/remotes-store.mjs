import fs from 'node:fs/promises';
import path from 'node:path';

function isUrlLike(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

export async function loadRemotes(remotesPath) {
  try {
    const raw = await fs.readFile(remotesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.remotes && typeof parsed.remotes === 'object') {
      return parsed;
    }
    return { version: 1, remotes: {} };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: 1, remotes: {} };
    throw error;
  }
}

export async function saveRemote(remotesPath, name, entry) {
  if (!entry || !entry.url) throw new Error('remote entry requires url');
  const current = await loadRemotes(remotesPath);
  current.remotes[name] = { url: entry.url, token: entry.token || null };
  await fs.mkdir(path.dirname(remotesPath), { recursive: true });
  await fs.writeFile(remotesPath, JSON.stringify(current, null, 2));
}

export async function resolveRemote(remotesPath, nameOrUrl) {
  if (isUrlLike(nameOrUrl)) {
    return { url: nameOrUrl, token: null };
  }
  const remotes = await loadRemotes(remotesPath);
  const key = nameOrUrl || 'default';
  const entry = remotes.remotes[key];
  if (!entry) throw new Error(`unknown remote: ${key}`);
  return entry;
}
