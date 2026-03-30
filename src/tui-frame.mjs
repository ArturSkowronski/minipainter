function padLine(value, width) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, ' ');
}

export function renderSection(title, lines, width = 38) {
  const body = lines.length > 0 ? lines : [''];

  return [
    `╔${'═'.repeat(width)}╗`,
    `║ ${padLine(title, width - 1)}║`,
    `╠${'═'.repeat(width)}╣`,
    ...body.map((line) => `║ ${padLine(line, width - 1)}║`),
    `╚${'═'.repeat(width)}╝`,
  ].join('\n');
}

export function renderSeparator(label, width = 78) {
  const core = ` ${label} `;
  const fill = Math.max(0, width - core.length);
  const left = Math.floor(fill / 2);
  const right = fill - left;
  return `${'═'.repeat(left)}${core}${'═'.repeat(right)}`;
}
