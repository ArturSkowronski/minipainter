import { visibleWidth, plainTheme } from './tui-theme.mjs';

// Built programmatically and centered by visible width, so the frame stays square
// whatever the title/subtitle length or escape codes contain.
export function renderBanner(theme = plainTheme, width = 78) {
  const edge = (s) => theme.dim(s);

  const center = (content) => {
    const pad = Math.max(0, width - visibleWidth(content));
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + content + ' '.repeat(pad - left);
  };
  const line = (content) => `${edge('║')}${center(content)}${edge('║')}`;

  return [
    edge(`╔${'═'.repeat(width)}╗`),
    line(''),
    line(theme.goldBold('░▒▓█  WARPAINT  █▓▒░')),
    line(''),
    line(theme.dim('MINIATURE PAINT INVENTORY')),
    line(''),
    edge(`╚${'═'.repeat(width)}╝`),
  ].join('\n');
}
