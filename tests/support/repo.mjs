/* Shared reading for tests/. Where the repo is, how to read a file, and the four small parsers more
 * than one test needs: a PNG header, the service worker's SHELL list, the router's tables, and
 * "does this file parse at all".
 *
 * Nothing here imports the app. js/store.js reaches out to esm.sh at import time and js/app.js needs
 * a DOM, so the suite reads both as text and checks the promises they make to each other - which is
 * the whole class of bug this app actually has: five files that have to agree about a name, a path
 * or a cache version, with nothing at runtime comparing them. */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const abs = (rel) => join(ROOT, rel);
export const read = (rel) => readFileSync(abs(rel), 'utf8');
export const exists = (rel) => existsSync(abs(rel));
export const bytes = (rel) => readFileSync(abs(rel));

/* A short, stable fingerprint. Short is deliberate: it only ever goes into tests/shell-baseline.json,
 * where what matters is whether a file changed, not collision resistance. */
export const sha = (rel) => createHash('sha256').update(bytes(rel)).digest('hex').slice(0, 16);

/* Every file under a directory, repo-relative with forward slashes, skipping the things that are not
 * source: the object store, installed packages, and editor/OS droppings. */
export function walk(dir = '', { skip = ['.git', 'node_modules', '.DS_Store'], exts = null } = {}) {
  const out = [];
  for (const name of readdirSync(abs(dir), { withFileTypes: true })) {
    if (skip.includes(name.name)) continue;
    const rel = dir ? `${dir}/${name.name}` : name.name;
    if (name.isDirectory()) out.push(...walk(rel, { skip, exts }));
    else if (!exts || exts.includes(extname(rel))) out.push(rel);
  }
  return out.sort();
}

/* --- PNG ------------------------------------------------------------------------------------ */

/* What Apple and the browser actually look at: the pixel size, and whether the file carries an alpha
 * channel. An icon with one is rejected for the App Store, and that is invisible in every image
 * viewer - the alpha is simply unused and renders as nothing unusual. */
export function png(rel) {
  const b = bytes(rel);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((v, i) => b[i] !== v)) throw new Error(`${rel} is not a PNG`);
  const info = {
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
    bitDepth: b[24],
    colorType: b[25],
    transparencyChunk: false,
  };
  /* Walk the chunks for tRNS: a palette or greyscale PNG can carry transparency without saying so
   * in the colour type, and Apple counts that as an alpha channel too. */
  for (let i = 8; i + 8 <= b.length; ) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    if (type === 'tRNS') info.transparencyChunk = true;
    if (type === 'IEND') break;
    i += 12 + len;
  }
  info.hasAlpha = info.colorType === 4 || info.colorType === 6 || info.transparencyChunk;
  info.colorTypeName = { 0: 'grey', 2: 'rgb', 3: 'palette', 4: 'grey+alpha', 6: 'rgba' }[info.colorType] ?? '?';
  return info;
}

/* --- the service worker's file list --------------------------------------------------------- */

/* sw.js is plain script, so the array is read out of the source rather than imported. It is the list
 * of files that make the app open offline, and every path in it has to exist. */
export function shell() {
  const src = read('sw.js');
  const m = src.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!m) throw new Error('sw.js no longer has a SHELL array');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export const cacheName = () => (read('sw.js').match(/const CACHE = '([^']+)'/) ?? [])[1] ?? '';

/* SHELL paths are cache keys, not filesystem paths: './' is the directory root, which is index.html. */
export const shellPath = (entry) => (entry === './' ? 'index.html' : entry.replace(/^\.\//, ''));

/* --- the router ----------------------------------------------------------------------------- */

/* Two tables in js/app.js decide what a hash means: SECTION (which nav item lights up for a route)
 * and the if-chain in route() that renders it. Both are read as text. */
export function router() {
  const src = read('js/app.js');

  const sectionSrc = src.match(/const SECTION = \{([\s\S]*?)\n\};/);
  if (!sectionSrc) throw new Error('js/app.js no longer has a SECTION table');
  /* Keys are quoted or bare, and one of them is the empty string - the bare '#/' route - so the
   * quoted form has to allow an empty name. */
  const section = {};
  for (const m of sectionSrc[1].matchAll(/('(?:[A-Za-z]*)'|([A-Za-z]+))\s*:\s*'([a-z]+)'/g)) {
    section[(m[1] ?? m[2]).replace(/'/g, '')] = m[3];
  }

  const openSrc = src.match(/const OPEN_WHEN_SIGNED_OUT = \[([^\]]*)\]/);
  const openWhenSignedOut = openSrc ? [...openSrc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

  /* The chain itself, read line by line rather than by regex over the whole file: the conditions
   * contain nested parentheses, so only the line knows where a condition ends. Order matters here,
   * because the first branch that matches is the one that renders. */
  const start = src.indexOf('async function route(');
  const body = src.slice(start, src.indexOf('} catch (err)', start));
  const chain = [];
  for (const line of body.split('\n')) {
    if (!/^\s*(else )?if \(/.test(line) || !/view ===/.test(line)) continue;
    chain.push({
      line: line.trim(),
      views: [...line.matchAll(/view === '([^']+)'/g)].map((m) => m[1]),
      takesId: /&& a\b/.test(line),
    });
  }

  const navSrc = src.match(/const items = \[([\s\S]*?)\n {2}\];/);
  const nav = navSrc ? [...navSrc[1].matchAll(/'#\/([A-Za-z]*)/g)].map((m) => m[1]) : [];

  return { section, openWhenSignedOut, chain, nav, src };
}

/* Every '#/route' written anywhere in the repo, with the file it was written in. */
export function hashRouteLiterals(files) {
  const found = [];
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/['"`]#\/([A-Za-z]+)/g)) found.push({ file: f, route: m[1] });
  }
  return found;
}

/* --- syntax --------------------------------------------------------------------------------- */

/* Runs the file through Node's own parser. The browser would find the same error, only after you
 * have opened the page and wondered why nothing happened. */
export function parses(rel) {
  try {
    execFileSync(process.execPath, ['--check', abs(rel)], { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err.stderr || err.message).split('\n').slice(0, 4).join(' ') };
  }
}

/* --- http ----------------------------------------------------------------------------------- */

/* The types a static host maps by extension. A file whose extension is not in here is served as
 * application/octet-stream, which the browser usually refuses to use - the reason a .heic photo
 * added to icons/ would look fine on disk and broken in the app. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* A static server over the repo, close enough to `python -m http.server` and `npx serve` for a smoke
 * test: an unknown path is a 404, a directory serves its index.html. Used by tests/smoke.test.mjs. */
export function serve(root = ROOT) {
  return async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const target = join(root, path);
    if (!target.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      if (statSync(target).isDirectory()) {
        res.writeHead(302, { location: `${path.replace(/\/?$/, '/')}index.html` }).end();
        return;
      }
      const body = readFileSync(target);
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  };
}

export const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
