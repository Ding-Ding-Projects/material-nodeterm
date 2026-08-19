/** One ready-made pattern in the builder's preset library. Selecting a preset replaces the
 *  current pattern outright (and loads `sample` alongside it when given, so the preset
 *  demonstrates itself against text that actually contains what it's meant to find) — it never
 *  merges with whatever was already typed. */
export interface RegexPreset {
  name: string
  pattern: string
  sample?: string
}

export const REGEX_PRESETS: RegexPreset[] = [
  { name: 'Host : port', pattern: '(?<host>[\\w.-]+):(?<port>\\d+)', sample: 'ha-box.local:8443 · 127.0.0.1:5173 · relay.nodeterm.dev:443' },
  {
    name: 'Email address',
    pattern: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)',
    sample: 'enes@nodeterm.dev · ops+ci@ding-ding.dev · not-an-email'
  },
  {
    name: 'URL',
    pattern: 'https?:\\/\\/(?<host>[\\w.-]+)(?<path>\\/[\\w\\/.%-]*)?',
    sample: 'see https://nodeterm.dev/docs and http://127.0.0.1:5173/app'
  },
  {
    name: 'IPv4 address',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    sample: 'hosts: 127.0.0.1, 192.168.1.44, 10.0.0.255 — not 999.999'
  },
  { name: 'ISO date', pattern: '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})', sample: 'released 2026-08-16, next 2026-09-01' },
  { name: 'Semver', pattern: '\\bv?(?<maj>\\d+)\\.(?<min>\\d+)\\.(?<patch>\\d+)\\b', sample: 'v0.9.5 → v0.10.0 (was 0.9.4)' },
  { name: 'Git SHA (short)', pattern: '\\b[0-9a-f]{7,10}\\b', sample: 'a41c9e2 7f0b135 c92aa07 — not zzz1234' },
  { name: 'Hex color', pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b', sample: 'seed #6750A4 on #141218, light #FEF7FF' },
  { name: 'ANSI escape', pattern: '\\x1b\\[[0-9;]*m', sample: 'plain [31mred[0m text' },
  { name: 'tmux session name', pattern: 'nt-(?<agent>claude|codex|term)-(?<n>\\d+)', sample: 'nt-claude-3 nt-codex-1 nt-term-7' },
  { name: 'Trailing whitespace', pattern: '[ \\t]+$', sample: 'a line with trailing spaces   \nanother, clean' },
  { name: 'Duplicate words', pattern: '\\b(?<word>\\w+)\\s+\\k<word>\\b', sample: 'the the quick brown fox fox' }
]
