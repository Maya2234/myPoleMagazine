/* store.js — Supabase version.
 *
 * Same exported names as the localStorage version so app.js barely changes,
 * but anything that talks to the database is now async (await it).
 * Privacy and admin rules are enforced by the Row Level Security policies in
 * Supabase, not here. This file only asks for data and reports errors.
 */
import { supabase } from './supabase.js';

export const STATUSES = [
  { value: 'goal', label: 'Goal' },
  { value: 'progress', label: 'In progress' },
  { value: 'achieved', label: 'Achieved' },
];

/* ---------- small caches so a few functions can stay synchronous ---------- */

let me = null;                     // the logged-in user's profile
let pending = 0;                   // admin's pending-suggestion count (for the nav pill)
const profiles = new Map();        // id -> public user, filled whenever we load profiles
const usernames = new Map();       // id -> username
const usage = new Map();           // Bible entry id -> Set of dancer ids who logged it

/* ---------- helpers ---------- */

const now = () => new Date().toISOString();
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');   // so "_" and "%" in a name aren't wildcards

/* Supabase returns { data, error }. Throw the error, hand back the data. */
function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

function requireUser() {
  if (!me) throw new Error('Please log in first.');
  return me;
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

/* ---------- row -> app shape (database snake_case to the camelCase app.js uses) ---------- */

const toUser = (r) => ({
  id: r.id, username: r.username, isPrivate: r.is_private, isAdmin: r.is_admin,
  avatar: r.avatar ?? null,             // one of AVATARS, or null for the letter avatar
  polingSince: r.poling_since ?? null,  // the year they started pole, or null
});

function remember(row) {
  const user = toUser(row);
  profiles.set(user.id, user);
  usernames.set(user.id, user.username);
  return user;
}

const toMove = (r) => ({
  id: r.id, userId: r.user_id, name: r.name, status: r.status, difficulty: r.difficulty,
  entries: r.entries ?? [], exits: r.exits ?? [], combos: r.combos ?? [], notes: r.notes ?? '',
  dictEntryId: r.dictionary_entry_id, achievedAt: r.achieved_at, updatedAt: r.updated_at,
  categoryIds: (r.move_categories ?? []).map((c) => c.category_id),
});
const MOVE_SELECT = '*, move_categories(category_id)';

const toCategory = (r) => ({ id: r.id, userId: r.user_id, name: r.name, isDefault: r.is_default ?? false });
const toEntry = (r) => ({
  id: r.id, name: r.name, status: r.status, submittedBy: r.submitted_by, createdAt: r.created_at,
});

/* ---------- startup & session ---------- */

async function loadMe() {
  const { data: { session } } = await supabase.auth.getSession();
  me = null;
  if (session) {
    const row = must(await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    /* Without a row the whole app has nothing to show, so say why instead of bouncing straight
     * back to the login screen as if the password had been wrong. */
    if (!row) {
      throw new Error(`Signed in as ${session.user.email ?? 'this account'}, but there is no row for it in the profiles table. The database trigger that creates a profile on signup is missing or did not run.`);
    }
    me = remember(row);
  }
  await refreshPendingCount();
  await refreshFollowing();     // who I follow, so the views can ask synchronously
}

/* Call once before the first route() in app.js: `await store.init()`. */
export const init = loadMe;

export const currentUser = () => me;

/* A confirmation link comes back to the app with either a session in the URL fragment, which
 * the Supabase client picks up on its own, or a ?code= that has to be exchanged, plus an
 * error_description when the link has expired or was already used. Returns `{ error }` so the
 * screen can say what went wrong instead of leaving the visitor staring at nothing. */
export async function completeEmailLink() {
  const url = new URL(location.href);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const described = url.searchParams.get('error_description') ?? hash.get('error_description');
  if (described) return { error: described.replace(/\+/g, ' ') };

  const code = url.searchParams.get('code');
  if (!code) return {};
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? { error: error.message } : {};
}

export async function refreshPendingCount() {
  if (!me?.isAdmin) { pending = 0; return 0; }
  const { count, error } = await supabase
    .from('dictionary_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if (!error) pending = count ?? 0;
  return pending;
}
export const pendingCount = () => pending;

/* ---------- accounts ---------- */

const EMAIL_TAKEN = 'That email already has an account. Log in instead, or register with a different email.';
const USERNAME_TAKEN = 'That username is taken. Try another one.';

/* Asks the database whether an email or a username is already in use, so the form can say so
 * before it tries to sign up. The function is optional: it exists only if you ran
 * supabase/signup-availability.sql. When it is missing the app carries on and works out the same
 * two cases from the signup response instead. */
async function signupAvailability(email, username) {
  const { data, error } = await supabase.rpc('signup_availability', { p_email: email, p_username: username });
  if (error || !data?.[0]) return { checked: false };
  return { checked: true, emailTaken: !!data[0].email_taken, usernameTaken: !!data[0].username_taken };
}

/* Supabase logs in with email, so register takes email + username + password. */
export async function register(email, username, password) {
  const name = String(username ?? '').trim();
  const address = String(email ?? '').trim();
  if (!/^[\w.-]{3,24}$/.test(name)) {
    throw new Error('Username must be 3–24 characters: letters, numbers, dots, dashes or underscores.');
  }
  if (String(password ?? '').length < 6) throw new Error('Password must be at least 6 characters.');

  /* Supabase answers a duplicate email with a fake successful signup when email confirmation is
   * on, so ask directly first when the database can answer. */
  const availability = await signupAvailability(address, name);
  if (availability.checked) {
    if (availability.emailTaken) throw new Error(EMAIL_TAKEN);
    if (availability.usernameTaken) throw new Error(USERNAME_TAKEN);
  }

  const { data, error } = await supabase.auth.signUp({
    email: address,
    password,
    options: {
      data: { username: name },   // the database trigger copies this into profiles
      /* Send the confirmation link back to whichever origin the app is running on, so localhost
       * and a deployed copy both work. That origin still has to be listed in the Supabase project
       * (Authentication -> URL Configuration) or Supabase ignores it and uses the Site URL. */
      emailRedirectTo: location.origin + location.pathname,
    },
  });
  if (error) {
    if (error.code === 'user_already_exists' || /already (been )?registered/i.test(error.message)) {
      throw new Error(EMAIL_TAKEN);
    }
    // A duplicate username makes the profile trigger fail, which surfaces as a generic database error.
    throw new Error(/database error/i.test(error.message) ? USERNAME_TAKEN : error.message);
  }

  /* With confirmation on and the address already registered, Supabase returns a user with no
   * identities and no error, so nothing was created and no mail was sent. Only treat an empty
   * array as proof - the field is absent in some configurations and guessing would block real
   * signups. */
  if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
    throw new Error(EMAIL_TAKEN);
  }

  /* With "Confirm email" on in Supabase there is no session until the link is clicked. That is a
   * normal outcome of a good registration, so report it rather than throwing. */
  if (!data.session) return { needsConfirmation: true };
  await loadMe();
  return { needsConfirmation: false };
}

export async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: String(email ?? '').trim(), password });
  if (error) throw new Error(error.message);
  await loadMe();
}

export async function logout() {
  me = null;            // clear first so a route() that runs right away already sees "logged out"
  pending = 0;
  following = new Set();
  await supabase.auth.signOut();
}

export async function setPrivacy(isPrivate) {
  requireUser();
  must(await supabase.from('profiles').update({ is_private: !!isPrivate }).eq('id', me.id));
  me = { ...me, isPrivate: !!isPrivate };
  profiles.set(me.id, me);
}

/* ---------- my profile: avatar and pole dancing since ---------- */

/* The one place that knows about avatar artwork: on the left an id, which is what a profile row
 * stores in profiles.avatar, and on the right the file in icons/avatars/ that draws it. The key is
 * just a label - it never has to match the file name, so an id can point at a .jpg, a .png or an
 * .svg. Swap a file, or add a line plus its file, and the picker on the Account screen offers it;
 * nothing else in the app cares about the extension. The order here is the order of the picker. */
export const AVATAR_FILES = {
  'pleaser-black': 'pleaser-black.jpg',
  'pleaser-blue': 'pleaser-blue.jpg',
  'pleaser-boot': 'pleaser-boot.jpg',
  'pleaser-orange': 'pleaser-orange.jpg',
  'pleaser-pink': 'pleaser-pink.jpg',
};

/* The ids on offer. Derived, so the list and the files can never drift apart. */
export const AVATARS = Object.keys(AVATAR_FILES);

/* The address of a stored avatar id, or null when this build no longer ships that one - a preset
 * that was removed, or a row someone edited by hand. Callers fall back to the letter avatar. */
export const avatarSrc = (key) => (key && AVATAR_FILES[key] ? `icons/avatars/${AVATAR_FILES[key]}` : null);

const SOCIAL_HINT = 'Avatars, pole dancing since and following are not switched on for this project yet: run supabase/social.sql in the Supabase SQL editor, then reload.';

/* "column profiles.avatar does not exist" is not a sentence a dancer needs, so translate it. */
const explainSocial = (message) =>
  (/does not exist|schema cache/i.test(message) ? SOCIAL_HINT : message);

/* Changes the public handle. Logging in uses the email address, so nothing about the session
 * changes here - only the name other dancers see. */
export async function renameMe(username) {
  const user = requireUser();
  const name = String(username ?? '').trim();
  if (!/^[\w.-]{3,24}$/.test(name)) {
    throw new Error('Username must be 3-24 characters: letters, numbers, dots, dashes or underscores.');
  }
  if (name === user.username) return me;

  /* Asking for the row back means a policy that silently matches nothing is caught here rather
   * than looking like a success. */
  const { data, error } = await supabase.from('profiles')
    .update({ username: name }).eq('id', user.id).select().maybeSingle();
  if (error) {
    if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) throw new Error(USERNAME_TAKEN);
    throw new Error(error.message);
  }
  if (!data) throw new Error('Your profile could not be updated. Check that the policies on profiles allow you to update your own row.');

  me = { ...me, username: name };
  profiles.set(me.id, me);
  usernames.set(me.id, name);
  return me;
}

/* Saves the avatar and/or the year they started pole. Pass only what changed; pass null to clear. */
export async function saveProfile({ avatar, polingSince } = {}) {
  const user = requireUser();
  const patch = {};

  if (avatar !== undefined) {
    if (avatar !== null && !AVATARS.includes(avatar)) throw new Error('That is not one of the built-in avatars.');
    patch.avatar = avatar;
  }

  if (polingSince !== undefined) {
    if (polingSince === null || polingSince === '') {
      patch.poling_since = null;
    } else {
      const year = Number.parseInt(polingSince, 10);
      const thisYear = new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1900 || year > thisYear) {
        throw new Error(`Enter a year between 1900 and ${thisYear}, or leave it empty.`);
      }
      patch.poling_since = year;
    }
  }

  if (!Object.keys(patch).length) return me;
  try {
    must(await supabase.from('profiles').update(patch).eq('id', user.id));
  } catch (err) {
    throw new Error(explainSocial(err.message));
  }

  me = {
    ...me,
    ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
    ...(patch.poling_since !== undefined ? { polingSince: patch.poling_since } : {}),
  };
  profiles.set(me.id, me);
  return me;
}

/* Deletes this account and everything in it. The database work lives in
 * supabase/delete-account.sql, because a browser can never remove a row from auth.users.
 *
 * The uploaded files have to go through the Storage API first (deleting their rows leaves the
 * objects behind), and that needs the session, so it happens before the account is removed. */
export async function deleteAccount() {
  const user = requireUser();

  const { data: files } = await supabase.storage.from(BUCKET).list(user.id, { limit: 1000 });
  if (files?.length) {
    await supabase.storage.from(BUCKET).remove(files.map((f) => `${user.id}/${f.name}`));
  }

  const { error } = await supabase.rpc('delete_my_account');
  if (error) {
    throw /could not find the function|does not exist/i.test(error.message)
      ? new Error('Deleting an account is not switched on for this project yet: run supabase/delete-account.sql in the Supabase SQL editor.')
      : new Error(error.message);
  }

  me = null;        // the session is worthless now, so drop it before anything re-renders
  pending = 0;
  await supabase.auth.signOut();
}

/* Everyone except me and admin accounts, for Browse. */
export async function listOtherUsers() {
  requireUser();
  const rows = must(await supabase.from('profiles').select('*')
    .neq('id', me.id).eq('is_admin', false).order('username'));
  return rows.map(remember);
}

export async function userById(id) {
  const row = must(await supabase.from('profiles').select('*').eq('id', id).maybeSingle());
  return row ? remember(row) : null;
}

/* Synchronous, reads the cache. Only reliable after userById/listOtherUsers has loaded that user.
 * (The database already hides private data; this is just for choosing which screen to show.) */
export const usernameOf = (id) => usernames.get(id) ?? 'unknown';
export function canView(ownerId) {
  if (me?.id === ownerId) return true;
  const owner = profiles.get(ownerId);
  return !!owner && !owner.isPrivate;
}

/* ---------- moves ---------- */

export async function listMoves(userId) {
  // RLS returns nothing for another dancer's private account, so no check is needed here.
  const rows = must(await supabase.from('moves').select(MOVE_SELECT)
    .eq('user_id', userId).order('updated_at', { ascending: false }));
  return rows.map(toMove);
}

export async function getMove(id) {
  const row = must(await supabase.from('moves').select(MOVE_SELECT).eq('id', id).maybeSingle());
  return row ? toMove(row) : null;       // null when it doesn't exist or isn't visible to you
}

export async function summary(userId) {
  const rows = must(await supabase.from('moves').select('status').eq('user_id', userId));
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, goal: count('goal'), progress: count('progress'), achieved: count('achieved') };
}

/* Create (no id) or update (with id) one of my moves. */
export async function saveMove(input) {
  requireUser();
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Give the move a name.');
  const row = {
    name,
    difficulty: Math.min(5, Math.max(1, Number(input.difficulty) || 3)),
    entries: cleanList(input.entries),
    exits: cleanList(input.exits),
    combos: cleanList(input.combos),
    notes: String(input.notes ?? '').trim().slice(0, 2000),
    dictionary_entry_id: input.dictEntryId || null,
    updated_at: now(),
  };

  /* The app no longer shows a status, but the column is still there and older rows still carry a
   * value, so an edit never writes over one. setStatus() stays the only thing that changes it. */
  if (input.status === undefined) {
    if (!input.id) row.status = 'goal';        // a new row still needs a value
  } else {
    const status = STATUSES.some((s) => s.value === input.status) ? input.status : 'goal';
    // achieved_at is set the first time a move becomes "achieved" and cleared if it moves back.
    let achievedAt = null;
    if (input.id) {
      const old = must(await supabase.from('moves').select('achieved_at').eq('id', input.id).maybeSingle());
      achievedAt = old?.achieved_at ?? null;
    }
    row.status = status;
    row.achieved_at = status === 'achieved' ? (achievedAt ?? now()) : null;
  }

  // user_id is filled in by the column default (auth.uid()), so it can't be spoofed.
  const saved = input.id
    ? must(await supabase.from('moves').update(row).eq('id', input.id).select().maybeSingle())
    : must(await supabase.from('moves').insert(row).select().single());
  if (!saved) throw new Error('You can only edit your own moves.');

  // Replace this move's collection links. (Two steps, so not atomic. Fine for a prototype.)
  must(await supabase.from('move_categories').delete().eq('move_id', saved.id));
  const categoryIds = [...new Set(input.categoryIds ?? [])];
  if (categoryIds.length) {
    must(await supabase.from('move_categories')
      .insert(categoryIds.map((category_id) => ({ move_id: saved.id, category_id }))));
  }
  return toMove({ ...saved, move_categories: categoryIds.map((category_id) => ({ category_id })) });
}

export async function setStatus(id, status) {
  requireUser();
  const next = STATUSES.some((s) => s.value === status) ? status : 'goal';
  const old = must(await supabase.from('moves').select('achieved_at').eq('id', id).maybeSingle());
  const row = {
    status: next,
    achieved_at: next === 'achieved' ? (old?.achieved_at ?? now()) : null,
    updated_at: now(),
  };
  const saved = must(await supabase.from('moves').update(row).eq('id', id).select(MOVE_SELECT).maybeSingle());
  if (!saved) throw new Error('You can only edit your own moves.');
  return toMove(saved);
}

export async function deleteMove(id) {
  requireUser();
  must(await supabase.from('moves').delete().eq('id', id));   // RLS only lets you delete your own
}

/* "Save to my goals" on someone else's move. Copies only the name and the Bible link. */
export async function copyToMine(moveId) {
  requireUser();
  const source = await getMove(moveId);
  if (!source) throw new Error('That move is not available.');
  if (source.userId === me.id) throw new Error('That move is already yours.');
  const entry = source.dictEntryId ? await getEntry(source.dictEntryId) : null;
  const linked = entry?.status === 'approved' ? entry.id : null;
  const mine = await listMoves(me.id);
  const existing = mine.find((m) => (linked && m.dictEntryId === linked) || sameText(m.name, source.name));
  if (existing) return { move: existing, existed: true };
  const move = await saveMove({ name: source.name, status: 'goal', difficulty: 3, dictEntryId: linked });

  /* It was saved as a goal, so it belongs on the home page too. */
  const goals = await goalsCategory(me.id);
  return { move: goals ? ((await addToCategory(move.id, goals.id)) ?? move) : move, existed: false };
}

/* ---------- collections (personal categories) ---------- */

/* The one collection every profile has: where a dancer keeps what they are working on. It is
 * created by a trigger when the profile is made (supabase/current-goals.sql), so a brand new
 * dancer already has somewhere to put the moves they are chasing. */
export const GOALS_NAME = 'Current goals';

/* A dancer's own "Current goals" collection always comes first. */
export async function listCategories(userId) {
  const rows = must(await supabase.from('categories').select('*').eq('user_id', userId));
  return rows.map(toCategory)
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || byName(a, b));
}

export async function getCategory(id) {
  const row = must(await supabase.from('categories').select('*').eq('id', id).maybeSingle());
  return row ? toCategory(row) : null;
}

export async function createCategory(name) {
  requireUser();
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) throw new Error('Give the collection a name.');
  const existing = (await listCategories(me.id)).find((c) => sameText(c.name, clean));
  if (existing) return existing;
  return toCategory(must(await supabase.from('categories').insert({ name: clean }).select().single()));
}

export async function renameCategory(id, name) {
  requireUser();
  const clean = String(name ?? '').trim().slice(0, 40);
  if (!clean) throw new Error('Give the collection a name.');
  if ((await getCategory(id))?.isDefault) throw new Error(`"${GOALS_NAME}" is the collection your home page uses, so it cannot be renamed.`);
  const clash = (await listCategories(me.id)).some((c) => c.id !== id && sameText(c.name, clean));
  if (clash) throw new Error('You already have a collection with that name.');
  const row = must(await supabase.from('categories').update({ name: clean }).eq('id', id).select().maybeSingle());
  if (!row) throw new Error('Collection not found.');
}

/* Deleting a collection never deletes moves; the links cascade away in the database. */
export async function deleteCategory(id) {
  requireUser();
  if ((await getCategory(id))?.isDefault) throw new Error(`"${GOALS_NAME}" is the collection your home page uses, so it cannot be deleted.`);
  must(await supabase.from('categories').delete().eq('id', id));
}

/* ---------- current goals (the one collection every profile has) ---------- */

/* Finds a dancer's current-goals collection. `is_default` is the real marker; the name is only a
 * fallback, so accounts that existed before that file was run still find theirs. */
export async function goalsCategory(userId) {
  const rows = await listCategories(userId);
  return rows.find((c) => c.isDefault) ?? rows.find((c) => sameText(c.name, GOALS_NAME)) ?? null;
}

/* Mine, creating it when the database trigger has not (yet). */
export async function ensureGoalsCategory() {
  const user = requireUser();
  const existing = await goalsCategory(user.id);
  return existing ?? createCategory(GOALS_NAME);
}

/* Adds one of my moves to a collection and leaves its other links alone. */
export async function addToCategory(moveId, categoryId) {
  requireUser();
  const move = await getMove(moveId);
  if (!move) throw new Error('That move is not available.');
  if (move.userId !== me.id) throw new Error('You can only add your own moves to a collection.');
  if (move.categoryIds.includes(categoryId)) return move;
  must(await supabase.from('move_categories').insert({ move_id: moveId, category_id: categoryId }));
  return getMove(moveId);
}

export async function removeFromCategory(moveId, categoryId) {
  requireUser();
  must(await supabase.from('move_categories').delete().eq('move_id', moveId).eq('category_id', categoryId));
  return getMove(moveId);
}

/* ---------- pole Bible ---------- */

/* Approved entries plus my own pending suggestions. Also records which dancers logged each entry,
 * which entryUsers() and entryUsage() read. (Both only ever see moves you are allowed to see.) */
export async function listEntries() {
  const rows = must(await supabase.from('dictionary_entries').select('*, moves(user_id)'));
  const visible = rows.filter((r) => r.status === 'approved' || r.submitted_by === me?.id);
  for (const r of visible) {
    usage.set(r.id, new Set((r.moves ?? []).map((m) => m.user_id).filter(Boolean)));
  }
  /* One extra query for every dancer behind those ids, so the Bible can show whose moves a trick is
   * without asking once per row. A profile this dancer may not read simply does not come back, and
   * the trick then shows one fewer face - exactly who the old count left out too. */
  await loadProfiles([...new Set([...usage.values()].flatMap((ids) => [...ids]))]);
  return visible.map(toEntry).sort(byName);
}

export async function getEntry(id) {
  const row = must(await supabase.from('dictionary_entries').select('*').eq('id', id).maybeSingle());
  if (!row) return null;
  return row.status === 'approved' || row.submitted_by === me?.id ? toEntry(row) : null;
}

export const entryUsage = (id) => usage.get(id)?.size ?? 0;   // synchronous, filled by listEntries()

/* The dancers themselves, for the mini avatars the Bible draws. Read from the same cache, so it is
 * only ever as complete as the last listEntries(), and anyone whose profile this dancer cannot read
 * is left out rather than shown as a blank face. */
export const entryUsers = (id) =>
  [...(usage.get(id) ?? [])].map((uid) => profiles.get(uid)).filter(Boolean);

/* Suggest a new trick. If the name already exists (approved, or mine and pending) the existing
 * entry is returned instead. Admin submissions are approved immediately; others wait for review. */
export async function submitEntry(name) {
  requireUser();
  const clean = String(name ?? '').trim().slice(0, 60);
  if (!clean) throw new Error('Enter a trick name.');

  const findExisting = async () => {
    const rows = must(await supabase.from('dictionary_entries').select('*').ilike('name', escapeLike(clean)));
    return rows.map(toEntry).find((e) => e.status === 'approved' || e.submittedBy === me.id);
  };

  const existing = await findExisting();
  if (existing) return { entry: existing, created: false };

  const { data, error } = await supabase.from('dictionary_entries')
    .insert({ name: clean, status: me.isAdmin ? 'approved' : 'pending' }).select().single();
  if (error?.code === '23505') {                       // someone approved the same name a moment ago
    const again = await findExisting();
    if (again) return { entry: again, created: false };
  }
  if (error) throw new Error(error.message);
  return { entry: toEntry(data), created: true };
}

export async function listPending() {
  if (!me?.isAdmin) throw new Error('Admins only.');
  const rows = must(await supabase.from('dictionary_entries')
    .select('*, submitter:profiles!submitted_by(username)')
    .eq('status', 'pending').order('created_at'));
  for (const r of rows) if (r.submitted_by && r.submitter) usernames.set(r.submitted_by, r.submitter.username);
  pending = rows.length;
  return rows.map(toEntry);
}

/* Approve publishes the entry. Reject deletes it, and moves that used it lose the link. */
export async function reviewEntry(id, approve) {
  if (!me?.isAdmin) throw new Error('Admins only.');
  const base = supabase.from('dictionary_entries');
  const query = approve
    ? base.update({ status: 'approved' }).eq('id', id).eq('status', 'pending')
    : base.delete().eq('id', id).eq('status', 'pending');
  const { data, error } = await query.select('id');
  if (error?.code === '23505') {
    throw new Error('An approved entry with that name already exists. Reject this one instead.');
  }
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error('That submission is no longer pending.');
  await refreshPendingCount();
}

/* ---------- photos & videos ---------- */

const BUCKET = 'media';
/* Keep in step with file_size_limit in supabase/media.sql, and with the project's own limit in
 * Supabase -> Storage -> Settings. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const toMedia = (r) => ({
  id: r.id, ownerId: r.owner_id, moveId: r.move_id, entryId: r.dictionary_entry_id,
  path: r.storage_path, kind: r.kind, mime: r.mime_type, size: r.size_bytes,
  caption: r.caption, createdAt: r.created_at,
});

/* Signed URLs, because the bucket is private: who may see a file is decided by the storage
 * policies, not by a guessable public address. One call covers the whole list. */
export async function listMedia({ moveId = null, entryId = null } = {}) {
  requireUser();
  const value = moveId ?? entryId;
  if (!value) throw new Error('Media belongs to a move or a Bible entry.');
  const rows = must(await supabase.from('media').select('*')
    .eq(moveId ? 'move_id' : 'dictionary_entry_id', value).order('created_at'));
  if (!rows.length) return [];

  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ ...toMedia(r), url: urls.get(r.storage_path) ?? '' }));
}

const SETUP_HINT = 'Uploads are not switched on for this project yet: run supabase/media.sql in the Supabase SQL editor.';

/* Turns the raw storage and database errors into the thing to do about them. */
function explainUpload(message) {
  if (/bucket not found/i.test(message)) return SETUP_HINT;
  if (/maximum allowed size|too large|exceeded/i.test(message)) {
    return `That file is too big. Keep uploads under ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB.`;
  }
  if (/mime|content type/i.test(message)) {
    return 'That file type is not allowed. Use a JPG, PNG, WebP or GIF, or an MP4, WebM or MOV video.';
  }
  return message;
}

/* Uploads one file and records it. `moveId` or `entryId` says what it belongs to. */
export async function uploadMedia(file, { moveId = null, entryId = null, caption = '' } = {}) {
  const user = requireUser();
  if (!file) throw new Error('Pick a photo or a video first.');
  if (!moveId && !entryId) throw new Error('Media belongs to a move or a Bible entry.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name || 'That file'} is ${(file.size / 1048576).toFixed(1)} MB. Keep uploads under ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB.`);
  }
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : null;
  if (!kind) throw new Error('Only photos and videos can be uploaded.');

  /* One folder per dancer, so the storage policies can read ownership straight off the path. */
  const ext = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    || (kind === 'photo' ? 'jpg' : 'mp4');
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(explainUpload(error.message));

  try {
    const row = must(await supabase.from('media').insert({
      storage_path: path,
      kind,
      mime_type: file.type || null,
      size_bytes: file.size,
      caption: String(caption ?? '').trim().slice(0, 200) || null,
      move_id: moveId,
      dictionary_entry_id: entryId,
    }).select().single());
    return toMedia(row);
  } catch (err) {
    // Never leave a file behind when its row was rejected.
    await supabase.storage.from(BUCKET).remove([path]);
    throw /does not exist|schema cache|permission denied/i.test(err.message) ? new Error(SETUP_HINT) : err;
  }
}

/* Removes the row and then the file. The storage policy only lets you delete your own. */
export async function removeMedia(media) {
  requireUser();
  if (!media?.id || !media?.path) throw new Error('That file is no longer there.');
  must(await supabase.from('media').delete().eq('id', media.id));
  await supabase.storage.from(BUCKET).remove([media.path]);
}

/* ---------- following ---------- */

let following = new Set();   // the profile ids I follow, filled with the session
let socialReady = true;      // false once the follows table turns out to be missing

/* False when supabase/social.sql has not been run, so a screen can say so instead of breaking. */
export const socialEnabled = () => socialReady;

export async function refreshFollowing() {
  following = new Set();
  socialReady = true;
  if (!me) return following;
  try {
    const rows = must(await supabase.from('follows').select('followee_id').eq('follower_id', me.id));
    following = new Set(rows.map((r) => r.followee_id));
  } catch {
    /* The table is not there yet. Everything except following still works, so carry on quietly and
     * let the screens that need it say what to run. */
    socialReady = false;
  }
  return following;
}

/* Synchronous, reads the cache filled by refreshFollowing(). */
export const followingIds = () => following;
export const isFollowing = (id) => following.has(id);

export async function follow(userId) {
  const user = requireUser();
  if (userId === user.id) throw new Error('You cannot follow yourself.');
  try {
    must(await supabase.from('follows').insert({ follower_id: user.id, followee_id: userId }));
  } catch (err) {
    throw new Error(explainSocial(err.message));
  }
  following.add(userId);
}

export async function unfollow(userId) {
  const user = requireUser();
  try {
    must(await supabase.from('follows').delete().eq('follower_id', user.id).eq('followee_id', userId));
  } catch (err) {
    throw new Error(explainSocial(err.message));
  }
  following.delete(userId);
}

export async function followCounts(userId) {
  const [followers, followees] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', userId),
    supabase.from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  const failed = followers.error ?? followees.error;
  if (failed) throw new Error(explainSocial(failed.message));
  return { followers: followers.count ?? 0, following: followees.count ?? 0 };
}

/* ---------- community feed ---------- */

/* Loads these profiles into the cache and hands them back by id. */
async function loadProfiles(ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const row of must(await supabase.from('profiles').select('*').in('id', ids))) {
    out.set(row.id, remember(row));
  }
  return out;
}

/* The newest moves this dancer is allowed to see: their own plus everyone public. Row level
 * security decides that, so this is a plain select. Usernames come from a second query because
 * moves.user_id points at auth.users, which the API does not expose. */
export async function feedMoves(limit = 20) {
  requireUser();
  const rows = must(await supabase.from('moves').select(MOVE_SELECT)
    .order('updated_at', { ascending: false }).limit(limit));
  const owners = await loadProfiles([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({ ...toMove(r), owner: owners.get(r.user_id) })).filter((m) => m.owner);
}

/* The newest uploads, each with its parent (a move or a trick) and the dancer who posted it. */
export async function feedMedia(limit = 12) {
  requireUser();
  const rows = must(await supabase.from('media').select('*')
    .order('created_at', { ascending: false }).limit(limit));
  if (!rows.length) return [];

  const owners = await loadProfiles([...new Set(rows.map((r) => r.owner_id))]);
  const parents = new Map();
  const moveIds = [...new Set(rows.map((r) => r.move_id).filter(Boolean))];
  const entryIds = [...new Set(rows.map((r) => r.dictionary_entry_id).filter(Boolean))];
  if (moveIds.length) {
    for (const m of must(await supabase.from('moves').select('id, name, user_id').in('id', moveIds))) {
      parents.set(m.id, { kind: 'move', id: m.id, name: m.name, ownerId: m.user_id });
    }
  }
  if (entryIds.length) {
    for (const e of must(await supabase.from('dictionary_entries').select('id, name').in('id', entryIds))) {
      parents.set(e.id, { kind: 'trick', id: e.id, name: e.name, ownerId: null });
    }
  }

  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  /* A file whose parent this dancer may not see is dropped rather than shown as a dead tile: the
   * parent query obeys the same policies as a move or trick page, so it simply does not resolve. */
  return rows.map((r) => ({
    ...toMedia(r),
    url: urls.get(r.storage_path) ?? '',
    owner: owners.get(r.owner_id),
    parent: parents.get(r.move_id ?? r.dictionary_entry_id) ?? null,
  })).filter((m) => m.owner && m.parent);
}

/* ---------- export ---------- */

export async function exportMine() {
  requireUser();
  const rows = must(await supabase.from('moves')
    .select('*, dictionary_entries(name), move_categories(categories(name))')
    .eq('user_id', me.id).order('name'));
  return {
    app: 'myPoleMagazine',
    exportedAt: now(),
    username: me.username,
    moves: rows.map((r) => ({
      name: r.name, status: r.status, difficulty: r.difficulty,
      entries: r.entries, exits: r.exits, combos: r.combos, notes: r.notes,
      collections: (r.move_categories ?? []).map((c) => c.categories?.name).filter(Boolean),
      BibleEntry: r.dictionary_entries?.name ?? null,
      achievedAt: r.achieved_at,
    })),
  };
}