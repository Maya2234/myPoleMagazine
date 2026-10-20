/* The manifest, the icons, and the four lines in index.html that have to be right before the first
 * paint.
 *
 * This is the file that decides whether "Add to Home Screen" makes an app or a bookmark, and almost
 * all of it is invisible on a desktop browser: an icon that is 512 in the manifest and 180 on disk,
 * a size declared but not honoured, an alpha channel that only App Review ever looks at. The theme
 * script is here for the same reason - it has to run before the stylesheet, and the key it writes has
 * to match the one js/app.js reads, or a dancer's dark choice is silently forgotten between loads.
 *
 * Run:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, exists, png } from './support/repo.mjs';

const manifest = JSON.parse(read('manifest.webmanifest'));

test('the manifest carries what iOS and the browser read', () => {
  assert.equal(manifest.display, 'standalone', 'without display: standalone the home-screen app opens with Safari chrome');
  assert.equal(manifest.start_url, './', 'start_url should be the app root');
  assert.equal(manifest.scope, './', 'scope should cover the app root');
  assert.ok(manifest.name?.length > 2, 'name is missing');
  assert.ok(manifest.short_name?.length > 2 && manifest.short_name.length <= 12, 'short_name should be short enough for a home screen');
  assert.equal(manifest.orientation, 'portrait', 'the app is a portrait app; the manifest is where that is enforced');
  for (const key of ['background_color', 'theme_color']) {
    assert.match(manifest[key] ?? '', /^#[0-9a-f]{6}$/i, `${key} should be a #rrggbb colour`);
  }
});

test('every icon in the manifest is on disk at the size it claims', () => {
  assert.ok(manifest.icons?.length >= 3, 'the manifest should list at least a 192, a 512 and a maskable icon');

  for (const icon of manifest.icons) {
    assert.ok(exists(icon.src), `the manifest lists ${icon.src}, which is not in the repo`);
    if (icon.sizes === 'any') continue;

    const [w, h] = icon.sizes.split('x').map(Number);
    assert.ok(w > 0 && h > 0, `${icon.src} declares sizes "${icon.sizes}"`);

    const real = png(icon.src);
    assert.equal(real.width, w, `${icon.src} declares ${icon.sizes} but is ${real.width}x${real.height} wide`);
    assert.equal(real.height, h, `${icon.src} declares ${icon.sizes} but is ${real.width}x${real.height} tall`);
  }

  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'Android and Chrome need a 192 and a 512');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'without a maskable icon Android crops the artwork');
});

test('the Apple touch icon is the right size and has no alpha channel', () => {
  const html = read('index.html');
  const href = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
  assert.ok(href, 'index.html should link an apple-touch-icon: iOS falls back to a screenshot of the page without one');
  assert.ok(exists(href), `${href} is not in the repo`);

  const icon = png(href);
  assert.equal(icon.width, icon.height, `${href} should be square`);
  assert.equal(icon.width, 180, `iOS uses 180x180 for a home-screen icon; ${href} is ${icon.width}x${icon.height}`);
  assert.equal(icon.hasAlpha, false, `${href} carries an alpha channel (${icon.colorTypeName}); Apple rejects icons with one`);
});

test('App Store icon gaps, reported rather than failed', (t) => {
  /* These do not break the web app, so they are not failures here - they are the two things that
   * stop an App Store submission, and they need to be visible without being re-discovered. */
  const has1024 = manifest.icons.some((i) => i.sizes === '1024x1024');
  if (!has1024) t.diagnostic('APP STORE: there is no 1024x1024 icon. App Store Connect requires one, with no alpha channel.');

  for (const icon of manifest.icons) {
    if (icon.sizes === 'any') continue;
    const real = png(icon.src);
    if (real.hasAlpha) t.diagnostic(`APP STORE: ${icon.src} has an alpha channel (${real.colorTypeName}); the App Store icon set must be opaque.`);
  }
});

test('the theme is applied before the first paint, and the key matches the app', () => {
  const html = read('index.html');
  const appKey = read('js/app.js').match(/const THEME_KEY = '([^']+)'/)?.[1];
  assert.ok(appKey, 'js/app.js should define THEME_KEY');
  assert.ok(html.includes(`'${appKey}'`), `index.html should read the same localStorage key as js/app.js (${appKey})`);

  const scriptAt = html.indexOf("localStorage.getItem");
  const cssAt = html.indexOf('<link rel="stylesheet"');
  assert.ok(scriptAt > 0 && cssAt > 0, 'both the inline theme script and the stylesheet should be in index.html');
  assert.ok(scriptAt < cssAt, 'the theme has to be set before the stylesheet loads, or a dark-theme dancer sees a white flash');

  const meta = html.match(/<meta name="theme-color" id="theme-color" content="([^"]+)">/);
  assert.ok(meta, 'the theme-color meta needs its id: the inline script and js/app.js both write to it');
});

test('index.html is set up for a phone', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="viewport"[^>]*viewport-fit=cover/, 'viewport-fit=cover is what makes env(safe-area-inset-*) resolve to the notch');
  assert.match(html, /<title>myPoleMagazine<\/title>/, 'the title is the fallback name iOS shows when it cannot read the manifest');
  assert.match(html, /<noscript>/, 'a browser with JavaScript off should be told why nothing happens');
  assert.match(html, /viewport-fit=cover[\s\S]*class="topbar"/, 'the layout should come after the viewport meta');
});
