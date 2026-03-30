import path from 'node:path';

export function getDefaultRegistryPath(cwd = process.cwd()) {
  return path.join(cwd, '.warpaint', 'registry.json');
}

export function resolveRegistryPath(options = {}) {
  return options.registryPath || getDefaultRegistryPath(options.cwd);
}
