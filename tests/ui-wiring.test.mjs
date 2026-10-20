/* A button that is drawn but never listened to.
 *
 * This is the quietest bug a single-page app can have: the markup is right, the styles are right, the
 * button looks pressed, and nothing happens. Nothing at runtime complains, there is no console error,
 * and on a phone there is no console to read anyway. The one that shipped was the cross in the
 * add-a-goal panel - `#goal-add-x`, rendered at js/app.js:649 and referenced nowhere else in the file.
 *
 * The rule: a <button> whose behaviour is wired by id must be referenced by that id somewhere else in
 * js/app.js. Buttons wired by a delegated listener (a `data-` attribute on a container, like the
 * journal's entries) are deliberately not covered - they carry no id, and the delegated handler is the
 * thing that makes them work.
 *
 * Run:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './support/repo.mjs';

const src = read('js/app.js');

/* Every id handed to a <button>, in the order they appear, across multi-line markup. */
const buttonIds = [...new Set([...src.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]))];

test('the app still has buttons to check', () => {
  assert.ok(buttonIds.length > 15, `expected the app to render plenty of buttons (found ${buttonIds.length})`);
});

test('every button with an id is wired to something', () => {
  const dead = buttonIds.filter((id) => !src.includes(`#${id}`));
  assert.deepEqual(
    dead,
    [],
    `these buttons are drawn but nothing listens to them: ${dead.map((d) => `#${d}`).join(', ')}`,
  );
});
