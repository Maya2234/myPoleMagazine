/* The collection page is one screen with three controls that are easy to pull apart later: the
 * pencil beside the title, the bin, and the people icon. None of them is covered by the button-id
 * check alone, because the bugs this file is looking for are about *where* a change happens:
 *
 *   1. a new collection asks for dancers in its Dancers field, with no "share with class" checkbox;
 *   2. renaming happens in the name line itself, not in a second dialog;
 *   3. deleting asks the same question as removing a goal, and keeps the moves;
 *   4. the people icon opens the one box that adds, removes and withdraws collaborators.
 *
 * The app needs a DOM and a Supabase client to import, so these read js/app.js the same way the other
 * tests read it: as the source of the contract between the markup and the handlers beside it.
 *
 * Run:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './support/repo.mjs';

const src = read('js/app.js');

/* One top-level function, up to the next one. The JSDoc before the following function comes along,
 * which is harmless: the assertions below look for names and calls, not for boundaries. */
function body(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `js/app.js no longer has ${name}()`);
  const end = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, end < 0 ? undefined : end);
}

const buttonTag = (page, id) => {
  const tag = page.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
  assert.ok(tag, `the collection head should draw a #${id} button`);
  return tag;
};

test('a new collection invites from its Dancers field, with no sharing checkbox', () => {
  const dialog = body('newCollectionDialog');

  assert.match(dialog, /id="new-collection-add-dancer"/, 'the + that opens the dancer search is gone');
  assert.match(dialog, /id="new-collection-search-input"/, 'the dancer search input is gone');
  assert.match(dialog, /wireDancerSearch\(/, 'the create dialog no longer uses the shared dancer search');
  assert.match(dialog, /store\.inviteToCollection\(/, 'creating with dancers picked no longer sends invitations');

  assert.doesNotMatch(dialog, /type="checkbox"/i, 'the create dialog should not have a sharing checkbox');
  assert.doesNotMatch(dialog, /share with (a )?class/i, 'the old "share with class" question is back');
});

test('the collection head offers inline rename, delete, and sharing', () => {
  const page = body('viewCollection');

  for (const id of ['rename-collection', 'delete-collection', 'share-collection']) {
    const tag = buttonTag(page, id);
    assert.match(tag, /aria-label="[^"]+"/, `#${id} needs an accessible name`);
    assert.match(tag, /title="[^"]+"/, `#${id} needs a tooltip`);
  }

  /* Renaming is the heading turning into an input, not a second dialog. */
  assert.match(page, /<form class="collection-name-edit" id="collection-rename" hidden>/, 'the inline rename form is gone');
  assert.match(page, /renameForm\.elements\.name/, 'the name input is not wired');
  assert.match(page, /store\.renameCategory\(cat\.id, name\)/, 'saving the inline name does not rename the collection');
  assert.doesNotMatch(page, /id="rename-dialog"|id="rename-collection-dialog"/, 'renaming should not open a dialog');

  /* Deleting reuses the confirm sheet, names the consequence, and keeps the moves. */
  assert.match(page, /title: 'Delete this collection\?'/);
  assert.match(page, /body: `“\$\{cat\.name\}” is deleted\. The moves stay\.\$\{warn\}`/);
  assert.match(page, /confirmLabel: 'Delete'/, 'the delete confirmation should name the action');
  assert.match(page, /store\.deleteCategory\(cat\.id\)/, 'the delete button is not wired to deleteCategory');

  /* The people icon is the sharing surface, and changes inside it redraw the page once it closes. */
  assert.match(page, /shareCollectionDialog\(cat, dancers, pending\)/, 'the people icon no longer opens the share box');
  assert.match(page, /if \(changed\) await route\(\{ keepScroll: true \}\)/, 'share changes should refresh the page');
});

test('the old inline Manage and Dancers panels are not left behind', () => {
  const old = /id="(?:edit-collection|collection-manage|share-box|invite-form|share-on|share-off|dancers-box)"|class="(?:collection-manage|share-box)"|data-(?:remove-dancer|cancel-invite)/;
  assert.doesNotMatch(src, old, 'the old inline collection controls are back beside the header icons');
});

test('the share dialog is the one place to invite, remove, and withdraw', () => {
  const dialog = body('shareCollectionDialog');

  assert.match(dialog, /<dialog class="sheet share-sheet" id="share-collection-dialog"/, 'the share overlay is gone');
  assert.match(dialog, /dialog\.showModal\(\)/, 'the share box no longer opens as a dialog');

  for (const id of ['share-collection-search', 'share-collection-results', 'share-members', 'share-waiting-list', 'share-collection-done']) {
    assert.ok(dialog.includes(`id="${id}"`), `the share dialog should draw #${id}`);
  }

  assert.match(dialog, /data-share-remove/, 'members can no longer be removed from the share dialog');
  assert.match(dialog, /store\.removeCategoryMember\(cat\.id, btn\.dataset\.shareRemove\)/, 'member removal is not wired');
  assert.match(dialog, /data-share-cancel/, 'invitations can no longer be withdrawn from the share dialog');
  assert.match(dialog, /store\.cancelInvite\(btn\.dataset\.shareCancel\)/, 'invitation withdrawal is not wired');
  assert.match(dialog, /store\.inviteToCollection\(cat\.id, user\.username\)/, 'the share dialog no longer sends invitations');
  assert.match(dialog, /canRemove && u\.id !== cat\.userId/, 'the owner should not be removable');
});
