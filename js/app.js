/* app.js — router and views.
 *
 * One hash route per screen (#/, #/move/:id, #/dictionary ...). Each view is a
 * function that builds an HTML string and wires up its own events. All data
 * comes from store.js, so nothing here knows where data is kept.
 */
import * as store from './store.js';

/* ---------- tiny templating: values are HTML-escaped unless wrapped as Safe ---------- */

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(fmt).join('');
  if (v instanceof Safe) return v.s;
  return esc(v);
};
const html = (strings, ...vals) =>
  new Safe(strings.reduce((out, str, i) => out + fmt(vals[i - 1]) + str));

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const show = (view) => { app.innerHTML = String(view); };

/* ---------- routing helpers ---------- */

function parseHash() {
  const [path, qs] = (location.hash.replace(/^#/, '') || '/').split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}
const go = (hash) => (location.hash === hash ? route() : (location.hash = hash));

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), isError ? 4000 : 2400);
}
const attempt = async (fn) => {
  try { return await fn(); } catch (err) { toast(err.message, true); return undefined; }
};

/* ---------- light, dark, or follow the device ---------- */

/* A device preference rather than account data, so it lives in localStorage and needs no round
 * trip: the inline script in index.html reads the same key before the first paint, which is what
 * stops a dancer who chose dark from seeing a white flash on every load. Change the key here and you
 * must change it there too. */
const THEME_KEY = 'mypolemagazine-theme';
const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const systemPrefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/* Anything unrecognised - a stale value, or a browser with localStorage switched off - falls back to
 * following the device rather than to a blank screen. */
function themePref() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.value === saved) ? saved : 'system';
  } catch { return 'system'; }
}

/* Writes the choice to the document, remembers it, and keeps the browser's own chrome in step through
 * the theme-color meta tag - the one part of the theme the stylesheet cannot reach. */
function applyTheme(value) {
  const pref = THEMES.some((t) => t.value === value) ? value : 'system';
  const root = document.documentElement;
  /* No attribute at all means "the stylesheet's media query decides", which is exactly what system
   * means; the CSS is written to read it that way. */
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* private mode; the choice just won't stick */ }
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark());
  $('#theme-color')?.setAttribute('content', dark ? '#08080a' : '#ffffff');
}

/* ---------- shared bits ---------- */

/* Passed as the level of a trick nobody has rated: it draws the Unrated pill instead of the dashes. */
const UNRATED = 'unrated';

/* A dancer's own 1-5 rating, as five pink dashes and nothing else. The dashes are the whole reading:
 * they say where the move sits in the scale without a word next to them, which is what lets one line
 * hold a name, a level and a status at once. The written level is still there for anybody who asks -
 * as the tooltip when the dashes are hovered, and in the accessible name - so nothing is lost, it is
 * only no longer said twice. */
const diffMeter = (n) => {
  if (n === UNRATED) return html`<span class="diff-unrated" title="Nobody has rated this trick yet">Unrated</span>`;
  const value = Math.min(5, Math.max(1, Number(n) || 3));
  const label = store.difficultyLabel(value);
  const said = `Difficulty ${value} of 5: ${label}`;
  return html`<span class="diff" role="img" aria-label="${said}" title="${said}">
    <span class="diff-dots" aria-hidden="true">${
      [1, 2, 3, 4, 5].map((i) => html`<i class="${i <= value ? 'on' : ''}"></i>`)}</span>
  </span>`;
};

/* Where a move has got to, in the words a dancer reads. Not Started is the state of a move nobody has
 * said anything about yet, and it is a real answer rather than a blank: every move has one of the
 * three. */
const statusValue = (value) =>
  (store.STATUSES.find((s) => s.value === value) ?? store.STATUSES[0]).value;

/* The status of one move, as a dropdown that is also the place the status is read: it paints itself in
 * the colour of the answer it is showing, so a card says where the move has got to and changing it is
 * one click in the same spot. It writes the moment it changes - there is no Save button to forget -
 * and the screen redraws, which is what keeps the colour in step with the value. */
const statusSelect = (move) => html`
  <label class="status-pick status-${statusValue(move.status)}">
    <span class="sr-only">Where ${move.name} has got to</span>
    <select data-status="${move.id}" aria-label="Where ${move.name} has got to">
      ${store.STATUSES.map((s) => html`<option value="${s.value}"
        ${statusValue(move.status) === s.value ? raw('selected') : ''}>${s.label}</option>`)}
    </select>
  </label>`;

/* Wires every status dropdown a screen has drawn. The store writes the new value, then the screen
 * redraws itself: the dropdown paints itself in the colour of the answer, so a value that changed
 * without a redraw would be showing the wrong colour. `moves` is what the selectors were drawn for,
 * used only to name the move in the toast. */
function wireStatusSelects(moves) {
  $$('[data-status]').forEach((sel) => sel.addEventListener('change', () => attempt(async () => {
    const move = moves.find((m) => m.id === sel.dataset.status);
    await store.setStatus(sel.dataset.status, sel.value);
    const label = (store.STATUSES.find((s) => s.value === sel.value) ?? {}).label ?? '';
    toast(move ? `${move.name} is now ${label.toLowerCase()}.` : 'Status saved.');
    await route({ keepScroll: true });
  })));
}

/* One trick or move, previewed. Every list that shows a preview draws it through here, so the name,
 * the level beside it, the line underneath and the action on the right are one shape on the Moves
 * page, in the Current goals window, in the Dictionary and in the Community feed - the same shape a
 * dancer learns once. What differs between the screens is what goes in the slots: a status badge and
 * a dropdown here, a "Pending" mark and an add button there. */
const trickPreview = ({ href, name, mark = '', difficulty = null, badge = '', alias = '',
  detail = '', extra = '', actions = '', actionsInHead = false }) => {
  /* An empty slot arrives as '', as null, or as an empty list of chips - all three mean "nothing
   * here", and a slot that is filled with nothing would leave a gap under the name. */
  const blank = (v) => v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length);
  return html`<div class="trick-card">
    <div class="trick-head">
      <h3 class="trick-name">${href
        ? html`<a class="entry-link" href="${href}">${name}</a>`
        : name}${mark}</h3>
      <span class="trick-tail">
        ${difficulty === null ? '' : html`<span class="trick-level">${diffMeter(difficulty)}</span>`}
        ${badge}
        <!-- The one control that belongs to the name it sits beside - "add this trick" - rides with
             the name rather than under it, which is where the dictionary puts it. Nothing else goes
             up here: a status and a Remove button are what you do to a move you already have, and
             they read as the second half of the card. -->
        ${actionsInHead && !blank(actions) ? actions : ''}
      </span>
    </div>
    ${blank(alias) ? '' : html`<p class="trick-alias">also called “${alias}”</p>`}
    ${blank(detail) ? '' : html`<p class="trick-detail">${detail}</p>`}
    ${extra}
    ${!actionsInHead && !blank(actions) ? html`<div class="trick-actions">${actions}</div>` : ''}
  </div>`;
};

/* Plus, check and camera, drawn with the same stroke as the pencil so every icon button reads as one set. */
const plusIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 5v14M5 12h14"/></svg>`;
const searchIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
const checkIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/></svg>`;
const cameraIcon = html`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

/* The collection pencil. Renaming and deleting live behind it so they are not the first thing a
 * dancer sees when they open a collection. */
const pencilIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z"/><path d="M14.5 5.5l4 4"/></svg>`;

/* A head and shoulders, drawn with the same stroke as the pencil so the two icons match. It stands
 * in for the word "Account" in the navigation, which is why the link that carries it names itself
 * with aria-label: nothing here is readable by voice. */
const profileIcon = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="8" r="3.75"/><path d="M4.75 20.5a7.25 7.25 0 0 1 14.5 0"/></svg>`;

/* The gear that stands for Settings on the profile page. Feather's settings glyph, drawn with the
 * same stroke as the pencil and the profile head so the three read as one set. */
/* Feather's help-circle and chevron-right, drawn with the same stroke as the gear, the pencil and
 * the profile head, so every icon in the app reads as one set. */
const supportIcon = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.9 2.4-2.9 2.4"/>
  <path d="M12 16.4h.01"/></svg>`;
/* Up and down, for the order of a dancer's own list of studios: the top row is the one a profile
 * shows, so the arrows are how that row is chosen. Drawn with the same stroke as the rest. */
const arrowUpIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
const arrowDownIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`;

const chevronIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 18 6-6-6-6"/></svg>`;

/* The cross in the corner of a panel that opened in place: the add-a-goal panel is closed with it.
 * Drawn with the same stroke as the pencil and the chevron so it belongs to the same set. */
const crossIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

const settingsIcon = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const dateText = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
/* Resolves to a Map so views can look up a collection name by id after awaiting it. */
const catMap = async (userId) => new Map((await store.listCategories(userId)).map((c) => [c.id, c.name]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/* Names come from the database in whatever case a dancer typed, so "admin spin" and "Admin Spin"
 * sort together instead of by character code. */
const compareNames = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/* The one back control in the app: a small button, the same shape as every other button here, at the
 * top of the screen it returns from. `href` is always a real screen rather than history.back(), so a
 * visitor who followed a link into the middle of the app is not dropped out of it (see backTo). */
const backLink = (href, label) => html`<a class="btn small page-back" href="${href}" aria-label="${label}" title="${label}">←</a>`;

/* Joins the parts of a one-line fact - "Poler since 2021 · Studio 54 — Leeds" - with the separator
 * a profile line uses. A part may be plain text or markup, so this answers a fragment rather than a
 * string, and a caller asks for `.length` rather than trusting an array to be falsy when empty. */
const joinText = (bits) => bits.flatMap((bit, i) => (i ? [' · ', bit] : [bit]));

/* A studio's name, linked to the page that says who trains there. */
const studioLink = (studio) =>
  html`<a class="quiet-link" href="#/studio/${studio.id}">${store.studioLabel(studio)}</a>`;

/* The rest of somebody's studios, behind a "+N" that opens where it sits. A dancer may list several
 * places they train (supabase/home-studios.sql) and a one-line profile fact has room for one of them,
 * so the others are folded away rather than dropped - a native <details>, so it works from the
 * keyboard and closes on Escape the way the follow lists do. */
const studioMore = (rest) => html`<span class="studio-more" tabindex="0"
  aria-label="Also trains at ${rest.map((s) => store.studioLabel(s)).join(', ')}">
  <span class="studio-more-count" aria-hidden="true">+${rest.length}</span>
  <span class="studio-more-panel"><span class="studio-more-box">${rest.map((s) => html`<span class="studio-more-item">${studioLink(s)}</span>`)}</span></span>
</span>`;

/* An Instagram account, as a link out. The stored value is the bare handle (see readInstagram in
 * store.js), so the address is built there and nothing here has to know its shape. */
const instagramLink = (handle) => html`<a class="chip" href="${store.instagramUrl(handle)}"
  target="_blank" rel="noopener noreferrer">@${handle}</a>`;

/* ---------- avatars ---------- */

/* A stable yes or no for a name, so a letter avatar always picks the same one of the two loud brand
 * colours and a list of names does not read as the same disc repeated. */
function avatarAlt(text) {
  let sum = 0;
  for (const ch of String(text ?? '')) sum += ch.codePointAt(0);
  return sum % 2 === 1;
}

/* The pleaser they picked, or their initial on a brand colour when they have not picked one.
 * `user` may be missing fields - this is also used for a half-built profile on the picker. */
function avatarOf(user, cls = '') {
  /* Only an avatar this build ships draws a file. Anything else - a preset that was removed, or a
   * hand-edited row - falls back to the letter instead of showing a broken image. */
  const src = store.avatarSrc(user?.avatar);
  if (src) {
    /* The hand-drawn pleasers are dark artwork, so they sit on a light disc; anything else, a photo
     * for instance, fills the circle. */
    const art = src.endsWith('.svg') ? ' avatar-art' : '';
    return html`<img class="avatar${art} ${cls}" src="${src}" alt="" loading="lazy"
      width="96" height="96">`;
  }
  const name = String(user?.username ?? '?');
  return html`<span class="avatar avatar-letter ${cls}${avatarAlt(name) ? ' alt' : ''}"
    aria-hidden="true">${name.trim().charAt(0).toUpperCase() || '?'}</span>`;
}

/* The members who logged a trick, as up to three mini avatars with a count for the rest. Draws
 * nothing at all when nobody has logged it, so an unused trick shows no empty row. */
const LOGGERS_SHOWN = 3;
function loggerRow(users) {
  if (!users.length) return '';
  const shown = users.slice(0, LOGGERS_SHOWN);
  const extra = users.length - shown.length;
  return html`<span class="loggers">
    <span class="sr-only">Logged by ${plural(users.length, 'dancer')}</span>
    ${shown.map((u) => html`<a class="logger" href="#/user/${u.id}" title="${u.username}"
      aria-label="${u.username}">${avatarOf(u, 'avatar-xs')}</a>`)}
    ${extra ? html`<span class="logger-more">+${extra}</span>` : ''}
  </span>`;
}

/* One row of a follow list: face, name, and a button. The same shape the members tab uses, so a face
 * reads the same way in both places. `canRemove` swaps the follow button for the one only the owner
 * of the profile may use: taking a follower off, which deletes the follow pointing at them rather
 * than one they made. */
const personRow = (u, canRemove = false) => {
  const following = store.isFollowing(u.id);
  return html`<li class="row">
    <a class="feed-who" href="#/user/${u.id}">${avatarOf(u, 'avatar-sm')}</a>
    <div class="row-main">
      <strong><a class="entry-link" href="#/user/${u.id}">${u.username}</a></strong>
      ${u.polingSince ? html`<span class="muted">Poler since ${u.polingSince}</span>` : ''}
    </div>
    ${!store.socialEnabled() ? '' : html`<div class="actions">
      ${canRemove ? html`<button type="button" class="btn small danger"
        data-remove-follower="${u.id}">Remove</button>` : html`<button type="button"
        class="btn small ${following ? '' : 'primary'}" data-follow="${u.id}"
        aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>`}
    </div>`}
  </li>`;
};

/* Which bar is open. Kept by name rather than by element, because a follow redraws the page and a
 * new element is built each time - without this the list you clicked in would snap shut mid-use. */
const openBars = new Set();

/* A bar's list sits over the page, so clicking anywhere else or pressing Escape puts it away, the
 * way any dropdown is dismissed. Registered here, once, rather than inside the wiring below: that
 * runs on every render, and a document listener added each time would pile up. */
const closeFollowBars = () => {
  openBars.clear();
  $$('.follow-bar').forEach((bar) => { bar.open = false; });
};
document.addEventListener('click', (e) => { if (!e.target.closest('.follow-bars')) closeFollowBars(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFollowBars(); });

/* The follow lists as bars beside the name in a page head: Followers, Friends, Following, each with
 * its count and each dropping down its list when opened. An empty list still opens, to say what the
 * list means and how to fill it - a bar that is there and empty is findable, which the old version
 * (sections that drew only when somebody was in them) was not.
 *
 * Friends point at each other; Following holds the members this account follows that have not
 * followed back, which is why it says so - without the note it reads as though someone is missing.
 * Followers is drawn on both kinds of profile: it is a count anyone can read, and the only part of it
 * that is not is the button, since removing a follower is an action only the owner of the profile
 * may take. All three carry their own count, which is why the head has no second line repeating the
 * totals - the bars are those totals.
 *
 * The two outbound lists are halves of the same set, so nobody appears in both. Followers is the
 * inbound set, so a friend of yours does appear in Followers as well as Friends - that is what a
 * follower is. */
/* The one line under a name: how long they have been a poler, and where they train. The studio
 * carries its own city (see studioLabel), so a studio that has one says so here and there is no
 * second place to keep a city in step with it. Either half may be missing. */
function placeLine(user) {
  const studios = store.studiosOf(user);
  return joinText([
    user.polingSince ? `Poler since ${user.polingSince}` : '',
    studios.length ? html`${studioLink(studios[0])}${studios.length > 1 ? studioMore(studios.slice(1)) : ''}` : '',
  ].filter(Boolean));
}

function followBars(lists, { own = false } = {}) {
  if (!lists) return '';
  const bar = (title, people, { note = '', canRemove = false, empty }) => html`
    <details class="follow-bar" data-bar="${title}" ${openBars.has(title) ? raw('open') : ''}>
      <summary><span>${title}</span><span class="count">${people.length}</span></summary>
      <div class="follow-panel">
        ${note ? html`<p class="muted subnote">${note}</p>` : ''}
        ${people.length
          ? html`<ul class="list">${people.map((u) => personRow(u, canRemove))}</ul>`
          : html`<p class="muted">${empty}</p>`}
      </div>
    </details>`;
  return html`<div class="follow-bars">
    ${bar('Followers', lists.followers, {
      note: own
        ? 'members who follow you. Removing one takes their follow back off; they can follow you again.'
        : 'members who follow them.',
      /* The button is the profile owner's, so somebody looking at another dancer's profile reads the
       * list and nothing more. */
      canRemove: own,
      empty: own ? 'Nobody follows you yet.' : 'Nobody follows them yet.',
    })}
    ${bar('Friends', lists.friends, {
      empty: 'No friends yet. When you and another dancer follow each other, they appear here.',
    })}
    ${bar('Following', lists.following, {
      note: 'members this account follows who have not followed back yet.',
      empty: own
        ? 'You are not following anyone yet. Find members on the Community tab.'
        : 'Not following anyone yet.',
    })}</div>`;
}

/* Every follow list and the members tab draw the same two controls, so they share their wiring: do
 * the thing, say so, then redraw whichever screen drew the button. */
function wireFollowActions(refresh) {
  /* <details> opens itself. This only keeps it to one bar at a time and remembers which, so the
   * redraw after a follow leaves that bar open. */
  $$('.follow-bar').forEach((bar) => bar.addEventListener('toggle', () => {
    if (bar.open) {
      openBars.add(bar.dataset.bar);
      $$('.follow-bar').forEach((other) => { if (other !== bar) other.open = false; });
    } else {
      openBars.delete(bar.dataset.bar);
    }
  }));
  $$('[data-follow]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    const id = btn.dataset.follow;
    const wasFollowing = store.isFollowing(id);
    if (wasFollowing) await store.unfollow(id);
    else await store.follow(id);
    toast(wasFollowing ? 'Unfollowed.' : `You follow ${store.usernameOf(id)}.`);
    await refresh();
  })));
  $$('[data-remove-follower]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    const id = btn.dataset.removeFollower;
    await store.removeFollower(id);
    toast(`${store.usernameOf(id)} no longer follows you.`);
    await refresh();
  })));
}

/* A move card: the shared preview inside the link that makes the whole card tappable. Used on the
 * Moves page and under a profile's own list of moves. The collections are the line underneath, and
 * are left out rather than drawn empty when a move is in none. */
const moveCard = (m, names = new Map()) => {
  const tags = m.categoryIds.map((id) => names.get(id)).filter(Boolean);
  return html`<a class="card" href="#/move/${m.id}">
    ${trickPreview({
      name: m.name,
      difficulty: m.difficulty,
      detail: tags.map((n) => html`<span class="tag">${n}</span>`),
    })}
  </a>`;
};

function setTitle(text) {
  document.title = text ? `${text} · myPoleMagazine` : 'myPoleMagazine';
}

/* ---------- navigation bar ---------- */

function renderNav(section) {
  const nav = $('#nav');
  const me = store.currentUser();
  nav.hidden = !me;
  if (!me) return;
  const items = [
    ['home', '#/', 'Home'],
    ['moves', '#/moves', 'Moves'],
    ['dictionary', '#/dictionary', 'Dictionary'],
    ['community', '#/community', 'Community'],
  ];
  if (me.isAdmin) items.push(['review', '#/review', 'Review']);
  items.push(['account', '#/account', 'Account', profileIcon]);
  const pending = store.pendingCount();
  nav.innerHTML = items.map(([key, href, label, icon]) => {
    const here = key === section ? raw('aria-current="page"') : '';
    const pill = key === 'review' && pending ? html`<span class="pill">${pending}</span>` : '';
    /* An item with an icon shows only the icon, so the label moves into an accessible name. */
    return icon
      ? String(html`<a class="icon-only" href="${href}" ${here} aria-label="${label}" title="${label}">${icon}${pill}</a>`)
      : String(html`<a href="${href}" ${here}>${label}${pill}</a>`);
  }).join('');
  nav.insertAdjacentHTML('beforeend', '<button type="button" class="journal-open" id="journal-open" aria-haspopup="dialog">Journal</button>');
  mountJournal();
}
const raw = (s) => new Safe(s);

/* ---------- router ---------- */

/* The screen on show, and the one it was reached from, so a Back button can go somewhere real.
 * Deliberately not history.back(): a screen opened from a bookmark or a link has nothing of ours
 * behind it, and going back would drop the visitor out of the app entirely. */
let screenHash = '';
let cameFromHash = '';
const backTo = (fallback) => (cameFromHash && cameFromHash !== screenHash ? cameFromHash : fallback);

const SECTION = {
  '': 'home', home: 'home', moves: 'moves', move: 'moves',
  collections: 'moves', collection: 'moves',   // collections live on the Moves page now
  dictionary: 'dictionary', Bible: 'dictionary',   // #/Bible was this section's route before the rename
  community: 'community', Directory: 'community', browse: 'community', user: 'community',
  studio: 'community',   // a studio page is reached from the Community tab, so that stays lit
  review: 'review', account: 'account',
  reset: 'account',     // the set-a-new-password screen; it has no nav item of its own
  settings: 'account',  // reached from the Account page, so Account stays the lit nav item
  support: 'account',
};

/* Screens somebody with no session still has to reach: logging in, the two password ones, and
 * support. A reset link signs the dancer in, but a forgotten password starts signed out - and
 * somebody who cannot get into their account is exactly who needs to write to us. */
const OPEN_WHEN_SIGNED_OUT = ['auth', 'forgot', 'reset', 'support'];

async function route({ keepScroll = false } = {}) {
  const { parts, query } = parseHash();
  const me = store.currentUser();   // synchronous: the store caches the loaded profile

  /* Remember how we got here, for whatever Back button this screen renders. */
  const hash = location.hash || '#/';
  if (hash !== screenHash) { cameFromHash = screenHash; screenHash = hash; }

  if (!me && !OPEN_WHEN_SIGNED_OUT.includes(parts[0] ?? '')) return go('#/auth');
  if (me && parts[0] === 'auth') return go('#/');

  /* The profile editor is a short-lived form on one screen, so leaving Account closes it - and takes
   * the studio list being reordered with it, which is why that is state here rather than a screen. */
  if (SECTION[parts[0] ?? ''] !== 'account') { openEditor = null; studioDraft = null; }

  /* The add-a-move panel belongs to the screen it was opened on: a fresh visit (a link, Back, or a tile)
   * starts closed. Redraws of the same screen pass keepScroll and keep it open. */

  renderNav(SECTION[parts[0] ?? ''] ?? '');

  try {
    const [view, a, b] = parts;
    if (!view || view === 'home') await viewHome();
    else if (view === 'moves') await viewMoves();
    else if (view === 'auth') viewAuth();
    else if (view === 'forgot') viewForgot();
    else if (view === 'reset') viewReset();
    else if (view === 'move' && a === 'new') await viewMoveForm(null, query);
    else if (view === 'move' && b === 'edit') await viewMoveForm(a, query);
    else if (view === 'move' && a) await viewMove(a);
    else if (view === 'collections') return go('#/moves');   // old link: collections are on the Moves page
    else if (view === 'collection' && a) await viewCollection(a);
    else if ((view === 'dictionary' || view === 'dictionary') && a) await viewEntry(a);
    else if (view === 'dictionary' || view === 'dictionary') await viewdictionary();
    else if (view === 'community') await viewCommunity(query);
    else if (view === 'Directory' || view === 'browse') return go('#/community?tab=members');
    else if (view === 'user' && a) await viewUser(a);
    else if (view === 'studio' && a) await viewStudio(a);
    else if (view === 'review') await viewReview();
    else if (view === 'account') await viewAccount();
    else if (view === 'settings') viewSettings();
    else if (view === 'support' && a === 'inbox') await viewSupportInbox();
    else if (view === 'support') viewSupport();
    else notFound();
  } catch (err) {
    console.error(err);
    show(html`<div class="empty"><h3>Something went wrong</h3><p>${err.message}</p>
      <a class="btn" href="#/">Back to my goals</a></div>`);
  }

  if (!keepScroll) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
}

function notFound(message = 'That page does not exist.') {
  setTitle('Not found');
  show(html`<div class="empty"><h3>Not found</h3><p>${message}</p>
    <a class="btn" href="#/">Back to my goals</a></div>`);
}

/* ---------- view: login / register ---------- */

let authMode = 'login';
let authEmail = '';   // kept so switching between the two forms doesn't lose what was typed

function viewAuth() {
  setTitle(authMode === 'login' ? 'Log in' : 'Create account');
  const isLogin = authMode === 'login';
  show(html`
    <section class="auth">
      <h1 class="brand-lg"><em>my</em>PoleMagazine</h1>
      <p class="lede">Log your moves, track your progress, standarize naming across the community.</p>
      <div class="seg" role="group" aria-label="Log in or create an account">
        <button type="button" class="seg-btn" data-mode="login" aria-pressed="${isLogin}">Log in</button>
        <button type="button" class="seg-btn" data-mode="register" aria-pressed="${!isLogin}">Create account</button>
      </div>
      <form class="form" id="auth-form">
        ${isLogin ? '' : html`<label class="field"><span>Username</span>
          <input type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="24" required>
          <small>3-24 characters: letters, numbers, dots, dashes or underscores</small></label>`}
        <label class="field"><span>Email</span>
          <input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${authEmail}" required></label>
        <label class="field"><span>Password</span>
          <input type="password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="6" required></label>
        <button class="btn primary block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
      </form>
      <p class="muted fineprint" style="text-align:center">
        ${isLogin ? html`<a href="#/forgot">Forgot your password?</a> · ` : ''}<a
          href="#/support">Need help?</a></p>
    </section>`);

  $$('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
    authMode = btn.dataset.mode;
    viewAuth();
  }));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (authMode === 'login') {
        await store.login(data.get('email'), data.get('password'));
      } else {
        authEmail = String(data.get('email') ?? '').trim();
        const { needsConfirmation } = await store.register(authEmail, data.get('username'), data.get('password'));
        /* Not an error: the account was created, it just has no session until the link is clicked. */
        if (needsConfirmation) {
          authMode = 'login';
          viewAuth();
          toast('Account created. Check your email for the confirmation link, then log in.');
          return;
        }
      }
      go('#/');
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

/* ---------- views: forgotten password, and setting a new one ---------- */

/* What the last reset request was sent to, so the screen can name it instead of asking again. Kept
 * out of the URL: it is one screen's memory, not a route. */
let forgotSentTo = '';

/* Asks for the email. Whatever happens, the screen reports the same thing, because Supabase answers
 * the same way for an address that has no account here - and the app should not undo that. */
function viewForgot() {
  setTitle('Reset your password');
  const sent = forgotSentTo;

  show(html`
    <section class="auth">
      <h1 class="brand-lg"><em>my</em>PoleMagazine</h1>
      ${sent ? html`
        <p class="lede">If <strong>${sent}</strong> has an account here, a link to set a new password
          is on its way. It can take a minute or two - do check the spam folder.</p>
        <p class="muted fineprint">The link brings you back to this app to choose the password. It can
          only be used once, and it is worth using soon after it arrives.</p>
        <a class="btn block" href="#/auth">Back to log in</a>` : html`
        <p class="lede">Forgot the password? Enter the email address you registered with and we will
          send a link to set a new one.</p>
        <form class="form" id="forgot-form">
          <label class="field"><span>Email</span>
            <input type="email" name="email" autocomplete="email" autocapitalize="none"
              spellcheck="false" required></label>
          <button class="btn primary block" type="submit">Send the link</button>
        </form>
        <p class="muted fineprint" style="text-align:center"><a href="#/auth">Back to log in</a></p>`}
    </section>`);

  $('#forgot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await store.requestPasswordReset(data.get('email'));
      forgotSentTo = String(data.get('email') ?? '').trim();
      viewForgot();
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

/* The screen a reset link lands on. It needs the session the link carried, so a stale or already-used
 * link is a real possibility rather than an edge case, and says so instead of showing a form that
 * could not save. */
function viewReset() {
  setTitle('Set a new password');
  const me = store.currentUser();

  show(html`
    <section class="auth">
      <h1 class="brand-lg"><em>my</em>PoleMagazine</h1>
      ${me ? html`
        <p class="lede">${me.username}, choose a new password. You are already logged in, so this is
          the only step.</p>
        <form class="form" id="reset-form">
          <label class="field"><span>New password</span>
            <input type="password" name="password" autocomplete="new-password" minlength="6" required>
            <small>At least 6 characters.</small></label>
          <label class="field"><span>Type it again</span>
            <input type="password" name="confirm" autocomplete="new-password" minlength="6" required></label>
          <button class="btn primary block" type="submit">Save the new password</button>
        </form>` : html`
        <p class="lede">That reset link has expired, or it has already been used.</p>
        <a class="btn primary block" href="#/forgot">Send a new link</a>`}
      <p class="muted fineprint" style="text-align:center"><a href="#/auth">Back to log in</a></p>
    </section>`);

  $('#reset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    /* Checked here rather than in the store: what went wrong is a typo in one of two boxes, which is
     * a thing to say on the screen, not an error from the database. */
    if (data.get('password') !== data.get('confirm')) {
      toast('The two passwords are not the same.', true);
      return;
    }
    const button = e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await store.updatePassword(data.get('password'));
      toast('Password changed. You are logged in.');
      go('#/');
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

/* ---------- view: home (current goals) ---------- */

/* The add panel is the same for every collection of your own: Current goals opens it, and so does each
 * collection, and it adds the same three sources to whichever one it was opened from. It opens as an
 * overlay (`goalPanel` says which collection, or null while closed). */
let goalPanel = null;           // { target, where } while the overlay is open, else null
let goalSource = 'move';        // which of the three sources the rail is showing
let goaldictionaryQuery = '';

/* The three sources, named in a rail beside the panel. Nothing is hidden behind a click, and the panel
 * is only as tall as the source being used. `move` first because it needs nothing typed. */
const GOAL_SOURCES = [
  { value: 'move', label: 'One of my moves' },
  { value: 'dictionary', label: 'A trick from the dictionary' },
  { value: 'new', label: 'A move that is not in the dictionary' },
];

/* What the panel needs, loaded only while it is open: the moves not yet in the collection it adds to,
 * every dictionary entry, and which of those the dancer already logs as one of their moves. */
async function loadAddPanel(moves, target) {
  return {
    spare: moves.filter((m) => !m.categoryIds.includes(target.id)),
    entries: await store.listEntries(),
    linked: new Map(moves.filter((m) => m.dictEntryId).map((m) => [m.dictEntryId, m])),
  };
}

/* The panel's markup. `target` is the collection a move lands in. */
function addPanelHtml(target, spare) {
  const verb = target.isDefault ? 'Add to goals' : 'Add to collection';
  /* Each source is built from the same data, and the rail redraws the page rather than swapping one
   * panel in place, so the sources cannot drift out of step with the list above them. A source that
   * cannot help says so in its own panel rather than being taken off the rail. */
  const sourcePanel = () => {
    if (goalSource === 'dictionary') {
      return html`<section class="goal-source-block">
        <input type="search" id="goal-dictionary-q" placeholder="Search the dictionary"
          aria-label="Search the dictionary" value="${goaldictionaryQuery}">
        <div class="stack" id="goal-dictionary-list"></div>
      </section>`;
    }
    if (goalSource === 'new') {
      return html`<section class="goal-source-block">
        <p class="muted">A move of your own that the dictionary does not know about yet. Adding it
          here logs it as one of your moves and puts it in this list.</p>
        <div class="actions">
          <button type="button" class="btn primary" id="goal-new-move">Fill in a new move</button>
        </div>
      </section>`;
    }
    return html`<section class="goal-source-block">
      ${spare.length ? html`
        <form class="inline-form" id="add-goal">
          <select name="move" aria-label="Pick one of your moves">
            ${spare.map((m) => html`<option value="${m.id}">${m.name}</option>`)}
          </select>
          <button class="btn primary" type="submit">${verb}</button>
        </form>` : html`
        <p class="muted">Nothing to pick from: every move you have logged is already here.</p>`}
    </section>`;
  };

  return html`
    <div class="goal-add" id="goal-add">
      <!-- The way out is a cross in the corner of the box. -->
      <button type="button" class="panel-x" id="goal-add-x"
        aria-label="Close the add-a-goal panel" title="Close">${crossIcon}</button>
      <div class="goal-add-grid">
        <div class="goal-sources" role="group" aria-label="Where the new move comes from">
          ${GOAL_SOURCES.map((s) => html`
            <button type="button" class="goal-source-btn" data-goal-source="${s.value}"
              aria-pressed="${goalSource === s.value}">${s.label}</button>`)}
        </div>
        ${sourcePanel()}
      </div>
    </div>`;
}

/* The overlay the panel lives in. It sits on the body, outside the page, so redrawing the page behind it
 * does not close it. Closing it - the cross, Escape, or a finished move - refreshes the page behind. */
function goalDialog() {
  let dialog = $('#goal-dialog');
  if (!dialog) {
    document.body.insertAdjacentHTML('beforeend',
      '<dialog class="sheet goal-sheet" id="goal-dialog" aria-labelledby="goal-dialog-title"></dialog>');
    dialog = $('#goal-dialog');
    dialog.addEventListener('close', () => {
      dialog.innerHTML = '';
      goalPanel = null;
      route({ keepScroll: true });
    });
  }
  return dialog;
}

/* Draws the panel from fresh data into the overlay. */
async function drawGoalPanel() {
  if (!goalPanel) return;
  const { target, where } = goalPanel;
  const moves = await store.listMoves(store.currentUser().id);
  const data = await loadAddPanel(moves, target);
  const title = target.isDefault ? 'Add to current goals' : 'Add to collection';
  goalDialog().innerHTML = String(html`<h2 id="goal-dialog-title">${title}</h2>${addPanelHtml(target, data.spare)}`);
  wireAddPanel(target, where, data);
}

/* After a change the overlay redraws its own list and the page behind it refreshes. */
async function afterGoalChange() {
  await drawGoalPanel();
  await route({ keepScroll: true });
}

/* Opens the overlay for one collection. */
async function openGoalPanel(target, where) {
  goalPanel = { target, where };
  const dialog = goalDialog();
  await drawGoalPanel();
  if (!dialog.open) dialog.showModal();
}

/* Wires the panel once it is on the page. `where` names the collection in the toasts. */
function wireAddPanel(target, where, { spare, entries, linked }) {
  const addWord = target.isDefault ? 'Add as goal' : 'Add to collection';

  /* Adding a trick puts a move you already had into the collection, or logs the trick as a new move
   * named after it, already linked to the dictionary entry. */
  const addFromDictionary = (entryId) => attempt(async () => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const mine = linked.get(entry.id);
    if (mine) {
      await store.addToCategory(mine.id, target.id);
      toast(`${entry.name} is in ${where}.`);
    } else {
      await store.saveMove({ name: entry.name, status: 'goal', difficulty: 3, dictEntryId: entry.id, categoryIds: [target.id] });
      toast(`${entry.name} added. Open it to add entries, exits and notes.`);
    }
    await afterGoalChange();
  });

  /* Drawn on its own so typing in the search box does not redraw the page and lose the focus. */
  const drawdictionary = () => {
    const list = $('#goal-dictionary-list');
    if (!list) return;
    /* Searched the same way the dictionary's own box searches it, nicknames included. */
    const rows = entries.filter((e) => entryMatch(e, goaldictionaryQuery).matches);
    list.innerHTML = rows.length ? rows.map((e) => {
      const mine = linked.get(e.id);
      const already = mine ? mine.categoryIds.includes(target.id) : false;
      return String(html`<div class="card">${trickPreview({
        href: `#/dictionary/${e.id}`,
        name: e.name,
        alias: entryMatch(e, goaldictionaryQuery).alias,
        detail: already ? `Already in ${where}`
          : mine ? `You already log this as “${mine.name}”` : 'Not in your moves yet',
        actions: already ? ''
          : html`<button type="button" class="btn small primary" data-goal-entry="${e.id}">${addWord}</button>`,
      })}</div>`);
    }).join('') : String(html`<div class="empty"><p>No tricks match that.</p></div>`);
    $$('[data-goal-entry]').forEach((btn) => btn.addEventListener('click', () => addFromDictionary(btn.dataset.goalEntry)));
  };

  $('#goal-new-move')?.addEventListener('click', () => attempt(async () => {
    goalDialog().close();
    await openMoveDialog(target);
  }));
  $('#add-goal')?.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      await store.addToCategory(new FormData(e.target).get('move'), target.id);
      toast(`Added to ${where}.`);
      await afterGoalChange();
    });
  });
  /* One way out, and it is the cross. */    $('#goal-add-x')?.addEventListener('click', () => goalDialog().close());
  $$('[data-goal-source]').forEach((btn) => btn.addEventListener('click', () => {
    if (goalSource === btn.dataset.goalSource) return;
    goalSource = btn.dataset.goalSource;
    drawGoalPanel();
  }));
  $('#goal-dictionary-q')?.addEventListener('input', (e) => {
    goaldictionaryQuery = e.target.value;
    drawdictionary();
  });
  drawdictionary();
}

/* The landing screen: the moves this dancer is working on. `Current goals` is a real collection,
 * so it also shows up on the Collections screen and on their public profile. */
async function viewHome() {
  setTitle('Home');
  const me = store.currentUser();

  /* Created by supabase/current-goals.sql for every profile; this also makes one for accounts that
   * existed before that file was run, so the screen works either way. */
  let goals = null;
  let goalsNote = '';
  try { goals = await store.ensureGoalsCategory(); }
  catch (err) { goalsNote = err.message; }

  const [cats, moves] = await Promise.all([store.listCategories(me.id), store.listMoves(me.id)]);
  const inGoals = goals ? moves.filter((m) => m.categoryIds.includes(goals.id)) : [];

  /* One add control, wherever this dancer is. It opens the panel as an overlay. */
  const addButton = html`
    <button type="button" class="btn primary" id="add-goal-toggle" aria-haspopup="dialog">+ Add new goal</button>`;

  show(html`
    <div class="page-head">
      <div class="who">
        ${avatarOf(me, 'avatar-lg')}
        <div><p class="eyebrow">Hi, ${me.username}</p><h1>Current goals</h1></div>
      </div>
    </div>

    ${goalsNote ? html`
      <div class="empty">
        <h3>Current goals is not set up</h3>
        <p>${goalsNote}</p>
        <p class="muted fineprint">Run <code>supabase/current-goals.sql</code> once in the Supabase SQL
          editor: it gives every profile its own Current goals collection.</p>
      </div>` : ''}

    ${!goals ? '' : inGoals.length ? html`
      <div class="stack" id="goal-list">
        ${inGoals.map((m) => html`
          <div class="card">
            ${trickPreview({
              href: `#/move/${m.id}`,
              name: m.name,
              difficulty: m.difficulty,
              actions: html`${statusSelect(m)}
                <button type="button" class="btn small remove-dash" data-drop="${m.id}"
                  title="Remove from current goals"
                  aria-label="Remove ${m.name} from current goals">—</button>`,
            })}
          </div>`)}
      </div>
      <div class="actions" style="margin-top:20px">${addButton}</div>` : html`
      <div class="empty">
        <h3>No current goals</h3>
        <div class="actions" style="justify-content:center;margin-top:14px">${addButton}</div>
      </div>`}

  `);

  if (!goals) return;
  wireStatusSelects(inGoals);
  $$('[data-drop]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    await store.removeFromCategory(btn.dataset.drop, goals.id);
    toast('Taken off your current goals.');
    await route({ keepScroll: true });
  })));
  $('#add-goal-toggle')?.addEventListener('click', () => attempt(() => openGoalPanel(goals, 'your current goals')));
}

/* ---------- view: my moves ---------- */

const filters = { q: '', sort: 'recent' };

async function viewMoves() {
  setTitle('Skill Roster');
  const me = store.currentUser();
  const [cats, moves] = await Promise.all([store.listCategories(me.id), store.listMoves(me.id)]);
  /* Every collection is a label on the card, Current goals included, so a dancer can see which moves
   * are their current goals next to the others. */
  const names = new Map(cats.map((c) => [c.id, c.name]));

  const head = html`
  <br>
    <div class="page-head">
    
      <div><h1>Skill Roster</h1></div>
      <a class="btn primary" href="#/move/new">+ Add move</a>
    </div>`;

  /* Collections sit above the moves: the square tiles, then a tile that opens the new-collection form. */
  const collections = html`
    <section class="coll-section" aria-labelledby="coll-title">
      <h2 class="subhead" id="coll-title">Collections</h2>
      <div class="coll-grid">
        <button type="button" class="coll-tile coll-new" id="new-cat-open" aria-expanded="false" aria-controls="new-cat">
          <span class="coll-plus" aria-hidden="true">+</span>
          <span class="coll-name">New collection</span>
        </button>
        ${cats.map((c) => html`
          <a class="coll-tile" href="#/collection/${c.id}">
            <span class="coll-name">${c.name}</span>
            <span class="count">${moves.filter((m) => m.categoryIds.includes(c.id)).length}</span>
          </a>`)}
      </div>
      <form class="inline-form" id="new-cat" hidden>
        <input type="text" name="name" maxlength="40" placeholder="New collection name" aria-label="New collection name" required>
        <button class="btn primary" type="submit">Create</button>
      </form>
    </section>`;

  /* Wired after every draw of this page, empty or not, so the tile always works. */
  const wireCollections = () => {
    $('#new-cat-open').addEventListener('click', (e) => {
      const form = $('#new-cat');
      form.hidden = !form.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) form.querySelector('input').focus();
    });
    $('#new-cat').addEventListener('submit', (e) => {
      e.preventDefault();
      attempt(async () => {
        const cat = await store.createCategory(new FormData(e.target).get('name'));
        toast('Collection ready.');
        go(`#/collection/${cat.id}`);
      });
    });
  };

  if (!moves.length) {
    show(html`${head}${collections}
      <div class="empty">
        <h3>No moves yet</h3>
        <p>Log the first one: what you can do today, or what you are working toward.</p>
        <a class="btn primary" href="#/move/new">Add your first move</a>
      </div>`);
    wireCollections();
    return;
  }

  show(html`${head}${collections}
    <h2 class="subhead">Moves</h2>
    <div class="filters">
      <div class="filter-row">
        <select id="sort" aria-label="Sort moves">
          <option value="recent" ${filters.sort === 'recent' ? raw('selected') : ''}>Recent</option>
          <option value="name" ${filters.sort === 'name' ? raw('selected') : ''}>A to Z</option>
          <option value="hard" ${filters.sort === 'hard' ? raw('selected') : ''}>Hardest first</option>
        </select>
      </div>
    </div>
    <div class="stack" id="move-list"></div>`);

  const list = $('#move-list');
  const draw = () => {
    const rows = [...moves];
    if (filters.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    if (filters.sort === 'hard') rows.sort((a, b) => b.difficulty - a.difficulty || a.name.localeCompare(b.name));
    list.innerHTML = rows.length
      ? rows.map((m) => moveCard(m, names)).join('')
      : String(html`<div class="empty">No moves match those filters.</div>`);
  };
  draw();

  wireCollections();
  $('#sort').addEventListener('change', (e) => { filters.sort = e.target.value; draw(); });
}

/* ---------- photos & videos (shared by the move and dictionary screens) ---------- */

const megabytes = (bytes) => Math.round(bytes / 1048576);

/* A size in the unit that reads best: rounding a 400 KB photo to "0 MB" is not a size, and the
 * chips in the upload list are the one place a dancer reads the number of a single file. */
const fileSize = (bytes) => (bytes >= 1048576
  ? `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/* A raw Supabase error is rarely the sentence a dancer needs, so translate the usual ones. */
function mediaSetupNote(err) {
  return /does not exist|schema cache|permission denied|bucket/i.test(err.message)
    ? html`Photo and video uploads are not switched on for this project yet: run
        <code>supabase/media.sql</code> in the Supabase SQL editor, then reload.`
    : html`Media could not be loaded: ${err.message}`;
}

const mediaGrid = (rows, me) => rows.length ? html`
  <div class="media-grid">
    ${rows.map((m) => html`
      <figure class="media-item">
        ${m.kind === 'video'
          ? html`<video src="${m.url}" controls preload="metadata" playsinline></video>`
          : html`<img src="${m.url}" alt="${m.caption || 'Photo'}" loading="lazy">`}
        ${m.ownerId === me.id ? html`<button type="button" class="media-remove" data-remove="${m.id}"
          aria-label="Remove this ${m.kind}">×</button>` : ''}
      </figure>`)}
  </div>` : html`<p class="muted"></p>`;

/* The hint reads as the section's own description - under the heading, where it explains what the
   section holds, rather than after the upload button where it read as a footnote to it. `panel`
   draws it as the same box as the section above it, for the screens that use panels. */
function mediaSection({ title, hint, rows, note, canUpload, me, panel = false }) {
  return html`
    <div class="section${panel ? ' panel' : ''}">
      <h2>${title}</h2>
      ${hint ? html`<p class="muted subnote">${hint}</p>` : ''}
      ${note ? html`<p class="muted">${note}</p>` : mediaGrid(rows, me)}
      ${canUpload && !note ? html`
        <div class="upload-row">
          <input type="file" id="media-file" accept="image/*,video/*" multiple hidden>
          <button type="button" class="btn small" id="media-add">+ Add photo or video</button>
          <br>
        </div>` : ''}
        <span>   <span>
         <span class="muted upload-note">JPG, PNG, WebP, GIF or MP4/WebM/MOV, up to ${megabytes(store.MAX_UPLOAD_BYTES)} MB each.</span>

    </div>`;
}

/* Wires the upload control and the remove buttons on the grid that was just rendered. */
function wireMedia({ parent, rows, refresh }) {
  const input = $('#media-file');
  $('#media-add')?.addEventListener('click', () => input.click());

  input?.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    attempt(async () => {
      for (const file of files) {
        toast(`Uploading ${file.name}…`);
        await store.uploadMedia(file, parent);
      }
      toast(files.length === 1 ? 'Added.' : `Added ${files.length} files.`);
      await refresh();
    });
  });

  $$('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
    const row = rows.find((m) => m.id === btn.dataset.remove);
    if (!row) return;
    attempt(async () => {
      await store.removeMedia(row);
      toast('Removed.');
      await refresh();
    });
  }));
}

/* ---------- view: one move ---------- */

async function viewMove(id) {
  const move = await store.getMove(id);
  if (!move) return notFound('That move does not exist, or it belongs to a private account.');
  setTitle(move.name);

  /* Your own move is edited on its own page, so there is one screen for it: the editor. Other
   * members' moves keep the read-only view below. */
  const me = store.currentUser();
  if (move.userId === me.id) return viewMoveForm(id, new URLSearchParams());
  const [owner, names, entry] = await Promise.all([
    store.userById(move.userId),
    catMap(move.userId),
    move.dictEntryId ? store.getEntry(move.dictEntryId) : null,
  ]);
  const ownerName = owner?.username ?? 'this dancer';

  /* RLS decides what comes back, so this is safe to ask for on anyone's move. */
  let media = [];
  let mediaNote = '';
  try { media = await store.listMedia({ moveId: move.id }); }
  catch (err) { mediaNote = mediaSetupNote(err); }

  /* Entries and exits are words this dancer typed, but a word that names a dictionary trick is a link:
   * "Wrist grip" walks into its own page instead of sitting there as text. The index is the dictionary's
   * own list, so a chip links exactly where the add-a-move form would link the same name. */
  await store.loadEntryIndex();
  const chipSection = (title, items) => items.length
    ? html`<div class="section"><h2>${title}</h2><div class="chips">${
        items.map((t) => partChip({ text: t, count: 1 }))}</div></div>`
    : '';

  show(html`
    ${backLink(`#/user/${move.userId}`, `${ownerName}'s moves`)}
    <div class="page-head">
      <div>
        <p class="eyebrow">Move by ${ownerName}</p>
        <h1>${move.name}</h1>
      </div>
    </div>

    <div class="meta-row">
      ${diffMeter(move.difficulty)}
      ${entry ? html`<span class="tag">Dictionary: <a href="#/dictionary/${entry.id}">${entry.name}</a>${entry.status === 'pending' ? ' (pending review)' : ''}</span>`
        : html`<span class="tag">Not in the dictionary</span>`}
    </div>

    ${chipSection('Entries', move.entries)}
    ${chipSection('Exits', move.exits)}
    ${chipSection('Combos', move.combos)}

    ${move.categoryIds.length ? html`
      <div class="section"><h2>Collections</h2><div class="chips">
        ${move.categoryIds.filter((cid) => names.has(cid)).map((cid) =>
          html`<a class="chip" href="#/collection/${cid}">${names.get(cid)}</a>`)}
      </div></div>` : ''}

    ${move.notes ? html`<div class="section"><h2>Notes</h2><div class="notes">${move.notes}</div></div>` : ''}

    ${mediaSection({
      title: 'Media',
      hint: '',
      rows: media, note: mediaNote, canUpload: false, me,
    })}

    <div class="actions">
      <button type="button" class="btn primary" id="copy">Save to my goals</button>
    </div>
    <p class="muted fineprint">Only the name is copied. ${ownerName}'s notes, entries and exits stay theirs.</p>
  `);

  $('#copy')?.addEventListener('click', () => {
    attempt(async () => {
      const { move: copy, existed } = await store.copyToMine(move.id);
      toast(existed ? 'You already have that move.' : 'Added to your goals.');
      go(`#/move/${copy.id}`);
    });
  });

  wireMedia({ parent: { moveId: move.id }, rows: media, refresh: () => route({ keepScroll: true }) });
}

/* ---------- chip input (entries / exits / combos) ---------- */

function chipField(el, initial, label) {
  let items = [...initial];
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chip-text';
  input.maxLength = 80;
  input.placeholder = 'Type and press Enter';
  input.setAttribute('aria-label', `Add to ${label}`);

  const commit = () => {
    const value = input.value.trim().replace(/,+$/, '').trim();
    input.value = '';
    if (value && !items.some((i) => i.toLowerCase() === value.toLowerCase())) items.push(value);
    return Boolean(value);
  };
  const draw = () => {
    el.replaceChildren();
    items.forEach((text, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(text);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.setAttribute('aria-label', `Remove ${text}`);
      x.textContent = '×';
      x.addEventListener('click', () => { items.splice(i, 1); draw(); input.focus(); });
      chip.append(x);
      el.append(chip);
    });
    el.append(input);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(); draw(); input.focus();
    } else if (e.key === 'Backspace' && !input.value && items.length) {
      items.pop(); draw(); input.focus();
    }
  });
  input.addEventListener('blur', () => { if (input.value.trim() && commit()) draw(); });
  el.addEventListener('click', (e) => { if (e.target === el) input.focus(); });
  draw();
  return () => { commit(); return items; };
}

/* ---------- view: add / edit move ---------- */

async function viewMoveForm(id, query, inDialog = null) {
  const me = store.currentUser();
  let move = null;
  if (id) {
    move = await store.getMove(id);
    if (!move || move.userId !== me.id) return notFound('You can only edit your own moves.');
  }
  if (!inDialog) setTitle(move ? `Edit ${move.name}` : 'Add move');

  const [entries, prefillEntry, cats] = await Promise.all([
    store.listEntries(),
    !move && query.get('entry') ? store.getEntry(query.get('entry')) : null,
    store.listCategories(me.id),
  ]);
  const prefillCat = !move ? query.get('cat') : null;
  const m = move ?? {
    name: prefillEntry?.name ?? '', difficulty: 3, entries: [], exits: [], combos: [],
    notes: '', categoryIds: cats.some((c) => c.id === prefillCat) ? [prefillCat] : [],
    dictEntryId: prefillEntry?.id ?? null,
  };
  const backHref = '#/moves';
  /* The level the dashes start on. A move with no level, or a new one, starts at the middle. */
  const level = Math.min(5, Math.max(1, Number(m.difficulty) || 3));

  const view = html`
    ${inDialog ? html`<h2 id="move-dialog-title">Add a move</h2>` : html`${backLink(backHref, move ? 'My moves' : 'Cancel')}
    <div class="page-head"><div><p class="eyebrow">${move ? 'Move' : 'New move'}</p><h1>${move ? m.name : 'Add a move'}</h1></div></div>
    ${move ? html`<div class="meta-row">${statusSelect(move)}</div>` : ''}`}

    <form class="form" id="move-form">
      <label class="field"><span>Nickname</span>
        <input type="text" name="name" required maxlength="80" autocomplete="off" list="dict-names"
          value="${m.name}" placeholder="trick name">
        <datalist id="dict-names">${entries.map((e) => html`<option value="${e.name}"></option>`)}</datalist>
      </label>

      <label class="field"><span>Corresponding Dictionary entry (if it exists)</span>
        <select name="dict">
          <option value="">Not linked</option>
          ${entries.map((e) => html`<option value="${e.id}" ${m.dictEntryId === e.id ? raw('selected') : ''}>${e.name}${e.status === 'pending' ? ' (pending review)' : ''}</option>`)}
        </select>
        <small id="dict-hint">Linking helps the community agree on one name per move.</small>
      </label>

      <label class="check-row field" id="suggest-row" hidden>
        <input type="checkbox" name="suggest">
        <span><strong>Suggest this as a new Dictionary entry</strong>
          <small>An admin reviews it before it appears for everyone.</small></span>
      </label>

      <fieldset class="field"><legend>Difficulty</legend>
        <div class="diff-edit">
          <input type="hidden" name="difficulty" value="${level}">
          <div class="diff-steps" role="radiogroup" aria-label="Difficulty">
            ${[1, 2, 3, 4, 5].map((i) => html`<button type="button" class="diff-step ${i <= level ? 'on' : ''}"
              role="radio" data-level="${i}" aria-checked="${i === level ? 'true' : 'false'}"
              aria-label="${i} of 5"></button>`)}
          </div>
          <p class="diff-label" id="diff-label" aria-live="polite">${store.difficultyLabel(level)}</p>
        </div>
      </fieldset>

      <div class="field"><span class="label">Entries</span><div class="chip-field" id="f-entries"></div>
        </div>
      <div class="field"><span class="label">Exits</span><div class="chip-field" id="f-exits"></div>
        </div>
      <div class="field"><span class="label">Combines well with...</span><div class="chip-field" id="f-combos"></div>
        </div>

      <fieldset class="field"><legend>Collections</legend>
        ${cats.length ? html`<div class="checks">
          ${cats.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c.id}" ${m.categoryIds.includes(c.id) ? raw('checked') : ''}> ${c.name}</label>`)}
        </div>` : ''}
        <div class="cat-add">
          <button type="button" class="icon-btn" id="cat-add" aria-expanded="false" aria-controls="newcat"
            aria-label="Add to a new collection" title="Add to a new collection">${plusIcon}</button>
          <input type="text" id="newcat" name="newcat" maxlength="40" placeholder="New collection name"
            aria-label="New collection name" hidden>
        </div>
      </fieldset>

      <fieldset class="field" id="media-field">
        <legend>Media <span class="muted"></span></legend>

        <input type="file" id="move-files" accept="image/*,video/*" multiple hidden>
        <div class="actions">
          <button type="button" class="btn small" id="move-files-add">+ Add photo or video</button>
        </div>
        <ul class="file-list" id="move-file-list"></ul>
        <div class="media-grid" id="move-media" hidden></div>
        <p class="field-help" id="move-media-note" hidden></p>
      </fieldset>

      <label class="field"><span>Notes</span>
        <textarea name="notes" maxlength="2000" placeholder="">${m.notes}</textarea></label>

      <div class="actions">
        <button class="btn primary" type="submit">Save move</button>
        ${inDialog ? html`<button type="button" class="btn" id="move-cancel">Cancel</button>`
          : move ? html`<button type="button" class="btn danger" id="delete">Delete from My Moves</button>`
          : html`<a class="btn" href="${backHref}">Cancel</a>`}
      </div>
    </form>`;
  if (inDialog) inDialog.innerHTML = String(view);
  else show(view);
  if (inDialog) $('#move-cancel').addEventListener('click', () => inDialog.close());
  if (move && !inDialog) {
    wireStatusSelects([move]);
    $('#delete').addEventListener('click', () => {
      if (!confirm(`Delete "${move.name}"?`)) return;
      attempt(async () => { await store.deleteMove(move.id); toast('Move deleted.'); go('#/moves'); });
    });
  }

  /* The dashes are the level: a click on one sets it, lights the dashes up to it and names it below. */
  const formEl = $('#move-form');
  const diffInput = formEl.elements.difficulty;
  const diffLabel = $('#diff-label');
  $$('.diff-step', formEl).forEach((step) => step.addEventListener('click', () => {
    const n = Number(step.dataset.level);
    diffInput.value = String(n);
    $$('.diff-step', formEl).forEach((s) => {
      const sn = Number(s.dataset.level);
      s.classList.toggle('on', sn <= n);
      s.setAttribute('aria-checked', String(sn === n));
    });
    diffLabel.textContent = store.difficultyLabel(n);
  }));

  /* The + reveals the box for a brand-new collection; that one is made and this move is put in it. */
  const catAdd = $('#cat-add');
  const newCat = $('#newcat');
  catAdd.addEventListener('click', () => {
    newCat.hidden = !newCat.hidden;
    catAdd.setAttribute('aria-expanded', String(!newCat.hidden));
    if (!newCat.hidden) newCat.focus();
  });

  const form = $('#move-form');
  const getEntries = chipField($('#f-entries'), m.entries, 'entries');
  const getExits = chipField($('#f-exits'), m.exits, 'exits');
  const getCombos = chipField($('#f-combos'), m.combos, 'combos');

  /* Typing a name that matches a dictionary entry links it automatically. */
  const nameInput = form.elements.name;
  const dictSelect = form.elements.dict;
  const suggestRow = $('#suggest-row');
  const hint = $('#dict-hint');
  let autoLinked = false;
  const sync = () => {
    const typed = nameInput.value.trim().toLowerCase();
    const match = entries.find((e) => e.name.toLowerCase() === typed);
    if (match && (!dictSelect.value || autoLinked)) {
      dictSelect.value = match.id;
      autoLinked = true;
    } else if (!match && autoLinked) {
      dictSelect.value = '';
      autoLinked = false;
    }
    hint.textContent = autoLinked
      ? `Matched "${dictSelect.selectedOptions[0].textContent}" in the dictionary.`
      : '';
    suggestRow.hidden = !(typed && !dictSelect.value && !match);
  };
  nameInput.addEventListener('input', sync);
  dictSelect.addEventListener('change', () => { autoLinked = false; sync(); });
  sync();

  /* ---------- photos & videos, chosen here and sent with the move ---------- */

  let picked = [];          // files chosen in this form, uploaded once the move has an id
  let mediaEnabled = true;  // false once the media tables turn out to be missing

  /* The chosen-but-not-yet-uploaded list. Rebuilt from the array on every change, so a file taken
   * back off cannot leave a stale button behind. */
  const drawPicked = () => {
    const list = $('#move-file-list');
    list.innerHTML = picked.length ? picked.map((f, i) => String(html`
      <li class="file-chip">
        <span class="file-chip-name">${f.name}</span>
        <span class="file-chip-size">${fileSize(f.size)}</span>
        <button type="button" class="file-chip-x" data-unpick="${i}"
          aria-label="Do not upload ${f.name}">×</button>
      </li>`)).join('') : '';
    $$('[data-unpick]').forEach((btn) => btn.addEventListener('click', () => {
      picked.splice(Number(btn.dataset.unpick), 1);
      drawPicked();
    }));
  };

  const fileInput = $('#move-files');
  $('#move-files-add').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';   // so choosing the same file twice in a row still fires
    /* A file over the limit is refused here rather than after a long upload: the message is the
     * same one the store would give, it just arrives before the wait. */
    const tooBig = files.filter((f) => f.size > store.MAX_UPLOAD_BYTES);
    picked = picked.concat(files.filter((f) => f.size <= store.MAX_UPLOAD_BYTES));
    if (tooBig.length) {
      toast(`Skipped ${plural(tooBig.length, 'file')} over ${megabytes(store.MAX_UPLOAD_BYTES)} MB.`, true);
    }
    drawPicked();
  });

  /* On an edit, the clips already on the move are listed here too, with their remove buttons, so one
   * screen covers the move and everything attached to it. Only the grid is redrawn after a removal:
   * re-rendering the page would throw away whatever is half-typed in the form above. */
  const drawFormMedia = async (moveId) => {
    const grid = $('#move-media');
    const note = $('#move-media-note');
    try {
      const rows = await store.listMedia({ moveId });
      grid.hidden = !rows.length;
      grid.innerHTML = rows.length ? String(mediaGrid(rows, me)) : '';
      note.hidden = true;
      $$('[data-remove]', grid).forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
        const row = rows.find((r) => r.id === btn.dataset.remove);
        if (!row) return;
        await store.removeMedia(row);
        toast('Removed.');
        await drawFormMedia(moveId);
      })));
    } catch (err) {
      mediaEnabled = false;
      grid.hidden = true;
      note.hidden = false;
      note.innerHTML = String(mediaSetupNote(err));
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      const data = new FormData(form);
      const name = String(data.get('name')).trim();
      let dictEntryId = data.get('dict') || null;
      if (!dictEntryId && data.get('suggest')) {
        const { entry, created } = await store.submitEntry(name);
        dictEntryId = entry.id;
        if (created) toast(entry.status === 'pending' ? 'Move saved. Dictionary suggestion sent for review.' : 'Move saved.');
      }
      const categoryIds = data.getAll('cat');
      const newCat = String(data.get('newcat') ?? '').trim();
      if (newCat) categoryIds.push((await store.createCategory(newCat)).id);

      const saved = await store.saveMove({
        id: move?.id, name, difficulty: data.get('difficulty'),
        entries: getEntries(), exits: getExits(), combos: getCombos(),
        notes: data.get('notes'), categoryIds, dictEntryId,
      });
      if (!data.get('suggest') && !picked.length) toast('Move saved.');

      /* Uploads come after the move exists, because a file has to belong to something. A failed
       * upload does not undo the move: it is saved either way, and the file can be added again from
       * the move's own page - so the failure is reported and the dancer still lands on their move. */
      if (picked.length && !mediaEnabled) {
        toast('Move saved. Uploads are not switched on for this project yet: run supabase/media.sql, '
          + 'then add the files from the move page.', true);
      } else if (picked.length) {
        try {
          for (const file of picked) {
            toast(`Uploading ${file.name}…`);
            await store.uploadMedia(file, { moveId: saved.id });
          }
          toast(picked.length === 1 ? 'Move saved, with its photo or video.'
            : `Move saved, with ${plural(picked.length, 'file')}.`);
        } catch (err) {
          toast(`Move saved, but the upload failed: ${err.message}`, true);
        }
      }
      if (inDialog) {
        inDialog.close();
        await route({ keepScroll: true });
      } else if (move) {
        /* Saved on the page it was edited on: redraw it so the photos and the status line are current. */
        await route({ keepScroll: true });
      } else {
        go(`#/move/${saved.id}`);
      }
    });
  });

  if (move) await drawFormMedia(move.id);
}

/* The full move editor, opened in a dialogue from the add-a-goal panel so the dancer stays on the
 * collection they are adding to. It is the same form as the move page, aimed at this collection. The
 * dialogue is made on first use and emptied when it closes, so nothing is left behind on the page. */
async function openMoveDialog(target) {
  let dialog = $('#move-dialog');
  if (!dialog) {
    document.body.insertAdjacentHTML('beforeend',
      '<dialog class="sheet" id="move-dialog" aria-labelledby="move-dialog-title"></dialog>');
    dialog = $('#move-dialog');
    dialog.addEventListener('close', () => { dialog.innerHTML = ''; });
  }
  await viewMoveForm(null, new URLSearchParams({ cat: target.id }), dialog);
  dialog.showModal();
  dialog.querySelector('input[name=name]')?.focus();
}

/* ---------- view: my collections ---------- */

/* The collection whose pencil is open. Kept per collection, so opening another one starts closed. */
let editingCollection = null;

async function viewCollection(id) {
  const cat = await store.getCategory(id);
  if (!cat) return notFound('That collection does not exist, or it belongs to a private account.');
  setTitle(cat.name);
  const me = store.currentUser();
  const mine = cat.userId === me.id;
  const [owner, cats, allMoves] = await Promise.all([
    store.userById(cat.userId), store.listCategories(cat.userId), store.listMoves(cat.userId),
  ]);
  /* No collection tags here: the page already says which collection this is. */
  const ownerName = owner?.username ?? 'this dancer';
  const moves = allMoves.filter((m) => m.categoryIds.includes(cat.id));
  /* Nothing to manage on someone else's collection, and the home screen's collection is fixed. */
  const canManage = mine && !cat.isDefault;
  const editing = editingCollection === cat.id;

  show(html`
    ${backLink(mine ? '#/moves' : `#/user/${cat.userId}`, mine ? 'Moves' : `${ownerName}'s profile`)}
    <div class="page-head">
      <div><p class="eyebrow">${mine ? 'Collection' : `Collection by ${ownerName}`}</p><h1>${cat.name}</h1></div>
      <div class="head-actions">
        <span class="count">${moves.length}</span>
        ${canManage ? html`<button type="button" class="icon-btn" id="edit-collection"
          aria-label="Rename or delete this collection" aria-expanded="${editing}"
          aria-controls="collection-manage">${pencilIcon}</button>` : ''}
      </div>
    </div>
    ${mine ? html`
      <div class="actions"><button type="button" class="btn primary" id="add-to-collection-toggle"
        aria-haspopup="dialog">+ Add to collection</button></div>` : ''}

    ${moves.length ? html`<div class="stack" id="collection-moves">${moves.map((m) => moveCard(m))}</div>`
      : html`<div class="empty"><p>No moves in this collection yet.</p></div>`}

    ${!canManage ? '' : html`
      <div id="collection-manage" ${editing ? '' : raw('hidden')}>
        <h2 class="subhead">Manage</h2>
        <form class="inline-form" id="rename">
          <input type="text" name="name" maxlength="40" value="${cat.name}" aria-label="Collection name" required>
          <button class="btn" type="submit">Rename</button>
        </form>
        <button type="button" class="btn danger" id="delete">Delete collection</button>
        <p class="muted fineprint">Deleting a collection never deletes its moves.</p>
      </div>`}`);

  $('#add-to-collection-toggle')?.addEventListener('click', () => attempt(() => openGoalPanel(cat, `“${cat.name}”`)));

  /* The pencil opens and closes the panel; nothing that changes the collection is on screen until
   * it is clicked. */
  $('#edit-collection')?.addEventListener('click', () => {
    editingCollection = editing ? null : cat.id;
    route({ keepScroll: true });
  });
  $('#rename')?.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      await store.renameCategory(cat.id, new FormData(e.target).get('name'));
      toast('Renamed.');
      await route({ keepScroll: true });
    });
  });
  $('#delete')?.addEventListener('click', () => {
    if (!confirm(`Delete the collection "${cat.name}"? The moves stay.`)) return;
    attempt(async () => { await store.deleteCategory(cat.id); toast('Collection deleted.'); go('#/moves'); });
  });
}

/* Does a trick answer to this search? Its own name first, then every nickname members have filed for
 * it - which is the whole point of the aliases: a dancer types the name their studio uses and the
 * dictionary answers with the trick. Returns the nickname that matched, so a row can say why it is in the
 * results rather than appearing out of nowhere under a search for a word that is not in its name. */
function entryMatch(entry, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return { matches: true, alias: '' };
  if (entry.name.toLowerCase().includes(q)) return { matches: true, alias: '' };
  const hit = store.entryAliases(entry.id).find((a) => a.alias.toLowerCase().includes(q));
  return hit ? { matches: true, alias: hit.alias } : { matches: false, alias: '' };
}

/* ---------- view: pole dictionary ---------- */

let dictQuery = '';
let dictLevel = 'any';   // 'any', or one of store.LEVELS values: the level most members chose
let dictSort = 'name';   // 'name' | 'easiest' | 'hardest' | 'answered'

async function viewdictionary() {
  setTitle('Pole dictionary');
  const me = store.currentUser();
  const [entries, moves] = await Promise.all([store.listEntries(), store.listMoves(me.id)]);
  const mineByEntry = new Map(moves.filter((m) => m.dictEntryId).map((m) => [m.dictEntryId, m]));

  show(html`
    <div class="page-head">
      <div><h1>Pole Dictionary</h1></div>
      <div class="head-actions">
        <span class="count">${entries.length}</span>
        <button type="button" class="icon-btn" id="suggest-open" title="Add a trick" aria-label="Add a trick">${plusIcon}</button>
      </div>
    </div>
    <div class="filters">
      <input type="search" id="dq" placeholder="Search the dictionary" aria-label="Search the dictionary" value="${dictQuery}">
      ${store.levelsEnabled() ? html`
        <div class="filter-row">
          <select id="level" aria-label="Browse by level">
            <option value="any" ${dictLevel === 'any' ? raw('selected') : ''}>Any level</option>
            ${store.LEVELS.map((l) => html`<option value="${l.value}"
              ${dictLevel === l.value ? raw('selected') : ''}>${l.label} tricks</option>`)}
          </select>
          <select id="sort" aria-label="Rank tricks by level">
            <option value="name" disabled ${dictSort === 'name' ? raw('selected') : ''}>Rank by level</option>
            ${[['easiest', 'Level ascending'], ['hardest', 'Level descending'],
               ['answered', 'Most answers first']].map(([value, label]) => html`<option value="${value}"
              ${dictSort === value ? raw('selected') : ''}>${label}</option>`)}
          </select>
        </div>` : html`
        <p class="subnote muted">Browsing by level needs one setup step: run supabase/levels.sql in the
          Supabase SQL editor, then reload.</p>`}
      <p class="subnote muted" id="dict-note"></p>
    </div>
    <div class="stack" id="dict-list"></div>
    ${suggestDialog(me)}`);

  const list = $('#dict-list');
  const draw = () => {
    const q = dictQuery.trim().toLowerCase();
    /* Counted once per trick: the badge, the filter and the sort all read the same numbers. */
    const info = new Map(entries.map((e) => [e.id, store.entryLevel(e.id)]));

    /* A trick answers to its own name and to every nickname filed for it. Which nickname matched is
     * remembered, because a row that appears under a search for a word it does not contain has to say
     * where the word came from. */
    const matchedAlias = new Map();
    let rows = entries.filter((e) => {
      const hit = entryMatch(e, dictQuery);
      if (hit.alias) matchedAlias.set(e.id, hit.alias);
      return hit.matches;
    });
    if (dictLevel !== 'any') rows = rows.filter((e) => info.get(e.id).lead === dictLevel);

    /* Sorting by level means sorting by the average answer. A trick nobody has marked has no
     * average, so it goes last whichever way you sort rather than looking easiest by default. */
    const byAverage = (dir) => (a, b) => {
      const x = info.get(a.id).average;
      const y = info.get(b.id).average;
      if (x === null && y === null) return compareNames(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return dir * (x - y) || compareNames(a, b);
    };
    if (dictSort === 'easiest') rows = [...rows].sort(byAverage(1));
    else if (dictSort === 'hardest') rows = [...rows].sort(byAverage(-1));
    else if (dictSort === 'answered') rows = [...rows].sort((a, b) => info.get(b.id).total - info.get(a.id).total || compareNames(a, b));
    else rows = [...rows].sort(compareNames);

    list.innerHTML = rows.length ? rows.map((e) => {
      const linked = mineByEntry.get(e.id);
      /* One line, or two when a search matched a nickname. Nobody's face here: the card names the trick,
       * and the members who log it are answered on that name's own page. The level shows as the dashes
       * (the average vote, scaled to five), and a trick nobody has rated shows none. */
      const avg = info.get(e.id).average;
      return String(html`<div class="card">${trickPreview({
        href: `#/dictionary/${e.id}`,
        name: e.name,
        difficulty: avg === null ? UNRATED : Math.round((avg * 5) / 3),
        mark: e.status === 'pending' ? html`<span class="pending-mark" role="img" title="Pending review" aria-label="Pending review">*</span>` : '',
        alias: matchedAlias.get(e.id),
        actionsInHead: true,
        actions: linked
          ? html`<a class="icon-btn" href="#/move/${linked.id}" title="In your moves"
              aria-label="In your moves: ${e.name}">${checkIcon}</a>`
          : html`<a class="icon-btn" href="#/move/new?entry=${e.id}" title="Add to my moves"
              aria-label="Add ${e.name} to my moves">${plusIcon}</a>`,
      })}</div>`);
    }).join('') : String(html`<div class="empty"><p>${dictLevel === 'any'
      ? 'No matches. Suggest it below.'
      : `No trick is mostly ${store.levelLabel(dictLevel).toLowerCase()} yet.`}</p></div>`);

    /* One line saying what the two controls did, so it is never ambiguous whether a level filter is
     * on. Hidden when it would only be reporting the obvious. */
    const note = $('#dict-note');
    const filtered = dictLevel !== 'any' || q;
    note.hidden = !filtered;
    if (filtered) {
      note.textContent = `${plural(rows.length, 'trick')} shown`
        + (q ? ` matching “${dictQuery.trim()}”` : '')
        + (dictLevel === 'any' ? '' : `, mostly ${store.levelLabel(dictLevel).toLowerCase()} by the members who answered`)
        + (matchedAlias.size ? `, ${plural(matchedAlias.size, 'trick')} by another name` : '')
        + `, out of ${plural(entries.length, 'trick')}.`;
    }
  };
  draw();

  $('#dq').addEventListener('input', (e) => { dictQuery = e.target.value; draw(); });
  $('#level')?.addEventListener('change', (e) => { dictLevel = e.target.value; draw(); });
  $('#sort')?.addEventListener('change', (e) => { dictSort = e.target.value; draw(); });
  wireSuggestDialog();
}

/* Files chosen in the add-a-trick dialogue but not yet uploaded: they are sent once the trick exists
 * and has an id to hang them on, which is the same order the add-a-move form uses. Module state
 * rather than per-render, because the dialogue survives the redraws that picking an avatar or a
 * studio causes elsewhere. */
let suggestPicked = [];

/* Adding a trick, in a dialogue: three questions that belong together and none of them worth a
 * screen of their own. Native <dialog>, so the backdrop, Escape and the focus trap are the browser's
 * job rather than something hand-rolled here.
 *
 * Only the name is required. The level defaults to Unrated because most tricks start with nobody
 * having an opinion, and a level picked here is only the first vote - it is not what makes the trick
 * hard or easy. Photographs are attached to the trick itself, so anyone opening it later sees them. */
function suggestDialog(me) {
  const choices = [{ value: '', label: 'Unrated' }, ...store.LEVELS.map((l) => ({ value: l.value, label: l.label }))];
  return html`
    <dialog class="sheet" id="suggest-dialog" aria-labelledby="suggest-title">
      <form class="form" id="suggest-form">
        <h2 id="suggest-title">Add a trick</h2>
        <p class="muted subnote">${me.isAdmin
          ? 'It goes straight into the dictionary, and other members can mark its level from there.'
          : 'An admin reviews it before it appears for everyone.'}</p>

        <label class="field"><span>Name</span>
          <input type="text" name="name" maxlength="60" required autocomplete="off"
            placeholder="">
        </label>

        <fieldset class="field">
          <legend>Level <span class="muted">optional</span></legend>
          <div class="seg seg-2col">
            ${choices.map((c) => html`<label><input type="radio" name="level" value="${c.value}"
              ${c.value === '' ? raw('checked') : ''}><span>${c.label}</span></label>`)}
          </div>
          <small>Leave it on Unrated if you are not sure. Levels are what the members think of a
            trick, and one answer is only the start of it.</small>
        </fieldset>

        <div class="field">
          <span>Photos and videos <span class="muted">optional</span></span>
          <input type="file" id="suggest-files" accept="image/*,video/*" multiple hidden>
          <div class="upload-row">
            <button type="button" class="btn small" id="suggest-files-add">+ Choose files</button>
            <span class="muted upload-note">Up to ${megabytes(store.MAX_UPLOAD_BYTES)} MB each.</span>
          </div>
          <ul class="file-list" id="suggest-file-list"></ul>
        </div>

        <div class="actions">
          <button type="submit" class="btn primary">${me.isAdmin ? 'Add to the dictionary' : 'Send for review'}</button>
          <button type="button" class="btn" id="suggest-cancel">Cancel</button>
        </div>
      </form>
    </dialog>`;
}

function wireSuggestDialog() {
  const dialog = $('#suggest-dialog');
  const fileInput = $('#suggest-files');

  const drawPicked = () => {
    const list = $('#suggest-file-list');
    list.innerHTML = suggestPicked.map((f, i) => String(html`
      <li class="file-chip">
        <span class="file-chip-name">${f.name}</span>
        <span class="file-chip-size">${fileSize(f.size)}</span>
        <button type="button" class="file-chip-x" data-unpick="${i}" aria-label="Remove ${f.name}">×</button>
      </li>`)).join('');
    $$('[data-unpick]').forEach((btn) => btn.addEventListener('click', () => {
      suggestPicked.splice(Number(btn.dataset.unpick), 1);
      drawPicked();
    }));
  };

  $('#suggest-open').addEventListener('click', () => {
    suggestPicked = [];
    drawPicked();
    $('#suggest-form').reset();
    dialog.showModal();
    $('#suggest-form input[name=name]').focus();
  });
  $('#suggest-cancel').addEventListener('click', () => dialog.close());
  $('#suggest-files-add').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    const tooBig = files.filter((f) => f.size > store.MAX_UPLOAD_BYTES);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')} is over the ${megabytes(store.MAX_UPLOAD_BYTES)} MB limit.`, true);
    suggestPicked = suggestPicked.concat(files.filter((f) => f.size <= store.MAX_UPLOAD_BYTES));
    drawPicked();
  });

  $('#suggest-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const level = String(data.get('level') ?? '');
    const files = suggestPicked;
    attempt(async () => {
      const { entry, created } = await store.submitEntry(data.get('name'));
      dialog.close();
      if (!created) {
        toast(`“${entry.name}” is already in the dictionary.`);
        await route({ keepScroll: true });
        return;
      }
      /* The level and the photographs are attached after the trick exists, and neither is worth
       * failing the whole thing over: the trick is the part that had to be filed, and the page it
       * lands on has both of these controls on it anyway. */
      if (level && store.levelsEnabled()) {
        try { await store.setEntryLevel(entry.id, level); } catch (err) { toast(err.message, true); }
      }
      let attached = 0;
      for (const file of files) {
        try { await store.uploadMedia(file, { entryId: entry.id }); attached += 1; }
        catch (err) { toast(err.message, true); break; }
      }
      const said = entry.status === 'pending' ? 'Sent for review. Thank you!' : 'Added to the dictionary.';
      toast(attached ? `${said} ${plural(attached, 'file')} attached.` : said);
      await route({ keepScroll: true });
    });
  });
}

/* ---------- community difficulty: the pills and the bars ---------- */

/* The voting section on a trick's own page: three pills to answer with, and - once anybody has
 * answered - the community's answer so far as three bars. A pending suggestion cannot be marked -
 * nobody else can see it yet - so it says that instead of collecting answers that would not mean
 * anything. */
function levelSection(entry) {
  if (!store.levelsEnabled()) return '';

  if (entry.status !== 'approved') {
    return html`<section class="section level-card">
      <h2>Relative difficulty</h2>
      <p class="subnote muted">Levels open once this trick is approved. A suggestion is visible only
        to you and the reviewers, so there is nobody to compare answers with yet.</p>
    </section>`;
  }

  const { counts, percents, total, mine } = store.entryLevel(entry.id);

  /* The bars are only drawn once somebody has answered. Three empty tracks are the loudest thing on
   * the page and they say nothing, so with no answers the card says it in words instead - including
   * the word the badges use (Unrated), so the trick's headline and this panel cannot drift apart. */
  /* One row per level, and no mark on whichever is ahead: the tick that used to sit after the leading
   * level was read as a tick against the reader's own answer, because the two are usually the same
   * level. The percentage and the count on each row already say who is ahead. */
  const bars = total ? html`<div class="level-bars">
    ${store.LEVELS.map((l) => html`
      <div class="level-row">
        <span class="level-name">${l.label}</span>
        <span class="level-track"><span class="level-fill level-${l.value}"
          style="width:${percents[l.value]}%"></span></span>
        <span class="level-pct">${percents[l.value]}%</span>
        <span class="level-count">${plural(counts[l.value], 'vote')}</span>
      </div>`)}
  </div>` : '';

  return html`<section class="section level-card">
    <h2>Relative difficulty</h2>

    <fieldset class="field level-pick">
      <legend class="sr-only">Your level for ${entry.name}</legend>
      <div class="seg">
        ${store.LEVELS.map((l) => html`
          <label><input type="radio" name="level" value="${l.value}" data-level="${l.value}"
            ${mine === l.value ? raw('checked') : ''}><span>${l.label}</span></label>`)}
      </div>

    </fieldset>

    ${bars}
    ${total ? '' : html`<p class="muted subnote level-empty"></p>`}

  </section>`;
}

/* Answering saves straight away: there is no Save button to forget, and one vote per dancer means a
 * second answer edits the first rather than adding to it. */
function wireLevelVote(entry) {
  $$('.level-pick input').forEach((input) => input.addEventListener('change', () => attempt(async () => {
    const level = input.dataset.level;
    await store.setEntryLevel(entry.id, level);
    toast(`Marked as ${store.levelLabel(level).toLowerCase()}. Thank you!`);
    await route({ keepScroll: true });
  })));
}

/* The other names a trick goes by, as a list any signed-in dancer may add to - which is what replaced
 * the name-change suggestions. A nickname is not a decision anybody has to make: the trick keeps the
 * one canonical name that every move links to and every screen shows, and what dancers actually call
 * it is written underneath where the search can find it. So there is no queue, no argument, and
 * nothing to approve; the two people who call it different things are both right.
 *
 * Whoever added a name - or an admin - can take it off, the same rule supabase/aliases.sql writes.
 * There is no edit: correcting a nickname means removing it and adding the right one, which keeps the
 * name of whoever typed it honest. */
function aliasSection(entry, me) {
  if (!store.aliasesEnabled()) {
    return html`<section class="section alias-card">
      <h2>Also known as</h2>
      <p class="muted">Nicknames are not switched on for this project yet: run
        <code>supabase/aliases.sql</code> in the Supabase SQL editor, then reload.</p>
    </section>`;
  }
  const aliases = store.entryAliases(entry.id);
  return html`<section class="section alias-card">
    <h2>Also known as</h2>
    
    ${aliases.length
      ? html`<div class="chips">${aliases.map((a) => html`<span class="chip alias-chip">
          ${a.alias}${(a.addedBy === me.id || me.isAdmin)
            ? html`<button type="button" class="chip-x" data-drop-alias="${a.id}"
                aria-label="Remove the name ${a.alias}">×</button>`
            : ''}
        </span>`)}</div>`
      : html`<p></p>`}
    <form class="inline-form" id="alias-form">
      <input type="text" name="alias" maxlength="60" required
        placeholder="name..." aria-label="Another name for ${entry.name}">
      <button class="btn primary" type="submit">Add name</button>
    </form>
  </section>`;
}

/* One entry or exit of a move, as a chip. When the dictionary has a trick by that name the chip links to
 * it - "Wrist grip" walks into its own page rather than sitting there as text - and when it does not,
 * it is what it always was: a word this dancer wrote. `count` only appears on a trick page, where the
 * number is the number of members who said it. */
const partChip = (item) => {
  const entry = store.entryNamed(item.text);
  const label = html`${item.text}${item.count > 1
    ? html` <span class="chip-count">${item.count}</span>` : ''}`;
  return entry
    ? html`<a class="chip" href="#/dictionary/${entry.id}">${label}</a>`
    : html`<span class="chip">${label}</span>`;
};

/* What the members do on this trick, gathered from every move of it they have logged. A shared trick
 * is one thing described forty ways, and the descriptions that come up over and over are the ones
 * worth knowing - which is the one question a single move's own list can never answer. */
function partsSection(parts, note) {
  if (note) return html`<section class="section parts-card"><h2>Entries &amp; exits</h2>
    <p class="muted">${note}</p></section>`;
  if (!parts.entries.length && !parts.exits.length) return '';
  const row = (title, items) => (!items.length ? '' : html`
    <h3 class="parts-title">${title}</h3>
    <div class="chips">${items.map((it) => partChip(it))}</div>`);
  return html`<section class="section parts-card">
    <h2>Entries &amp; exits</h2>
    <p class="muted subnote">What the members who log this trick say they do on it, most common
      first. A name in the dictionary opens its own page.</p>
    ${row('Entries', parts.entries)}
    ${row('Exits', parts.exits)}
  </section>`;
}

/* ---------- view: one dictionary entry ---------- */

async function viewEntry(id) {
  const entry = await store.getEntry(id);
  if (!entry) return notFound('That trick does not exist, or it is still waiting for review.');
  setTitle(entry.name);

  const me = store.currentUser();
  /* listEntries also fills the cache entryUsers() and entryUsage() read; listMoves tells us whether
   * I already have this trick logged as one of my own. */
  const [entries, moves] = await Promise.all([store.listEntries(), store.listMoves(me.id)]);
  const loggers = entries.some((e) => e.id === entry.id) ? store.entryUsers(entry.id) : [];
  const used = loggers.length;
  const linked = moves.find((m) => m.dictEntryId === entry.id);

  let media = [];
  let mediaNote = '';
  try { media = await store.listMedia({ entryId: entry.id }); }
  catch (err) { mediaNote = mediaSetupNote(err); }

  /* What the members do on this trick, gathered from their own moves of it. Failure is the ordinary
   * way to find out the moves table is not what this app expects, so the page carries on and the
   * section says why rather than disappearing. */
  let parts = { entries: [], exits: [] };
  let partsNote = '';
  try { parts = await store.entryParts(entry.id); }
  catch (err) { partsNote = err.message; }

  /* Read as a short article rather than as a pile of cards: what this trick is and who logs it, then
   * the facts worth having before you read anything else, then what the community makes of it, the
   * names it goes by, and how members get into it. A stat strip rather than a set of panels is what
   * keeps the facts quiet and the trick loud. */
  const level = store.entryLevel(entry.id);
  show(html`
    ${backLink('#/dictionary', 'Pole dictionary')}
    <article class="entry">
      <div class="entry-hero">
        <header class="entry-head">
          <p class="eyebrow">Pole Dictionary</p>
          <div class="entry-title">
            <h1>${entry.name}</h1>
            ${entry.status === 'pending' ? html`<span class="tag">Pending review</span>` : ''}
          </div>
          <!-- Who logs it, and no number: the fact strip below already counts them, and saying it
               twice made the page read as though it were two different facts. -->
          <p class="lede loggers-line">
            ${used ? loggerRow(loggers) : ''}
            <span>${used ? '' : 'Nobody has logged this trick yet.'}${
              entry.submittedBy === me.id ? ' You suggested it.' : ''}</span>
          </p>
        </header>

        <div class="entry-facts">
          <div class="fact">
            <span class="fact-value">${used ? used : '0'}</span>
            <span class="fact-label">Members logging it</span>
          </div>
          <div class="fact">
            <span class="fact-value">${level.total && level.lead
              ? store.levelLabel(level.lead) : 'Unrated'}</span>
            <span class="fact-label">Community level</span>
          </div>
          <div class="fact">
            <span class="fact-value">${linked ? 'Logged' : 'Not yet'}</span>
            <span class="fact-label">Your moves</span>
          </div>
        </div>

        <div class="actions">
          ${linked ? html`<a class="btn primary" href="#/move/${linked.id}">Open your move</a>`
            : html`<a class="btn primary" href="#/move/new?entry=${entry.id}">+ Add to my moves</a>`}
        </div>
      </div>

      ${levelSection(entry)}

      ${aliasSection(entry, me)}

      ${partsSection(parts, partsNote)}

      ${mediaSection({
        title: 'Media',
        rows: media, note: mediaNote, canUpload: true, me, panel: true,
      })}
    </article>`);

  wireLevelVote(entry);
  wireMedia({ parent: { entryId: entry.id }, rows: media, refresh: () => route({ keepScroll: true }) });

  $('#alias-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    attempt(async () => {
      const alias = await store.addEntryAlias(entry.id, data.get('alias'));
      await route({ keepScroll: true });
    });
  });

  $$('[data-drop-alias]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    await store.removeEntryAlias(btn.dataset.dropAlias);
    toast('That name is off the trick.');
    await route({ keepScroll: true });
  })));
}

/* ---------- view: community (the feed, and the members list) ---------- */

let feedFilter = 'all';        // 'all', or only the members I follow
let memberQuery = '';          // what the members search box holds, kept across redraws

/* Which tab is open comes from the URL rather than from a variable, so the back button works and a
 * plain #/community link lands somewhere predictable. */
async function viewCommunity(query) {
  const tab = query.get('tab') === 'members' ? 'members' : 'feed';
  setTitle('Community');

  /* One choice, once. The two views used to be two loose buttons in a row that looked exactly like
   * the audience filter underneath them, which is what made the screen read as four options in a
   * heap. They are one segmented control the width of the page now, and the heading says which half
   * is open, so the question "what am I looking at" is answered before the list starts. The label is
   * short and the panel below names the contents in full. */
  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Community</p><h1>${tab === 'members' ? 'Members' : 'Activity'}</h1></div>
    </div>
    <div class="seg seg-tabs" role="group" aria-label="What to show">
      <button type="button" class="seg-btn" data-tab="feed" aria-pressed="${tab === 'feed'}">Activity</button>
      <button type="button" class="seg-btn" data-tab="members" aria-pressed="${tab === 'members'}">Members</button>
    </div>
    <div id="community-body"></div>`);

  $$('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    go(btn.dataset.tab === 'members' ? '#/community?tab=members' : '#/community');
  }));

  if (tab === 'feed') await drawFeed();
  else await drawmembers();
}

/* The newest public moves and uploads. Row level security decides what this dancer may see, which
 * is why nothing here filters by privacy: a private account's rows never arrive in the first place. */
async function drawFeed() {
  const body = $('#community-body');
  const me = store.currentUser();
  const mine = store.followingIds();
  const keep = (ownerId) => feedFilter === 'all' || mine.has(ownerId);

  const onlyMine = feedFilter === 'following';
  /* Moves and uploads in one list, already ordered together by the store. */
  const activity = (await store.feedActivity()).filter((it) => keep(it.owner.id));

  /* The audience filter is a filter, not a second navigation, so it rides beside the heading that
   * names the list and is drawn smaller and quieter than the page's own control above it. One row,
   * two questions, each answered in the place a dancer would look for it. */
  body.innerHTML = String(html`
    <div class="panel-head">
      <h2 class="subhead">Community updates</h2>
      ${store.socialEnabled() ? html`
        <div class="seg seg-sm" role="group" aria-label="Whose posts to show">
          <button type="button" class="seg-btn" data-feed="all" aria-pressed="${feedFilter === 'all'}">Everyone</button>
          <button type="button" class="seg-btn" data-feed="following" aria-pressed="${onlyMine}">People I follow (${mine.size})</button>
        </div>` : ''}
    </div>
    ${activity.length ? html`<ul class="list">
      ${activity.map((it) => (it.kind === 'event' ? html`
        <li class="row">
          <a class="feed-who" href="#/user/${it.owner.id}">${avatarOf(it.owner, 'avatar-sm')}</a>
          <div class="row-main">
            <strong>${it.owner.username}</strong>
            <span class="muted">${it.event === 'achieved' ? 'marked' : 'added'}
              <a class="entry-link" href="#/move/${it.moveId}">${it.moveName}</a>
              ${it.event === 'achieved' ? 'as achieved' : 'to their goals'} · ${dateText(it.at)}</span>
          </div>
        </li>` : it.kind === 'move' ? html`
        <li class="feed-post">
          <a class="feed-who" href="#/user/${it.owner.id}">${avatarOf(it.owner, 'avatar-sm')}</a>
          <div class="card">${trickPreview({
            href: `#/move/${it.move.id}`,
            name: it.move.name,
            difficulty: it.move.difficulty,
            detail: `${it.owner.username} · ${dateText(it.at)}`,
          })}</div>
        </li>` : html`
        <li class="row">
          <a class="feed-who" href="#/user/${it.owner.id}">${avatarOf(it.owner, 'avatar-sm')}</a>
          <div class="row-main">
            <strong><a class="entry-link" href="${feedParentHref(it.media)}">${it.media.parent.name}</a></strong>
            <span class="muted">${it.owner.username} added a ${it.media.kind} · ${dateText(it.at)}</span>
          </div>
          <a class="feed-media" href="${feedParentHref(it.media)}">
            ${it.media.kind === 'video'
              ? html`<video src="${it.media.url}" preload="metadata" playsinline muted></video>`
              : html`<img src="${it.media.url}" alt="${it.media.caption || 'Photo'}" loading="lazy">`}
          </a>
          ${it.media.ownerId === me.id ? html`<div class="actions">
            <button type="button" class="btn small danger" data-remove="${it.media.id}"
              aria-label="Remove this ${it.media.kind}">Remove</button>
          </div>` : ''}
        </li>`))}
    </ul>` : html`<div class="empty"><p>${onlyMine
      ? 'Nobody you follow has posted anything yet.' : 'Nothing has been posted yet.'}</p></div>`}
  `);

  $$('[data-feed]').forEach((btn) => btn.addEventListener('click', () => {
    feedFilter = btn.dataset.feed;
    drawFeed();
  }));
  /* Reuses the media wiring: there is no upload control on the feed, only the remove button on
   * your own posts. */
  wireMedia({
    parent: null,
    rows: activity.filter((it) => it.kind === 'media').map((it) => it.media),
    refresh: () => route({ keepScroll: true }),
  });
}

/* Where an upload lives: on the move it belongs to, or on the trick in the dictionary. */
const feedParentHref = (m) => (m.parent.kind === 'move' ? `#/move/${m.parent.id}` : `#/dictionary/${m.parent.id}`);

/* The members list: the old Directory, now a tab, with avatars and a follow button each. */
async function drawmembers() {
  const body = $('#community-body');
  /* Everyone, A to Z by name. Case is ignored so "zoe" sits with "Zoe". */
  const all = (await store.listOtherUsers())
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
  /* Summaries for public accounts, fetched together so the list doesn't wait one by one. */
  const sums = new Map(await Promise.all(all.filter((u) => !u.isPrivate)
    .map(async (u) => [u.id, await store.summary(u.id)])));

  /* The search box is drawn once and only the rows beneath it are redrawn, so the field keeps its
   * focus while someone types. */
  body.innerHTML = String(html`
    <div class="filter-bar">
      <label class="set-label" for="member-search">Search</label>
      <div class="search-field">
        ${searchIcon}
        <input id="member-search" type="search" aria-label="Search members by name or studio" autocomplete="off" value="${memberQuery}">
      </div>
    </div>
    <div id="member-list"></div>`);

  const list = $('#member-list');
  const draw = () => {
    const q = memberQuery.trim().toLowerCase();
    /* A search matches the dancer's name or any studio they list. */
    const users = q
      ? all.filter((u) => u.username.toLowerCase().includes(q)
        || store.studiosOf(u).some((s) => store.studioLabel(s).toLowerCase().includes(q)))
      : all;

    list.innerHTML = String(html`${users.length ? html`<ul class="list">
      ${users.map((u) => {
        if (u.isPrivate) {
          return html`<li class="row">
            <span class="feed-who">${avatarOf(u, 'avatar-sm')}</span>
            <div class="row-main"><strong>${u.username}</strong><span class="muted">Private account</span></div>
          </li>`;
        }
        const sum = sums.get(u.id);
        const following = store.isFollowing(u.id);
        const studio = store.studioOf(u);
        const place = studio ? store.studioLabel(studio) : (u.city ?? '');
        return html`<li class="row">
          <a class="feed-who" href="#/user/${u.id}">${avatarOf(u, 'avatar-sm')}</a>
          <div class="row-main">
            <strong><a class="entry-link" href="#/user/${u.id}">${u.username}</a></strong>
            <span class="muted">${plural(sum.total, 'move')} logged${place ? ` · ${place}` : ''}${u.polingSince ? ` · Poler since ${u.polingSince}` : ''}</span>
          </div>
          ${store.socialEnabled() ? html`<div class="actions">
            <button type="button" class="btn small ${following ? '' : 'primary'}" data-follow="${u.id}"
              aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>
          </div>` : ''}
        </li>`;
      })}
    </ul>` : html`<div class="empty"><p>${q
      ? 'No one matches that search.' : 'No other members yet.'}</p></div>`}
    ${store.socialEnabled() ? '' : html`<p class="muted fineprint">Following needs
      <code>supabase/social.sql</code> run once in the Supabase SQL editor.</p>`}`);
    wireFollowActions(drawmembers);
  };

  $('#member-search').addEventListener('input', (e) => {
    memberQuery = e.target.value;
    draw();
  });
  draw();
}

/* ---------- view: one dancer's profile ---------- */

async function viewUser(id) {
  const user = await store.userById(id);
  if (!user) return notFound('That dancer does not exist.');
  if (user.id === store.currentUser().id) return go('#/');
  setTitle(user.username);

  const visible = store.canView(user.id);
  const [names, cats, moves] = visible
    ? await Promise.all([catMap(user.id), store.listCategories(user.id), store.listMoves(user.id)])
    : [new Map(), [], []];

  /* Following needs supabase/social.sql. Without it the profile still reads; the count, the button
   * and the two lists are left out and the reason is said on the page. */
  let social = null;
  let socialNote = '';
  if (!store.socialEnabled()) {
    socialNote = 'Following is off until supabase/social.sql is run in the Supabase SQL editor.';
  } else {
    try { social = await store.followLists(user.id); }
    catch (err) { socialNote = err.message; }
  }
  /* Their whole following count is the two lists added together: friends are the ones who follow
   * back, and the rest are under Following. */
  const counts = social
    ? { followers: social.followers.length, following: social.friends.length + social.following.length }
    : null;
  const following = store.isFollowing(user.id);
  /* Where they train and where they are, either of which may be missing - both are optional. The
   * studio links to its own page, which is where "who else goes here" is answered, and a dancer who
   * trains at more than one place shows the first with the rest behind a "+N". */
  const studios = store.studiosOf(user);
  const place = joinText([
    studios.length ? html`Trains at ${studioLink(studios[0])}${studios.length > 1 ? studioMore(studios.slice(1)) : ''}` : '',
  ].filter(Boolean));

  show(html`
    ${backLink('#/community?tab=members', 'Members')}
    <div class="page-head profile-head">
      <div class="who">
        ${avatarOf(user, 'avatar-lg')}
        <div>
          <div class="name-row">
            <h1>${user.username}</h1>
          </div>
          ${followBars(social)}
          ${!counts ? '' : html`<button type="button" class="btn small ${following ? '' : 'primary'}" id="follow"
            aria-pressed="${following ? 'true' : 'false'}">${following ? 'Following' : 'Follow'}</button>`}
          ${user.polingSince ? html`<p class="muted">Poler since ${user.polingSince}</p>` : ''}
          ${place.length ? html`<p class="muted">${place}</p>` : ''}
          ${user.instagram ? html`<p>${instagramLink(user.instagram)}</p>` : ''}
        </div>
      </div>
    </div>

    ${socialNote ? html`<p class="muted fineprint">${socialNote}</p>` : ''}

    ${visible ? html`
      ${cats.length ? html`<h2 class="subhead">Collections</h2>
        <div class="chips">${cats.map((c) => html`<a class="chip" href="#/collection/${c.id}">${c.name}</a>`)}</div>` : ''}
      <h2 class="subhead">Moves</h2>
      <div class="stack">${moves.length ? moves.map((m) => moveCard(m, names))
        : html`<div class="empty"><p>No moves logged yet.</p></div>`}</div>`
      : html`<div class="empty"><h3>This account is private</h3>
        <p>Only ${user.username} can see their moves.</p></div>`}
  `);

  $('#follow')?.addEventListener('click', () => attempt(async () => {
    if (store.isFollowing(user.id)) await store.unfollow(user.id);
    else await store.follow(user.id);
    toast(store.isFollowing(user.id) ? `You follow ${user.username}.` : `You no longer follow ${user.username}.`);
    await route({ keepScroll: true });
  }));
  wireFollowActions(() => route({ keepScroll: true }));
}

/* Who contributed an Instagram account to a studio. `added_by` is set to null when that dancer
 * closes their account (see instagram.sql), and "Added by unknown" would be a worse answer than
 * saying what actually happened. */
const addedByLine = (link, me) => (link.addedBy === me.id
  ? 'Added by you'
  : link.addedBy
    ? `Added by ${store.usernameOf(link.addedBy)}`
    : 'Added by a member who has since closed their account');

/* ---------- view: one studio ---------- */

/* A studio's own page: who trains there, and the Instagram accounts its members have contributed.
 * The directory can only answer "which studios are there", and the question a dancer actually has
 * about one is who else goes - and the question a studio has about itself is which account to
 * follow. So a studio row gets a page rather than a line in a dropdown.
 *
 * Nothing here is editable but the handles. A studio's name and city belong to whoever added it (see
 * store.addStudio), while the account list is meant to be filled in from below: the members who
 * train somewhere are the people who know its handle, so any signed-in dancer may add one, and the
 * row remembers who did.
 */
async function viewStudio(id) {
  const studio = store.studioById(id);
  if (!studio) return notFound('That studio is not in the list.');
  setTitle(studio.name);
  const me = store.currentUser();

  /* A failure here is the ordinary way to find out the studios file has not been run, so the page
   * carries on and simply has nobody to list. */
  const members = await store.membersAtStudio(studio.id).catch(() => []);
  const others = members.filter((u) => u.id !== me.id);
  const links = store.instagramEnabled() ? store.listStudioInstagrams(studio.id) : [];

  /* Whoever contributed a handle may be nobody on this page - anyone signed in can add one - so their
   * names are looked up before it is drawn, rather than read out of the cache that the members above
   * filled. A lookup that fails costs a name, not the page. */
  await Promise.all([...new Set(links.map((l) => l.addedBy).filter(Boolean))]
    .map((id) => store.userById(id).catch(() => null)));

  show(html`
    ${backLink('#/community?tab=members', 'Members')}
    <div class="page-head profile-head">
      <div class="who">
        ${avatarOf({ username: studio.name }, 'avatar-lg')}
        <div>
          <div class="name-row"><h1>${studio.name}</h1></div>
          <p class="muted">${studio.city ?? 'City not given'}</p>
        </div>
      </div>
    </div>

    <h2 class="subhead">Instagram</h2>
    ${!store.instagramEnabled() ? html`<p class="muted">Studio accounts are not switched on for this
      project yet: run <code>supabase/instagram.sql</code> in the Supabase SQL editor, then reload.</p>`
      : html`
      ${links.length ? html`<ul class="list">
        ${links.map((l) => html`
          <li class="row">
            <div class="row-main">
              ${instagramLink(l.handle)}
              <span class="muted">${addedByLine(l, me)}</span>
            </div>
            ${(l.addedBy === me.id || me.isAdmin) ? html`<div class="actions">
              <button type="button" class="btn small danger" data-unlink="${l.id}">Remove</button>
            </div>` : ''}
          </li>`)}
      </ul>` : html`<p class="muted">No Instagram account is listed for this studio yet.</p>`}

      <form class="form card" id="studio-link-form">
        <label class="field"><span>Add an Instagram account</span>
          <input type="text" name="handle" maxlength="60" autocapitalize="none" spellcheck="false"
            placeholder="@thestudio" required>
          <small>Just the part after the @. Anyone who trains here can add one.</small></label>
        <button class="btn primary" type="submit">Add account</button>
      </form>`}

    <!-- The heading is the count, because that is the question this section answers - how many
         members call this place home - and the list underneath is who they are. -->
    <h2 class="subhead">${plural(members.length, 'member')}</h2>
    ${!members.length
      ? '' : members.some((u) => u.id === me.id)
        ? html`<p class="muted subnote">You train here too.</p>`
        : html`<p class="muted subnote">Members who have listed this studio as somewhere they train.</p>`}
    ${others.length ? html`<ul class="list">${others.map((u) => personRow(u))}</ul>`
      : html`<div class="empty"><p>${members.length
        ? 'Nobody else has picked this studio yet.' : 'Nobody has picked this studio yet.'}</p></div>`}
  `);

  $('#studio-link-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input[name="handle"]');
    attempt(async () => {
      const added = await store.addStudioInstagram(studio.id, input.value);
      toast(`@${added.handle} is listed for ${studio.name}.`);
      await route({ keepScroll: true });
    });
  });

  $$('[data-unlink]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    await store.removeStudioInstagram(btn.dataset.unlink);
    toast('That account is off the studio page.');
    await route({ keepScroll: true });
  })));

  wireFollowActions(() => route({ keepScroll: true }));
}

/* ---------- view: admin review queue ---------- */

/* Two things are waiting for a decision, and they are different questions: a trick somebody wants to
 * add, and a name somebody wants changed. So they are two headed lists rather than one list of
 * everything, and the head counts them together because the admin's actual question is "how much is
 * waiting for me". The count in the navigation is the same number.
 *
 * A project that has not run supabase/entry-edits.sql still gets a working queue: the second list is
 * empty and says so, rather than failing the screen. */
/* One queue, not two. The second list - suggested name changes - was taken off this screen when
 * nicknames on a trick (supabase/aliases.sql) replaced the whole idea of arguing a trick into a
 * different name: a member who calls it something else now writes that down where a search finds it,
 * and nothing needs deciding. Nobody can file a proposal any more, so a list that could only ever
 * empty itself was a screen pretending to be useful. supabase/entry-edits.sql and the store calls it
 * belongs to are still on disk, unused, for anyone who wants the flow back. */
async function viewReview() {
  if (!store.currentUser()?.isAdmin) return notFound('Admins only.');
  setTitle('Review');
  const pending = await store.listPending();

  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Admin</p><h1>Review queue</h1></div>
      <span class="count">${pending.length}</span>
    </div>
    ${!pending.length ? html`<div class="empty"><h3>All caught up</h3>
      <p>Nothing is waiting for a decision.</p></div>` : html`
      <h2 class="subhead">New tricks</h2>
      <ul class="list">
        ${pending.map((e) => html`
          <li class="row">
            <div class="row-main">
              <strong>${e.name}</strong>
              <span class="muted">Suggested by ${store.usernameOf(e.submittedBy)} on ${dateText(e.createdAt)}</span>
            </div>
            <div class="actions">
              <button type="button" class="btn small primary" data-approve-entry="${e.id}">Approve</button>
              <button type="button" class="btn small danger" data-reject-entry="${e.id}">Reject</button>
            </div>
          </li>`)}
      </ul>`}`);

  const decide = (id, approve) => attempt(async () => {
    await store.reviewEntry(id, approve);
    toast(approve ? 'Approved and published.' : 'Rejected.');
    await route({ keepScroll: true });
  });
  $$('[data-approve-entry]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approveEntry, true)));
  $$('[data-reject-entry]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.rejectEntry, false)));
}

/* ---------- view: account ---------- */

/* Whether the username box is open, and whether the profile card is open for editing. Kept out of
 * the URL: both are short-lived forms, not screens. */
/* Which sheet of the profile editor is open: 'profile' for the details, 'avatar' for the picture, null
 * for neither. Kept here so that a redraw while a sheet is open (a studio added from inside it, say) puts
 * the same sheet back on screen. */
let openEditor = null;

/* Where a dancer trains, in the order the editor is showing them, while the editor is open. Module
 * state for the same reason the avatar picker reads its choice off the DOM: moving a studio up must
 * redraw the list without losing what has been typed in the boxes beside it. null means the editor
 * is closed. */
let studioDraft = null;

/* The value of the "Add a studio I cannot find" choice in the studio chooser. A sentinel rather than a
 * real id, because that choice selects no studio: it opens the two boxes that add one. */
const ADD_STUDIO = '__add-studio';

async function viewAccount() {
  setTitle('Account');
  const me = store.currentUser();
  const thisYear = new Date().getFullYear();

  /* The screen is a summary with one pencil beside the name, and the pencil is the only way in: it
   * opens every part of the profile at once. The avatar picker used to live in a card of its own with
   * the year and the studio under it, which is how the username ended up with an editor of its own
   * while the rest had a row of Save buttons. */
  const where = placeLine(me);

  /* My own profile has no page of its own - this screen is it - so my friends and the members I
   * follow are listed here, the same two lists other members see on my profile. */
  let social = null;
  if (store.socialEnabled()) {
    try { social = await store.followLists(me.id); } catch { social = null; }
  }

  /* Support sits on the profile rather than in Settings: it is a thing a dancer reaches for while
   * looking at their own screen, not while changing how the app behaves. Settings is a link row
   * with the other housekeeping, and logging out is neither - it stands on its own past a rule at
   * the bottom, where it cannot be hit on the way past. */
  show(html`
    <div class="page-head profile-head">
      <div class="who">
        <span class="avatar-wrap">
          ${avatarOf(me, 'avatar-lg')}
          ${store.socialEnabled() ? html`<button type="button" class="avatar-cam" id="change-avatar"
            title="Change avatar" aria-label="Change avatar">${cameraIcon}</button>` : ''}
        </span>
        <div>
          ${me.isAdmin ? html`<p class="eyebrow">Admin account</p>` : ''}
          <div class="name-row">
            <h1>${me.username}</h1>
          </div>
          ${followBars(social, { own: true })}
          ${where.length ? html`<p class="muted">${where}</p>`
            : html`<p class="muted"></p>`}
          ${me.instagram ? html`<p>${instagramLink(me.instagram)}</p>` : ''}
        </div>
      </div>
      <button type="button" class="icon-btn profile-edit" id="edit-profile"
        title="Edit profile" aria-label="Edit profile">${pencilIcon}</button>
    </div>

    ${profileEditor(me, thisYear)}

    <h2 class="subhead">Privacy</h2>
    <label class="check-row card">
      <input type="checkbox" id="private" ${me.isPrivate ? raw('checked') : ''}>
      <span><strong>Private account</strong>
        <small class="muted">Other members can't see your moves or collections. Dictionary suggestions are still reviewed as usual.</small></span>
    </label>

    <h2 class="subhead">Support</h2>
    <ul class="list">
      <li>
        <a class="link-row" href="#/support">
          ${supportIcon}
          <span><strong>Contact support</strong>
            <small class="muted">Something broken, or a question about your account?</small></span>
          ${chevronIcon}
        </a>
      </li>
      ${!me.isAdmin ? '' : html`
      <li>
        <a class="link-row" href="#/support/inbox">
          ${supportIcon}
          <span><strong>Support inbox</strong>
            <small class="muted">Every message the contact form has taken, and whether the email reached us.</small></span>
          ${chevronIcon}
        </a>
      </li>`}
    </ul>

    <h2 class="subhead">Settings</h2>
    <ul class="list">
      <li>
        <a class="link-row" href="#/settings">
          ${settingsIcon}
          <span><strong>Settings</strong>
            <small class="muted">Appearance, downloading your moves, closing your account</small></span>
          ${chevronIcon}
        </a>
      </li>
    </ul>

    <div class="account-actions">
      <button type="button" class="btn block" id="logout">Log out</button>
    </div>`);

  $('#private').addEventListener('change', (e) => {
    attempt(async () => {
      await store.setPrivacy(e.target.checked);
      toast(e.target.checked ? 'Your account is now private.' : 'Your account is now public.');
    });
  });
  $('#logout').addEventListener('click', () => {
    attempt(async () => { await store.logout(); go('#/auth'); });
  });

  /* Two sheets: the details, and the picture. Each has its own Save. Whichever is open is put back on
   * screen after a redraw, and closing either one - Cancel, Save or Escape - drops the unsaved studio
   * list, so the next open starts from what is saved. */
  $$('#profile-dialog, #avatar-dialog').forEach((d) => d.addEventListener('close', () => {
    openEditor = null;
    studioDraft = null;
  }));
  $('#edit-profile').addEventListener('click', () => {
    openEditor = 'profile';
    studioDraft = store.studiosOf(me).map((s) => s.id);
    drawStudios();
    $('#profile-dialog').showModal();
  });
  $('#profile-cancel').addEventListener('click', () => $('#profile-dialog').close());
  $('#change-avatar')?.addEventListener('click', () => {
    openEditor = 'avatar';
    $('#avatar-dialog').showModal();
  });
  $('#avatar-cancel').addEventListener('click', () => $('#avatar-dialog').close());
  if (openEditor) $(`#${openEditor}-dialog`)?.showModal();

  /* Picking an avatar only marks it: the pressed state moves and nothing is written until its Save. */
  $$('[data-avatar]').forEach((btn) => btn.addEventListener('click', () => {
    $$('[data-avatar]').forEach((other) => other.setAttribute('aria-pressed', String(other === btn)));
  }));

  /* ---------- the list of home studios ---------- */

  /* Drawn on its own rather than with the rest of the form, so that moving one up or removing one
   * does not redraw the page and lose what has been typed in the boxes beside it. */
  const drawStudios = () => {
    const list = $('#studio-draft');
    const pick = $('#studio-pick');
    if (!studioDraft || !list || !pick) return;
    /* The directory, read here rather than passed in: store.listStudios() answers out of the cache
     * the page has already filled, so this is a lookup and not a query. */
    const studios = store.studiosEnabled() ? store.listStudios() : [];

    list.innerHTML = studioDraft.length ? studioDraft.map((id, i) => {
      const studio = store.studioById(id);
      if (!studio) return '';
      const label = store.studioLabel(studio);
      return String(html`<li class="studio-draft-row">
        <span class="studio-draft-name">${label}</span>
        ${i === 0 ? html`<span class="tag">On my profile</span>` : ''}
        <span class="studio-draft-actions">
          <button type="button" class="icon-btn plain" data-studio-up="${id}"
            aria-label="Move ${label} up" ${i === 0 ? raw('disabled') : ''}>${arrowUpIcon}</button>
          <button type="button" class="icon-btn plain" data-studio-down="${id}"
            aria-label="Move ${label} down"
            ${i === studioDraft.length - 1 ? raw('disabled') : ''}>${arrowDownIcon}</button>
          <button type="button" class="btn small" data-studio-drop="${id}"
            aria-label="Remove ${label} from my list">Remove</button>
        </span>
      </li>`);
    }).join('') : String(html`<li class="studio-draft-row muted">None yet - add where you train below.</li>`);

    /* Only the studios that are not already listed, so the chooser cannot offer a duplicate. */
    pick.innerHTML = String(html`
      <option value="">Add a studio…</option>
      ${studios.filter((s) => !studioDraft.includes(s.id))
        .map((s) => html`<option value="${s.id}">${store.studioLabel(s)}</option>`)}
      <option value="${ADD_STUDIO}">+ Add a studio</option>`);
    const row = $('#studio-add-row');
    if (row) row.hidden = true;
  };

  const moveStudio = (id, by) => {
    const from = studioDraft.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= studioDraft.length) return;
    [studioDraft[from], studioDraft[to]] = [studioDraft[to], studioDraft[from]];
    drawStudios();
  };

  /* One listener on the list rather than three per row: the rows are replaced on every redraw, and a
   * listener attached to a row goes with it. */
  $('#studio-draft')?.addEventListener('click', (e) => {
    const up = e.target.closest('[data-studio-up]');
    const down = e.target.closest('[data-studio-down]');
    const drop = e.target.closest('[data-studio-drop]');
    if (up) moveStudio(up.dataset.studioUp, -1);
    else if (down) moveStudio(down.dataset.studioDown, 1);
    else if (drop) {
      studioDraft = studioDraft.filter((s) => s !== drop.dataset.studioDrop);
      drawStudios();
    }
  });

  /* Picking a studio from the list adds it at once - there is no second button. Choosing "Add a studio I
   * cannot find" opens the two boxes that add one instead. */
  $('#studio-pick')?.addEventListener('change', (e) => {
    const picked = e.target.value;
    if (picked === ADD_STUDIO) {
      $('#studio-add-row').hidden = false;
      $('#studio-name').focus();
      return;
    }
    if (picked && !studioDraft.includes(picked)) studioDraft = [...studioDraft, picked];
    drawStudios();
  });

  /* Adding a studio puts it in the shared directory and puts it in the list here; the form's own Save
   * is what makes it *yours*. A dancer who adds one and then cancels has added a studio rather than
   * claimed one, which is what the button says it does. */
  $('#studio-add')?.addEventListener('click', () => attempt(async () => {
    const studio = await store.addStudio({ name: $('#studio-name').value, city: $('#studio-city').value });
    if (!studioDraft.includes(studio.id)) studioDraft = [...studioDraft, studio.id];
    $('#studio-add-row').hidden = true;
    $('#studio-name').value = '';
    $('#studio-city').value = '';
    /* Redrawn from the top so the new studio joins the directory the chooser offers - the draft is
     * module state, so it survives the redraw with the order and the choices intact. */
    await route({ keepScroll: true });
    toast(`${store.studioLabel(studio)} is in the list now. Save to make it yours.`);
  }));

  drawStudios();

  $('#profile-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    attempt(async () => {
      /* The handle first: if it is already taken, renameMe says so and nothing else should move. */
      const username = String(data.get('username') ?? '').trim();
      if (username !== store.currentUser().username) await store.renameMe(username);

      /* Only the parts this project can actually store. A column that does not exist yet - poling_since
       * comes from social.sql, home_studio_id from studios.sql - is not a reason for the year to fail
       * along with it. The picture has its own sheet and its own Save. */
      const patch = { polingSince: String(data.get('polingSince') ?? '').trim() };
      /* The whole list in its order, once: home-studios.sql decides what the top one means, and the
       * old single-column write is gone with the dropdown that only had room for one. */
      if (store.homeStudiosEnabled()) patch.homeStudioIds = studioDraft ?? [];
      /* Both come from supabase/instagram.sql - the column on a profile and the table behind a studio
       * page - so one flag covers them. store.js still says which file to run if either is missing. */
      if (store.instagramEnabled()) patch.instagram = String(data.get('instagram') ?? '').trim();
      await store.saveProfile(patch);

      $('#profile-dialog').close();
      toast('Profile saved.');
      await route({ keepScroll: true });
    });
  });

  $('#avatar-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const picked = $('[data-avatar][aria-pressed="true"]');
    attempt(async () => {
      await store.saveProfile({ avatar: picked?.dataset.avatar || null });
      $('#avatar-dialog').close();
      toast('Avatar saved.');
      await route({ keepScroll: true });
    });
  });

  /* Exporting your data and deleting your account moved to #/settings; this screen only links
   * there, so there is nothing to wire up for them here. */
  wireFollowActions(() => route({ keepScroll: true }));
}

/* Everything about a profile, in two sheets. The details - the handle, the year a dancer started, the
 * Instagram account and where they train - sit behind the pencil with one Save at the bottom. The
 * picture has a sheet of its own behind "Change avatar", with its own Save, so a new picture never
 * waits on the details and the details never wait on a picture.
 *
 * Picking an avatar only marks it; Save is what writes.
 *
 * There is no city here on purpose. A studio already carries one, and a profile carrying a second
 * copy is a second thing that can be wrong - see studioLabel. */
function profileEditor(me, thisYear) {
  const studios = store.studiosEnabled() ? store.listStudios() : null;
  return html`
    <dialog class="sheet" id="profile-dialog" aria-labelledby="profile-title">
      <h2 id="profile-title">Edit profile</h2>

      <form class="form" id="profile-form">
        <div class="set-block">
          <label class="set-label" for="username-input">Username</label>
          <input type="text" id="username-input" name="username" value="${me.username}" minlength="3"
            maxlength="24" autocapitalize="none" spellcheck="false">
          <small class="muted field-help">3-24 characters: letters, numbers, dots, dashes or underscores.
          </small>
        </div>

        <div class="set-block">
          <label class="set-label" for="poling">Poler since</label>
          <input type="number" id="poling" name="polingSince" inputmode="numeric" min="1900"
            max="${thisYear}" placeholder="e.g. 2021" value="${me.polingSince ?? ''}">

        </div>

        <div class="set-block">
          <label class="set-label" for="instagram">Instagram</label>
          <input type="text" id="instagram" name="instagram" maxlength="60" autocapitalize="none"
            spellcheck="false" placeholder="yourhandle" value="${me.instagram ?? ''}">

        </div>

        <div class="set-block">
          <strong class="set-label" id="studios-label">Home studios</strong>
          ${!studios
            ? html`<p class="muted field-help">Optional, and needs <code>supabase/studios.sql</code> run once
                in the Supabase SQL editor.</p>`
          : html`
            <ul class="studio-draft" id="studio-draft" aria-labelledby="studios-label"></ul>
            <div class="field-row">
              <select id="studio-pick" aria-label="Pick a studio to add"></select>
            </div>
            <div class="field-row" id="studio-add-row" hidden>
              <input type="text" id="studio-name" maxlength="80" placeholder="Name of the studio">
              <input type="text" id="studio-city" maxlength="80" placeholder="City">
              <button type="button" class="btn small" id="studio-add">Add new studio</button>
            </div>
            <small class="muted field-help">${store.homeStudiosEnabled()
              ? html``
              /* One studio is all the profile can hold until the file has been run, so a list here
               * would be three places the app cannot keep. It still saves, and it saves the top. */
              : html`One studio can be saved for now; a whole list of them needs
                  <code>supabase/home-studios.sql</code> run once in the Supabase SQL editor. Today the
                  top one is the one saved.`}</small>`}
        </div>

        <div class="actions">
          <button type="submit" class="btn primary">Save changes</button>
          <button type="button" class="btn" id="profile-cancel">Cancel</button>
        </div>
      </form>
    </dialog>

    <dialog class="sheet" id="avatar-dialog" aria-labelledby="avatar-title">
      <form class="form" id="avatar-form">
        <h2 id="avatar-title">Change avatar</h2>
        <div class="avatar-picker" role="group" aria-labelledby="avatar-title">
          ${store.AVATARS.map((key) => html`
            <button type="button" class="avatar-opt" data-avatar="${key}" aria-pressed="${me.avatar === key}"
              aria-label="Avatar: ${key.replace('pleaser-', '').replace(/[-_]/g, ' ')}">${avatarOf({ avatar: key }, 'avatar-md')}</button>`)}
          <button type="button" class="avatar-opt" data-avatar="" aria-pressed="${!me.avatar}"
            aria-label="My initial">${avatarOf({ username: me.username }, 'avatar-md')}</button>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary">Save avatar</button>
          <button type="button" class="btn" id="avatar-cancel">Cancel</button>
        </div>
      </form>
    </dialog>`;
}

/* ---------- views: settings and support ---------- */

/* The housekeeping that is not about a dancer's profile: how the app looks, getting their data out,
 * and closing the account. It used to sit under the profile card, where "Delete my account" was one
 * scroll below an avatar picker; a screen of its own puts a deliberate step between the two. */
function viewSettings() {
  setTitle('Settings');
  const me = store.currentUser();
  const pref = themePref();
  /* Three groups, one shape each: heading, one line of explanation, then the control. The delete
   * group is not red and not boxed off on its own - it is the same size as the others and reads as
   * one of them until you actually read it, which is what "equal groupings" buys. Support used to be
   * a fourth group here and has moved to the profile, where a dancer actually looks for it. */
  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Account</p><h1>Settings</h1></div>
    </div>
    <p class="lede">How the app looks, your data, and the way out.</p>

    <div class="set-grid">
      <section class="set-card">
        <h2 class="set-title">Appearance</h2>
        <p class="set-help">System follows this device. A choice here is remembered on this device
          only.</p>
        <div class="seg" role="group" aria-label="Colour theme">
          ${THEMES.map((t) => html`<button type="button" class="seg-btn" data-theme-pick="${t.value}"
            aria-pressed="${pref === t.value}">${t.label}</button>`)}
        </div>
      </section>

      <section class="set-card">
        <h2 class="set-title">Your data</h2>
        <p class="set-help">Moves, notes, entries, exits and collections, as one JSON file. Photos and
          videos stay with their moves.</p>
        <div class="set-actions">
          <button type="button" class="btn" id="export">Download my moves (JSON)</button>
        </div>
      </section>

      <section class="set-card">
        <h2 class="set-title">Delete my account</h2>
        <p class="set-help">Your moves, collections, uploads and the tricks you suggested that are
          still waiting for review go with it. Tricks that were approved stay in the dictionary.
          Type your username to confirm.</p>
        <div class="set-actions">
          <input type="text" id="confirm-name" placeholder="${me.username}" autocomplete="off"
            aria-label="Type your username to confirm">
          <button type="button" class="btn danger" id="delete-account" disabled>Delete account</button>
        </div>
      </section>
    </div>`);

  /* Repainted in place rather than by redrawing the screen: the theme changes the moment you tap,
   * and a redraw would be work for no visible difference. */
  $$('[data-theme-pick]').forEach((btn) => btn.addEventListener('click', () => {
    applyTheme(btn.dataset.themePick);
    $$('[data-theme-pick]').forEach((other) =>
      other.setAttribute('aria-pressed', String(other === btn)));
  }));

  $('#export').addEventListener('click', () => {
    attempt(async () => {
      const blob = new Blob([JSON.stringify(await store.exportMine(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mypolemagazine-${me.username}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  });

  /* Typing the username is the confirmation: the button stays disabled until it matches. */
  const confirmName = $('#confirm-name');
  const deleteButton = $('#delete-account');
  confirmName.addEventListener('input', () => {
    deleteButton.disabled = confirmName.value.trim().toLowerCase() !== me.username.toLowerCase();
  });
  deleteButton.addEventListener('click', () => {
    attempt(async () => {
      await store.deleteAccount();
      toast('Your account and its data have been deleted.');
      go('#/auth');
    });
  });
}

/* Reached from the profile now (it used to live in Settings), and reachable while signed out on
 * purpose - see OPEN_WHEN_SIGNED_OUT. The email box is filled in from the session when there is one,
 * so a logged-in dancer only has to say what went wrong. */
function viewSupport() {
  setTitle('Support');
  const me = store.currentUser();
  show(html`
    ${backLink(backTo(me ? '#/account' : '#/auth'), 'Back')}
    <div class="page-head">
      <div><h1>Support</h1></div>
    </div>
    <p class="lede">Question or Comment? Write to me.</p>

    <form class="form card" id="support-form">
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off"
        aria-hidden="true">
      <label class="field"><span>Your name</span>
        <input type="text" name="name" maxlength="80" autocomplete="name"
          value="${me?.username ?? ''}" placeholder="Optional"></label>
      <label class="field"><span>Email</span>
        <input type="email" name="email" maxlength="160" autocomplete="email" required
          value="${store.myEmail()}">
        </label>
      <label class="field"><span>Subject</span>
        <input type="text" name="subject" maxlength="120" required placeholder="Subject"></label>
      <label class="field"><span>Message</span>
        <textarea name="message" rows="6" maxlength="4000" required
          placeholder="your message..."></textarea>
        </label>
      <button class="btn primary block" type="submit">Submit</button>
    </form>
`);

  $('#support-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    attempt(async () => {
      /* Disabled while in flight, so a slow send is not also sent twice. */
      button.disabled = true;
      try {
        const receipt = await store.sendSupportMessage({
          name: data.get('name'),
          email: data.get('email'),
          subject: data.get('subject'),
          message: data.get('message'),
          website: data.get('website'),
        });
        /* The server stores the message before it tries to email it, so "received" is true even when
         * the mail is switched off - and when it is, the dancer is told where the message actually
         * went rather than being promised an email that is not coming. */
        toast(receipt?.emailed === false
          ? 'Thank you - your message is saved, and it is waiting in the support inbox.'
          : 'Thank you - your message has been received.');
        await route({ keepScroll: true });   // a blank form, with the email box filled in again
      } finally {
        button.disabled = false;
      }
    });
  });
}

/* ---------- view: the support inbox (admins) ---------- */

/* Every message the contact form has taken, newest first. The email is still what a reply goes to,
 * but this list is the copy of record: the Edge Function writes the row before it tries to send
 * (see supabase/support.sql), so a mail outage shows up here as a message marked "not emailed"
 * rather than as nothing at all. Read-only apart from the handled flag - deleting somebody's words
 * is not something this screen should make easy. */
async function viewSupportInbox() {
  /* `?.` rather than `.` because support is one of the routes a signed-out visitor may reach (see
   * OPEN_WHEN_SIGNED_OUT), so this screen has to answer somebody with no session rather than throwing
   * on the way in. */
  if (!store.currentUser()?.isAdmin) return notFound('Admins only.');
  setTitle('Support inbox');
  let messages = [];
  let note = '';
  try { messages = await store.listSupportMessages(); }
  catch (err) { note = err.message; }
  const waiting = messages.filter((m) => !m.handled).length;
  const unsent = messages.filter((m) => !m.emailed).length;

  show(html`
    ${backLink('#/account', 'Back')}
    <div class="page-head">
      <div><p class="eyebrow">Support</p><h1>Support inbox</h1></div>
      <span class="count">${waiting}</span>
    </div>
    <p class="lede">Everything the contact form has taken, newest first${!waiting
      ? '.' : ` - ${plural(waiting, 'message')} still to deal with.`}</p>
    ${note ? html`<div class="empty"><h3>Support inbox is not set up</h3><p>${note}</p></div>` : ''}
    ${!note && unsent ? html`<p class="muted subnote">${plural(unsent, 'message')} never reached an
      inbox by email. They are here, which is the point of keeping them.</p>` : ''}
    ${note ? '' : messages.length ? html`<ul class="list">
      ${messages.map((m) => html`
        <li class="row support-row">
          <div class="row-main">
            <strong>${m.subject || 'No subject'}</strong>
            <span class="muted">${m.name || 'a visitor'}${m.username ? ` (@${m.username})` : ''} ·
              <a class="entry-link" href="mailto:${m.email}">${m.email}</a> ·
              ${dateText(m.createdAt)}</span>
            <div class="notes">${m.message}</div>
            <span class="muted fineprint">${m.emailed
              ? 'Emailed on its way in' : `Not emailed: ${m.emailError || 'email is switched off'}`}</span>
          </div>
          <div class="actions">
            <button type="button" class="btn small ${m.handled ? '' : 'primary'}" data-handled="${m.id}"
              data-state="${m.handled ? 'no' : 'yes'}"
              aria-pressed="${m.handled ? 'true' : 'false'}">${m.handled ? 'Handled' : 'Mark handled'}</button>
          </div>
        </li>`)}
    </ul>` : html`<div class="empty"><h3>No messages</h3><p>Nothing has come in through the contact
      form yet.</p></div>`}
  `);

  $$('[data-handled]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    const handled = btn.dataset.state === 'yes';
    await store.setSupportMessageHandled(btn.dataset.handled, handled);
    toast(handled ? 'Marked as handled.' : 'Back in the waiting list.');
    await route({ keepScroll: true });
  })));
}

/* ---------- start ---------- */

/* A confirmation link arrives as '#access_token=...' (or '?code=...'), with an
 * 'error_description' when it is stale. Neither is a route, so the router must not see it. */
function emailLink() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    isLink: /[?&#](access_token|code|error|error_description)=/.test(location.href),
    error: new URLSearchParams(location.search).get('error_description') ?? hash.get('error_description'),
  };
}

/* Turn the failures people actually hit into something they can act on. */
function startupHint(message) {
  const denied = /permission denied for table "?(\w+)"?/i.exec(message);
  if (denied) {
    return html`The role this session runs as has no privileges on the "${denied[1]}" table. That is a
      GRANT problem, which is separate from row-level security: a missing policy returns no rows,
      while a missing privilege throws this error. In the Supabase SQL editor run:
      grant usage on schema public to authenticated; and then
      grant select, insert, update, delete on all tables in schema public to authenticated;`;
  }
  if (/jwt|token/i.test(message)) {
    return html`The session token was rejected. Log in again, and check the project URL and publishable
      key in js/supabase.js belong to this project.`;
  }
  if (/does not exist|Could not find the table/i.test(message)) {
    return html`A table the app expects is missing, or it is not exposed to the API. Compare the
      tables named in README.md with the ones in the Supabase table editor.`;
  }
  return html`Usually that means the Supabase project was unreachable, the account has no row in the
    profiles table yet, or the URL this page was opened from is not in the project's redirect allow
    list.`;
}

/* Nothing should ever fail silently into an empty page. */
function showFatal(err) {
  console.error(err);
  show(html`
    <div class="empty">
      <h3>myPoleMagazine could not start</h3>
      <p>${err.message}</p>
      <p class="muted fineprint">${startupHint(err.message)}</p>
      <a class="btn" href="#/auth">Go to the login screen</a>
    </div>`);
}

/* A reset link comes back as '?reset=1' (set by requestPasswordReset in store.js). Read at load,
 * because the Supabase client consumes its token from the same URL and tidies the query away. */
const resetLink = new URLSearchParams(location.search).get('reset') === '1';

async function start() {
  const link = emailLink();

  /* Registered before init(), because the client can fire this while the page is still starting. */
  store.watchForPasswordRecovery(() => { location.hash = '#/reset'; });

  try {
    const { error } = await store.completeEmailLink();   // exchanges a ?code= link if there is one
    if (error && !link.error) link.error = error;
    await store.init();
  } catch (err) {
    showFatal(err);
    return;
  }

  if (link.isLink) {
    history.replaceState(null, '', location.pathname);   // drop the auth payload from the URL
    if (link.error) toast(`That email link did not work: ${link.error}`, true);
    else if (resetLink) toast('Choose a new password.');
    else if (store.currentUser()) toast('Email confirmed - you are logged in.');
  }

  /* Set after the URL has been tidied, so replaceState above cannot strip it again. */
  if (resetLink || store.isRecoveryPending()) location.hash = '#/reset';

  /* index.html already applied the saved theme before the first paint; this syncs the browser's own
   * chrome, and re-applies on a device flip so "System" keeps up without a reload. */
  applyTheme(themePref());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themePref()));

  window.addEventListener('hashchange', () => route());
  await route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}
/* ---------- journal: a dated log of the day's training, in a drawer opened from the nav ---------- */

const pad2 = (n) => String(n).padStart(2, '0');
/* The dancer's own calendar day rather than UTC, so an entry written late in the evening lands on
 * the day they are living in. */
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

/* Native <dialog>, like the add-a-trick sheet, so Escape and the focus trap come from the browser. */
function journalDrawer() {
  return html`
    <dialog class="journal-drawer" id="journal-drawer" aria-labelledby="journal-title">
      <div class="journal-head">
        <h2 id="journal-title">Journal</h2>
        <button type="button" class="btn small" id="journal-close">Close</button>
      </div>
      <form class="form" id="journal-form">
        <p class="journal-day"><time id="journal-day"></time></p>
        <label class="field"><span>What did you work on?</span>
          <textarea name="body" id="journal-body" rows="4" maxlength="2000" required
            placeholder="e.g. Spin drills, 20 minutes of climbs, chair work"></textarea>
        </label>
        <div class="actions"><button type="submit" class="btn primary">Add entry</button></div>
      </form>
      <ol class="journal-list" id="journal-list" aria-label="Past entries"></ol>
    </dialog>`;
}

/* The drawer is added once, outside #nav, because #nav is redrawn on every screen. */
function mountJournal() {
  if ($('#journal-drawer')) return;
  document.body.insertAdjacentHTML('beforeend', String(journalDrawer()));
  const drawer = $('#journal-drawer');
  $('#journal-close').addEventListener('click', () => drawer.close());
  $('#journal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = $('#journal-body').value;
    attempt(async () => {
      await store.addJournalEntry({ date: localDay(), body });
      $('#journal-form').reset();
      toast('Logged in your journal.');
      await drawJournal();
    });
  });
  $('#journal-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-journal-delete]');
    if (!btn || !window.confirm('Delete this journal entry?')) return;
    attempt(async () => {
      await store.deleteJournalEntry(btn.dataset.journalDelete);
      toast('Entry deleted.');
      await drawJournal();
    });
  });
}

async function drawJournal() {
  const list = $('#journal-list');
  const entries = await store.listJournal();
  list.innerHTML = entries.length
    ? entries.map((e) => String(html`
        <li class="journal-entry">
          <div class="journal-entry-head">
            <time datetime="${e.date}">${dayLabel(e.date)}</time>
            <button type="button" class="btn small" data-journal-delete="${e.id}">Delete</button>
          </div>
          <p class="journal-entry-body">${e.body}</p>
        </li>`)).join('')
    : '<li class="muted">Nothing logged yet. Your first entry will show here.</li>';
}

async function openJournal() {
  mountJournal();
  const drawer = $('#journal-drawer');
  const today = localDay();
  $('#journal-day').textContent = dayLabel(today);
  $('#journal-day').setAttribute('datetime', today);
  $('#journal-form').reset();
  drawer.showModal();
  $('#journal-body').focus();
  await attempt(drawJournal);
}

document.addEventListener('click', (e) => { if (e.target.closest('#journal-open')) openJournal(); });

start();
