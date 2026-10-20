import * as store from './store.js';

//---------- templating ----------

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

//---------- routing helpers ----------

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

//---------- light, dark, or follow the device ----------

const THEME_KEY = 'mypolemagazine-theme';
const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const systemPrefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

function themePref() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.value === saved) ? saved : 'system';
  } catch { return 'system'; }
}

function applyTheme(value) {
  const pref = THEMES.some((t) => t.value === value) ? value : 'system';
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* private mode; the choice just won't stick */ }
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark());
  $('#theme-color')?.setAttribute('content', dark ? '#08080a' : '#ffffff');
}

//---------- shared bits ----------

const UNRATED = 'unrated';

const diffMeter = (n) => {
  if (n === UNRATED) return html`<span class="diff-badge diff-unrated">Unrated</span>`;
  const value = Math.min(5, Math.max(1, Number(n) || 3));
  const label = store.difficultyLabel(value);
  return html`<span class="diff-badge">${label}</span>`;
};

//statuses of moves in current goals
const statusValue = (value) =>
  (store.STATUSES.find((s) => s.value === value) ?? store.STATUSES[0]).value;

/* `headingId` names a visible label beside the control - the move's own page says *Current goal* next
 * to it - and takes over as the accessible name when it is given, since that is what the dancer can
 * see. Everywhere else the sr-only text carries it: on a goals card the pill sits under the move's
 * name, and a visible label there would say the same thing twice. */
const statusSelect = (move, headingId = '') => html`
  <label class="status-pick status-${statusValue(move.status)}">
    <span class="sr-only">Where ${move.name} has got to</span>
    <select data-status="${move.id}" ${headingId ? raw(`aria-labelledby="${headingId}"`) : ''}
      aria-label="Where ${move.name} has got to">
      ${store.STATUSES.map((s) => html`<option value="${s.value}"
        ${statusValue(move.status) === s.value ? raw('selected') : ''}>${s.label}</option>`)}
    </select>
  </label>`;

function wireStatusSelects(moves) {
  $$('[data-status]').forEach((sel) => sel.addEventListener('change', () => attempt(async () => {
    const move = moves.find((m) => m.id === sel.dataset.status);
    await store.setStatus(sel.dataset.status, sel.value);
    const label = (store.STATUSES.find((s) => s.value === sel.value) ?? {}).label ?? '';
    toast(move ? `${move.name} is now ${label.toLowerCase()}.` : 'Status saved.');
    await route({ keepScroll: true });
  })));
}

//---------- trick preview cards ----------
const trickPreview = ({ href, name, mark = '', difficulty = null, badge = '', alias = '',
  detail = '', extra = '', actions = '', actionsInHead = false }) => {
  const blank = (v) => v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length);
  return html`<div class="trick-card">
    <div class="trick-head">
      <h3 class="trick-name">${href
        ? html`<a class="entry-link" href="${href}">${name}</a>`
        : name}${mark}</h3>
      <span class="trick-tail">
        ${difficulty === null ? '' : html`<span class="trick-level">${diffMeter(difficulty)}</span>`}
        ${badge}
        ${actionsInHead && !blank(actions) ? actions : ''}
      </span>
    </div>
    ${blank(alias) ? '' : html`<p class="trick-alias">also called “${alias}”</p>`}
    ${blank(detail) ? '' : html`<p class="trick-detail">${detail}</p>`}
    ${extra}
    ${!actionsInHead && !blank(actions) ? html`<div class="trick-actions">${actions}</div>` : ''}
  </div>`;
};

// Icons used
const plusIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 5v14M5 12h14"/></svg>`;
/* Six dots: the one mark everyone already reads as "hold this and move it". */
const gripIcon = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
  <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>
  <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
  <circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
const searchIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
const checkIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/></svg>`;
const cameraIcon = html`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const pencilIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z"/><path d="M14.5 5.5l4 4"/></svg>`;
const profileIcon = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="8" r="3.75"/><path d="M4.75 20.5a7.25 7.25 0 0 1 14.5 0"/></svg>`;
const supportIcon = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.9 2.4-2.9 2.4"/>
  <path d="M12 16.4h.01"/></svg>`;
const arrowUpIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
const arrowDownIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`;
const chevronIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 18 6-6-6-6"/></svg>`;
const crossIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const trashIcon = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const settingsIcon = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const homeIcon = html`<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 3L14.0357 8.16153C14.2236 8.63799 14.3175 8.87622 14.4614 9.0771C14.5889 9.25516 14.7448 9.41106 14.9229 9.53859C15.1238 9.68245 15.362 9.77641 15.8385 9.96432L21 12L15.8385 14.0357C15.362 14.2236 15.1238 14.3175 14.9229 14.4614C14.7448 14.5889 14.5889 14.7448 14.4614 14.9229C14.3175 15.1238 14.2236 15.362 14.0357 15.8385L12 21L9.96432 15.8385C9.77641 15.362 9.68245 15.1238 9.53859 14.9229C9.41106 14.7448 9.25516 14.5889 9.0771 14.4614C8.87622 14.3175 8.63799 14.2236 8.16153 14.0357L3 12L8.16153 9.96432C8.63799 9.77641 8.87622 9.68245 9.0771 9.53859C9.25516 9.41106 9.41106 9.25516 9.53859 9.0771C9.68245 8.87622 9.77641 8.63799 9.96432 8.16153L12 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const dateText = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const catMap = async (userId) => new Map((await store.listCategories(userId)).map((c) => [c.id, c.name]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const compareNames = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const backLink = (href, label) => html`<a class="btn small page-back" href="${href}" aria-label="${label}" title="${label}">←</a>`;

const joinText = (bits) => bits.flatMap((bit, i) => (i ? [' · ', bit] : [bit]));

/* On a profile the studio is shown as its name alone. "Studio 54 — Leeds" is a directory label - it is
 * how two studios with the same name are told apart in a dropdown - and read as prose on a profile the
 * dash is just punctuation in the middle of a sentence. The city is still there for anyone who wants
 * it: it is the link's title, and the studio's own page leads with it. */
const studioLink = (studio) =>
  html`<a class="quiet-link" href="#/studio/${studio.id}" title="${store.studioLabel(studio)}">${studio.name}</a>`;

const studioMore = (rest) => html`<span class="studio-more" tabindex="0"
  aria-label="Also trains at ${rest.map((s) => store.studioLabel(s)).join(', ')}">
  <span class="studio-more-count" aria-hidden="true">+${rest.length}</span>
  <span class="studio-more-panel"><span class="studio-more-box">${rest.map((s) => html`<span class="studio-more-item">${studioLink(s)}</span>`)}</span></span>
</span>`;

const instagramLink = (handle) => html`<a class="chip" href="${store.instagramUrl(handle)}"
  target="_blank" rel="noopener noreferrer">@${handle}</a>`;

//---------- avatars ----------

function avatarAlt(text) {
  let sum = 0;
  for (const ch of String(text ?? '')) sum += ch.codePointAt(0);
  return sum % 2 === 1;
}

function avatarOf(user, cls = '') {
  const src = store.avatarSrc(user?.avatar);
  if (src) {
    const art = src.endsWith('.svg') ? ' avatar-art' : '';
    return html`<img class="avatar${art} ${cls}" src="${src}" alt="" loading="lazy"
      width="96" height="96">`;
  }
  const name = String(user?.username ?? '?');
  return html`<span class="avatar avatar-letter ${cls}${avatarAlt(name) ? ' alt' : ''}"
    aria-hidden="true">${name.trim().charAt(0).toUpperCase() || '?'}</span>`;
}

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

const openBars = new Set();

const closeFollowBars = () => {
  openBars.clear();
  $$('.follow-bar').forEach((bar) => { bar.open = false; });
};
document.addEventListener('click', (e) => { if (!e.target.closest('.follow-bars')) closeFollowBars(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFollowBars(); });

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
        ? 'members who follow you.'
        : 'members who follow them.',
      canRemove: own,
      empty: own ? 'Nobody follows you yet.' : 'Nobody follows them yet.',
    })}
    ${bar('Friends', lists.friends, {
      empty: 'No friends yet.',
    })}
    ${bar('Following', lists.following, {
      note: 'members this account follows',
      empty: own
        ? 'You are not following anyone yet.'
        : 'Not following anyone yet.',
    })}</div>`;
}

function wireFollowActions(refresh) {
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

//---------- navigation bar ----------

/* Five tabs, and two things that deliberately are not here. The journal is a floating notepad now, so
 * it can be reached from any screen instead of only from the bar (see the journal section below).
 * Review is admin work on a list - a bigger-screen job that lives under Account, which is also why
 * its count rides on the profile icon: that way a queue of suggestions is visible from every screen,
 * not only on the one tab an admin happens to be looking at.
 *
 * `data-nav` is on each link because the phone bar is a different order: Home sits in the middle
 * there, where a thumb lands, with the two lists either side of it (see the mobile rules in
 * css/style.css). The markup keeps one order so the two layouts cannot drift apart. */
function renderNav(section) {
  const nav = $('#nav');
  const me = store.currentUser();
  nav.hidden = !me;
  journalButton().hidden = !me;
  placeJournalFab();
  /* Once more on the next frame. The floor the button is held above is measured from the bar, and the
   * bar's height can still change after this line - a webfont landing, a label wrapping - which left
   * the button a few pixels off the place it was saved in. On the next frame the number is final. */
  requestAnimationFrame(placeJournalFab);
  if (!me) return;

  const items = [
    { key: 'home', href: '#/', name: 'Home', icon: html`<span class="home-nav-icon">${homeIcon}</span>` },
    { key: 'moves', href: '#/moves', name: 'My Moves' },
    { key: 'dictionary', href: '#/dictionary', name: 'Dictionary' },
    { key: 'community', href: '#/community', name: 'Community' },
    { key: 'account', href: '#/account', name: 'Account', icon: profileIcon },
  ];

  const pending = store.pendingCount();
  const link = ({ key, href, name, icon }) => {
    const here = key === section ? raw('aria-current="page"') : '';
    const waiting = key === 'account' && pending;
    const pill = waiting ? html`<span class="pill" aria-hidden="true">${pending}</span>` : '';
    /* The count is in the accessible name too, since the pill itself is hidden from a screen reader
     * in favour of this sentence. */
    const named = waiting ? `${name}, ${plural(pending, 'suggestion')} waiting for review` : name;
    return icon
      ? String(html`<a class="icon-only" data-nav="${key}" href="${href}" ${here} aria-label="${named}" title="${name}">${icon}${pill}</a>`)
      : String(html`<a data-nav="${key}" href="${href}" ${here}>${name}</a>`);
  };
  nav.innerHTML = items.map(link).join('');
}

const raw = (s) => new Safe(s);

//---------- router ----------

let screenHash = '';
let cameFromHash = '';
const backTo = (fallback) => (cameFromHash && cameFromHash !== screenHash ? cameFromHash : fallback);

const SECTION = {
  '': 'home', home: 'home', moves: 'moves', move: 'moves',
  collections: 'moves', collection: 'moves',
  dictionary: 'dictionary', Bible: 'dictionary',   // legacy #/Bible route
  community: 'community', Directory: 'community', browse: 'community', user: 'community',
  studio: 'community',   // keep Community active for studio pages
  review: 'review', account: 'account',
  reset: 'account',
  settings: 'account',
  support: 'account',
};

const OPEN_WHEN_SIGNED_OUT = ['auth', 'forgot', 'reset', 'support'];

async function route({ keepScroll = false } = {}) {
  const { parts, query } = parseHash();
  const me = store.currentUser();   // cached in store

  const hash = location.hash || '#/';
  if (hash !== screenHash) { cameFromHash = screenHash; screenHash = hash; }

  if (!me && !OPEN_WHEN_SIGNED_OUT.includes(parts[0] ?? '')) return go('#/auth');
  if (me && parts[0] === 'auth') return go('#/');

  if (SECTION[parts[0] ?? ''] !== 'account') { openEditor = null; studioDraft = null; }

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
    else if (view === 'collections') return go('#/moves');   // legacy collection route
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

//---------- view: login / register ----------

let authMode = 'login';
let authEmail = '';   // kept across forms

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

//---------- password reset ----------

let forgotSentTo = '';

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

//---------- home ----------

let goalPanel = null;
let goalSource = 'move';
let goaldictionaryQuery = '';

/* Two ways to pick, and one way to write a move down that is not in the app yet: the + on the My
 * Moves side of the panel, which opens the move form with this list already ticked. That is
 * deliberately not the old in-panel New Move form - the form is a page, and it is where entries,
 * exits and photos live - so the + goes there rather than growing a second, smaller one here. */
const GOAL_SOURCES = [
  { value: 'move', label: 'My Moves' },
  { value: 'dictionary', label: 'Dictionary' },
];

async function loadAddPanel(moves, target) {
  return {
    moves,
    entries: await store.listEntries(),
    linked: new Map(moves.filter((m) => m.dictEntryId).map((m) => [m.dictEntryId, m])),
  };
}

function addPanelHtml(target, moves) {
  const verb = target.isDefault ? 'Add to goals' : 'Add to collection';
  /* My Moves shows every move, not only the ones that could still be added. A list that hides what is
   * already in the collection answers "can I add this?" by omission, so a dancer hunting for a move
   * they are sure they logged finds nothing and assumes it is gone. Shown and disabled instead: the
   * row says where it already is, which is the answer to the question they actually had. */
  /* The empty case is the one that needs this most: the panel that says "you have not logged a move
   * yet" now offers the thing that fixes it, instead of sending you to another tab to find the +. */
  const newMove = html`<a class="btn" href="#/move/new?cat=${target.id}">+ New move</a>`;

  const sourcePanel = () => {
    if (goalSource === 'dictionary') {
      return html`<section class="goal-source-block">
        <input type="search" id="goal-dictionary-q" placeholder="Search the dictionary"
          aria-label="Search the dictionary" value="${goaldictionaryQuery}">
        <div class="stack" id="goal-dictionary-list"></div>
      </section>`;
    }
    if (!moves.length) {
      return html`<section class="goal-source-block">
        ${newMove}
        <p class="muted">You have not logged a move yet. The + above writes one down and puts it here.
          Entries, exits and photos come after, on its own page.</p>
      </section>`;
    }
    return html`<section class="goal-source-block">
      ${newMove}
      <div class="stack" id="goal-move-list">
        ${moves.map((m) => {
          const already = m.categoryIds.includes(target.id);
          /* Each row is left as markup, not turned into a string: stringified here it would be escaped
           * by the outer template and every dancer would see the HTML of a card instead of the card. */
          return html`<div class="card${already ? ' disabled' : ''}">${trickPreview({
            href: `#/move/${m.id}`,
            name: m.name,
            difficulty: m.difficulty,
            actions: already
              ? html`<button type="button" class="btn small" disabled>Already in</button>`
              : html`<button type="button" class="btn small primary" data-goal-move="${m.id}">${verb}</button>`,
          })}</div>`;
        })}
      </div>
    </section>`;
  };

  return html`
    <div class="goal-add" id="goal-add">
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
    /* Every row in the panel links to the move or the trick it names, so tapping one navigates. The
     * sheet has to go with it: left open, it sits over the page it sent you to. Adding a goal does not
     * move the hash, so this cannot close the panel on the thing the panel is for. */
    addEventListener('hashchange', () => { if (dialog.open) dialog.close(); });
  }
  return dialog;
}

async function drawGoalPanel() {
  if (!goalPanel) return;
  const { target, where } = goalPanel;
  const moves = await store.listMoves(store.currentUser().id);
  const data = await loadAddPanel(moves, target);
  const title = target.isDefault ? 'Add to current goals' : 'Add to collection';
  goalDialog().innerHTML = String(html`<h2 id="goal-dialog-title">${title}</h2>${addPanelHtml(target, data.moves)}`);
  wireAddPanel(target, where, data);
}

async function afterGoalChange() {
  await drawGoalPanel();
  await route({ keepScroll: true });
}

async function openGoalPanel(target, where) {
  goalPanel = { target, where };
  const dialog = goalDialog();
  await drawGoalPanel();
  if (!dialog.open) dialog.showModal();
}

function wireAddPanel(target, where, { entries, linked }) {
  const addWord = target.isDefault ? 'Add as goal' : 'Add to collection';

  /* The cross in the panel's corner. Closing the panel is closing the dialog it lives in - the same
   * thing Escape and a tap outside already do - so it is wired to the same call. It was drawn but
   * never listened to: the one control in the app that did nothing at all. */
  $('#goal-add-x')?.addEventListener('click', () => goalDialog().close());

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

  const drawdictionary = () => {
    const list = $('#goal-dictionary-list');
    if (!list) return;
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

  $$('[data-goal-move]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    await store.addToCategory(btn.dataset.goalMove, target.id);
    toast(`Added to ${where}.`);
    await afterGoalChange();
  })));
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

/* The order a dancer dragged their goals into. `order` is a Map of collection id -> place, so a list
 * nobody has rearranged - or a project where goal-order.sql has not been run, where every place is
 * missing - keeps the order it arrived in, which is newest edit first. Array#sort is stable and every
 * comparison here is equal in that case, so nothing moves. */
const orderInGoals = (moves, categoryId) => [...moves].sort((a, b) =>
  (a.order?.get(categoryId) ?? Number.MAX_SAFE_INTEGER) - (b.order?.get(categoryId) ?? Number.MAX_SAFE_INTEGER));

/* Dragging a goal card into a new place.
 *
 * By a grip rather than by the card: a card holds a link, a status dropdown and a Remove button, and on
 * a phone a press-and-drag on any of those is a scroll, a tap or a text selection. The grip is the one
 * part of the card that only ever means "move me", so touch-action: none is safe there and nowhere
 * else on it.
 *
 * The card follows the finger with a transform, which does not reflow the list under it, and the card
 * whose place it would take shows a pink edge instead. The order is written once, on release - a
 * request per pixel dragged would be a request per pixel dragged. */
let goalDrag = null;

const goalCards = () => (goalDrag ? [...goalDrag.list.querySelectorAll('[data-goal-card]')] : []);

function settleGoalDrag() {
  for (const card of goalCards()) {
    card.classList.remove('reordering', 'drop-before');
    card.style.transform = '';
  }
  goalDrag = null;
}

function endGoalDrag(save) {
  if (!goalDrag) return;
  const { list, goals, card, slot, moved } = goalDrag;
  if (!moved) {
    goalDrag = null;                       // a press on the grip that never became a drag
    return;
  }
  settleGoalDrag();
  if (!save) return;                       // the drag was cancelled: the list keeps its order
  const ids = [...list.querySelectorAll('[data-goal-card]')]
    .map((c) => c.dataset.goalCard).filter((id) => id !== card.dataset.goalCard);
  ids.splice(Math.min(slot, ids.length), 0, card.dataset.goalCard);
  saveGoalOrder(goals.id, ids, '');
}

/* Writes an order and redraws from it either way. The redraw is what makes a failed save honest: the
 * card has already been dropped where the finger left it, so the list has to be shown the order the
 * database actually holds rather than the one it was asked to hold. */
async function saveGoalOrder(categoryId, ids, message) {
  await attempt(async () => {
    try {
      await store.setCategoryOrder(categoryId, ids);
    } finally {
      await route({ keepScroll: true });
    }
    if (message) toast(message);
  });
}

function wireGoalReorder(list, goals) {
  if (!list) return;
  const SLOP = 5;                          // px of travel before a press counts as a drag

  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const control = e.target.closest('button, select, option, a, input, textarea, label');
    if (control && !control.closest('[data-grip]')) return;
    const card = e.target.closest('[data-goal-card]');
    if (!card) return;
    e.preventDefault();
    goalDrag = {
      list, goals, card, pointerId: e.pointerId,
      startY: e.clientY, moved: false, slot: goalCards().length - 1,
    };
    card.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', (e) => {
    if (!goalDrag) return;
    const dy = e.clientY - goalDrag.startY;
    if (!goalDrag.moved) {
      if (Math.abs(dy) < SLOP) return;
      goalDrag.moved = true;
      goalDrag.card.classList.add('reordering');
    }
    goalDrag.card.style.transform = `translateY(${dy}px)`;
    /* Which slot it would land in: the number of other cards whose middle the finger is below. The
     * card being dragged is left out, so the slot is an index among the cards that stay put. */
    const others = goalCards().filter((c) => c !== goalDrag.card);
    const slot = others.findIndex((c) => {
      const box = c.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    goalDrag.slot = slot < 0 ? others.length : slot;
    others.forEach((c, i) => c.classList.toggle('drop-before', i === goalDrag.slot));
  });

  list.addEventListener('pointerup', () => endGoalDrag(true));
  list.addEventListener('pointercancel', () => endGoalDrag(false));

  /* The same move with a keyboard, because a drag is the one gesture a keyboard cannot make. Every
   * grip is a button and a button that does nothing when it is pressed is a lie: the arrow keys move
   * the card it belongs to, one place at a time, and the focus follows it so a second press continues
   * from where the first one left off. */
  list.addEventListener('keydown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const id = grip.dataset.grip;
    const ids = [...list.querySelectorAll('[data-goal-card]')].map((c) => c.dataset.goalCard);
    const from = ids.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    attempt(async () => {
      try {
        await store.setCategoryOrder(goals.id, ids);
      } finally {
        await route({ keepScroll: true });
        /* The redraw replaces the list, so the old element is not where the new grip is: look it up
         * in the document, or the focus would be dropped on the floor with the old markup. */
        $(`[data-goal-card="${id}"] [data-grip]`)?.focus();
      }
    });
  });
}

/* A pointer let go somewhere else still ends a drag - a browser can drop capture on a system gesture,
 * and a card left floating would be worse than a reorder that did not happen. Installed once here,
 * not once per visit to the home screen. */
document.addEventListener('pointerup', (e) => {
  if (goalDrag && e.pointerId === goalDrag.pointerId) endGoalDrag(true);
}, true);

async function viewHome() {
  setTitle('Home');
  const me = store.currentUser();

  let goals = null;
  let goalsNote = '';
  try { goals = await store.ensureGoalsCategory(); }
  catch (err) { goalsNote = err.message; }

  const [cats, moves] = await Promise.all([store.listCategories(me.id), store.listMoves(me.id)]);
  const inGoals = goals ? orderInGoals(moves.filter((m) => m.categoryIds.includes(goals.id)), goals.id) : [];

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
          <div class="card goal-card" data-goal-card="${m.id}">
            ${trickPreview({
              href: `#/move/${m.id}`,
              name: m.name,
              difficulty: m.difficulty,
              /* The grip only appears when there is something to put the card beside. */
              actions: html`${inGoals.length > 1 ? html`<button type="button"
                  class="icon-btn plain goal-grip" data-grip="${m.id}"
                  title="Drag to reorder"
                  aria-label="Reorder ${m.name}, drag or use the arrow keys">${gripIcon}</button>` : ''}${statusSelect(m)}
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
  wireGoalReorder($('#goal-list'), goals);
  /* Taking a goal off the list is one tap away from the status dropdown and two from the grip, so it
   * asks first - the same way deleting a move or a collection does. The question says what happens to
   * the move as well, because "remove" on its own reads like it might delete it: it leaves your goals
   * and goes back to My Moves, which is where a goal you are not chasing right now belongs. */
  $$('[data-drop]').forEach((btn) => btn.addEventListener('click', () => {
    const name = inGoals.find((m) => m.id === btn.dataset.drop)?.name ?? 'this move';
    if (!confirm(`Take “${name}” off your current goals? The move stays in My Moves.`)) return;
    attempt(async () => {
      await store.removeFromCategory(btn.dataset.drop, goals.id);
      toast('Taken off your current goals.');
      await route({ keepScroll: true });
    });
  }));
  $('#add-goal-toggle')?.addEventListener('click', () => attempt(() => openGoalPanel(goals, 'your current goals')));
}

//---------- my moves ----------

const filters = { q: '', sort: 'recent' };

async function viewMoves() {
  setTitle('Skill Roster');
  const me = store.currentUser();
  const [cats, moves] = await Promise.all([store.listCategories(me.id), store.listMoves(me.id)]);
  const names = new Map(cats.map((c) => [c.id, c.name]));

  const head = html`
  <br>
    <div class="page-head">
    
      <div><h1>Skill Roster</h1></div>
      <a class="btn primary" href="#/move/new">+ Add move</a>
    </div>`;

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

//---------- photos & videos ----------

const megabytes = (bytes) => Math.round(bytes / 1048576);

const fileSize = (bytes) => (bytes >= 1048576
  ? `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

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
      ${canUpload ? html`<span class="muted upload-note">JPG, PNG, WebP, GIF or MP4/WebM/MOV, up to ${megabytes(store.MAX_UPLOAD_BYTES)} MB each.</span>` : ''}

    </div>`;
}

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

//---------- move ----------

async function viewMove(id) {
  const move = await store.getMove(id);
  if (!move) return notFound('That move does not exist, or it belongs to a private account.');
  setTitle(move.name);

  const me = store.currentUser();
  if (move.userId === me.id) return viewMoveForm(id, new URLSearchParams());
  const [owner, names, entry] = await Promise.all([
    store.userById(move.userId),
    catMap(move.userId),
    move.dictEntryId ? store.getEntry(move.dictEntryId) : null,
  ]);
  const ownerName = owner?.username ?? 'this dancer';

  let media = [];
  let mediaNote = '';
  try { media = await store.listMedia({ moveId: move.id }); }
  catch (err) { mediaNote = mediaSetupNote(err); }

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

//---------- chip input ----------

function chipField(el, initial, label) {
  let items = [...initial];
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chip-text';
  input.maxLength = 80;
  input.setAttribute('aria-label', `Add to ${label}`);

  const syncPlaceholder = () => {
    input.placeholder = items.length ? '' : 'Enter to add';
  };

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
    syncPlaceholder();
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

//---------- add / edit move ----------

/* Entries, exits, combos and notes are shown before they are offered: each reads as what it holds
 * until the pencil beside its label is tapped. Nothing is thrown away in between - the control inside
 * is drawn once and the pencil only hides its buttons and its box to type in - so a half-typed entry
 * survives the pencil being closed again. */
const lockedField = (label, control, id) => html`
  <div class="field" id="field-${id}" data-editing="off">
    <div class="field-head">
      <span class="label">${label}</span>
      <button type="button" class="icon-btn plain" data-edit="${id}" aria-expanded="false"
        aria-controls="f-${id}" aria-label="Edit ${label}" title="Edit ${label}">${pencilIcon}</button>
    </div>
    ${control}
  </div>`;

async function viewMoveForm(id, query) {
  const me = store.currentUser();
  let move = null;
  if (id) {
    move = await store.getMove(id);
    if (!move || move.userId !== me.id) return notFound('You can only edit your own moves.');
  }
  setTitle(move ? `Edit ${move.name}` : 'Add move');

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
  const level = Math.min(5, Math.max(1, Number(m.difficulty) || 3));

  const view = html`
    ${backLink(backHref, move ? 'My moves' : 'Cancel')}
    <div class="page-head move-head">
      <div><p class="eyebrow">${move ? 'Move' : 'New move'}</p><h1>${move ? m.name : 'Add a move'}</h1></div>
      <div class="head-fields">
        ${move ? html`<div class="head-field">
          <span class="label" id="status-head">Current goal</span>
          ${statusSelect(move, 'status-head')}
        </div>` : ''}
        <div class="head-field">
          <span class="label" id="diff-head">Difficulty</span>
          <div class="diff-edit">
            <div class="diff-steps" role="radiogroup" aria-labelledby="diff-head">
              ${[1, 2, 3, 4, 5].map((i) => html`<button type="button" class="diff-step ${i <= level ? 'on' : ''}"
                role="radio" data-level="${i}" aria-checked="${i === level ? 'true' : 'false'}"
                aria-label="${i} of 5"></button>`)}
            </div>
            <p class="diff-label" id="diff-label" aria-live="polite">${store.difficultyLabel(level)}</p>
          </div>
        </div>
      </div>
    </div>

    <form class="form" id="move-form">
      <input type="hidden" name="difficulty" value="${level}">
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

      ${lockedField('Entries', html`<div class="chip-field" id="f-entries"></div>`, 'entries')}
      ${lockedField('Exits', html`<div class="chip-field" id="f-exits"></div>`, 'exits')}
      ${lockedField('Combines well with...', html`<div class="chip-field" id="f-combos"></div>`, 'combos')}

      <fieldset class="field"><legend>Collections</legend>
        <div class="checks">
          ${cats.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c.id}" ${m.categoryIds.includes(c.id) ? raw('checked') : ''}> ${c.name}</label>`)}
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

      <div class="field" id="field-notes" data-editing="off">
        <div class="field-head">
          <label class="label" for="notes-text">Notes</label>
          <button type="button" class="icon-btn plain" data-edit="notes" aria-expanded="false"
            aria-controls="notes-text" aria-label="Edit notes" title="Edit notes">${pencilIcon}</button>
        </div>
        <p class="notes-read" id="notes-read"></p>
        <textarea class="notes-input" id="notes-text" name="notes" maxlength="2000" placeholder="">${m.notes}</textarea>
      </div>

      <div class="actions">
        <button class="btn primary" type="submit">Save move</button>
        ${move ? html`<button type="button" class="btn danger" id="delete">Delete from My Moves</button>`
          : html`<a class="btn" href="${backHref}">Cancel</a>`}
      </div>
    </form>`;
  show(view);
  if (move) {
    wireStatusSelects([move]);
    $('#delete').addEventListener('click', () => {
      if (!confirm(`Delete "${move.name}"?`)) return;
      attempt(async () => { await store.deleteMove(move.id); toast('Move deleted.'); go('#/moves'); });
    });
  }

  const formEl = $('#move-form');
  const diffInput = formEl.elements.difficulty;
  const diffLabel = $('#diff-label');
  /* The dashes live in the page head now, beside the name, so they are found on the page rather than
   * inside the form - the hidden input carrying the answer is still in the form, which is what the
   * save reads. */
  $$('.diff-step').forEach((step) => step.addEventListener('click', () => {
    const n = Number(step.dataset.level);
    diffInput.value = String(n);
    $$('.diff-step').forEach((s) => {
      const sn = Number(s.dataset.level);
      s.classList.toggle('on', sn <= n);
      s.setAttribute('aria-checked', String(sn === n));
    });
    diffLabel.textContent = store.difficultyLabel(n);
  }));

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

  /* The pencil beside a label opens that one field. `data-editing` carries the state, which is all the
   * stylesheet needs to swap a chip that can be deleted for plain pills and text (see .field[data-
   * editing] in style.css). Closing it again leaves the value alone: the input is hidden, not cleared. */
  $$('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const field = btn.closest('.field');
    const on = field.dataset.editing !== 'on';
    field.dataset.editing = on ? 'on' : 'off';
    btn.setAttribute('aria-expanded', String(on));
    if (on) field.querySelector('.chip-text, .notes-input')?.focus();
  }));

  /* What the notes say, before and while they are edited: the paragraph is the one the move's own page
   * draws, and an empty note is a line of muted text rather than an empty box. */
  const notesInput = $('#notes-text');
  const notesRead = $('#notes-read');
  const syncNotes = () => {
    const text = notesInput.value.trim();
    notesRead.textContent = text || 'None yet';
    notesRead.classList.toggle('is-empty', !text);
  };
  notesInput.addEventListener('input', syncNotes);
  syncNotes();

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

//---------- move photos & videos ----------

  let picked = [];
  let mediaEnabled = true;  // false if media tables are unavailable

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
    fileInput.value = '';   // allow reselecting the same file
    const tooBig = files.filter((f) => f.size > store.MAX_UPLOAD_BYTES);
    picked = picked.concat(files.filter((f) => f.size <= store.MAX_UPLOAD_BYTES));
    if (tooBig.length) {
      toast(`Skipped ${plural(tooBig.length, 'file')} over ${megabytes(store.MAX_UPLOAD_BYTES)} MB.`, true);
    }
    drawPicked();
  });

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
      /* One place to land afterwards: back to the list for an edit, into the move for an addition. */
      if (move) await route({ keepScroll: true });
      else go(`#/move/${saved.id}`);
    });
  });

  if (move) await drawFormMedia(move.id);
}


//---------- collections ----------

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
  const ownerName = owner?.username ?? 'this dancer';
  const moves = allMoves.filter((m) => m.categoryIds.includes(cat.id));
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

function entryMatch(entry, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return { matches: true, alias: '' };
  if (entry.name.toLowerCase().includes(q)) return { matches: true, alias: '' };
  const hit = store.entryAliases(entry.id).find((a) => a.alias.toLowerCase().includes(q));
  return hit ? { matches: true, alias: hit.alias } : { matches: false, alias: '' };
}

//---------- dictionary ----------

let dictQuery = '';
let dictLevel = 'any';
let dictSort = 'name';

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
    const info = new Map(entries.map((e) => [e.id, store.entryLevel(e.id)]));

    const matchedAlias = new Map();
    let rows = entries.filter((e) => {
      const hit = entryMatch(e, dictQuery);
      if (hit.alias) matchedAlias.set(e.id, hit.alias);
      return hit.matches;
    });
    if (dictLevel !== 'any') rows = rows.filter((e) => info.get(e.id).lead === dictLevel);

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

let suggestPicked = [];

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

//---------- community difficulty ----------

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

function wireLevelVote(entry) {
  $$('.level-pick input').forEach((input) => input.addEventListener('change', () => attempt(async () => {
    const level = input.dataset.level;
    await store.setEntryLevel(entry.id, level);
    toast(`Marked as ${store.levelLabel(level).toLowerCase()}. Thank you!`);
    await route({ keepScroll: true });
  })));
}

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

const partChip = (item) => {
  const entry = store.entryNamed(item.text);
  const label = html`${item.text}${item.count > 1
    ? html` <span class="chip-count">${item.count}</span>` : ''}`;
  return entry
    ? html`<a class="chip" href="#/dictionary/${entry.id}">${label}</a>`
    : html`<span class="chip">${label}</span>`;
};

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

//---------- dictionary entry ----------

async function viewEntry(id) {
  const entry = await store.getEntry(id);
  if (!entry) return notFound('That trick does not exist, or it is still waiting for review.');
  setTitle(entry.name);

  const me = store.currentUser();
  const [entries, moves] = await Promise.all([store.listEntries(), store.listMoves(me.id)]);
  const loggers = entries.some((e) => e.id === entry.id) ? store.entryUsers(entry.id) : [];
  const used = loggers.length;
  const linked = moves.find((m) => m.dictEntryId === entry.id);

  let media = [];
  let mediaNote = '';
  try { media = await store.listMedia({ entryId: entry.id }); }
  catch (err) { mediaNote = mediaSetupNote(err); }

  let parts = { entries: [], exits: [] };
  let partsNote = '';
  try { parts = await store.entryParts(entry.id); }
  catch (err) { partsNote = err.message; }

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

//---------- community ----------

let feedFilter = 'all';
let memberQuery = '';          // kept across redraws

async function viewCommunity(query) {
  const tab = query.get('tab') === 'members' ? 'members' : 'feed';
  setTitle('Community');

  show(html`
    <div class="page-head">
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

async function drawFeed() {
  const body = $('#community-body');
  const me = store.currentUser();
  const mine = store.followingIds();
  const keep = (ownerId) => feedFilter === 'all' || mine.has(ownerId);

  const onlyMine = feedFilter === 'following';
  const activity = (await store.feedActivity()).filter((it) => keep(it.owner.id));

  body.innerHTML = String(html`
    <div class="panel-head">
      <h2 class="subhead">Updates</h2>
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
  wireMedia({
    parent: null,
    rows: activity.filter((it) => it.kind === 'media').map((it) => it.media),
    refresh: () => route({ keepScroll: true }),
  });
}

const feedParentHref = (m) => (m.parent.kind === 'move' ? `#/move/${m.parent.id}` : `#/dictionary/${m.parent.id}`);

async function drawmembers() {
  const body = $('#community-body');
  const all = (await store.listOtherUsers())
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
  const sums = new Map(await Promise.all(all.filter((u) => !u.isPrivate)
    .map(async (u) => [u.id, await store.summary(u.id)])));

  body.innerHTML = String(html`
    <div class="filter-bar">
      <div class="search-field">
        ${searchIcon}
        <input id="member-search" type="search" aria-label="Search members by name or studio" autocomplete="off" value="${memberQuery}">
      </div>
    </div>
    <div id="member-list"></div>`);

  const list = $('#member-list');
  const draw = () => {
    const q = memberQuery.trim().toLowerCase();
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
        const place = studio ? studio.name : (u.city ?? '');
        return html`<li class="row">
          <a class="member-card-link" href="#/user/${u.id}">
            <span class="feed-who">${avatarOf(u, 'avatar-sm')}</span>
            <div class="row-main">
              <strong><span class="entry-link">${u.username}</span></strong>
              <span class="muted">${plural(sum.total, 'move')} logged${place ? ` · ${place}` : ''}${u.polingSince ? ` · Poler since ${u.polingSince}` : ''}${u.isAdmin ? ' · Admin' : ''}</span>
            </div>
          </a>
          ${store.socialEnabled() ? html`<div class="actions">
            <button type="button" class="btn small ${following ? '' : 'primary'}" data-follow="${u.id}"
              aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>
          </div>` : ''}
        </li>`;
      })}
    </ul>` : html`<div class="empty"><p>${q
      ? 'No users found' : 'No other members yet.'}</p></div>`}
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

//---------- profile ----------

async function viewUser(id) {
  const user = await store.userById(id);
  if (!user) return notFound('That dancer does not exist.');
  if (user.id === store.currentUser().id) return go('#/');
  setTitle(user.username);

  const visible = store.canView(user.id);
  const [names, cats, moves] = visible
    ? await Promise.all([catMap(user.id), store.listCategories(user.id), store.listMoves(user.id)])
    : [new Map(), [], []];

  let social = null;
  let socialNote = '';
  if (!store.socialEnabled()) {
    socialNote = 'Following is off until supabase/social.sql is run in the Supabase SQL editor.';
  } else {
    try { social = await store.followLists(user.id); }
    catch (err) { socialNote = err.message; }
  }
  const counts = social
    ? { followers: social.followers.length, following: social.friends.length + social.following.length }
    : null;
  const following = store.isFollowing(user.id);
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

const addedByLine = (link, me) => (link.addedBy === me.id
  ? 'Added by you'
  : link.addedBy
    ? `Added by ${store.usernameOf(link.addedBy)}`
    : 'Added by a member who has since closed their account');

//---------- studio ----------

async function viewStudio(id) {
  const studio = store.studioById(id);
  if (!studio) return notFound('That studio is not in the list.');
  setTitle(studio.name);
  const me = store.currentUser();

  const members = await store.membersAtStudio(studio.id).catch(() => []);
  const links = store.instagramEnabled() ? store.listStudioInstagrams(studio.id) : [];

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

    <h2 class="subhead">${plural(members.length, 'member')}</h2>
    ${members.length ? html`<div class="studio-members" role="group" aria-label="Studio members">
      ${members.map((u) => html`<a href="#/user/${u.id}" title="${u.username}"
        aria-label="${u.username}">${avatarOf(u, 'avatar-sm')}</a>`)}
    </div>` : html`<div class="empty"><p>Nobody has picked this studio yet.</p></div>`}
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

//---------- review queue ----------

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

//---------- account ----------

let openEditor = null;

let studioDraft = null;

async function viewAccount() {
  setTitle('Account');
  const me = store.currentUser();
  const thisYear = new Date().getFullYear();
  const pending = me.isAdmin ? store.pendingCount() : 0;

  const where = placeLine(me);

  let social = null;
  if (store.socialEnabled()) {
    try { social = await store.followLists(me.id); } catch { social = null; }
  }

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
            <small class="muted">Comments, questions, complaints or concerns</small></span>
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

    ${!me.isAdmin ? '' : html`
    <h2 class="subhead">Moderation</h2>
    <ul class="list">
      <li>
        <a class="link-row" href="#/review">
          ${checkIcon}
          <span><strong>Review</strong>
            <small class="muted">${pending
              ? `${plural(pending, 'new trick')} waiting to be published.`
              : 'New tricks waiting to be published, and the dictionary you moderate.'}</small></span>
          ${chevronIcon}
        </a>
      </li>
    </ul>`}

    <h2 class="subhead">Settings</h2>
    <ul class="list">
      <li>
        <a class="link-row" href="#/settings">
          ${settingsIcon}
          <span><strong>Settings</strong>
            <small class="muted">Appearance, download data, delete account</small></span>
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

  $$('[data-avatar]').forEach((btn) => btn.addEventListener('click', () => {
    $$('[data-avatar]').forEach((other) => other.setAttribute('aria-pressed', String(other === btn)));
  }));

//---------- home studios ----------

  const drawStudios = () => {
    const list = $('#studio-draft');
    const pick = $('#studio-pick');
    if (!studioDraft || !list || !pick) return;
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

    pick.innerHTML = String(html`
      <option value="" disabled selected>Add a studio…</option>
      ${studios.filter((s) => !studioDraft.includes(s.id))
        .map((s) => html`<option value="${s.id}">${store.studioLabel(s)}</option>`)}`);
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

  $('#studio-pick')?.addEventListener('change', (e) => {
    const picked = e.target.value;
    if (picked && !studioDraft.includes(picked)) studioDraft = [...studioDraft, picked];
    drawStudios();
  });
  $('#studio-add-toggle')?.addEventListener('click', () => {
    $('#studio-add-row').hidden = false;
    $('#studio-name').focus();
  });

  $('#studio-add')?.addEventListener('click', () => attempt(async () => {
    const studio = await store.addStudio({ name: $('#studio-name').value, city: $('#studio-city').value });
    if (!studioDraft.includes(studio.id)) studioDraft = [...studioDraft, studio.id];
    $('#studio-add-row').hidden = true;
    $('#studio-name').value = '';
    $('#studio-city').value = '';
    await route({ keepScroll: true });
    toast(`${store.studioLabel(studio)} is in the list now. Save to make it yours.`);
  }));

  drawStudios();

  $('#profile-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    attempt(async () => {
      const username = String(data.get('username') ?? '').trim();
      if (username !== store.currentUser().username) await store.renameMe(username);

      const patch = { polingSince: String(data.get('polingSince') ?? '').trim() };
      if (store.homeStudiosEnabled()) patch.homeStudioIds = studioDraft ?? [];
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

  wireFollowActions(() => route({ keepScroll: true }));
}

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
              <button type="button" class="btn small" id="studio-add-toggle">Add a studio</button>
            </div>
            <div class="field-row" id="studio-add-row" hidden>
              <input type="text" id="studio-name" maxlength="80" placeholder="Name of the studio">
              <input type="text" id="studio-city" maxlength="80" placeholder="City">
              <button type="button" class="btn small" id="studio-add">Add new studio</button>
            </div>
            <small class="muted field-help">${store.homeStudiosEnabled()
              ? html``
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

//---------- settings and support ----------

function viewSettings() {
  setTitle('Settings');
  const me = store.currentUser();
  const pref = themePref();
  show(html`
    ${backLink('#/account', 'Back')}
    <div class="page-head">
      <div><p class="eyebrow">Account</p><h1>Settings</h1></div>
    </div>

    <div class="set-grid">
      <section class="set-card">
        <h2 class="set-title">Appearance</h2>
        <p class="set-help">Applies to his device only</p>
        <div class="seg" role="group" aria-label="Colour theme">
          ${THEMES.map((t) => html`<button type="button" class="seg-btn" data-theme-pick="${t.value}"
            aria-pressed="${pref === t.value}">${t.label}</button>`)}
        </div>
      </section>

      <section class="set-card">
        <h2 class="set-title">Your data</h2>
        <p class="set-help">Moves, notes, entries, exits, collections, and media as one JSON file.</p>
        <div class="set-actions">
          <button type="button" class="btn" id="export">Download my moves (JSON)</button>
        </div>
      </section>

      <section class="set-card">
        <h2 class="set-title">Delete my account</h2>
        <p class="set-help">
          Type your username to confirm.</p>
        <div class="set-actions">
          <input type="text" id="confirm-name" placeholder="${me.username}" autocomplete="off"
            aria-label="Type your username to confirm">
          <button type="button" class="btn danger" id="delete-account" disabled>Delete account</button>
        </div>
      </section>
    </div>`);

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
      button.disabled = true;
      try {
        const receipt = await store.sendSupportMessage({
          name: data.get('name'),
          email: data.get('email'),
          subject: data.get('subject'),
          message: data.get('message'),
          website: data.get('website'),
        });
        toast(receipt?.emailed === false
          ? 'Thank you - your message is saved, and it is waiting in the support inbox.'
          : 'Thank you - your message has been received.');
        await route({ keepScroll: true });
      } finally {
        button.disabled = false;
      }
    });
  });
}

//---------- support inbox ----------

async function viewSupportInbox() {
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

//---------- start ----------

function emailLink() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    isLink: /[?&#](access_token|code|error|error_description)=/.test(location.href),
    error: new URLSearchParams(location.search).get('error_description') ?? hash.get('error_description'),
  };
}

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

const resetLink = new URLSearchParams(location.search).get('reset') === '1';

async function start() {
  const link = emailLink();

  store.watchForPasswordRecovery(() => { location.hash = '#/reset'; });

  try {
    const { error } = await store.completeEmailLink();
    if (error && !link.error) link.error = error;
    await store.init();
  } catch (err) {
    showFatal(err);
    return;
  }

  if (link.isLink) {
    history.replaceState(null, '', location.pathname);
    if (link.error) toast(`That email link did not work: ${link.error}`, true);
    else if (resetLink) toast('Choose a new password.');
    else if (store.currentUser()) toast('Email confirmed - you are logged in.');
  }

  if (resetLink || store.isRecoveryPending()) location.hash = '#/reset';

  applyTheme(themePref());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themePref()));

  window.addEventListener('hashchange', () => route());
  await route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}
//---------- journal ----------

/* The notepad floats over the content instead of living in the navigation bar, because the journal is
 * not somewhere you go: it is a thought you catch mid-set, from whatever screen you are on. Drag it
 * anywhere that is not in the way and it stays exactly there - a thumb is not always in the same
 * place, and a button that insisted on an edge would be in the way on the screen where the edge is
 * busy.
 *
 * Where it sits is a device preference, like the theme, not account data - it is about the hand
 * holding the phone. A tap opens the journal and only a real drag moves it, decided by how far the
 * pointer travelled, so repositioning it can never open it by accident. */
const JOURNAL_FAB_KEY = 'mypolemagazine-journal-fab';
const FAB_SIZE = 52;
const FAB_MARGIN = 12;
const FAB_SLOP = 6;      // px of travel before a press counts as a drag rather than a tap

const notepadIcon = html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M7 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>
  <path d="M9 2v4M15 2v4"/><path d="M8.5 11h7M8.5 15.5h4"/></svg>`;

/* Where the button was left, as a fraction of the room it had in each direction rather than in pixels,
 * so the same place survives a rotation or a taller phone. Anything unreadable means it has never been
 * moved, which starts it bottom right - above the phone's bar, where a thumb already is.
 *
 * An older position stored as a side still reads: x becomes 0 or 1, which is exactly where that side
 * put it. Without this the button would jump back to the corner once, for anyone who had moved it. */
const clamp = (n) => Math.min(1, Math.max(0, n));

function journalFabPos() {
  try {
    const saved = JSON.parse(localStorage.getItem(JOURNAL_FAB_KEY) ?? '');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return { x: clamp(saved.x), y: clamp(saved.y) };
    }
    if (saved && (saved.side === 'left' || saved.side === 'right') && Number.isFinite(saved.y)) {
      return { x: saved.side === 'left' ? 0 : 1, y: clamp(saved.y) };
    }
  } catch { /* never moved, or storage is off in private mode */ }
  return { x: 1, y: 1 };
}

function saveJournalFabPos(pos) {
  try { localStorage.setItem(JOURNAL_FAB_KEY, JSON.stringify(pos)); } catch { /* private mode: it just will not stick */ }
}

/* The highest the button may sit: the bottom of the viewport, or the top of the phone's bar when the
 * bar is fixed along the bottom - a floating button underneath the navigation is one nobody can
 * press. The bar is only fixed on a phone; on a wide screen it lives in the header, so there the
 * limit is the viewport itself. */
function journalFabFloor() {
  const nav = $('#nav');
  const fixed = nav && !nav.hidden && getComputedStyle(nav).position === 'fixed';
  return Math.round(fixed ? nav.getBoundingClientRect().top : window.innerHeight);
}

/* How far the button may travel on each axis: the viewport, less the button and its margin at both
 * ends. Never negative, so a window narrower than the button puts it in the corner rather than off the
 * edge. */
const fabRoom = () => ({
  x: Math.max(0, window.innerWidth - FAB_SIZE - 2 * FAB_MARGIN),
  y: Math.max(0, journalFabFloor() - FAB_SIZE - 2 * FAB_MARGIN),
});

function placeJournalFab() {
  const fab = $('#journal-fab');
  if (!fab || fab.hidden) return;
  const { x, y } = journalFabPos();
  const room = fabRoom();
  fab.style.left = `${Math.round(FAB_MARGIN + x * room.x)}px`;
  fab.style.top = `${Math.round(FAB_MARGIN + y * room.y)}px`;
  fab.style.right = '';
}

function journalButton() {
  const existing = $('#journal-fab');
  if (existing) return existing;
  document.body.insertAdjacentHTML('beforeend', String(html`
    <button type="button" class="journal-fab" id="journal-fab" hidden aria-haspopup="dialog"
      aria-label="Journal" title="Journal">${notepadIcon}</button>`));
  const fab = $('#journal-fab');
  wireJournalFab(fab);
  return fab;
}

function wireJournalFab(fab) {
  let dragging = false;
  let engaged = false;      // true once the press has travelled far enough to be a drag
  let travelled = 0;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let room = { x: 0, y: 0 };      // how far it may travel, measured when it is picked up

  /* While it is held, both axes follow the finger, so it goes where the hand puts it rather than where
   * the layout allows - which is the whole point of a free button. It stops at the edges and above the
   * phone's bar, because a button under the navigation is one nobody can press. */
  const hold = (value, span) => Math.round(Math.min(Math.max(value, FAB_MARGIN), FAB_MARGIN + span));

  fab.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    engaged = false;
    travelled = 0;
    startX = e.clientX;
    startY = e.clientY;
    const box = fab.getBoundingClientRect();
    startLeft = box.left;
    startTop = box.top;
    room = fabRoom();
    fab.setPointerCapture(e.pointerId);
  });

  fab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    travelled = Math.max(travelled, Math.abs(dx), Math.abs(dy));
    if (travelled <= FAB_SLOP) return;

    if (!engaged) {
      /* This is only now a drag, so only now does the button stop being anchored to a side. Anything
       * earlier than this would let a plain tap move the button, which is not what a tap means. */
      engaged = true;
      fab.classList.add('dragging');
      fab.style.right = '';
    }
    fab.style.left = `${hold(startLeft + dx, room.x)}px`;
    fab.style.top = `${hold(startTop + dy, room.y)}px`;
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove('dragging');
    if (!engaged) return;                       // a tap: nothing moved, so nothing to save

    const box = fab.getBoundingClientRect();
    saveJournalFabPos({
      x: room.x ? clamp((box.left - FAB_MARGIN) / room.x) : 0,
      y: room.y ? clamp((box.top - FAB_MARGIN) / room.y) : 0,
    });
    /* A drag ends with a click event on the same element. Remember that this was a drag so the click
     * handler can swallow it: dropping the button must not also open the journal. */
    fab.dataset.moved = '1';
    placeJournalFab();
  };
  fab.addEventListener('pointerup', release);
  fab.addEventListener('pointercancel', release);

  fab.addEventListener('click', (e) => {
    if (fab.dataset.moved) {
      delete fab.dataset.moved;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    openJournal();
  });

  /* The button is stored as a fraction of the room it had, so a different viewport has to become a
   * new pixel position: a rotation, a resize, or a phone's browser bar sliding away all move the top
   * of the bottom bar out from under it. */
  addEventListener('resize', placeJournalFab);
  addEventListener('orientationchange', placeJournalFab);
}

const pad2 = (n) => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

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
            placeholder="e.g. flips, inverts, a combo, etc..."></textarea>
        </label>
        <div class="actions"><button type="submit" class="btn primary">Add entry</button></div>
      </form>
      <ol class="journal-list" id="journal-list" aria-label="Past entries"></ol>
    </dialog>`;
}

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
            <button type="button" class="icon-btn plain" data-journal-delete="${e.id}" title="Delete entry" aria-label="Delete entry">${trashIcon}</button>
          </div>
          <p class="journal-entry-body">${e.body}</p>
        </li>`)).join('')
    : '<li class="muted"></li>';
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

start();
