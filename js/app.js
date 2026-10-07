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
const attempt = (fn) => {
  try { return fn(); } catch (err) { toast(err.message, true); return undefined; }
};

/* ---------- shared bits ---------- */

const statusLabel = (value) => store.STATUSES.find((s) => s.value === value)?.label ?? value;
const badge = (status) => html`<span class="badge badge-${status}">${statusLabel(status)}</span>`;
const dots = (n) => html`<span class="dots" role="img" aria-label="Difficulty ${n} of 5">${
  [1, 2, 3, 4, 5].map((i) => html`<i class="${i <= n ? 'on' : ''}"></i>`)}</span>`;
const dateText = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const catMap = (userId) => new Map(store.listCategories(userId).map((c) => [c.id, c.name]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const moveCard = (m, names) => html`
  <a class="card" href="#/move/${m.id}">
    <div class="card-top"><h3>${m.name}</h3>${badge(m.status)}</div>
    <div class="meta">
      ${dots(m.difficulty)}
      ${m.categoryIds.map((id) => names.get(id)).filter(Boolean).map((n) => html`<span class="tag">${n}</span>`)}
    </div>
  </a>`;

const statsRow = (sum) => html`
  <div class="stats">
    <div class="stat"><strong>${sum.goal}</strong><span>Goals</span></div>
    <div class="stat"><strong>${sum.progress}</strong><span>In progress</span></div>
    <div class="stat"><strong>${sum.achieved}</strong><span>Achieved</span></div>
  </div>`;

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
    ['moves', '#/', 'Moves'],
    ['collections', '#/collections', 'Collections'],
    ['dictionary', '#/dictionary', 'Dictionary'],
    ['browse', '#/browse', 'Browse'],
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
  '': 'moves', move: 'moves', collections: 'collections', collection: 'collections',
  dictionary: 'dictionary', browse: 'browse', user: 'browse', review: 'review', account: 'account',
};

function route({ keepScroll = false } = {}) {
  const { parts, query } = parseHash();
  const me = store.currentUser();

  if (!me && parts[0] !== 'auth') return go('#/auth');
  if (me && parts[0] === 'auth') return go('#/');

  renderNav(SECTION[parts[0] ?? ''] ?? '');

  try {
    const [view, a, b] = parts;
    if (!view) viewMoves();
    else if (view === 'auth') viewAuth();
    else if (view === 'move' && a === 'new') viewMoveForm(null, query);
    else if (view === 'move' && b === 'edit') viewMoveForm(a, query);
    else if (view === 'move' && a) viewMove(a);
    else if (view === 'collections') viewCollections();
    else if (view === 'collection' && a) viewCollection(a);
    else if (view === 'dictionary') viewDictionary();
    else if (view === 'browse') viewBrowse();
    else if (view === 'user' && a) viewUser(a);
    else if (view === 'review') viewReview();
    else if (view === 'account') viewAccount();
    else notFound();
  } catch (err) {
    console.error(err);
    show(html`<div class="empty"><h3>Something went wrong</h3><p>${err.message}</p>
      <a class="btn" href="#/">Back to my moves</a></div>`);
  }

  if (!keepScroll) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
}

function notFound(message = 'That page does not exist.') {
  setTitle('Not found');
  show(html`<div class="empty"><h3>Not found</h3><p>${message}</p>
    <a class="btn" href="#/">Back to my moves</a></div>`);
}

/* ---------- view: login / register ---------- */

let authMode = 'login';

function viewAuth() {
  setTitle(authMode === 'login' ? 'Log in' : 'Create account');
  const isLogin = authMode === 'login';
  show(html`
    <section class="auth">
      <h1 class="brand-lg"><em>my</em>PoleMagazine</h1>
      <p class="lede">Log your moves, track your progress, and help the community agree on what to call things.</p>
      <div class="seg" role="group" aria-label="Log in or create an account">
        <button type="button" class="seg-btn" data-mode="login" aria-pressed="${isLogin}">Log in</button>
        <button type="button" class="seg-btn" data-mode="register" aria-pressed="${!isLogin}">Create account</button>
      </div>
      <form class="form" id="auth-form">
        <label class="field"><span>Username</span>
          <input type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label class="field"><span>Password</span>
          <input type="password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required></label>
        <button class="btn primary block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
      </form>
      <div class="demo card">
        <strong>Demo accounts</strong>
        <p><code>juniper</code> / <code>demo</code> has moves and collections to look at.<br>
        <code>admin</code> / <code>admin</code> can review dictionary submissions.</p>
      </div>
    </section>`);

  $$('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
    authMode = btn.dataset.mode;
    viewAuth();
  }));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    try {
      const fn = authMode === 'login' ? store.login : store.register;
      await fn(data.get('username'), data.get('password'));
      go('#/');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/* ---------- view: my moves (home) ---------- */

const filters = { status: 'all', cat: 'all', q: '', sort: 'recent' };

function viewMoves() {
  setTitle('My moves');
  const me = store.currentUser();
  const sum = store.summary(me.id);
  const cats = store.listCategories(me.id);
  const names = catMap(me.id);
  const moves = store.listMoves(me.id);
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

  const tabs = [['all', 'All', sum.total], ...store.STATUSES.map((s) => [s.value, s.label, sum[s.value]])];
  show(html`${head}
    ${statsRow(sum)}
    <div class="filters">
      <div class="seg" role="group" aria-label="Filter by status">
        ${tabs.map(([value, label, n]) => html`
          <button type="button" class="seg-btn" data-status="${value}" aria-pressed="${filters.status === value}">${label} ${n}</button>`)}
      </div>
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
      .filter((m) => (filters.status === 'all' || m.status === filters.status)
        && (filters.cat === 'all' || m.categoryIds.includes(filters.cat))
        && (!q || m.name.toLowerCase().includes(q)));
    if (filters.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    if (filters.sort === 'hard') rows.sort((a, b) => b.difficulty - a.difficulty || a.name.localeCompare(b.name));
    list.innerHTML = rows.length
      ? rows.map((m) => moveCard(m, names)).join('')
      : String(html`<div class="empty">No moves match those filters.</div>`);
  };
  draw();

  $$('[data-status]').forEach((btn) => btn.addEventListener('click', () => {
    filters.status = btn.dataset.status;
    $$('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    draw();
  }));
  $('#q').addEventListener('input', (e) => { filters.q = e.target.value; draw(); });
  $('#sort').addEventListener('change', (e) => { filters.sort = e.target.value; draw(); });
  $('#cat')?.addEventListener('change', (e) => { filters.cat = e.target.value; draw(); });
}

/* ---------- view: one move ---------- */

function viewMove(id) {
  const move = store.getMove(id);
  if (!move) return notFound('That move does not exist, or it belongs to a private account.');
  setTitle(move.name);

  const me = store.currentUser();
  const mine = move.userId === me.id;
  const owner = store.userById(move.userId);
  const names = catMap(move.userId);
  const entry = move.dictEntryId ? store.getEntry(move.dictEntryId) : null;

  const chipSection = (title, items) => items.length
    ? html`<div class="section"><h2>${title}</h2><div class="chips">${items.map((t) => html`<span class="chip">${t}</span>`)}</div></div>`
    : '';

  show(html`
    <a class="back" href="${mine ? '#/' : `#/user/${owner.id}`}">← ${mine ? 'My moves' : `${owner.username}'s moves`}</a>
    <div class="page-head">
      <div>
        <p class="eyebrow">${mine ? 'Move' : `Move by ${owner.username}`}</p>
        <h1>${move.name}</h1>
      </div>
      ${badge(move.status)}
    </div>

    <div class="meta-row">
      ${dots(move.difficulty)}
      ${entry ? html`<span class="tag">Dictionary: ${entry.name}${entry.status === 'pending' ? ' (pending review)' : ''}</span>`
        : html`<span class="tag">Not in the dictionary</span>`}
      ${move.achievedAt ? html`<span class="muted">Achieved ${dateText(move.achievedAt)}</span>` : ''}
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

    ${mine ? html`
      <div class="section">
        <h2>Update status</h2>
        <div class="seg" role="group" aria-label="Update status">
          ${store.STATUSES.map((s) => html`
            <button type="button" class="seg-btn" data-set="${s.value}" aria-pressed="${move.status === s.value}">${s.label}</button>`)}
        </div>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/move/${move.id}/edit">Edit</a>
        <button type="button" class="btn danger" id="delete">Delete</button>
      </div>` : html`
      <div class="actions">
        <button type="button" class="btn primary" id="copy">Save to my goals</button>
      </div>
      <p class="muted fineprint">Only the name is copied. ${owner.username}'s notes, entries and exits stay theirs.</p>`}
  `);

  $$('[data-set]').forEach((btn) => btn.addEventListener('click', () => {
    attempt(() => {
      store.setStatus(move.id, btn.dataset.set);
      toast(btn.dataset.set === 'achieved' ? 'Nice work. Marked as achieved.' : 'Status updated.');
      route({ keepScroll: true });
    });
  }));
  $('#delete')?.addEventListener('click', () => {
    if (!confirm(`Delete "${move.name}"? This cannot be undone.`)) return;
    attempt(() => { store.deleteMove(move.id); toast('Move deleted.'); go('#/'); });
  });
  $('#copy')?.addEventListener('click', () => {
    attempt(() => {
      const { move: copy, existed } = store.copyToMine(move.id);
      toast(existed ? 'You already have that move.' : 'Added to your goals.');
      go(`#/move/${copy.id}`);
    });
  });
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

function viewMoveForm(id, query) {
  const me = store.currentUser();
  let move = null;
  if (id) {
    move = store.getMove(id);
    if (!move || move.userId !== me.id) return notFound('You can only edit your own moves.');
  }
  setTitle(move ? `Edit ${move.name}` : 'Add move');

  const entries = store.listEntries();
  const prefillEntry = !move && query.get('entry') ? store.getEntry(query.get('entry')) : null;
  const prefillCat = !move ? query.get('cat') : null;
  const cats = store.listCategories(me.id);
  const m = move ?? {
    name: prefillEntry?.name ?? '', status: 'goal', difficulty: 3, entries: [], exits: [], combos: [],
    notes: '', categoryIds: cats.some((c) => c.id === prefillCat) ? [prefillCat] : [],
    dictEntryId: prefillEntry?.id ?? null,
  };
  const backHref = move ? `#/move/${move.id}` : '#/';

  show(html`
    <a class="back" href="${backHref}">← Cancel</a>
    <div class="page-head"><div><p class="eyebrow">${move ? 'Edit move' : 'New move'}</p><h1>${move ? m.name : 'Add a move'}</h1></div></div>

    <form class="form" id="move-form">
      <label class="field"><span>Move name</span>
        <input type="text" name="name" required maxlength="80" autocomplete="off" list="dict-names"
          value="${m.name}" placeholder="e.g. Fireman spin">
        <datalist id="dict-names">${entries.map((e) => html`<option value="${e.name}"></option>`)}</datalist>
      </label>

      <label class="field"><span>Pole dictionary entry</span>
        <select name="dict">
          <option value="">Not linked</option>
          ${entries.map((e) => html`<option value="${e.id}" ${m.dictEntryId === e.id ? raw('selected') : ''}>${e.name}${e.status === 'pending' ? ' (pending review)' : ''}</option>`)}
        </select>
        <small id="dict-hint">Linking helps the community agree on one name per move.</small>
      </label>

      <label class="check-row field" id="suggest-row" hidden>
        <input type="checkbox" name="suggest">
        <span><strong>Suggest this as a new dictionary entry</strong>
          <small>An admin reviews it before it appears for everyone.</small></span>
      </label>

      <fieldset class="field"><legend>Status</legend>
        <div class="seg">
          ${store.STATUSES.map((s) => html`
            <label><input type="radio" name="status" value="${s.value}" ${m.status === s.value ? raw('checked') : ''}><span>${s.label}</span></label>`)}
        </div>
      </fieldset>

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
      : 'Linking helps the community agree on one name per move.';
    suggestRow.hidden = !(typed && !dictSelect.value && !match);
  };
  nameInput.addEventListener('input', sync);
  dictSelect.addEventListener('change', () => { autoLinked = false; sync(); });
  sync();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(() => {
      const data = new FormData(form);
      const name = String(data.get('name')).trim();
      let dictEntryId = data.get('dict') || null;
      if (!dictEntryId && data.get('suggest')) {
        const { entry, created } = store.submitEntry(name);
        dictEntryId = entry.id;
        if (created) toast(entry.status === 'pending' ? 'Move saved. Dictionary suggestion sent for review.' : 'Move saved.');
      }
      const categoryIds = data.getAll('cat');
      const newCat = String(data.get('newcat') ?? '').trim();
      if (newCat) categoryIds.push(store.createCategory(newCat).id);

      const saved = store.saveMove({
        id: move?.id, name, status: data.get('status'), difficulty: data.get('difficulty'),
        entries: getEntries(), exits: getExits(), combos: getCombos(),
        notes: data.get('notes'), categoryIds, dictEntryId,
      });
      if (!data.get('suggest')) toast('Move saved.');
      go(`#/move/${saved.id}`);
    });
  });
}

/* ---------- view: my collections ---------- */

function viewCollections() {
  setTitle('Collections');
  const me = store.currentUser();
  const cats = store.listCategories(me.id);
  const moves = store.listMoves(me.id);

  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Group your moves</p><h1>Collections</h1></div>
      <span class="count">${cats.length}</span>
    </div>
    <p class="lede">Make a collection for anything: a routine, a skill level, a strength goal. A move can sit in several.</p>
    <form class="inline-form" id="new-cat">
      <input type="text" name="name" maxlength="40" placeholder="New collection name" aria-label="New collection name" required>
      <button class="btn primary" type="submit">Create</button>
    </form>
    ${cats.length ? html`<div class="stack">
      ${cats.map((c) => html`
        <a class="card" href="#/collection/${c.id}">
          <div class="card-top"><h3>${c.name}</h3>
            <span class="count">${moves.filter((m) => m.categoryIds.includes(c.id)).length}</span></div>
        </a>`)}
    </div>` : html`<div class="empty"><h3>No collections yet</h3><p>Create one above, then add moves to it from a move's edit screen.</p></div>`}`);

  $('#new-cat').addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(() => {
      const cat = store.createCategory(new FormData(e.target).get('name'));
      toast('Collection ready.');
      go(`#/collection/${cat.id}`);
    });
  });
}

function viewCollection(id) {
  const cat = store.getCategory(id);
  if (!cat) return notFound('That collection does not exist, or it belongs to a private account.');
  setTitle(cat.name);
  const me = store.currentUser();
  const mine = cat.userId === me.id;
  const owner = store.userById(cat.userId);
  const names = catMap(cat.userId);
  const moves = store.listMoves(cat.userId).filter((m) => m.categoryIds.includes(cat.id));

  show(html`
    <a class="back" href="${mine ? '#/collections' : `#/user/${owner.id}`}">← ${mine ? 'Collections' : `${owner.username}'s profile`}</a>
    <div class="page-head">
      <div><p class="eyebrow">${mine ? 'Collection' : `Collection by ${owner.username}`}</p><h1>${cat.name}</h1></div>
      <span class="count">${moves.length}</span>
    </div>
    ${mine ? html`
      <div class="actions"><a class="btn primary" href="#/move/new?cat=${cat.id}">+ Add a move</a></div>` : ''}
    <div class="stack" style="margin-top:16px">
      ${moves.length ? moves.map((m) => moveCard(m, names))
        : html`<div class="empty">${mine ? 'Nothing here yet. Add a move to this collection from its edit screen.' : 'No moves in this collection.'}</div>`}
    </div>
    ${mine ? html`
      <h2 class="subhead">Manage</h2>
      <form class="inline-form" id="rename">
        <input type="text" name="name" maxlength="40" value="${cat.name}" aria-label="Collection name" required>
        <button class="btn" type="submit">Rename</button>
      </form>
      <button type="button" class="btn danger" id="delete">Delete collection</button>
      <p class="muted fineprint">Deleting a collection never deletes its moves.</p>` : ''}`);

  $('#rename')?.addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(() => {
      store.renameCategory(cat.id, new FormData(e.target).get('name'));
      toast('Renamed.');
      route({ keepScroll: true });
    });
  });
  $('#delete')?.addEventListener('click', () => {
    if (!confirm(`Delete the collection "${cat.name}"? The moves stay.`)) return;
    attempt(() => { store.deleteCategory(cat.id); toast('Collection deleted.'); go('#/collections'); });
  });
}

/* ---------- view: pole dictionary ---------- */

let dictQuery = '';

function viewDictionary() {
  setTitle('Pole dictionary');
  const me = store.currentUser();
  const entries = store.listEntries();
  const mineByEntry = new Map(store.listMoves(me.id).filter((m) => m.dictEntryId).map((m) => [m.dictEntryId, m]));

  show(html`
    <div class="page-head">
      <div><p class="eyebrow">One name per move</p><h1>Pole dictionary</h1></div>
      <span class="count">${entries.length}</span>
    </div>
    <p class="lede">The community's shared list of trick names. Link your moves to it so everyone means the same thing.</p>
    <input type="search" id="dq" placeholder="Search the dictionary" aria-label="Search the dictionary" value="${dictQuery}" style="margin-bottom:14px">
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
      const used = store.entryUsage(e.id);
      const linked = mineByEntry.get(e.id);
      return String(html`
        <li class="row">
          <div class="row-main">
            <strong>${e.name}</strong>
            <span class="muted">${e.status === 'pending' ? 'Pending review' : used ? `Logged by ${plural(used, 'dancer')}` : 'Not logged by anyone yet'}</span>
          </div>
          <div class="actions">
            ${linked ? html`<a class="btn small" href="#/move/${linked.id}">In your moves</a>`
              : html`<a class="btn small" href="#/move/new?entry=${e.id}">Log it</a>`}
          </div>
        </li>`);
    }).join('') : String(html`<li class="row"><span class="muted">No matches. Suggest it below.</span></li>`);
  };
  draw();

  $('#dq').addEventListener('input', (e) => { dictQuery = e.target.value; draw(); });
  $('#suggest').addEventListener('submit', (e) => {
    e.preventDefault();
    attempt(() => {
      const { entry, created } = store.submitEntry(new FormData(e.target).get('name'));
      if (!created) toast(`"${entry.name}" is already in the dictionary.`);
      else toast(entry.status === 'pending' ? 'Sent for review. Thank you!' : 'Added to the dictionary.');
      route({ keepScroll: true });
    });
  });
}

/* ---------- view: browse other dancers ---------- */

function viewBrowse() {
  setTitle('Browse');
  const users = store.listOtherUsers();
  show(html`
    <div class="page-head"><div><p class="eyebrow">Community</p><h1>Browse dancers</h1></div></div>
    <p class="lede">See what other dancers are working on. Private accounts stay hidden.</p>
    ${users.length ? html`<div class="stack">${users.map((u) => {
      if (u.isPrivate) {
        return html`<div class="card disabled"><div class="card-top"><h3>${u.username}</h3><span class="tag">Private</span></div></div>`;
      }
      const sum = store.summary(u.id);
      return html`<a class="card" href="#/user/${u.id}">
        <div class="card-top"><h3>${u.username}</h3></div>
        <p class="muted">${plural(sum.total, 'move')} · ${sum.achieved} achieved · ${sum.progress} in progress</p>
      </a>`;
    })}</div>` : html`<div class="empty">No other dancers yet.</div>`}`);
}

function viewUser(id) {
  const user = store.userById(id);
  if (!user) return notFound('That dancer does not exist.');
  if (user.id === store.currentUser().id) return go('#/');
  setTitle(user.username);

  const back = html`<a class="back" href="#/browse">← Browse</a>`;
  if (!store.canView(user.id)) {
    show(html`${back}
      <div class="page-head"><div><p class="eyebrow">Dancer</p><h1>${user.username}</h1></div></div>
      <div class="empty"><h3>This account is private</h3><p>Only ${user.username} can see their moves.</p></div>`);
    return;
  }
  const names = catMap(user.id);
  const cats = store.listCategories(user.id);
  const moves = store.listMoves(user.id);
  show(html`${back}
    <div class="page-head"><div><p class="eyebrow">Dancer</p><h1>${user.username}</h1></div></div>
    ${statsRow(store.summary(user.id))}
    ${cats.length ? html`<h2 class="subhead">Collections</h2>
      <div class="chips">${cats.map((c) => html`<a class="chip" href="#/collection/${c.id}">${c.name}</a>`)}</div>` : ''}
    <h2 class="subhead">Moves</h2>
    <div class="stack">${moves.length ? moves.map((m) => moveCard(m, names)) : html`<div class="empty">No moves logged yet.</div>`}</div>`);
}

/* ---------- view: admin review queue ---------- */

function viewReview() {
  if (!store.currentUser().isAdmin) return notFound('Admins only.');
  setTitle('Review');
  const pending = store.listPending();
  show(html`
    <div class="page-head">
      <div><p class="eyebrow">Admin</p><h1>Review queue</h1></div>
      <span class="count">${pending.length}</span>
    </div>
    <p class="lede">Check that each suggestion is a real trick and isn't already in the dictionary under another spelling. Approving publishes it. Rejecting removes it and unlinks any moves that used it.</p>
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

  const review = (id, approve) => attempt(() => {
    store.reviewEntry(id, approve);
    toast(approve ? 'Approved and published.' : 'Rejected.');
    route({ keepScroll: true });
  });
  $$('[data-approve]').forEach((b) => b.addEventListener('click', () => review(b.dataset.approve, true)));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', () => review(b.dataset.reject, false)));
}

/* ---------- view: account ---------- */

function viewAccount() {
  setTitle('Account');
  const me = store.currentUser();
  show(html`
    <div class="page-head"><div><p class="eyebrow">${me.isAdmin ? 'Admin account' : 'Signed in'}</p><h1>${me.username}</h1></div></div>

    <h2 class="subhead">Privacy</h2>
    <label class="check-row card">
      <input type="checkbox" id="private" ${me.isPrivate ? raw('checked') : ''}>
      <span><strong>Private account</strong>
        <small class="muted">Other dancers can't see your moves or collections. Dictionary suggestions are still reviewed as usual.</small></span>
    </label>

    <h2 class="subhead">Your data</h2>
    <div class="actions">
      <button type="button" class="btn" id="export">Download my moves (JSON)</button>
      <button type="button" class="btn" id="logout">Log out</button>
    </div>

    <h2 class="subhead">Prototype tools</h2>
    <button type="button" class="btn danger" id="reset">Reset demo data</button>
    <p class="muted fineprint">Everything is saved in this browser only. Resetting erases it and restores the demo dancers and starter dictionary.</p>`);

  $('#private').addEventListener('change', (e) => {
    attempt(() => {
      store.setPrivacy(e.target.checked);
      toast(e.target.checked ? 'Your account is now private.' : 'Your account is now public.');
    });
  });
  $('#export').addEventListener('click', () => {
    attempt(() => {
      const blob = new Blob([JSON.stringify(store.exportMine(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mypolemagazine-${me.username}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  });
  $('#logout').addEventListener('click', () => { store.logout(); go('#/auth'); });
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Erase everything in this browser and restore the demo data?')) return;
    await store.resetAll();
    toast('Demo data restored. Please log in again.');
    go('#/auth');
  });
}

/* ---------- start ---------- */

async function start() {
  await store.init();
  window.addEventListener('hashchange', () => route());
  route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}
start();
