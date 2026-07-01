// ANSI theming for the ledger TUI. All helpers are no-ops when color is off,
// so the plain layout (tests, SVG capture) is byte-identical to the styled one
// minus the escape codes. Layout math must use visibleWidth, never String.length.

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const FG = {
  gold: '\x1b[38;2;204;162;76m',
  bone: '\x1b[38;2;236;229;210m',
  dim: '\x1b[38;2;157;150;127m',
  green: '\x1b[38;2;127;201;160m',
  red: '\x1b[38;2;182;85;63m',
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(value) {
  return String(value).replace(ANSI_RE, '');
}

export function visibleWidth(value) {
  return stripAnsi(value).length;
}

export function createTheme(enabled = false) {
  const paint = (prefix) => (text) => (enabled ? `${prefix}${text}${RESET}` : String(text));

  return {
    enabled,
    gold: paint(FG.gold),
    bone: paint(FG.bone),
    dim: paint(FG.dim),
    green: paint(FG.green),
    red: paint(FG.red),
    goldBold: paint(`${BOLD}${FG.gold}`),
    boneBold: paint(`${BOLD}${FG.bone}`),
    // a two-cell block filled with the paint's own RGB; two plain spaces when off
    swatch: (rgb) => (enabled && rgb
      ? `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m  ${RESET}`
      : '  '),
  };
}

export const plainTheme = createTheme(false);

export function supportsColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return Boolean(stream && stream.isTTY);
}
