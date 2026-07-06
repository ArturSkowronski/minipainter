import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('../.claude/skills/minipainter/', import.meta.url));
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');

function readFrontmatter(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md must open with a --- frontmatter block');
  return { raw, frontmatter: match[1], body: raw.slice(match[0].length) };
}

// Extract a scalar or folded (>- / |) value for a top-level YAML key, stopping at
// the next top-level `key:` line. Good enough for the small, fixed skill schema.
function fieldValue(frontmatter, key) {
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return null;
  const first = lines[start].slice(key.length + 1).trim();
  if (first && first !== '>-' && first !== '>' && first !== '|' && first !== '|-') {
    return first.replace(/^["']|["']$/g, '');
  }
  const rest = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[a-zA-Z0-9_-]+:/.test(lines[i])) break;
    rest.push(lines[i].trim());
  }
  return rest.join(' ').trim();
}

test('minipainter skill has a spec-compliant name', () => {
  const { frontmatter } = readFrontmatter(SKILL_MD);
  const name = fieldValue(frontmatter, 'name');
  assert.ok(name, 'name is required');
  assert.match(name, /^[a-z0-9-]+$/, 'name must be lowercase letters, digits, hyphens');
  assert.ok(name.length <= 64, 'name must be <= 64 chars');
  assert.equal(name, path.basename(SKILL_DIR.replace(/\/$/, '')), 'name must match the skill folder');
});

test('minipainter skill description is present and within the 1024-char limit', () => {
  const { frontmatter } = readFrontmatter(SKILL_MD);
  const description = fieldValue(frontmatter, 'description');
  assert.ok(description && description.length >= 20, 'description must be a meaningful sentence');
  assert.ok(description.length <= 1024, 'description must be <= 1024 chars');
  // A good trigger description names the tool and when to use it.
  assert.match(description, /minipainter/i);
  assert.match(description, /\b(use when|search|match|inventory|own)\b/i);
});

test('minipainter skill scopes its tools and its referenced files exist', () => {
  const { frontmatter, body } = readFrontmatter(SKILL_MD);
  assert.ok(fieldValue(frontmatter, 'allowed-tools'), 'allowed-tools should scope the skill');

  // Every references/*.md the body links to must actually exist (no dead progressive-disclosure links).
  const links = [...body.matchAll(/references\/([\w.-]+\.md)/g)].map((m) => m[1]);
  assert.ok(links.length > 0, 'skill should link to at least one reference file');
  for (const link of new Set(links)) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', link)), `missing reference file: ${link}`);
  }
});

test('minipainter SKILL.md stays lean (progressive disclosure)', () => {
  const lineCount = fs.readFileSync(SKILL_MD, 'utf8').split('\n').length;
  assert.ok(lineCount <= 200, `SKILL.md should stay short; detail belongs in references/ (was ${lineCount} lines)`);
});
