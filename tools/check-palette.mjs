#!/usr/bin/env node
/* Checks the two things about css/style.css that are easy to get wrong and impossible to see.
 *
 * 1. THE FOUR COPIES. The palette is written four times - :root, the dark media query,
 *    html[data-theme="light"] and html[data-theme="dark"] - because a media query cannot be reused
 *    for an attribute selector. Nothing at runtime compares them, so a colour changed in three of
 *    the four places works everywhere the developer looks and breaks on the one device they did not
 *    open. This is that comparison.
 *
 * 2. CONTRAST. Every text pair the app renders must clear WCAG AA (4.5:1) in both themes, and every
 *    shape drawn on a neutral surface must clear 3:1. One case needs its own rule rather than a
 *    number: a shape drawn on a PINK fill, where the edge must be --accent-strong instead of
 *    --accent, because --accent on --accent-soft is 2.99:1 in light mode and the edge then reads as
 *    no edge at all.
 *
 * Run:  node tools/check-palette.mjs      (exit 0 = pass, 1 = something above is wrong)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/style.css'), 'utf8');

/* Pull the body of one rule, brace-matched, so a nested at-rule cannot cut it short. */
function block(header) {
  const i = css.indexOf(header);
  if (i < 0) return null;
  const start = css.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (!depth) return css.slice(start + 1, j);
    }
  }
  return null;
}

/* Tokens, with comments stripped first so a colour named in prose is never read as a declaration,
   and every declaration found rather than the first on each line (the level ramp is two per line). */
function tokens(text) {
  const out = {};
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

const HEADERS = {
  light: ':root {',
  dark: '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"])',
  lightAttr: 'html[data-theme="light"]',
  darkAttr: 'html[data-theme="dark"]',
};

const found = {};
const missing = [];
for (const [name, header] of Object.entries(HEADERS)) {
  const body = block(header);
  if (body === null) missing.push(header.split('\n').pop());
  found[name] = body === null ? {} : tokens(body);
}
if (missing.length) {
  for (const h of missing) console.log(`FAIL could not find the ${h} block`);
  process.exit(1);
}

/* Colours only: the other tokens (radii, fonts) are deliberately declared once in :root. */
const isColour = (v) => /^#[0-9a-f]{3,8}$/i.test(v);
const coloursOf = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => isColour(v)));

const sets = {
  lightRoot: coloursOf(found.light),
  darkMedia: coloursOf(found.dark),
  lightAttr: coloursOf(found.lightAttr),
  darkAttr: coloursOf(found.darkAttr),
};

let failed = 0;

const agreements = [
  ['light: :root === html[data-theme="light"]', sets.lightRoot, sets.lightAttr, true],
  ['dark: media query === html[data-theme="dark"]', sets.darkMedia, sets.darkAttr, true],
  ['light and dark name the same colours', sets.lightRoot, sets.darkMedia, false],
];

for (const [label, a, b, compareValues] of agreements) {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [...names].filter((k) => {
    if (!(k in a) || !(k in b)) return true;
    return compareValues ? a[k] !== b[k] : false;
  });
  if (diffs.length) {
    failed++;
    console.log(`FAIL ${label}`);
    for (const k of diffs) console.log(`       ${k}: ${a[k] ?? '(missing)'}  vs  ${b[k] ?? '(missing)'}`);
  } else {
    console.log(`ok   ${label}  (${Object.keys(a).length} colours)`);
  }
}

const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
if (open !== close) {
  failed++;
  console.log(`FAIL unbalanced braces: ${open} { vs ${close} }`);
} else console.log(`ok   braces balanced (${open})`);

const heavy = [...css.matchAll(/font-weight:\s*(800|900)/g)].length;
if (heavy) {
  failed++;
  console.log(`FAIL ${heavy} font-weight 800/900 left; this palette stops at 700`);
} else console.log('ok   no font-weight above 700');

/* --- contrast ------------------------------------------------------------------------------- */

const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (rgb) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

const TEXT = [
  ['body ink on paper', '--ink', '--paper'],
  ['body ink on surface', '--ink', '--surface'],
  ['muted on surface', '--muted', '--surface'],
  ['muted on paper', '--muted', '--paper'],
  ['accent-strong (links, eyebrows) on surface', '--accent-strong', '--surface'],
  ['accent-strong on paper', '--accent-strong', '--paper'],
  ['accent-strong on accent-soft (count pill, level badge)', '--accent-strong', '--accent-soft'],
  ['label on a primary button', '--accent-ink', '--accent'],
  ['bar ink on bar', '--bar-ink', '--bar'],
  ['danger ink on surface', '--danger', '--surface'],
  ['toast ink on a danger fill', '--danger-ink', '--danger'],
  ['goal fg on goal bg', '--goal-fg', '--goal-bg'],
  ['progress fg on progress bg', '--progress-fg', '--progress-bg'],
  ['achieved fg on achieved bg', '--achieved-fg', '--achieved-bg'],
  ['lvl1 fg on lvl1 bg', '--lvl1-fg', '--lvl1-bg'],
  ['lvl2 fg on lvl2 bg', '--lvl2-fg', '--lvl2-bg'],
  ['lvl3 fg on lvl3 bg', '--lvl3-fg', '--lvl3-bg'],
];
const SHAPE = [
  ['accent fill on a neutral surface', '--accent', '--surface'],
  ['accent fill on surface-2 (segmented track)', '--accent', '--surface-2'],
];

for (const [theme, t] of [['LIGHT', found.light], ['DARK', found.dark]]) {
  console.log(`\n${theme}  (ink ${t['--ink']} on paper ${t['--paper']})`);
  for (const [label, fg, bg] of TEXT) {
    const c = ratio(t[fg], t[bg]);
    if (c < 4.5) {
      failed++;
      console.log(`  FAIL ${String(c).padStart(6)}:1  (AA needs 4.5)   ${label}`);
    } else console.log(`  ok   ${String(c).padStart(6)}:1  (AA needs 4.5)   ${label}`);
  }
  for (const [label, fg, bg] of SHAPE) {
    const c = ratio(t[fg], t[bg]);
    if (c < 3) {
      failed++;
      console.log(`  FAIL ${String(c).padStart(6)}:1  (needs 3)        ${label}`);
    } else console.log(`  ok   ${String(c).padStart(6)}:1  (needs 3)        ${label}`);
  }
}

/* The pink-on-pink case: a shape drawn on an --accent-soft fill needs --accent-strong for its edge. */
console.log('\npink on pink:');
let softRules = 0;
let pinkBad = 0;
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = m[2];
  if (!/background(-color)?:\s*var\(--accent-soft\)/.test(body)) continue;
  softRules++;
  const sel = m[1].trim().replace(/\s+/g, ' ').split(/[,\n]/).pop().trim();
  if (/var\(--accent\)/.test(body)) {
    pinkBad++;
    console.log(`       ${sel}`);
  }
}
if (pinkBad) {
  failed++;
  console.log(`  FAIL ${pinkBad} of ${softRules} rule(s) drawing on an --accent-soft fill still use var(--accent)`);
} else {
  console.log(`  ok   ${softRules} rule(s) paint on --accent-soft; none draws a var(--accent) edge`);
}

console.log(
  failed
    ? `\n${failed} PROBLEM(S) IN css/style.css`
    : '\ncss/style.css PASSES: four token blocks in step, every pair the app renders readable',
);
process.exit(failed ? 1 : 0);
