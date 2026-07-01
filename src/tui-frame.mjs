import { visibleWidth, plainTheme } from './tui-theme.mjs';

function padLine(value, width) {
  const vis = visibleWidth(value);
  if (vis >= width) {
    // rare overflow: only trim when there are no escape codes to mangle
    return vis === value.length ? value.slice(0, width) : value;
  }
  return value + ' '.repeat(width - vis);
}

export function renderSection(title, lines, width = 38, theme = plainTheme) {
  const body = lines.length > 0 ? lines : [''];
  const edge = (s) => theme.dim(s);
  const row = (content) => `${edge('║')} ${padLine(content, width - 1)}${edge('║')}`;

  return [
    edge(`╔${'═'.repeat(width)}╗`),
    row(theme.goldBold(title)),
    edge(`╠${'═'.repeat(width)}╣`),
    ...body.map((line) => row(line)),
    edge(`╚${'═'.repeat(width)}╝`),
  ].join('\n');
}

export function renderSeparator(label, width = 78, theme = plainTheme) {
  const core = ` ${label} `;
  const fill = Math.max(0, width - core.length);
  const left = Math.floor(fill / 2);
  const right = fill - left;
  return `${theme.dim('═'.repeat(left))}${theme.dim(' ')}${theme.goldBold(label)}${theme.dim(' ')}${theme.dim('═'.repeat(right))}`;
}
