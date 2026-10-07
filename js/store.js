/* store.js — the data layer.
 *
 * Every read and write of app data goes through this file. The UI never
 * touches localStorage directly, so swapping in a real backend later
 * (Supabase, Firebase, your own API) means rewriting only this module.
 *
 * Data model (each array maps to a table if you move to SQL):
 *   users       { id, username, passHash, isAdmin, isPrivate, createdAt }
 *   moves       { id, userId, name, status, difficulty, entries[], exits[], combos[],
 *                 notes, categoryIds[], dictEntryId, createdAt, updatedAt, achievedAt }
 *   categories  { id, userId, name }                 a user's personal "collections"
 *   dictionary  { id, name, status, submittedBy, createdAt }   status: approved | pending
 *
 * A move links to the dictionary through the optional dictEntryId. It's
 * optional so a dancer can log a move before it exists in the dictionary.
 *
 * Rules enforced here (not in the UI), so the UI can't accidentally bypass them:
 *   - you can only edit your own moves and collections
 *   - private accounts' moves and collections are invisible to everyone else
 *   - pending dictionary entries are visible only to their submitter and admins
 */

const KEY = 'myPoleMagazine.v1';

export const STATUSES = [
  { value: 'goal', label: 'Goal' },
  { value: 'progress', label: 'In progress' },
  { value: 'achieved', label: 'Achieved' },
];

let state = blankState();

function blankState() {
  return { users: [], moves: [], categories: [], dictionary: [], sessionUserId: null };
}

/* ---------- small helpers ---------- */

const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const now = () => new Date().toISOString();
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save to localStorage', err);
  }
}

/* Prototype-grade password hashing: SHA-256 in the browser. This is NOT real
 * security (anyone with the device can read localStorage). A real backend
 * should hash server-side with bcrypt/argon2, or use a managed auth provider. */
async function hashPassword(username, password) {
  const text = `${username.toLowerCase()}::${password}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `plain:${text}`; // non-secure context fallback (e.g. http on a LAN address)
}

/* Trim, drop blanks and case-insensitive duplicates, keep order. */
function cleanList(list = []) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = String(item).trim().slice(0, 80);
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/* ---------- startup & seed data ---------- */

export async function init() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = { ...blankState(), ...JSON.parse(raw) };
      return;
    }
  } catch (err) {
    console.warn('Saved data was unreadable, starting fresh', err);
  }
  await seed();
}

/* A starter dictionary of well-known tricks plus a few demo dancers so the
 * Browse and Review screens have something to show. These names are demo
 * data, not an authoritative list. The community (and your admin) own that. */
const SEED_TRICKS = [
  'Allegra', 'Attitude spin', 'Ayesha', 'Back hook spin', 'Brass monkey', 'Butterfly',
  'Carousel spin', 'Chair spin', 'Cross knee release', 'Cupid', 'Fireman spin', 'Gemini',
  'Handspring', 'Iguana mount', 'Jade', 'Layback', 'Shoulder mount', 'Superman',
];

async function seed() {
  state = blankState();
  const entryIds = {};
  for (const name of SEED_TRICKS) {
    const entry = { id: uid(), name, status: 'approved', submittedBy: null, createdAt: now() };
    state.dictionary.push(entry);
    entryIds[name] = entry.id;
  }

  const addUser = async (username, password, extra = {}) => {
    const user = {
      id: uid(), username, passHash: await hashPassword(username, password),
      isAdmin: false, isPrivate: false, createdAt: now(), ...extra,
    };
    state.users.push(user);
    return user;
  };
  const addCategory = (user, name) => {
    const cat = { id: uid(), userId: user.id, name };
    state.categories.push(cat);
    return cat;
  };
  const addMove = (user, name, status, difficulty, extra = {}) => {
    const move = {
      id: uid(), userId: user.id, name, status, difficulty,
      entries: [], exits: [], combos: [], notes: '', categoryIds: [],
      dictEntryId: entryIds[name] ?? null,
      createdAt: now(), updatedAt: now(), achievedAt: status === 'achieved' ? now() : null,
      ...extra,
    };
    state.moves.push(move);
    return move;
  };

  await addUser('admin', 'admin', { isAdmin: true, isPrivate: true });
  const juniper = await addUser('juniper', 'demo');
  const pat = await addUser('pat', 'demo', { isPrivate: true });

  const spins = addCategory(juniper, 'Spins');
  const strength = addCategory(juniper, 'Strength goals');
  const routine = addCategory(juniper, 'Showcase routine');
  const note = 'Demo data. Your own notes live here.';
  addMove(juniper, 'Fireman spin', 'achieved', 1, {
    entries: ['Step-around'], exits: ['Walk out'], combos: ['Chair spin'], notes: note,
    categoryIds: [spins.id, routine.id],
  });
  addMove(juniper, 'Chair spin', 'achieved', 2, {
    entries: ['Fireman spin'], exits: ['Back hook spin'], notes: note,
    categoryIds: [spins.id, routine.id],
  });
  addMove(juniper, 'Back hook spin', 'progress', 2, { notes: note, categoryIds: [spins.id] });
  addMove(juniper, 'Cupid', 'progress', 3, { notes: note, categoryIds: [routine.id] });
  addMove(juniper, 'Brass monkey', 'goal', 4, { notes: note, categoryIds: [strength.id] });
  addMove(juniper, 'Superman', 'goal', 5, { notes: note, categoryIds: [strength.id] });

  addMove(pat, 'Carousel spin', 'achieved', 1, { notes: note });
  addMove(pat, 'Ayesha', 'goal', 4, { notes: note });

  persist();
}

export async function resetAll() {
  localStorage.removeItem(KEY);
  await seed();
}

/* ---------- accounts & session ---------- */

const rawMe = () => state.users.find((u) => u.id === state.sessionUserId) ?? null;
const publicUser = (u) =>
  u ? { id: u.id, username: u.username, isPrivate: u.isPrivate, isAdmin: u.isAdmin } : null;

function requireUser() {
  const me = rawMe();
  if (!me) throw new Error('Please log in first.');
  return me;
}
function requireAdmin() {
  const me = requireUser();
  if (!me.isAdmin) throw new Error('Admins only.');
  return me;
}

export const currentUser = () => publicUser(rawMe());
export const userById = (id) => publicUser(state.users.find((u) => u.id === id));
export const usernameOf = (id) => state.users.find((u) => u.id === id)?.username ?? 'unknown';

export async function register(username, password) {
  const name = String(username ?? '').trim();
  const pass = String(password ?? '');
  if (!/^[\w.-]{3,24}$/.test(name)) {
    throw new Error('Username must be 3–24 characters: letters, numbers, dots, dashes or underscores.');
  }
  if (pass.length < 4) throw new Error('Password must be at least 4 characters.');
  if (state.users.some((u) => sameText(u.username, name))) throw new Error('That username is taken.');
  const user = {
    id: uid(), username: name, passHash: await hashPassword(name, pass),
    isAdmin: false, isPrivate: false, createdAt: now(),
  };
  state.users.push(user);
  state.sessionUserId = user.id;
  persist();
  return publicUser(user);
}

export async function login(username, password) {
  const name = String(username ?? '').trim();
  const user = state.users.find((u) => sameText(u.username, name));
  const hash = await hashPassword(name, String(password ?? ''));
  if (!user || user.passHash !== hash) throw new Error('Incorrect username or password.');
  state.sessionUserId = user.id;
  persist();
  return publicUser(user);
}

export function logout() {
  state.sessionUserId = null;
  persist();
}

export function setPrivacy(isPrivate) {
  requireUser().isPrivate = !!isPrivate;
  persist();
}

/* Everyone except me and staff accounts, for the Browse screen. */
export function listOtherUsers() {
  const me = requireUser();
  return state.users
    .filter((u) => u.id !== me.id && !u.isAdmin)
    .map(publicUser)
    .sort((a, b) => a.username.localeCompare(b.username));
}

/* ---------- visibility ---------- */

export function canView(ownerId) {
  const me = rawMe();
  if (me?.id === ownerId) return true;
  const owner = state.users.find((u) => u.id === ownerId);
  return !!owner && !owner.isPrivate;
}

/* ---------- moves ---------- */

export function listMoves(userId) {
  if (!canView(userId)) return [];
  return state.moves
    .filter((m) => m.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getMove(id) {
  const move = state.moves.find((m) => m.id === id);
  return move && canView(move.userId) ? move : null;
}

export function summary(userId) {
  const mine = listMoves(userId);
  const count = (status) => mine.filter((m) => m.status === status).length;
  return { total: mine.length, goal: count('goal'), progress: count('progress'), achieved: count('achieved') };
}

/* achievedAt is set the first time a move becomes "achieved" and cleared if it moves back. */
function applyStatus(move, status) {
  move.status = STATUSES.some((s) => s.value === status) ? status : 'goal';
  if (move.status === 'achieved') move.achievedAt ??= now();
  else move.achievedAt = null;
}

/* Create (no id) or update (with id) one of my moves. */
export function saveMove(input) {
  const me = requireUser();
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Give the move a name.');

  let move = null;
  if (input.id) {
    move = state.moves.find((m) => m.id === input.id);
    if (!move || move.userId !== me.id) throw new Error('You can only edit your own moves.');
  }

  const fields = {
    name,
    difficulty: Math.min(5, Math.max(1, Number(input.difficulty) || 3)),
    entries: cleanList(input.entries),
    exits: cleanList(input.exits),
    combos: cleanList(input.combos),
    notes: String(input.notes ?? '').trim().slice(0, 2000),
    categoryIds: (input.categoryIds ?? []).filter((id) =>
      state.categories.some((c) => c.id === id && c.userId === me.id)),
    dictEntryId: input.dictEntryId && getEntry(input.dictEntryId) ? input.dictEntryId : null,
  };

  if (!move) {
    move = { id: uid(), userId: me.id, createdAt: now(), achievedAt: null };
    state.moves.push(move);
  }
  Object.assign(move, fields, { updatedAt: now() });
  applyStatus(move, input.status);
  persist();
  return move;
}

export function setStatus(id, status) {
  const me = requireUser();
  const move = state.moves.find((m) => m.id === id);
  if (!move || move.userId !== me.id) throw new Error('You can only edit your own moves.');
  applyStatus(move, status);
  move.updatedAt = now();
  persist();
  return move;
}

export function deleteMove(id) {
  const me = requireUser();
  const move = state.moves.find((m) => m.id === id);
  if (!move || move.userId !== me.id) throw new Error('You can only delete your own moves.');
  state.moves = state.moves.filter((m) => m.id !== id);
  persist();
}

/* "Save to my goals" on someone else's move. Copies only the name and the
 * dictionary link. Their notes, entries and exits stay theirs. */
export function copyToMine(moveId) {
  const me = requireUser();
  const source = getMove(moveId);
  if (!source) throw new Error('That move is not available.');
  if (source.userId === me.id) throw new Error('That move is already yours.');
  const entry = source.dictEntryId ? getEntry(source.dictEntryId) : null;
  const linked = entry?.status === 'approved' ? entry.id : null;
  const existing = state.moves.find(
    (m) => m.userId === me.id && ((linked && m.dictEntryId === linked) || sameText(m.name, source.name)));
  if (existing) return { move: existing, existed: true };
  const move = saveMove({ name: source.name, status: 'goal', difficulty: 3, dictEntryId: linked });
  return { move, existed: false };
}

/* ---------- collections (personal categories) ---------- */

export function listCategories(userId) {
  if (!canView(userId)) return [];
  return state.categories.filter((c) => c.userId === userId).sort(byName);
}

export function getCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  return cat && canView(cat.userId) ? cat : null;
}

export function createCategory(name) {
  const me = requireUser();
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) throw new Error('Give the collection a name.');
  const existing = state.categories.find((c) => c.userId === me.id && sameText(c.name, clean));
  if (existing) return existing;
  const cat = { id: uid(), userId: me.id, name: clean };
  state.categories.push(cat);
  persist();
  return cat;
}

export function renameCategory(id, name) {
  const me = requireUser();
  const cat = state.categories.find((c) => c.id === id && c.userId === me.id);
  if (!cat) throw new Error('Collection not found.');
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) throw new Error('Give the collection a name.');
  if (state.categories.some((c) => c.userId === me.id && c.id !== id && sameText(c.name, clean))) {
    throw new Error('You already have a collection with that name.');
  }
  cat.name = clean;
  persist();
}

/* Deleting a collection never deletes moves. They just leave the group. */
export function deleteCategory(id) {
  const me = requireUser();
  state.categories = state.categories.filter((c) => !(c.id === id && c.userId === me.id));
  for (const move of state.moves) {
    if (move.userId === me.id) move.categoryIds = move.categoryIds.filter((cid) => cid !== id);
  }
  persist();
}

/* ---------- pole dictionary ---------- */

/* Approved entries plus my own pending submissions. */
export function listEntries() {
  const me = rawMe();
  return state.dictionary
    .filter((e) => e.status === 'approved' || e.submittedBy === me?.id)
    .sort(byName);
}

export function getEntry(id) {
  const entry = state.dictionary.find((e) => e.id === id);
  if (!entry) return null;
  return entry.status === 'approved' || entry.submittedBy === rawMe()?.id ? entry : null;
}

/* How many different dancers have logged a move linked to this entry. */
export function entryUsage(id) {
  return new Set(state.moves.filter((m) => m.dictEntryId === id).map((m) => m.userId)).size;
}

/* Suggest a new trick. If the name already exists (approved, or mine and
 * pending) the existing entry is returned instead of creating a duplicate.
 * Admin submissions are approved immediately; everyone else's wait for review. */
export function submitEntry(name) {
  const me = requireUser();
  const clean = String(name ?? '').trim().slice(0, 60);
  if (!clean) throw new Error('Enter a trick name.');
  const existing = state.dictionary.find(
    (e) => sameText(e.name, clean) && (e.status === 'approved' || e.submittedBy === me.id));
  if (existing) return { entry: existing, created: false };
  const entry = {
    id: uid(), name: clean, status: me.isAdmin ? 'approved' : 'pending',
    submittedBy: me.id, createdAt: now(),
  };
  state.dictionary.push(entry);
  persist();
  return { entry, created: true };
}

export function listPending() {
  requireAdmin();
  return state.dictionary
    .filter((e) => e.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const pendingCount = () => (rawMe()?.isAdmin ? listPending().length : 0);

/* Approve publishes the entry. Reject deletes it and unlinks any moves that pointed at it. */
export function reviewEntry(id, approve) {
  requireAdmin();
  const entry = state.dictionary.find((e) => e.id === id && e.status === 'pending');
  if (!entry) throw new Error('That submission is no longer pending.');
  if (approve) {
    entry.status = 'approved';
  } else {
    state.dictionary = state.dictionary.filter((e) => e.id !== id);
    for (const move of state.moves) if (move.dictEntryId === id) move.dictEntryId = null;
  }
  persist();
}

/* ---------- export ---------- */

export function exportMine() {
  const me = requireUser();
  const catName = (id) => state.categories.find((c) => c.id === id)?.name;
  return {
    app: 'myPoleMagazine',
    exportedAt: now(),
    username: me.username,
    moves: state.moves
      .filter((m) => m.userId === me.id)
      .map((m) => ({
        name: m.name, status: m.status, difficulty: m.difficulty,
        entries: m.entries, exits: m.exits, combos: m.combos, notes: m.notes,
        collections: m.categoryIds.map(catName).filter(Boolean),
        dictionaryEntry: state.dictionary.find((e) => e.id === m.dictEntryId)?.name ?? null,
        achievedAt: m.achievedAt,
      })),
  };
}
