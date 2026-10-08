/* app.js — router and views.
 *
 * One hash route per screen (#/, #/move/:id, #/Bible ...). Each view is a
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

/* ---------- shared bits ---------- */

const dots = (n) => html`<span class="dots" role="img" aria-label="Difficulty ${n} of 5">${
  [1, 2, 3, 4, 5].map((i) => html`<i class="${i <= n ? 'on' : ''}"></i>`)}</span>`;

/* The collection pencil. Renaming and deleting live behind it so they are not the first thing a
 * dancer sees when they open a collection. */
const pencilIcon = html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z"/><path d="M14.5 5.5l4 4"/></svg>`;
const dateText = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
/* Resolves to a Map so views can look up a collection name by id after awaiting it. */
const catMap = async (userId) => new Map((await store.listCategories(userId)).map((c) => [c.id, c.name]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- avatars ---------- */

/* A hue that is stable for a name, so a dancer's letter avatar is always the same colour. */
function hueOf(text) {
  let hue = 7;
  for (const ch of String(text ?? '')) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return hue;
}

/* The pleaser they picked, or their initial on a colour of its own when they have not picked one.
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
  return html`<span class="avatar avatar-letter ${cls}" aria-hidden="true"
    style="background: hsl(${hueOf(name)} 46% 38%)">${name.trim().charAt(0).toUpperCase() || '?'}</span>`;
}

/* The dancers who logged a trick, as up to three mini avatars with a count for the rest. Draws
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

const moveCard = (m, names) => html`
  <a class="card" href="#/move/${m.id}">
    <div class="card-top"><h3>${m.name}</h3></div>
    <div class="meta">
      ${dots(m.difficulty)}
      ${m.categoryIds.map((id) => names.get(id)).filter(Boolean).map((n) => html`<span class="tag">${n}</span>`)}
    </div>
  </a>`;

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
    ['collections', '#/collections', 'Collections'],
    ['Bible', '#/Bible', 'Bible'],
    ['community', '#/community', 'Community'],
  ];
  if (me.isAdmin) items.push(['review', '#/review', 'Review']);
  items.push(['account', '#/account', 'Account']);
  const pending = store.pendingCount();
  nav.innerHTML = items.map(([key, href, label]) => String(html`
    <a href="${href}" ${key === section ? raw('aria-current="page"') : ''}>${label}${
      key === 'review' && pending ? html`<span class="pill">${pending}</span>` : ''}</a>`)).join('');
}
const raw = (s) => new Safe(s);

/* ---------- router ---------- */

const SECTION = {
  '': 'home', home: 'home', moves: 'moves', move: 'moves',
  collections: 'collections', collection: 'collections',
  Bible: 'Bible', dictionary: 'Bible',          // #/dictionary links from before the rename
  community: 'community', Directory: 'community', browse: 'community', user: 'community',
  review: 'review', account: 'account',
};

async function route({ keepScroll = false } = {}) {
  const { parts, query } = parseHash();
  const me = store.currentUser();   // synchronous: the store caches the loaded profile

  if (!me && parts[0] !== 'auth') return go('#/auth');
  if (me && parts[0] === 'auth') return go('#/');

  /* The username box is a short-lived form on one screen, so leaving Account closes it. */
  if (SECTION[parts[0] ?? ''] !== 'account') editingName = false;

  renderNav(SECTION[parts[0] ?? ''] ?? '');

  try {
    const [view, a, b] = parts;
    if (!view || view === 'home') await viewHome();
    else if (view === 'moves') await viewMoves();
    else if (view === 'auth') viewAuth();
    else if (view === 'move' && a === 'new') await viewMoveForm(null, query);
    else if (view === 'move' && b === 'edit') await viewMoveForm(a, query);
    else if (view === 'move' && a) await viewMove(a);
    else if (view === 'collections') await viewCollections();
    else if (view === 'collection' && a) await viewCollection(a);
    else if ((view === 'Bible' || view === 'dictionary') && a) await viewEntry(a);
    else if (view === 'Bible' || view === 'dictionary') await viewBible();
    else if (view === 'community') await viewCommunity(query);
    else if (view === 'Directory' || view === 'browse') return go('#/community?tab=dancers');
    else if (view === 'user' && a) await viewUser(a);
    else if (view === 'review') await viewReview();
    else if (view === 'account') await viewAccount();
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
          <small>3-24 characters: letters, numbers, dots, dashes or underscores. This is what other dancers see.</small></label>`}
        <label class="field"><span>Email</span>
          <input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${authEmail}" required></label>
        <label class="field"><span>Password</span>
          <input type="password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="6" required></label>
        <button class="btn primary block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
      </form>
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

/* ---------- view: home (current goals) ---------- */

let goalAddMode = null;    // null = pick for this dancer: their moves if they have any, else the Bible
let goalAddOpen = false;   // the panel, when the list is not empty and the button was clicked
let goalBibleQuery = '';

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
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const inGoals = goals ? moves.filter((m) => m.categoryIds.includes(goals.id)) : [];
  const spare = goals ? moves.filter((m) => !m.categoryIds.includes(goals.id)) : [];

  /* Three ways onto the list: a move you already have, a trick from the Bible, or a new move. The
   * choice is a radio group down the left of the dialogue, and the right side shows that choice.
   * Someone who has logged nothing yet is better served by the Bible than by an empty picker. */
  const mode = goalAddMode ?? (spare.length ? 'mine' : 'bible');
  const showPanel = Boolean(goals) && goalAddOpen;
  const entries = showPanel ? await store.listEntries() : [];
  const linked = new Map(moves.filter((m) => m.dictEntryId).map((m) => [m.dictEntryId, m]));

  /* Adding a trick puts a move you already had onto the list, or logs the trick as a new move named
   * after it, already linked to the Bible entry. */
  const addFromBible = (entryId) => attempt(async () => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const mine = linked.get(entry.id);
    if (mine) {
      await store.addToCategory(mine.id, goals.id);
      toast(`${entry.name} is on your current goals.`);
    } else {
      await store.saveMove({ name: entry.name, status: 'goal', difficulty: 3, dictEntryId: entry.id, categoryIds: [goals.id] });
      toast(`${entry.name} added. Open it to add entries, exits and notes.`);
    }
    await route({ keepScroll: true });
  });

  /* Drawn on its own so typing in the search box does not redraw the page and lose the focus. */
  const drawBible = () => {
    const list = $('#goal-bible-list');
    if (!list) return;
    const q = goalBibleQuery.trim().toLowerCase();
    const rows = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    list.innerHTML = rows.length ? rows.map((e) => {
      const mine = linked.get(e.id);
      const already = mine ? mine.categoryIds.includes(goals.id) : false;
      return String(html`
        <li class="row">
          <div class="row-main">
            <strong><a class="entry-link" href="#/Bible/${e.id}">${e.name}</a></strong>
            <span class="muted">${already ? 'Already a current goal'
              : mine ? `You already log this as “${mine.name}”` : 'Not in your moves yet'}</span>
          </div>
          ${already ? '' : html`<div class="actions">
            <button type="button" class="btn small primary" data-goal-entry="${e.id}">Add as goal</button>
          </div>`}
        </li>`);
    }).join('') : String(html`<li class="row"><span class="muted">No tricks match that.</span></li>`);
    $$('[data-goal-entry]').forEach((btn) => btn.addEventListener('click', () => addFromBible(btn.dataset.goalEntry)));
  };

  const panel = html`
    <div class="goal-add" id="goal-add">
      <div class="goal-add-body">
        <fieldset class="goal-sources">
          <legend class="fineprint">Add a goal from</legend>
          ${[['mine', 'One of my moves'], ['bible', 'From the Bible'], ['new', 'A new move']].map(([value, label]) => html`
            <label class="goal-source">
              <input type="radio" name="goal-source" value="${value}" ${mode === value ? raw('checked') : ''}>
              <span>${label}</span>
            </label>`)}
        </fieldset>

        <div class="goal-add-options">
          <div data-source-panel="mine" ${mode === 'mine' ? '' : raw('hidden')}>
            ${spare.length ? html`
              <form class="inline-form" id="add-goal">
                <select name="move" aria-label="Pick one of your moves">
                  ${spare.map((m) => html`<option value="${m.id}">${m.name}</option>`)}
                </select>
                <button class="btn primary" type="submit">Add to goals</button>
              </form>` : html`
              <p class="muted">Every move you have logged is already a current goal.
                Pick a trick from the Bible instead.</p>`}
          </div>

          <div data-source-panel="bible" ${mode === 'bible' ? '' : raw('hidden')}>
            <input type="search" id="goal-bible-q" placeholder="Search the Bible" aria-label="Search the Bible"
              value="${goalBibleQuery}">
            <ul class="list" id="goal-bible-list"></ul>
            <p class="muted fineprint">A trick you add becomes a move named after it, linked to the Bible
              entry, so the community keeps one name for it.</p>
          </div>

          <div data-source-panel="new" ${mode === 'new' ? '' : raw('hidden')}>
            <div class="actions">
              <a class="btn primary" href="#/move/new?cat=${goals.id}">Fill in a new move</a>
            </div>
            <p class="muted fineprint">Entries, exits, combos and notes can all be added now or later.</p>
          </div>
        </div>
      </div>
    </div>`;

  /* One add control, wherever this dancer is: inside the empty box when the list is empty, under
   * the list once there are goals. */
  const addButton = html`
    <button type="button" class="btn ${goalAddOpen ? '' : 'primary'}" id="add-goal-toggle"
      aria-expanded="${goalAddOpen}" aria-controls="goal-add">${goalAddOpen ? 'Close' : '+ Add new goal'}</button>`;

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
      <ul class="list">
        ${inGoals.map((m) => html`
          <li class="row">
            <div class="row-main">
              <strong><a class="entry-link" href="#/move/${m.id}">${m.name}</a></strong>
              <span class="muted">${dots(m.difficulty)}${
                m.categoryIds.filter((id) => id !== goals.id && names.has(id))
                  .map((id) => html` · ${names.get(id)}`)}</span>
            </div>
            <div class="actions">
              <button type="button" class="btn small" data-drop="${m.id}">Done for now</button>
            </div>
          </li>`)}
      </ul>
      <div class="actions" style="margin-top:20px">${addButton}</div>` : html`
      <div class="empty">
        <h3>No current goals</h3>
        <div class="actions" style="justify-content:center;margin-top:14px">${addButton}</div>
      </div>`}

    ${showPanel ? panel : ''}

  `);

  if (!goals) return;
  $$('[data-drop]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    await store.removeFromCategory(btn.dataset.drop, goals.id);
    toast('Taken off your current goals.');
    await route({ keepScroll: true });
  })));
  $('#add-goal')?.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      await store.addToCategory(new FormData(e.target).get('move'), goals.id);
      toast('Added to your current goals.');
      await route({ keepScroll: true });
    });
  });
  /* Swapping the choice only shows and hides the panes, so the radio keeps focus and the Bible
   * list is not fetched twice. */
  $$('input[name="goal-source"]').forEach((input) => input.addEventListener('change', () => {
    goalAddMode = input.value;
    $$('[data-source-panel]').forEach((pane) => { pane.hidden = pane.dataset.sourcePanel !== goalAddMode; });
  }));
  $('#add-goal-toggle')?.addEventListener('click', () => {
    goalAddOpen = !goalAddOpen;
    route({ keepScroll: true });
  });
  $('#goal-bible-q')?.addEventListener('input', (e) => {
    goalBibleQuery = e.target.value;
    drawBible();
  });
  drawBible();
}

/* ---------- view: my moves ---------- */

const filters = { cat: 'all', q: '', sort: 'recent' };

async function viewMoves() {
  setTitle('Skill Roster');
  const me = store.currentUser();
  const [cats, moves] = await Promise.all([store.listCategories(me.id), store.listMoves(me.id)]);
  const names = new Map(cats.map((c) => [c.id, c.name]));   // same data catMap() would fetch twice
  if (filters.cat !== 'all' && !names.has(filters.cat)) filters.cat = 'all';

  const head = html`
    <div class="page-head">
      <div><p class="eyebrow">Hi, ${me.username}</p><h1>My moves</h1></div>
      <a class="btn primary" href="#/move/new">+ Add move</a>
    </div>`;

  if (!moves.length) {
    show(html`${head}
      <div class="empty">
        <h3>No moves yet</h3>
        <p>Log the first one: what you can do today, or what you are working toward.</p>
        <a class="btn primary" href="#/move/new">Add your first move</a>
      </div>`);
    return;
  }

  show(html`${head}
    <div class="filters">
      <div class="filter-row">
        <input type="search" id="q" placeholder="Search your moves" aria-label="Search your moves" value="${filters.q}">
        <select id="sort" aria-label="Sort moves">
          <option value="recent" ${filters.sort === 'recent' ? raw('selected') : ''}>Recent</option>
          <option value="name" ${filters.sort === 'name' ? raw('selected') : ''}>A to Z</option>
          <option value="hard" ${filters.sort === 'hard' ? raw('selected') : ''}>Hardest first</option>
        </select>
      </div>
      ${cats.length ? html`
        <select id="cat" aria-label="Filter by collection">
          <option value="all">All collections</option>
          ${cats.map((c) => html`<option value="${c.id}" ${filters.cat === c.id ? raw('selected') : ''}>${c.name}</option>`)}
        </select>` : ''}
    </div>
    <div class="stack" id="move-list"></div>`);

  const list = $('#move-list');
  const draw = () => {
    const q = filters.q.trim().toLowerCase();
    const rows = moves
      .filter((m) => (filters.cat === 'all' || m.categoryIds.includes(filters.cat))
        && (!q || m.name.toLowerCase().includes(q)));
    if (filters.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    if (filters.sort === 'hard') rows.sort((a, b) => b.difficulty - a.difficulty || a.name.localeCompare(b.name));
    list.innerHTML = rows.length
      ? rows.map((m) => moveCard(m, names)).join('')
      : String(html`<div class="empty">No moves match those filters.</div>`);
  };
  draw();

  $('#q').addEventListener('input', (e) => { filters.q = e.target.value; draw(); });
  $('#sort').addEventListener('change', (e) => { filters.sort = e.target.value; draw(); });
  $('#cat')?.addEventListener('change', (e) => { filters.cat = e.target.value; draw(); });
}

/* ---------- photos & videos (shared by the move and Bible screens) ---------- */

const megabytes = (bytes) => Math.round(bytes / 1048576);

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
  </div>` : html`<p class="muted">Nothing here yet.</p>`;

function mediaSection({ title, hint, rows, note, canUpload, me }) {
  return html`
    <div class="section">
      <h2>${title}</h2>
      ${note ? html`<p class="muted">${note}</p>` : mediaGrid(rows, me)}
      ${canUpload && !note ? html`
        <div class="upload-row">
          <input type="file" id="media-file" accept="image/*,video/*" multiple hidden>
          <button type="button" class="btn small" id="media-add">+ Add photo or video</button>
          <span class="muted upload-note">JPG, PNG, WebP, GIF or MP4/WebM/MOV, up to ${megabytes(store.MAX_UPLOAD_BYTES)} MB each.</span>
        </div>` : ''}
      ${hint ? html`<p class="muted upload-note">${hint}</p>` : ''}
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

  const me = store.currentUser();
  const mine = move.userId === me.id;
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

  const chipSection = (title, items) => items.length
    ? html`<div class="section"><h2>${title}</h2><div class="chips">${items.map((t) => html`<span class="chip">${t}</span>`)}</div></div>`
    : '';

  show(html`
    <a class="back" href="${mine ? '#/moves' : `#/user/${move.userId}`}">← ${mine ? 'My moves' : `${ownerName}'s moves`}</a>
    <div class="page-head">
      <div>
        <p class="eyebrow">${mine ? 'Move' : `Move by ${ownerName}`}</p>
        <h1>${move.name}</h1>
      </div>
    </div>

    <div class="meta-row">
      ${dots(move.difficulty)}
      ${entry ? html`<span class="tag">Bible: <a href="#/Bible/${entry.id}">${entry.name}</a>${entry.status === 'pending' ? ' (pending review)' : ''}</span>`
        : html`<span class="tag">Not in the Bible</span>`}
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
      title: 'Photos & videos',
      hint: mine ? 'Other dancers see these the same way they see your moves.' : '',
      rows: media, note: mediaNote, canUpload: mine, me,
    })}

    ${mine ? html`
      <div class="actions">
        <a class="btn primary" href="#/move/${move.id}/edit">Edit</a>
        <button type="button" class="btn danger" id="delete">Delete</button>
      </div>` : html`
      <div class="actions">
        <button type="button" class="btn primary" id="copy">Save to my goals</button>
      </div>
      <p class="muted fineprint">Only the name is copied. ${ownerName}'s notes, entries and exits stay theirs.</p>`}
  `);

  $('#delete')?.addEventListener('click', () => {
    if (!confirm(`Delete "${move.name}"? This cannot be undone.`)) return;
    attempt(async () => { await store.deleteMove(move.id); toast('Move deleted.'); go('#/moves'); });
  });
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
  const backHref = move ? `#/move/${move.id}` : '#/moves';

  show(html`
    <a class="back" href="${backHref}">← Cancel</a>
    <div class="page-head"><div><p class="eyebrow">${move ? 'Edit move' : 'New move'}</p><h1>${move ? m.name : 'Add a move'}</h1></div></div>

    <form class="form" id="move-form">
      <label class="field"><span>Move name</span>
        <input type="text" name="name" required maxlength="80" autocomplete="off" list="dict-names"
          value="${m.name}" placeholder="e.g. Fireman spin">
        <datalist id="dict-names">${entries.map((e) => html`<option value="${e.name}"></option>`)}</datalist>
      </label>

      <label class="field"><span>Pole Bible entry</span>
        <select name="dict">
          <option value="">Not linked</option>
          ${entries.map((e) => html`<option value="${e.id}" ${m.dictEntryId === e.id ? raw('selected') : ''}>${e.name}${e.status === 'pending' ? ' (pending review)' : ''}</option>`)}
        </select>
        <small id="dict-hint">Linking helps the community agree on one name per move.</small>
      </label>

      <label class="check-row field" id="suggest-row" hidden>
        <input type="checkbox" name="suggest">
        <span><strong>Suggest this as a new Bible entry</strong>
          <small>An admin reviews it before it appears for everyone.</small></span>
      </label>

      <fieldset class="field"><legend>Difficulty for you (1 easy, 5 very hard)</legend>
        <div class="seg">
          ${[1, 2, 3, 4, 5].map((n) => html`
            <label><input type="radio" name="difficulty" value="${n}" ${m.difficulty === n ? raw('checked') : ''}><span>${n}</span></label>`)}
        </div>
      </fieldset>

      <div class="field"><span class="label">Entries</span><div class="chip-field" id="f-entries"></div>
        <small>How you get into this move. Press Enter after each one.</small></div>
      <div class="field"><span class="label">Exits</span><div class="chip-field" id="f-exits"></div>
        <small>How you get out of it.</small></div>
      <div class="field"><span class="label">Combos</span><div class="chip-field" id="f-combos"></div>
        <small>Moves that flow well with this one.</small></div>

      <fieldset class="field"><legend>Collections</legend>
        ${cats.length ? html`<div class="checks">
          ${cats.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c.id}" ${m.categoryIds.includes(c.id) ? raw('checked') : ''}> ${c.name}</label>`)}
        </div>` : ''}
        <input type="text" name="newcat" maxlength="40" placeholder="New collection (optional)" aria-label="New collection name">
      </fieldset>

      <label class="field"><span>Notes</span>
        <textarea name="notes" maxlength="2000" placeholder="Grip, cues, what to fix next time...">${m.notes}</textarea></label>

      <div class="actions">
        <button class="btn primary" type="submit">Save move</button>
        <a class="btn" href="${backHref}">Cancel</a>
      </div>
    </form>`);

  const form = $('#move-form');
  const getEntries = chipField($('#f-entries'), m.entries, 'entries');
  const getExits = chipField($('#f-exits'), m.exits, 'exits');
  const getCombos = chipField($('#f-combos'), m.combos, 'combos');

  /* Typing a name that matches a Bible entry links it automatically. */
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
      ? `Matched "${dictSelect.selectedOptions[0].textContent}" in the Bible.`
      : 'Linking helps the community agree on one name per move.';
    suggestRow.hidden = !(typed && !dictSelect.value && !match);
  };
  nameInput.addEventListener('input', sync);
  dictSelect.addEventListener('change', () => { autoLinked = false; sync(); });
  sync();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      const data = new FormData(form);
      const name = String(data.get('name')).trim();
      let dictEntryId = data.get('dict') || null;
      if (!dictEntryId && data.get('suggest')) {
        const { entry, created } = await store.submitEntry(name);
        dictEntryId = entry.id;
        if (created) toast(entry.status === 'pending' ? 'Move saved. Bible suggestion sent for review.' : 'Move saved.');
      }
      const categoryIds = data.getAll('cat');
      const newCat = String(data.get('newcat') ?? '').trim();
      if (newCat) categoryIds.push((await store.createCategory(newCat)).id);

      const saved = await store.saveMove({
        id: move?.id, name, difficulty: data.get('difficulty'),
        entries: getEntries(), exits: getExits(), combos: getCombos(),
        notes: data.get('notes'), categoryIds, dictEntryId,
      });
      if (!data.get('suggest')) toast('Move saved.');
      go(`#/move/${saved.id}`);
    });
  });
}

/* ---------- view: my collections ---------- */

/* The collection whose pencil is open. Kept per collection, so opening another one starts closed. */
let editingCollection = null;

async function viewCollections() {
  setTitle('Collections');
  const me = store.currentUser();
  const [cats, moves] = await Promise.all([store.listCategories(me.id), store.listMoves(me.id)]);

  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Group your moves</p><h1>Collections</h1></div>
      <span class="count">${cats.length}</span>
    </div>
    <form class="inline-form" id="new-cat">
      <input type="text" name="name" maxlength="40" placeholder="New collection name" aria-label="New collection name" required>
      <button class="btn primary" type="submit">Create</button>
    </form>
    ${cats.length ? html`<div class="stack">
      ${cats.map((c) => html`
        <a class="card" href="#/collection/${c.id}">
          <div class="card-top"><h3>${c.name}${c.isDefault ? html` <span class="tag">Home</span>` : ''}</h3>
            <span class="count">${moves.filter((m) => m.categoryIds.includes(c.id)).length}</span></div>
        </a>`)}
    </div>` : html`<div class="empty"><h3>No collections yet</h3><p>Create one above, then add moves to it from a move's edit screen.</p></div>`}`);

  $('#new-cat').addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      const cat = await store.createCategory(new FormData(e.target).get('name'));
      toast('Collection ready.');
      go(`#/collection/${cat.id}`);
    });
  });
}

async function viewCollection(id) {
  const cat = await store.getCategory(id);
  if (!cat) return notFound('That collection does not exist, or it belongs to a private account.');
  setTitle(cat.name);
  const me = store.currentUser();
  const mine = cat.userId === me.id;
  const [owner, names, allMoves] = await Promise.all([
    store.userById(cat.userId), catMap(cat.userId), store.listMoves(cat.userId),
  ]);
  const ownerName = owner?.username ?? 'this dancer';
  const moves = allMoves.filter((m) => m.categoryIds.includes(cat.id));
  /* Nothing to manage on someone else's collection, and the home screen's collection is fixed. */
  const canManage = mine && !cat.isDefault;
  const editing = editingCollection === cat.id;

  show(html`
    <a class="back" href="${mine ? '#/collections' : `#/user/${cat.userId}`}">← ${mine ? 'Collections' : `${ownerName}'s profile`}</a>
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
      <div class="actions"><a class="btn primary" href="#/move/new?cat=${cat.id}">+ Add a move</a></div>` : ''}
    <div class="stack" style="margin-top:16px">
      ${moves.length ? moves.map((m) => moveCard(m, names))
        : html`<div class="empty">${mine ? 'Nothing here yet. Add a move to this collection from its edit screen.' : 'No moves in this collection.'}</div>`}
    </div>
    ${!cat.isDefault || !mine ? '' : html`
      <p class="muted fineprint" style="margin-top:26px">Your <a href="#/">home screen</a> shows this collection,
        so it stays as it is. Make another collection if you want a different grouping.</p>`}
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
    attempt(async () => { await store.deleteCategory(cat.id); toast('Collection deleted.'); go('#/collections'); });
  });
}

/* ---------- view: pole Bible ---------- */

let dictQuery = '';

async function viewBible() {
  setTitle('Pole Bible');
  const me = store.currentUser();
  const [entries, moves] = await Promise.all([store.listEntries(), store.listMoves(me.id)]);
  const mineByEntry = new Map(moves.filter((m) => m.dictEntryId).map((m) => [m.dictEntryId, m]));

  show(html`
    <div class="page-head">
      <div><p class="eyebrow"></p><h1>Pole Bible</h1></div>
      <span class="count">${entries.length}</span>
    </div>
    <p class="lede">The community's shared list of trick names. Link your moves to it so everyone means the same thing.</p>
    <input type="search" id="dq" placeholder="Search the Bible" aria-label="Search the Bible" value="${dictQuery}" style="margin-bottom:14px">
    <ul class="list" id="dict-list"></ul>
    <h2 class="subhead">Missing a trick?</h2>
    <form class="inline-form" id="suggest">
      <input type="text" name="name" maxlength="60" placeholder="Trick name" aria-label="Trick name to suggest" required>
      <button class="btn primary" type="submit">${me.isAdmin ? 'Add' : 'Suggest'}</button>
    </form>
    <p class="muted fineprint">${me.isAdmin ? 'Admin additions publish immediately.' : 'Suggestions are reviewed by an admin before they appear for everyone.'}</p>`);

  const list = $('#dict-list');
  const draw = () => {
    const q = dictQuery.trim().toLowerCase();
    const rows = entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    list.innerHTML = rows.length ? rows.map((e) => {
      const loggers = store.entryUsers(e.id);
      const linked = mineByEntry.get(e.id);
      return String(html`
        <li class="row">
          <div class="row-main">
            <strong><a class="entry-link" href="#/Bible/${e.id}">${e.name}</a></strong>
            ${e.status === 'pending' ? html`<span class="muted">Pending review</span>` : loggerRow(loggers)}
          </div>
          <div class="actions">
            ${linked ? html`<a class="btn small" href="#/move/${linked.id}">In your moves</a>`
              : html`<a class="btn small" href="#/move/new?entry=${e.id}">+ Add to My Moves</a>`}
          </div>
        </li>`);
    }).join('') : String(html`<li class="row"><span class="muted">No matches. Suggest it below.</span></li>`);
  };
  draw();

  $('#dq').addEventListener('input', (e) => { dictQuery = e.target.value; draw(); });
  $('#suggest').addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      const { entry, created } = await store.submitEntry(new FormData(e.target).get('name'));
      if (!created) toast(`"${entry.name}" is already in the Bible.`);
      else toast(entry.status === 'pending' ? 'Sent for review. Thank you!' : 'Added to the Bible.');
      route({ keepScroll: true });
    });
  });
}

/* ---------- view: one Bible entry ---------- */

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

  show(html`
    <a class="back" href="#/Bible">← Pole Bible</a>
    <div class="page-head">
      <div><p class="eyebrow">Trick</p><h1>${entry.name}</h1></div>
      ${entry.status === 'pending' ? html`<span class="tag">Pending review</span>` : ''}
    </div>

    ${used || entry.submittedBy === me.id ? html`
      <p class="lede loggers-line">
        ${used ? loggerRow(loggers) : ''}
        <span>${used ? `Logged by ${plural(used, 'dancer')}.` : ''}${
          entry.submittedBy === me.id ? ' You suggested this one.' : ''}</span>
      </p>` : ''}

    <div class="actions">
      ${linked ? html`<a class="btn primary" href="#/move/${linked.id}">In your moves</a>`
        : html`<a class="btn primary" href="#/move/new?entry=${entry.id}">Log it as my move</a>`}
    </div>

    ${mediaSection({
      title: 'Photos & videos',
      hint: 'Anyone can add a clip of their own to a shared trick, and only you can remove yours.',
      rows: media, note: mediaNote, canUpload: true, me,
    })}`);

  wireMedia({ parent: { entryId: entry.id }, rows: media, refresh: () => route({ keepScroll: true }) });
}

/* ---------- view: community (the feed, and the dancers list) ---------- */

let feedFilter = 'all';        // 'all', or only the dancers I follow

/* Which tab is open comes from the URL rather than from a variable, so the back button works and a
 * plain #/community link lands somewhere predictable. */
async function viewCommunity(query) {
  const tab = query.get('tab') === 'dancers' ? 'dancers' : 'feed';
  setTitle('Community');

  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Everyone</p><h1>Community</h1></div>
    </div>
    <div class="seg" role="group" aria-label="Community view" style="margin-bottom:18px">
      <button type="button" class="seg-btn" data-tab="feed" aria-pressed="${tab === 'feed'}">New moves & uploads</button>
      <button type="button" class="seg-btn" data-tab="dancers" aria-pressed="${tab === 'dancers'}">Dancers</button>
    </div>
    <div id="community-body"></div>`);

  $$('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    go(btn.dataset.tab === 'dancers' ? '#/community?tab=dancers' : '#/community');
  }));

  if (tab === 'feed') await drawFeed();
  else await drawDancers();
}

/* The newest public moves and uploads. Row level security decides what this dancer may see, which
 * is why nothing here filters by privacy: a private account's rows never arrive in the first place. */
async function drawFeed() {
  const body = $('#community-body');
  const me = store.currentUser();
  const mine = store.followingIds();
  const keep = (ownerId) => feedFilter === 'all' || mine.has(ownerId);

  const [moves, media] = await Promise.all([store.feedMoves(24), store.feedMedia(12)]);
  const shownMoves = moves.filter((m) => keep(m.owner.id));
  const shownMedia = media.filter((m) => keep(m.owner.id));
  const onlyMine = feedFilter === 'following';

  body.innerHTML = String(html`
    ${store.socialEnabled() ? html`
      <div class="seg" role="group" aria-label="Whose posts to show" style="margin-bottom:16px">
        <button type="button" class="seg-btn" data-feed="all" aria-pressed="${feedFilter === 'all'}">Everyone</button>
        <button type="button" class="seg-btn" data-feed="following" aria-pressed="${onlyMine}">People I follow (${mine.size})</button>
      </div>` : ''}

    <h2 class="subhead">New moves</h2>
    ${shownMoves.length ? html`<ul class="list">
      ${shownMoves.map((m) => html`
        <li class="row">
          <a class="feed-who" href="#/user/${m.owner.id}">${avatarOf(m.owner, 'avatar-sm')}</a>
          <div class="row-main">
            <strong><a class="entry-link" href="#/move/${m.id}">${m.name}</a></strong>
            <span class="muted">${m.owner.username} · ${dateText(m.updatedAt)}</span>
            <span class="muted">${dots(m.difficulty)}</span>
          </div>
        </li>`)}
    </ul>` : html`<div class="empty"><p>${onlyMine
      ? 'Nobody you follow has posted a move yet.' : 'No public moves yet.'}</p></div>`}

    <h2 class="subhead">New photos & videos</h2>
    ${shownMedia.length ? html`<div class="media-grid">
      ${shownMedia.map((m) => html`
        <figure class="media-item">
          ${m.kind === 'video'
            ? html`<video src="${m.url}" controls preload="metadata" playsinline></video>`
            : html`<img src="${m.url}" alt="${m.caption || 'Photo'}" loading="lazy">`}
          ${m.ownerId === me.id ? html`<button type="button" class="media-remove" data-remove="${m.id}"
            aria-label="Remove this ${m.kind}">×</button>` : ''}
          <figcaption class="media-owner">${avatarOf(m.owner, 'avatar-xs')}<span>
            <a href="#/user/${m.owner.id}">${m.owner.username}</a> on ${m.parent.kind === 'move'
              ? html`<a href="#/move/${m.parent.id}">${m.parent.name}</a>`
              : html`<a href="#/Bible/${m.parent.id}">${m.parent.name}</a>`}</span></figcaption>
        </figure>`)}
    </div>` : html`<div class="empty"><p>${onlyMine
      ? 'No uploads from the people you follow yet.' : 'No public uploads yet.'}</p></div>`}
  `);

  $$('[data-feed]').forEach((btn) => btn.addEventListener('click', () => {
    feedFilter = btn.dataset.feed;
    drawFeed();
  }));
  /* Reuses the media wiring: there is no upload control on the feed, only the remove button on
   * your own posts. */
  wireMedia({ parent: null, rows: shownMedia, refresh: () => route({ keepScroll: true }) });
}

/* The dancers list: the old Directory, now a tab, with avatars and a follow button each. */
async function drawDancers() {
  const body = $('#community-body');
  const users = await store.listOtherUsers();
  /* Summaries for public accounts, fetched together so the list doesn't wait one by one. */
  const sums = new Map(await Promise.all(users.filter((u) => !u.isPrivate)
    .map(async (u) => [u.id, await store.summary(u.id)])));

  body.innerHTML = String(html`
    <p class="lede">See what other dancers are working on, and follow the ones you want to keep up with.
      Private accounts stay hidden.</p>
    ${users.length ? html`<ul class="list">
      ${users.map((u) => {
        if (u.isPrivate) {
          return html`<li class="row">
            <span class="feed-who">${avatarOf(u, 'avatar-sm')}</span>
            <div class="row-main"><strong>${u.username}</strong><span class="muted">Private account</span></div>
          </li>`;
        }
        const sum = sums.get(u.id);
        const following = store.isFollowing(u.id);
        return html`<li class="row">
          <a class="feed-who" href="#/user/${u.id}">${avatarOf(u, 'avatar-sm')}</a>
          <div class="row-main">
            <strong><a class="entry-link" href="#/user/${u.id}">${u.username}</a></strong>
            <span class="muted">${plural(sum.total, 'move')} logged${u.polingSince ? ` · Pole dancing since ${u.polingSince}` : ''}</span>
          </div>
          ${store.socialEnabled() ? html`<div class="actions">
            <button type="button" class="btn small ${following ? '' : 'primary'}" data-follow="${u.id}"
              aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>
          </div>` : ''}
        </li>`;
      })}
    </ul>` : html`<div class="empty"><p>No other dancers yet.</p></div>`}
    ${store.socialEnabled() ? '' : html`<p class="muted fineprint">Following needs
      <code>supabase/social.sql</code> run once in the Supabase SQL editor.</p>`}`);

  $$('[data-follow]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    const id = btn.dataset.follow;
    if (store.isFollowing(id)) await store.unfollow(id);
    else await store.follow(id);
    toast(store.isFollowing(id) ? `You follow ${store.usernameOf(id)}.` : 'Unfollowed.');
    await drawDancers();
  })));
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

  /* Following needs supabase/social.sql. Without it the profile still reads; the button and the
   * counts are left out and the reason is said on the page. */
  let counts = null;
  let socialNote = '';
  if (!store.socialEnabled()) {
    socialNote = 'Following is off until supabase/social.sql is run in the Supabase SQL editor.';
  } else {
    try { counts = await store.followCounts(user.id); }
    catch (err) { socialNote = err.message; }
  }
  const following = store.isFollowing(user.id);

  show(html`
    <a class="back" href="#/community?tab=dancers">← Dancers</a>
    <div class="page-head">
      <div class="who">
        ${avatarOf(user, 'avatar-lg')}
        <div>
          <p class="eyebrow">Dancer</p>
          <h1>${user.username}</h1>
          ${user.polingSince ? html`<p class="muted">Pole dancing since ${user.polingSince}</p>` : ''}
        </div>
      </div>
      ${!counts ? '' : html`<button type="button" class="btn small ${following ? '' : 'primary'}" id="follow"
        aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>`}
    </div>

    ${!counts ? '' : html`<p class="muted">${plural(counts.followers, 'follower')} · ${counts.following} following</p>`}
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
}

/* ---------- view: admin review queue ---------- */

async function viewReview() {
  if (!store.currentUser().isAdmin) return notFound('Admins only.');
  setTitle('Review');
  const pending = await store.listPending();
  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Admin</p><h1>Review queue</h1></div>
      <span class="count">${pending.length}</span>
    </div>
    <p class="lede">Check that each suggestion is a real trick and isn't already in the Bible under another spelling. Approving publishes it. Rejecting removes it and unlinks any moves that used it.</p>
    ${pending.length ? html`<ul class="list">
      ${pending.map((e) => html`
        <li class="row">
          <div class="row-main"><strong>${e.name}</strong>
            <span class="muted">Suggested by ${store.usernameOf(e.submittedBy)} on ${dateText(e.createdAt)}</span></div>
          <div class="actions">
            <button type="button" class="btn small primary" data-approve="${e.id}">Approve</button>
            <button type="button" class="btn small danger" data-reject="${e.id}">Reject</button>
          </div>
        </li>`)}
    </ul>` : html`<div class="empty"><h3>All caught up</h3><p>No suggestions waiting.</p></div>`}`);

  const review = (id, approve) => attempt(async () => {
    await store.reviewEntry(id, approve);
    toast(approve ? 'Approved and published.' : 'Rejected.');
    await route({ keepScroll: true });
  });
  $$('[data-approve]').forEach((b) => b.addEventListener('click', () => review(b.dataset.approve, true)));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', () => review(b.dataset.reject, false)));
}

/* ---------- view: account ---------- */

/* Whether the username box is open. Kept out of the URL: it is a short-lived form, not a screen. */
let editingName = false;

function viewAccount() {
  setTitle('Account');
  const me = store.currentUser();
  const thisYear = new Date().getFullYear();
  show(html`
    <div class="page-head">
      <div class="who">
        ${avatarOf(me, 'avatar-lg')}
        <div>
          ${me.isAdmin ? html`<p class="eyebrow">Admin account</p>` : ''}
          <div class="name-row">
            ${!editingName ? html`
              <h1>${me.username}</h1>
              <button type="button" class="icon-btn plain" id="edit-username" title="Change your username"
                aria-label="Change your username">${pencilIcon}</button>` : html`
              <form class="name-form" id="username-form">
                <input type="text" name="username" value="${me.username}" minlength="3" maxlength="24"
                  autocapitalize="none" spellcheck="false" aria-label="New username"
                  aria-describedby="username-hint" required>
                <button class="btn small primary" type="submit">Save</button>
                <button class="btn small" type="button" id="cancel-username">Cancel</button>
                <small class="sr-only" id="username-hint">3-24 characters: letters, numbers, dots, dashes
                  or underscores. This is the name other dancers see; you still log in with your email.</small>
              </form>`}
          </div>
          ${me.polingSince ? html`<p class="muted">Pole dancing since ${me.polingSince}</p>` : ''}
        </div>
      </div>
    </div>

    <h2 class="subhead">Profile</h2>
    <div class="card">
      <div class="set-block">
        <strong class="set-label" id="avatar-label">Avatar</strong>
        <div class="avatar-picker" role="group" aria-labelledby="avatar-label">
          ${store.AVATARS.map((key) => html`
            <button type="button" class="avatar-opt" data-avatar="${key}" aria-pressed="${me.avatar === key}"
              aria-label="Avatar: ${key.replace('pleaser-', '').replace(/[-_]/g, ' ')}">${avatarOf({ avatar: key }, 'avatar-md')}</button>`)}
          <button type="button" class="avatar-opt" data-avatar="" aria-pressed="${!me.avatar}"
            aria-label="My initial">${avatarOf({ username: me.username }, 'avatar-md')}</button>
        </div>
      </div>

      <div class="set-block">
        <div class="field-row">
          <label class="set-label" for="poling">Pole dancing since</label>
          <input type="number" id="poling" inputmode="numeric" min="1900" max="${thisYear}" placeholder="e.g. 2021"
            value="${me.polingSince ?? ''}">
          <button type="button" class="btn primary" id="save-poling">Save</button>
        </div>
        ${store.socialEnabled() ? '' : html`<p class="muted field-help">Avatars, pole dancing since and following need
          <code>supabase/social.sql</code> run once in the Supabase SQL editor.</p>`}
      </div>
    </div>

    <h2 class="subhead">Privacy</h2>
    <label class="check-row card">
      <input type="checkbox" id="private" ${me.isPrivate ? raw('checked') : ''}>
      <span><strong>Private account</strong>
        <small class="muted">Other dancers can't see your moves or collections. Bible suggestions are still reviewed as usual.</small></span>
    </label>

    <h2 class="subhead">Your data</h2>
    <div class="card">
      <div class="set-block">
        <strong class="set-label">Export and sign out</strong>
        <div class="actions">
          <button type="button" class="btn" id="export">Download my moves (JSON)</button>
          <button type="button" class="btn" id="logout">Log out</button>
        </div>
        <p class="muted field-help">Your moves and collections are saved to your account, so they are
          there on any device you log in from.</p>
      </div>

      <div class="set-block">
        <strong class="set-label">Delete my account</strong>
        <p class="muted field-help">Your moves, collections, photos and videos, and any Bible suggestions
          still waiting for review are deleted. Tricks you suggested that were approved stay in the
          Bible, because other dancers have linked moves to them.</p>
        <label class="set-label" for="confirm-name">Type your username to confirm</label>
        <div class="inline-form">
          <input type="text" id="confirm-name" placeholder="${me.username}" autocomplete="off"
            aria-label="Type your username to confirm">
          <button type="button" class="btn danger" id="delete-account" disabled>Delete account</button>
        </div>
      </div>
    </div>`);

  /* Editing happens in the name row, so put the caret in the box that replaced the name. */
  if (editingName) $('#username-form input')?.select();

  $('#private').addEventListener('change', (e) => {
    attempt(async () => {
      await store.setPrivacy(e.target.checked);
      toast(e.target.checked ? 'Your account is now private.' : 'Your account is now public.');
    });
  });
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
  $('#logout').addEventListener('click', () => {
    attempt(async () => { await store.logout(); go('#/auth'); });
  });

  /* Avatar choices save the moment you pick one; the year needs its own button because it is text. */
  $$('[data-avatar]').forEach((btn) => btn.addEventListener('click', () => attempt(async () => {
    await store.saveProfile({ avatar: btn.dataset.avatar || null });
    toast('Avatar saved.');
    await route({ keepScroll: true });
  })));
  $('#save-poling').addEventListener('click', () => attempt(async () => {
    await store.saveProfile({ polingSince: $('#poling').value.trim() });
    toast('Profile saved.');
    await route({ keepScroll: true });
  }));

  $('#edit-username')?.addEventListener('click', () => {
    editingName = true;
    route({ keepScroll: true });
  });
  $('#cancel-username')?.addEventListener('click', () => {
    editingName = false;
    route({ keepScroll: true });
  });
  $('#username-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(async () => {
      await store.renameMe(new FormData(e.target).get('username'));
      editingName = false;
      toast('Username updated.');
      await route({ keepScroll: true });
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

async function start() {
  const link = emailLink();

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
    else if (store.currentUser()) toast('Email confirmed - you are logged in.');
  }

  window.addEventListener('hashchange', () => route());
  await route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}
start();
