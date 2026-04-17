const WASH_ROLES = new Set(['shade', 'contrast']);

export function normalizeRole(role) {
  if (typeof role !== 'string') {
    return role;
  }

  if (WASH_ROLES.has(role)) {
    return 'wash';
  }

  return role;
}

export function rolesMatch(a, b) {
  return normalizeRole(a) === normalizeRole(b);
}
