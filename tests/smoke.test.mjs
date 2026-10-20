/* Smoke: does the app boot from the files that are actually in the folder?
 *
 * A static site fails in three boring ways, and none of them shows up until a phone is holding it:
 * a script with a syntax error that kills the whole page, a path in index.html that points at a file
 * nobody renamed, and an asset whose extension a static host serves as octet-stream so the browser
 * quietly ignores it. This spins a server over the repo and asks it for everything the browser would
 * ask for, in the order the browser asks for it.
 *
 * Run:  npm test          (or: node --test tests/)
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { read, exists, parses, shell, shellPath, MIME, serve } from './support/repo.mjs';

let server;
let base = '';

before(async () => {
  server = createServer(serve());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('every script parses', () => {
  for (const file of ['js/app.js', 'js/store.js', 'js/supabase.js', 'sw.js']) {
    const result = parses(file);
    assert.ok(result.ok, `${file} has a syntax error: ${result.message}`);
  }
});

test('index.html asks for files that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|#|data:|mailto:)/.test(href));

  assert.ok(refs.length >= 4, `index.html should reference its manifest, stylesheet, script and icons (found ${refs.length})`);
  for (const href of refs) assert.ok(exists(href), `index.html references ${href}, which is not in the repo`);
});

test('index.html loads the app as one module', () => {
  const html = read('index.html');
  const modules = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(modules, ['js/app.js'], 'the app should be exactly one module script: js/app.js');
  assert.ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), 'the manifest link is missing');
});

test('a static server serves every file the service worker wants to cache', async () => {
  const entries = shell();
  assert.ok(entries.length > 5, 'the shell list looks empty');

  for (const entry of entries) {
    const path = `/${shellPath(entry)}`;
    const res = await fetch(base + path);
    assert.equal(res.status, 200, `GET ${path} (cache key ${entry}) should be 200`);

    const body = await res.arrayBuffer();
    assert.ok(body.byteLength > 0, `GET ${path} returned an empty body`);

    /* The type a static host derives from the extension. If a file's extension is not in the map a
     * host will serve, the browser is handed octet-stream and refuses to use it. */
    const type = MIME[extname(path)];
    assert.ok(type, `${path} has an extension no static host maps (${extname(path)}) - see MIME in tests/support/repo.mjs`);
    assert.equal(res.headers.get('content-type'), type, `${path} was served as ${res.headers.get('content-type')}`);
  }
});

test('the served root is the app, not a directory listing', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>myPoleMagazine<\/title>/, 'the root should serve index.html');
  assert.match(html, /<main id="app"/, 'the root should serve index.html');
});

test('a path that does not exist is a 404, not the app', async () => {
  /* A host that answers every path with index.html would hide a mistyped asset path behind a page
   * that appears to load. This pins the behaviour the tests above rely on. */
  const res = await fetch(`${base}/icons/nope.png`);
  assert.equal(res.status, 404);
});
