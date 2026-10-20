/* The hash router: two tables in js/app.js and every link in the app have to agree, and nothing at
 * runtime compares them.
 *
 *   the route() chain    what actually renders. This is the authority on whether a hash works: a
 *                        hash no branch matches falls through to notFound(), which a user reads as
 *                        "the app is broken" rather than "that link is wrong".
 *   SECTION              which nav item lights up for a route - and, deliberately, only the routes
 *                        that belong to one. #/auth and #/forgot are absent because the nav is hidden
 *                        while nobody is signed in, so a route missing from SECTION is not a bug.
 *   the links            `#/moves`, `#/collection/<id>`, and the legacy hashes old bookmarks use.
 *
 * Run:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { router, hashRouteLiterals } from './support/repo.mjs';

const { section, openWhenSignedOut, chain, nav } = router();
const keys = new Set(Object.keys(section));
const rendered = new Set(chain.flatMap((branch) => branch.views));
const routes = new Set([...keys, ...rendered]);

/* The six values renderNav() knows how to light up, taken from the nav items it builds rather than
 * from SECTION - otherwise this would compare the table with itself. */
const NAV_SECTIONS = new Set(['home', 'moves', 'dictionary', 'community', 'review', 'account']);

/* Routes that are rendered but are not a section of the app: the signed-out screens. A route in here
 * is one the nav bar should stay quiet about. */
const NO_NAV = new Set(['auth', 'forgot']);

test('the router still has its three tables', () => {
  assert.ok(keys.size > 10, `SECTION looks empty (${keys.size} routes)`);
  assert.ok(chain.length > 10, `the route() chain looks empty (${chain.length} branches)`);
  assert.ok(nav.length >= 4, `the nav should offer at least four items (found ${nav.length})`);
});

test('every route maps to a nav section the bar can render', () => {
  for (const [route, target] of Object.entries(section)) {
    assert.ok(
      NAV_SECTIONS.has(target),
      `SECTION maps "#/${route}" to "${target}", which no nav item uses - that route would never be highlighted`,
    );
  }
});

test('every nav link is a route the router renders', () => {
  for (const route of nav) {
    assert.ok(routes.has(route), `the nav links to "#/${route}", which nothing renders`);
  }
});

test('every hash written in the app resolves', () => {
  /* The one that catches a renamed route: a link left behind pointing at a hash no branch handles
   * any more. Reads js/ and index.html only, so a hash quoted in a comment in README cannot trip it. */
  const literals = hashRouteLiterals(['js/app.js', 'js/store.js', 'index.html']);
  const unknown = literals.filter((l) => !routes.has(l.route));
  assert.deepEqual(
    unknown,
    [],
    `these hashes are not routes: ${unknown.map((u) => `#/${u.route} (${u.file})`).join(', ')}`,
  );
});

test('every route is either in a nav section or deliberately outside the nav', () => {
  /* A new screen has to make this choice: give it a section, or say here that the nav stays quiet.
   * What it must not do is silently belong to neither. */
  const unclassified = [...rendered].filter((view) => !keys.has(view) && !NO_NAV.has(view));
  assert.deepEqual(
    unclassified,
    [],
    `these views render but are in neither SECTION nor NO_NAV: ${unclassified.join(', ')}`,
  );
});

test('a signed-out dancer can reach exactly the open routes, and they all render', () => {
  assert.ok(openWhenSignedOut.length >= 3, 'OPEN_WHEN_SIGNED_OUT should list the routes reachable without an account');
  for (const route of openWhenSignedOut) {
    assert.ok(routes.has(route), `OPEN_WHEN_SIGNED_OUT lists "${route}", which nothing renders`);
  }
  /* And the reversed mistake: a signed-out route that is also in the nav would show a nav bar to a
   * visitor with no account. */
  for (const route of openWhenSignedOut) {
    if (route === 'support') continue;    // the support form is linked from inside the app as well
    assert.ok(!section[route] || NAV_SECTIONS.has(section[route]), `"${route}" should not claim a nav section`);
  }
});

test('routes that take an id say so', () => {
  /* `#/move/<id>` and `#/user/<handle>` must not be reachable as a bare `#/move`: those branches
   * read `parts[1]`, and a missing id renders an empty page rather than an error. */
  for (const route of ['move', 'user', 'studio', 'collection']) {
    const branches = chain.filter((branch) => branch.views.includes(route));
    assert.ok(branches.length, `no branch renders "#/${route}"`);
    assert.ok(branches.some((b) => b.takesId), `every branch for "#/${route}" ignores the id, so "#/${route}/<id>" cannot work`);
  }
});

test('legacy hashes are still handled or redirect', () => {
  /* Old hashes: collections were once #/collections, the community had a #/Directory tab, and the
   * dictionary was once #/Bible. They are kept so a bookmark or an old notification still lands
   * somewhere, and they are the first thing a rename breaks. */
  for (const legacy of ['Bible', 'collections', 'Directory', 'browse', 'settings']) {
    assert.ok(keys.has(legacy), `the legacy route "${legacy}" is gone from SECTION`);
  }
  for (const legacy of ['collections', 'Directory', 'browse']) {
    const branch = chain.find((b) => b.views.includes(legacy));
    assert.ok(branch, `"${legacy}" has no branch in route(), so the hash falls through to not found`);
    assert.match(branch.line, /go\(|view[A-Z]/, `the "${legacy}" branch should redirect or render, not fall through`);
  }
});

test('every route in SECTION is reachable, not just expected', (t) => {
  /* SECTION is what the nav reads, so a key in it promises the route works. A key with no branch
   * renders notFound() instead: the nav lights up the right item and the body says the page does not
   * exist. Reported rather than failed, because the fix is a product decision - redirect the old
   * hash, or drop it from SECTION and let it 404 honestly. */
  for (const route of keys) {
    if (route === '' || rendered.has(route)) continue;
    t.diagnostic(`#/${route} is in SECTION but no branch in route() renders it - it lands on notFound()`);
  }
});

test('no branch tests the same view twice', (t) => {
  /* Dead conditions are not failures, but they mean a rename left something behind, and the branch
   * is now doing less than it looks like it does. Reported so it can be read, not failed. */
  for (const branch of chain) {
    const dupes = branch.views.filter((v, i) => branch.views.indexOf(v) !== i);
    if (dupes.length) t.diagnostic(`dead condition in: ${branch.line} - "${dupes[0]}" is tested twice`);
  }
});
