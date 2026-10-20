/* The service worker is the one file in this app that can break a *deployed* app without any change
 * to the app: it hands the browser a set of files to keep, and a cache version that decides whether
 * anyone ever sees the next set.
 *
 * Four things have to agree, and each fails quietly:
 *
 *   1. every path in SHELL exists, or the install fails and the app never opens offline;
 *   2. every file a page asks for is in SHELL, or the app opens offline *broken* in one corner;
 *   3. the CDN constant matches the host the Supabase client is actually imported from, or the
 *      client is the one thing missing from the offline copy;
 *   4. CACHE was bumped whenever one of those files changed - the rule written at the top of sw.js,
 *      which is the difference between a fix reaching a dancer and a dancer keeping the old copy.
 *
 * Run:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, exists, sha, shell, shellPath, cacheName } from './support/repo.mjs';

const entries = shell();
const cache = cacheName();

test('the cache version is the shape the app has always used', () => {
  assert.match(cache, /^mypolemagazine-v\d+$/, `CACHE is "${cache}"; it should be mypolemagazine-v<number>`);
});

test('every file the worker caches exists', () => {
  for (const entry of entries) {
    const path = shellPath(entry);
    assert.ok(exists(path), `SHELL lists ${entry}, which is not in the repo - the install would fail and nothing would open offline`);
  }
  assert.equal(new Set(entries).size, entries.length, 'SHELL has a duplicate entry');
});

test('no file the page asks for is missing from the shell', () => {
  const html = read('index.html');
  const referenced = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|#|data:|mailto:)/.test(href));

  for (const path of referenced) {
    assert.ok(entries.includes(path), `index.html loads ${path}, but it is not in SHELL in sw.js`);
  }
});

test('the module graph is cached', () => {
  /* The three js files import each other by relative path. A module in the graph but not in SHELL is
   * a page that opens offline and then dies on the import. */
  for (const file of ['js/app.js', 'js/store.js']) {
    for (const m of read(file).matchAll(/from\s+'(\.\/[^']+)'/g)) {
      const imported = `js/${m[1].replace('./', '')}`;
      assert.ok(entries.includes(imported), `${file} imports ${imported}, which is not in SHELL`);
    }
  }
});

test('every avatar the app can pick is cached', () => {
  /* README, on adding an avatar: "drop the file in and add a line ... then add the file to SHELL in
   * sw.js and bump CACHE". This is that sentence, as a test. */
  const files = read('js/store.js').match(/const AVATAR_FILES = \{([\s\S]*?)\n\};/);
  assert.ok(files, 'js/store.js no longer has an AVATAR_FILES map');
  const names = [...files[1].matchAll(/'[^']+':\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, `AVATAR_FILES looks empty (${names.length})`);

  for (const name of names) {
    const path = `icons/avatars/${name}`;
    assert.ok(exists(path), `AVATAR_FILES names ${name}, which is not in icons/avatars`);
    assert.ok(entries.includes(path), `icons/avatars/${name} can be picked as an avatar but is not in SHELL`);
  }
});

test('the CDN constant is the host the client is imported from', () => {
  const cdn = read('sw.js').match(/const CDN = '([^']+)'/)?.[1];
  const imported = read('js/supabase.js').match(/from\s+'(https:\/\/[^/']+)/)?.[1];
  assert.ok(cdn && imported, 'both sw.js and js/supabase.js should name the CDN');
  assert.equal(cdn, imported, `sw.js caches ${cdn} but the client is imported from ${imported}: offline, the import would fail`);
});

test('our own files are still fetched past the HTTP cache', () => {
  /* The rule the README calls out: a plain fetch() may answer from the browser's HTTP cache, which
   * is how a release serves a new app.js next to a ten-minute-old store.js. `cache: 'no-store'` on
   * same-origin requests is what keeps a reload on one whole build. Removing it silently brings that
   * crash back. */
  const src = read('sw.js');
  assert.match(src, /isOurs \? fetch\(request, \{ cache: 'no-store' \}\)/, 'the same-origin fetch should bypass the HTTP cache');
});

test('CACHE was bumped for the files that changed', (t) => {
  const baseline = JSON.parse(read('tests/shell-baseline.json'));
  assert.ok(baseline.files && typeof baseline.files === 'object', 'tests/shell-baseline.json should map each shell file to a hash');

  const changed = [];
  for (const entry of entries) {
    const path = shellPath(entry);
    if (!exists(path)) continue;          // reported by the test above, with a better message
    const was = baseline.files[path];
    if (was && was !== sha(path)) changed.push(path);
  }

  const bumped = cache !== baseline.cache;
  if (changed.length && !bumped) {
    assert.fail(
      `${changed.length} cached file(s) changed but CACHE in sw.js is still ${cache}:\n` +
        changed.map((p) => `    ${p}`).join('\n') +
        `\n  Bump CACHE (mypolemagazine-v__ + 1), then record the new baseline: npm run stamp`,
    );
  }
  if (bumped && changed.length) {
    t.diagnostic(`${changed.length} cached file(s) changed and CACHE moved to ${cache} - record it with: npm run stamp`);
  }
});
