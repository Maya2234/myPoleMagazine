/* store.js — Supabase version.
 *
 * Same exported names as the localStorage version so app.js barely changes,
 * but anything that talks to the database is now async (await it).
 * Privacy and admin rules are enforced by the Row Level Security policies in
 * Supabase, not here. This file only asks for data and reports errors.
 */
import { supabase } from './supabase.js';

/* Where a move has got to. Three answers, and every move has one of them - the first is what a move
 * nobody has said anything about reads as, which is why it says what it is rather than "Goal": a move
 * you logged is not a goal until you put it on your goals, and calling it one made the other two look
 * like progress on something you had never set out to do.
 *
 * The stored values are unchanged ('goal' is what the column has always held for a fresh move, and
 * rows in the database carry it), so this is a change of wording, not a migration. */
export const STATUSES = [
  { value: 'goal', label: 'Not started' },
  { value: 'progress', label: 'In progress' },
  { value: 'achieved', label: 'Achieved' },
];

/* ---------- small caches so a few functions can stay synchronous ---------- */

let me = null;                     // the logged-in user's profile
let pending = 0;                   // admin's pending-suggestion count (for the nav pill)
let myEmailAddress = '';           // the address on the session; profiles do not carry one
const profiles = new Map();        // id -> public user, filled whenever we load profiles
const usernames = new Map();       // id -> username
const usage = new Map();           // dictionary entry id -> Set of dancer ids who logged it

/* ---------- helpers ---------- */

const now = () => new Date().toISOString();
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const byUsername = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
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

/* Where a dancer trains is a list (studiosOf) rather than a field here, because a dancer may train
 * in several places - see supabase/home-studios.sql. homeStudioId is the old single column, kept only
 * so that the screens keep working until that file has been run: once it has, the backfill in it has
 * copied this value into the list and this field stops being read. */
const toUser = (r) => ({
  id: r.id, username: r.username, isPrivate: r.is_private, isAdmin: r.is_admin,
  homeStudioId: r.home_studio_id ?? null,   // the pre-list column, only while profile_studios is missing
  avatar: r.avatar ?? null,             // one of AVATARS, or null for the letter avatar
  polingSince: r.poling_since ?? null,  // the year they started pole, or null
  city: r.city ?? null,                 // where they dance, if they said
  instagram: r.instagram ?? null,       // the handle only, never a URL (see readInstagram)
});

const toStudio = (r) => ({
  id: r.id, name: r.name, city: r.city ?? null,
  createdBy: r.created_by ?? null, createdAt: r.created_at,
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
  myEmailAddress = '';
  if (session) {
    const row = must(await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    /* Without a row the whole app has nothing to show, so say why instead of bouncing straight
     * back to the login screen as if the password had been wrong. */
    if (!row) {
      throw new Error(`Signed in as ${session.user.email ?? 'this account'}, but there is no row for it in the profiles table. The database trigger that creates a profile on signup is missing or did not run.`);
    }
    me = remember(row);
    myEmailAddress = session.user.email ?? '';   // for the support form, so it need not be retyped
  }
  await refreshPendingCount();
  await refreshFollowing();     // who I follow, so the views can ask synchronously
  await refreshStudios();       // the studio directory, so the dropdowns can be drawn synchronously
  await refreshHomeStudios();   // which studios everyone lists, in their order
  await refreshStudioLinks();   // and the Instagram handles its members have added
  await refreshAliases();       // and every nickname the dictionary can be searched by
}

/* Call once before the first route() in app.js: `await store.init()`. */
export const init = loadMe;

export const currentUser = () => me;

/* The signed-in address, or '' when nobody is logged in. The profile row has no email column, so
 * this comes from the session rather than from `me`. */
export const myEmail = () => myEmailAddress;

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

/* Two queues, one number: a new trick waiting to be approved and a suggested name change waiting to
 * be decided are both things an admin has to look at, so the pill on the Review link counts both.
 * It counts what an admin can actually decide in the queue, which is pending tricks only: the second
 * list - suggested name changes - was taken off the Review screen when nicknames (supabase/aliases.sql)
 * replaced it, so counting rows nobody can see would put a number in the navigation that no screen
 * accounts for. The store functions for that queue stay where they are, unused - see suggestLine in
 * the git history if you ever want the list back. */
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

/* ---------- passwords ---------- */

/* A forgotten password. Supabase owns the token and sends the email, so there is nothing to add to
 * this project's database for it: what has to be true is that the app's address is in the project's
 * redirect allow list (Supabase -> Authentication -> URL Configuration).
 *
 * The address is never confirmed either way. "No account with that email" would turn this screen into
 * a way of testing whether an address is registered here, so the screen says "if that address has an
 * account" whatever the API answered.
 *
 * The link comes back as '?reset=1'. A query parameter rather than a '#/reset' route on purpose: a
 * recovery link arrives with a payload of its own in the hash, and two hashes do not live in one URL. */
export async function requestPasswordReset(email) {
  const address = String(email ?? '').trim();
  if (!address) throw new Error('Enter the email address you registered with.');
  const { error } = await supabase.auth.resetPasswordForEmail(address, {
    redirectTo: `${location.origin}${location.pathname}?reset=1`,
  });
  if (error) {
    throw new Error(/rate|too many|seconds/i.test(error.message)
      ? 'That is a lot of reset emails in a short time. Wait a minute and try again.'
      : error.message);
  }
}

/* Sets a new password for the dancer this session belongs to - right after a reset link, that is the
 * dancer the link was sent to. The same call is what a change-password screen would use. */
export async function updatePassword(password) {
  const value = String(password ?? '');
  if (value.length < 6) throw new Error('Password must be at least 6 characters.');
  const { error } = await supabase.auth.updateUser({ password: value });
  if (error) {
    throw new Error(/should be different|must be different/i.test(error.message)
      ? 'That is the password this account already has. Pick a different one.'
      : error.message);
  }
}

/* True once a recovery link has been used in this page, so the app can land on the reset screen even
 * if the URL has been tidied up by then. The listener is registered in app.js before the first route
 * runs, because the client can fire this while the page is still starting. */
let recoveryPending = false;
export const isRecoveryPending = () => recoveryPending;
export function watchForPasswordRecovery(onRecovery) {
  supabase.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    recoveryPending = true;
    onRecovery();
  });
}

export async function logout() {
  me = null;            // clear first so a route() that runs right away already sees "logged out"
  pending = 0;
  following = new Set();
  levelVotes.clear();   // my level for a trick is mine, so it does not outlive the session
  myEmailAddress = '';
  recoveryPending = false;
  await supabase.auth.signOut();
}

export async function setPrivacy(isPrivate) {
  requireUser();
  must(await supabase.from('profiles').update({ is_private: !!isPrivate }).eq('id', me.id));
  me = { ...me, isPrivate: !!isPrivate };
  profiles.set(me.id, me);
}

/* ---------- my profile: avatar and Poler since ---------- */

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

const SOCIAL_HINT = 'Avatars, Poler since and following are not switched on for this project yet: run supabase/social.sql in the Supabase SQL editor, then reload.';

/* "column profiles.avatar does not exist" is not a sentence a dancer needs, so translate it. */
const explainSocial = (message) =>
  (/does not exist|schema cache/i.test(message) ? SOCIAL_HINT : message);

/* A profile write can be missing either file: supabase/social.sql adds avatar and poling_since,
 * supabase/studios.sql adds city and home_studio_id. The two messages are different problems and
 * deserve different answers, so they are told apart here. */
const STUDIOS_HINT = 'Studios and cities are not switched on for this project yet: run supabase/studios.sql in the Supabase SQL editor, then reload.';
const HOME_STUDIOS_HINT = 'Listing more than one studio is not switched on for this project yet: run supabase/home-studios.sql in the Supabase SQL editor, then reload.';
const INSTAGRAM_HINT = 'Instagram is not switched on for this project yet: run supabase/instagram.sql in the Supabase SQL editor, then reload.';
const PROFILE_GRANT_HINT = 'This profile cannot be saved from the app: run supabase/studios.sql and supabase/instagram.sql, which grant update on the columns the app writes. supabase/admins.sql narrows that list, so every file that names a column has to be run.';

const explainProfile = (message) => {
  if (/permission denied for table "?profiles"?/i.test(message)) return PROFILE_GRANT_HINT;
  /* Before the city/studio test: PostgREST reports a missing column by naming it, and a profile with
   * no instagram column is instagram.sql not run rather than anything to do with where they train. */
  if (/instagram/i.test(message)) return INSTAGRAM_HINT;
  if (/city|home_studio|studios/i.test(message)) return STUDIOS_HINT;
  return explainSocial(message);
};

/* Changes the public handle. Logging in uses the email address, so nothing about the session
 * changes here - only the name other members see. */
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

/* ---------- Instagram ---------- */

/* A handle, not a URL. Everything a dancer might paste - "@studio54", "instagram.com/studio54",
 * "https://www.instagram.com/studio54/?hl=en", "studio54/" - is reduced to the one part Instagram
 * itself treats as the account name, because the app builds the address from it (instagramUrl) and
 * a stored URL would be a second copy of the same fact that can disagree with the first.
 *
 * Returns null for "nothing said", which is a real answer: clearing the box takes the handle off.
 * Anything else that is not a handle throws here rather than at the database, so the dancer is told
 * what is wrong with the words rather than what is wrong with a column. */
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;
export function readInstagram(value) {
  const handle = String(value ?? '').trim()
    /* The scheme and the www. are both optional, because a pasted address may carry either, both or
     * neither - "instagram.com/studio54" is what you get from typing it out by hand. */
    .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^@+/, '');
  if (!handle) return null;
  if (!INSTAGRAM_RE.test(handle)) {
    throw new Error('That does not look like an Instagram handle: use the part after the @, up to 30 letters, numbers, dots or underscores.');
  }
  return handle;
}

export const instagramUrl = (handle) => (handle ? `https://instagram.com/${handle}` : '');

/* Saves the avatar, the year they started pole, where they train and their Instagram handle. Pass
 * only what changed; pass null to clear.
 *
 * Where they train arrives as a whole ordered list (homeStudioIds) rather than as one column, because
 * a dancer may list several studios now - see supabase/home-studios.sql. It is written after the
 * profile row itself, so a name that is already taken cannot leave the studio list half changed. */
export async function saveProfile({ avatar, polingSince, homeStudioIds, city, instagram } = {}) {
  const user = requireUser();
  const patch = {};
  const studios = homeStudioIds === undefined ? null : [...new Set(homeStudioIds.filter(Boolean))];

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

  /* Both are optional, and clearing one is a real answer: the empty string means "remove it",
   * which is why this checks the value rather than trusting it to be truthy. */
  if (city !== undefined) {
    patch.city = String(city ?? '').trim().slice(0, 80) || null;
  }

  if (instagram !== undefined) {
    patch.instagram = readInstagram(instagram);
  }

  /* A save that only reordered the studios has nothing in `patch` and is still a real save. */
  /* With no table to hold a list, the top of it goes in the one column that exists: the rest is
   * dropped rather than pretended, which is what the line under the list says. */
  const legacyStudio = studios && !homeStudiosReady ? (studios[0] ?? null) : undefined;
  if (legacyStudio !== undefined) patch.home_studio_id = legacyStudio;
  if (!Object.keys(patch).length && !studios) return me;
  if (Object.keys(patch).length) {
    try {
      must(await supabase.from('profiles').update(patch).eq('id', user.id));
    } catch (err) {
      throw new Error(explainProfile(err.message));
    }
  }
  if (studios && homeStudiosReady) await replaceHomeStudios(user.id, studios);

  me = {
    ...me,
    ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
    ...(patch.poling_since !== undefined ? { polingSince: patch.poling_since } : {}),
    ...(patch.city !== undefined ? { city: patch.city } : {}),
    ...(patch.instagram !== undefined ? { instagram: patch.instagram } : {}),
    ...(legacyStudio !== undefined ? { homeStudioId: legacyStudio } : {}),
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
  myEmailAddress = '';
  levelVotes.clear();
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

/* "Save to my goals" on someone else's move. Copies only the name and the dictionary link. */
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

/* ---------- pole dictionary ---------- */

/* Approved entries plus my own pending suggestions. Also records which members logged each entry,
 * which entryUsers() and entryUsage() read. (Both only ever see moves you are allowed to see.) */
export async function listEntries() {
  const rows = must(await supabase.from('dictionary_entries').select('*, moves(user_id)'));
  const visible = rows.filter((r) => r.status === 'approved' || r.submitted_by === me?.id);
  for (const r of visible) {
    usage.set(r.id, new Set((r.moves ?? []).map((m) => m.user_id).filter(Boolean)));
  }
  /* One extra query for every dancer behind those ids, so the dictionary can show whose moves a trick is
   * without asking once per row. A profile this dancer may not read simply does not come back, and
   * the trick then shows one fewer face - exactly who the old count left out too. */
  await loadProfiles([...new Set([...usage.values()].flatMap((ids) => [...ids]))]);
  await loadLevels();          // the level every row of the dictionary wears, in the same round trip
  /* The list is also the live index of what the dictionary is called, which is what entryNamed() answers
   * from - a chip reading "Fireman spin" on a move links to this entry, not to a second one. */
  indexEntries(visible.map(toEntry));
  return visible.map(toEntry).sort(byName);
}

export async function getEntry(id) {
  const row = must(await supabase.from('dictionary_entries').select('*').eq('id', id).maybeSingle());
  if (!row) return null;
  return row.status === 'approved' || row.submitted_by === me?.id ? toEntry(row) : null;
}

export const entryUsage = (id) => usage.get(id)?.size ?? 0;   // synchronous, filled by listEntries()

/* The members themselves, for the mini avatars the dictionary draws. Read from the same cache, so it is
 * only ever as complete as the last listEntries(), and anyone whose profile this dancer cannot read
 * is left out rather than shown as a blank face. */
export const entryUsers = (id) =>
  [...(usage.get(id) ?? [])].map((uid) => profiles.get(uid)).filter(Boolean);

/* The dictionary's tricks by name, so a piece of text a dancer typed - an entry or an exit on a move - can
 * be linked to the trick it names. Keyed on the trimmed lowercase name, which is the same rule the
 * add-move form matches a typed name against, so a chip links exactly where a new move would link.
 *
 * Filled by listEntries(), like the other two caches above; a screen that needs it without having
 * listed the entries asks for it first (see loadEntryIndex below). */
const entryIndex = new Map();
const indexEntries = (entries) => {
  for (const e of entries) entryIndex.set(e.name.trim().toLowerCase(), e);
  return entryIndex;
};
/* Synchronous, reads the cache. null when nothing has been loaded yet, which is how the caller tells
 * "no trick by that name" from "nobody has looked yet". */
export const entryNamed = (text) => (entryIndex.size ? entryIndex.get(String(text).trim().toLowerCase()) ?? null : null);

/* The index on its own, for a screen that shows chips of names without showing the dictionary. One query,
 * and it fills the same cache listEntries() fills. */
export async function loadEntryIndex() {
  if (!entryIndex.size) indexEntries(await listEntries());
  return entryIndex;
}

/* Every entry and exit the members have written on their own moves of this trick, counted.
 *
 * This is the question a shared trick can answer and a single move cannot: the trick is one thing,
 * but forty dancers describe getting into it in their own words, and the words that come up over and
 * over are the ones worth knowing. Row level security decides whose moves are counted - a private
 * account's moves are simply not in the answer, the same way they are not in the feed. */
export async function entryParts(entryId) {
  requireUser();
  if (!entryId) return { entries: [], exits: [] };
  let rows = [];
  try {
    rows = must(await supabase.from('moves').select('entries, exits').eq('dictionary_entry_id', entryId));
  } catch (err) {
    throw new Error(/does not exist|schema cache|permission denied/i.test(err.message)
      ? 'The entries and exits of a trick could not be read: the moves table needs the two list columns this app already writes.'
      : err.message);
  }

  /* Counted case- and space-insensitively, or "Wrist grip" and "wrist grip " would be two answers to
   * one question. The first spelling seen is the one shown, because it is the one a member typed. */
  const tally = (list) => {
    const seen = new Map();
    for (const raw of rows.flatMap((r) => (list === 'entries' ? r.entries : r.exits) ?? [])) {
      const text = String(raw ?? '').trim().slice(0, 80);
      if (!text) continue;
      const key = text.toLowerCase();
      const found = seen.get(key);
      if (found) found.count += 1;
      else seen.set(key, { text, count: 1 });
    }
    /* Most members first - the commonest way in is the one worth reading - then alphabetically, so
     * the order never depends on which row the database happened to hand back first. */
    return [...seen.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
  };

  return { entries: tally('entries'), exits: tally('exits') };
};

/* ---------- the other names a trick goes by ---------- */

/* An alias is what dancers actually call a trick, filed under the one canonical name. The whole table
 * is read at start-up for the same reason the levels are: the dictionary's search box has to match a trick
 * by any of its names, and a search that asked the database per keystroke would be unusable. It is a
 * small table of short strings, and supabase/aliases.sql keeps it to tricks the reader may see. */
let aliases = [];              // every alias this dancer may read
let aliasesReady = true;       // false once the table turns out to be missing
const ALIASES_HINT = 'Nicknames for tricks are not switched on for this project yet: run supabase/aliases.sql in the Supabase SQL editor, then reload.';
const explainAliases = (message) =>
  (/does not exist|schema cache|permission denied|could not find/i.test(message) ? ALIASES_HINT : message);

/* True once supabase/aliases.sql has been run. */
export const aliasesEnabled = () => aliasesReady;

const toAlias = (r) => ({
  id: r.id, entryId: r.dictionary_entry_id, alias: r.alias,
  addedBy: r.added_by ?? null, createdAt: r.created_at,
});

/* Synchronous, reads the cache: every alias of one trick, oldest first, so the nickname somebody
 * just added appears where they expect it rather than in whatever order the table holds them. */
export const entryAliases = (entryId) => aliases.filter((a) => a.entryId === entryId);

/* Every alias, for the search box. Same cache, no query. */
export const allAliases = () => aliases;

async function refreshAliases() {
  aliases = [];
  aliasesReady = true;
  if (!me) return aliases;
  try {
    const rows = must(await supabase.from('entry_aliases').select('*').order('created_at'));
    aliases = rows.map(toAlias);
  } catch {
    /* Like the levels, the studios and the follows: the rest of the app carries on without it. */
    aliasesReady = false;
  }
  return aliases;
}

/* Adds a nickname to a trick, or hands back the one already there. aliases.sql has a unique index on
 * the trick and the alias, so adding the same name twice would fail - and "that is already listed" is
 * not a mistake worth an error message. */
export async function addEntryAlias(entryId, value) {
  requireUser();
  const entry = await getEntry(entryId);
  if (!entry) throw new Error('That trick is not available.');
  const text = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (text.length < 2) throw new Error('Write the other name this trick goes by (at least two characters).');
  /* The name is not an alias of itself, and the database cannot say so - only the app knows which row
   * the name came from. */
  if (sameText(text, entry.name)) throw new Error(`${entry.name} is already the trick's name.`);

  const existing = aliases.find((a) => a.entryId === entryId && sameText(a.alias, text));
  if (existing) return existing;

  let row;
  try {
    row = must(await supabase.from('entry_aliases')
      .insert({ dictionary_entry_id: entryId, alias: text }).select().single());
  } catch (err) {
    /* Lost a race with another member typing the same name: hand back theirs. */
    if (/duplicate key|unique/i.test(err.message)) {
      await refreshAliases();
      const now = aliases.find((a) => a.entryId === entryId && sameText(a.alias, text));
      if (now) return now;
    }
    throw new Error(explainAliases(err.message));
  }

  const alias = toAlias(row);
  aliases = [...aliases, alias];
  return alias;
}

/* Takes a nickname off a trick. Yours, or an admin's - the rules aliases.sql writes. Asking for the
 * deleted row back is what tells a refusal from a success, the way every other delete in this file
 * does it: a policy that matches nothing still answers without an error. */
export async function removeEntryAlias(id) {
  requireUser();
  let rows;
  try {
    rows = must(await supabase.from('entry_aliases').delete().eq('id', id).select());
  } catch (err) {
    throw new Error(explainAliases(err.message));
  }
  if (!rows.length) {
    throw new Error('That name could not be removed: only the member who added it, or an admin, can take it off.');
  }
  aliases = aliases.filter((a) => a.id !== id);
}

/* ---------- difficulty: a dancer's own rating, and the community's ---------- */

/* A dancer's own rating of their own move, gentlest first. `value` is the 1-5 the moves table
 * stores (a check constraint keeps it in that range) and `label` is what a dancer reads. The two
 * "+" rungs sit between the three names everyone already uses, so a move that is harder than
 * beginner but not yet intermediate has somewhere honest to go.
 *
 * The order is the order of the pills in the add-move form and of the segments in the meter on a
 * move card, so it lives here once instead of in each screen. */
export const DIFFICULTIES = [
  { value: 1, label: 'Beginner' },
  { value: 2, label: 'Beginner+' },
  { value: 3, label: 'Intermediate' },
  { value: 4, label: 'Intermediate+' },
  { value: 5, label: 'Advanced' },
];

/* '' for anything that is not one of the five, so a hand-edited row shows no made-up level. */
export const difficultyLabel = (value) =>
  DIFFICULTIES.find((d) => d.value === Number(value))?.label ?? '';

/* The three things a dancer can say about a trick, gentlest first. `value` is what the database
 * stores - entry_levels.level, pinned by a check constraint in supabase/levels.sql - and `label` is
 * what a dancer reads. The order is the order of the pills on a trick's page and of the bars under
 * them, so it lives here once instead of in each screen. */
export const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const LEVEL_SETUP_HINT = 'Community difficulty is not switched on for this project yet: run supabase/levels.sql in the Supabase SQL editor, then reload.';
const explainLevels = (message) =>
  (/does not exist|schema cache|permission denied|could not find the function/i.test(message)
    ? LEVEL_SETUP_HINT : message);

let levelsReady = true;        // false once entry_level_totals() turns out to be missing
const levelVotes = new Map();  // entry id -> { counts: { beginner, intermediate, advanced }, mine }

/* False when supabase/levels.sql has not been run, so a screen can say what to do instead of drawing
 * three bars that will never fill. */
export const levelsEnabled = () => levelsReady;

/* Every trick's totals in one call, because the dictionary puts a level on every row. The database hands
 * back counts and whether one of them is mine - never another dancer's answer (see levels.sql). */
async function loadLevels() {
  levelVotes.clear();
  levelsReady = true;
  if (!me) return;
  try {
    const rows = must(await supabase.rpc('entry_level_totals'));
    for (const r of rows) {
      const tally = levelVotes.get(r.entry_id) ?? { counts: {}, mine: null };
      tally.counts[r.level] = Number(r.votes);
      if (r.mine) tally.mine = r.level;
      levelVotes.set(r.entry_id, tally);
    }
  } catch {
    /* Like the social layer: the rest of the app carries on without it rather than breaking. */
    levelsReady = false;
  }
}

/* Synchronous, reads what loadLevels() filled. Always answers for all three levels, so a screen can
 * draw three bars without checking for gaps, and says lead: null when nobody has voted rather than
 * inventing a favourite. */
export function entryLevel(entryId) {
  const tally = levelVotes.get(entryId);
  const counts = {};
  let total = 0;
  for (const { value } of LEVELS) {
    counts[value] = tally?.counts[value] ?? 0;
    total += counts[value];
  }

  const percents = {};
  for (const { value } of LEVELS) percents[value] = total ? Math.round((counts[value] / total) * 100) : 0;

  /* The level most members chose. A tie goes to the gentler answer, which is the more careful claim
   * to make about a trick. */
  let lead = null;
  for (const { value } of LEVELS) if (counts[value] > 0 && (!lead || counts[value] > counts[lead])) lead = value;

  /* One number for sorting by level: 1 beginner, 2 intermediate, 3 advanced. null with no votes, so
   * a sort can put the unrated tricks last instead of pretending they are easy. */
  const rank = (value) => LEVELS.findIndex((l) => l.value === value) + 1;
  const average = total ? LEVELS.reduce((sum, { value }) => sum + rank(value) * counts[value], 0) / total : null;

  return { counts, percents, total, mine: tally?.mine ?? null, lead, average };
}

export const levelLabel = (value) => LEVELS.find((l) => l.value === value)?.label ?? '';

/* Record or change my answer for one trick. An upsert, because one dancer gets one vote per trick:
 * answering again edits that row rather than counting twice. */
export async function setEntryLevel(entryId, level) {
  const user = requireUser();
  if (!LEVELS.some((l) => l.value === level)) throw new Error('Pick a level.');
  try {
    must(await supabase.from('entry_levels')
      .upsert(
        { dictionary_entry_id: entryId, user_id: user.id, level, updated_at: now() },
        { onConflict: 'dictionary_entry_id,user_id' },
      )
      .select());
  } catch (err) {
    throw new Error(explainLevels(err.message));
  }

  /* Keep the cache in step, so the page redraws from it without asking the database again. */
  const tally = levelVotes.get(entryId) ?? { counts: {}, mine: null };
  if (tally.mine && tally.mine !== level) tally.counts[tally.mine] = Math.max(0, (tally.counts[tally.mine] ?? 1) - 1);
  if (tally.mine !== level) tally.counts[level] = (tally.counts[level] ?? 0) + 1;
  tally.mine = level;
  levelVotes.set(entryId, tally);
  return level;
}

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
  if (!value) throw new Error('Media belongs to a move or a dictionary entry.');
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
  if (!moveId && !entryId) throw new Error('Media belongs to a move or a dictionary entry.');
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

const REMOVE_FOLLOWER_HINT = 'Removing a follower is not switched on for this project yet: run supabase/social.sql in the Supabase SQL editor. Until then you can still unfollow other members.';

/* Takes a follow off you - the opposite direction from unfollow(). Requires the
 * follows_remove_follower policy in supabase/social.sql, because a dancer deleting a row that
 * points at them is a different permission from deleting a row they made. */
export async function removeFollower(followerId) {
  const user = requireUser();
  if (followerId === user.id) throw new Error('You cannot remove yourself.');
  let removed;
  try {
    /* Asking for the deleted rows back is the whole point: a policy that refuses matches no rows,
     * and Supabase reports that as a plain success rather than an error, so without this the screen
     * would claim a follower was removed while nothing changed. */
    removed = must(await supabase.from('follows')
      .delete().eq('follower_id', followerId).eq('followee_id', user.id).select('follower_id'));
  } catch (err) {
    throw new Error(explainSocial(err.message));
  }
  if (!removed.length) throw new Error(REMOVE_FOLLOWER_HINT);
}

/* A dancer's follows, split the way a profile shows them.
 *
 *   friends   - accounts this one follows that follow back. Two profiles pointing at each other is
 *               what makes a friendship, so it is worked out here rather than stored anywhere: no
 *               second table to keep in step, and it cannot drift out of agreement with the follows.
 *   following - accounts this one follows that have not followed back yet. Because friends is the
 *               other half of the same set, the two lists never repeat a dancer, and neither shows
 *               someone who only follows them.
 *   followers - everyone pointing at this account, which the count on the profile uses.
 *
 * Two plain selects, and the follows table is readable by any signed-in dancer, so this works on
 * anyone's profile the same way the count did. Names come from a second query because a follow
 * stores only ids. */
export async function followLists(userId) {
  const [inbound, outbound] = await Promise.all([
    supabase.from('follows').select('follower_id').eq('followee_id', userId),
    supabase.from('follows').select('followee_id').eq('follower_id', userId),
  ]);
  const failed = inbound.error ?? outbound.error;
  if (failed) throw new Error(explainSocial(failed.message));

  const followerIds = inbound.data.map((r) => r.follower_id);
  const followeeIds = outbound.data.map((r) => r.followee_id);
  await loadProfiles([...new Set([...followerIds, ...followeeIds])]);

  const followersOf = new Set(followerIds);
  const asPeople = (ids) => ids.map((id) => profiles.get(id)).filter(Boolean);
  const followedBack = followeeIds.filter((id) => followersOf.has(id));

  return {
    followers: asPeople(followerIds),
    friends: asPeople(followedBack).sort(byUsername),
    following: asPeople(followeeIds.filter((id) => !followersOf.has(id))).sort(byUsername),
  };
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

/* ---------- studios ---------- */

let studios = [];          // the directory, sorted for a dropdown
let studiosReady = true;   // false once the studios table turns out to be missing

/* False when supabase/studios.sql has not been run, so a screen can say what to do rather than
 * drawing an empty dropdown and letting the dancer wonder whether anyone is on it. */
const explainStudios = (message) =>
  (/does not exist|schema cache|permission denied|could not find/i.test(message) ? STUDIOS_HINT : message);

export const studiosEnabled = () => studiosReady;
export const listStudios = () => studios;
export const studioById = (id) => studios.find((s) => s.id === id) ?? null;

/* "Studio 54 - Leeds", or just the name when nobody said which city. Used for the dropdown, which
 * is where two studios with the same name have to be told apart. */
export const studioLabel = (studio) =>
  (!studio ? '' : studio.city ? `${studio.name} — ${studio.city}` : studio.name);

/* Where a dancer trains, in their own order. A dancer lists as many studios as they like
 * (supabase/home-studios.sql) and the order is theirs to set, so this is the whole list and the first
 * one is the one a profile leads with. The cache is filled at start-up with everyone's rows in one
 * call, the way the studio directory itself is - which is also what lets the Community filter ask
 * "who is at this studio" without a query per member. */
const homeStudios = new Map();   // dancer id -> [studio id, ...] in the dancer's own order
let homeStudiosReady = true;     // false once profile_studios turns out to be missing

/* True once supabase/home-studios.sql has been run, so the editor can say what to run instead of
 * offering a list it cannot save. */
export const homeStudiosEnabled = () => homeStudiosReady;

/* Every studio a dancer has listed, in their order. Answers [] for someone who has not said, which is
 * an ordinary answer rather than a missing one.
 *
 * Until supabase/home-studios.sql has been run there is no list to read, and the one column a profile
 * has always had stands in for it: one studio, which is what those screens showed before. */
export const studiosOf = (user) => {
  if (!user?.id) return [];
  if (!homeStudiosReady) return [studioById(user.homeStudioId)].filter(Boolean);
  return (homeStudios.get(user.id) ?? []).map(studioById).filter(Boolean);
};

/* The one a profile leads with: the top of their list, or null when they have not listed any. */
export const studioOf = (user) => studiosOf(user)[0] ?? null;

async function refreshHomeStudios() {
  homeStudios.clear();
  homeStudiosReady = true;
  if (!me) return homeStudios;
  try {
    const rows = must(await supabase.from('profile_studios')
      .select('user_id, studio_id, position').order('position').order('added_at'));
    for (const r of rows) {
      homeStudios.set(r.user_id, [...(homeStudios.get(r.user_id) ?? []), r.studio_id]);
    }
  } catch {
    /* The rest of the app carries on: a profile simply shows no studio until the file has been run. */
    homeStudios.clear();
    homeStudiosReady = false;
  }
  return homeStudios;
}

/* The whole directory in one call: it is small, it is readable by any signed-in dancer, and every
 * screen that shows a studio needs the names anyway. Sorted here rather than in the query, because
 * Postgres orders uppercase before lowercase and the dropdown should read like a phone book. */
async function refreshStudios() {
  studios = [];
  studiosReady = true;
  if (!me) return studios;
  try {
    const rows = must(await supabase.from('studios').select('*'));
    studios = rows.map(toStudio).sort(byStudioName);
  } catch {
    /* Like the social layer and the levels: the rest of the app carries on without it. */
    studiosReady = false;
  }
  return studios;
}

const byStudioName = (a, b) => studioLabel(a).localeCompare(studioLabel(b), undefined, { sensitivity: 'base' });

/* Adds a studio, or hands back the one that is already in the list.
 *
 * The second half matters: studios.sql has a unique index on the name and city, so adding the same
 * studio twice would fail, and "that already exists" is a mistake the dancer cannot see - the list
 * is long. Matching here means the button does the obvious thing instead of reporting an error. */
export async function addStudio({ name, city } = {}) {
  requireUser();
  const cleanName = String(name ?? '').trim().slice(0, 80);
  const cleanCity = String(city ?? '').trim().slice(0, 80) || null;
  if (cleanName.length < 2) throw new Error('Give the studio a name of at least two characters.');

  const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
  const existing = studios.find((s) => same(s.name, cleanName) && same(s.city, cleanCity));
  if (existing) return existing;

  let row;
  try {
    row = must(await supabase.from('studios').insert({ name: cleanName, city: cleanCity }).select().single());
  } catch (err) {
    /* Lost a race with another dancer adding the same one: fetch it rather than failing. */
    if (/duplicate key|unique/i.test(err.message)) {
      await refreshStudios();
      const now = studios.find((s) => same(s.name, cleanName) && same(s.city, cleanCity));
      if (now) return now;
    }
    throw new Error(explainStudios(err.message));
  }

  const studio = toStudio(row);
  studios = [...studios, studio].sort(byStudioName);
  return studio;
}

/* Everyone who has listed this studio - the answer to "who else trains here". The list is the join
 * table, so a dancer who trains at two places is in two of these; row level security decides which
 * profiles this dancer may read, the same way it does everywhere else. */
export async function membersAtStudio(studioId) {
  requireUser();
  if (!studioId) return [];
  /* Before supabase/home-studios.sql has been run there is no list table, and the answer comes out
   * of the profiles table instead: whoever named this studio as theirs. One place each, which is
   * what the app could hold then. */
  if (!homeStudiosReady) {
    const rows = must(await supabase.from('profiles').select('*')
      .eq('home_studio_id', studioId).order('username'));
    return rows.map(remember);
  }
  try {
    const rows = must(await supabase.from('profile_studios').select('profiles(*)').eq('studio_id', studioId));
    return rows.map((r) => r.profiles).filter(Boolean).map(remember)
      .sort((a, b) => a.username.localeCompare(b.username));
  } catch (err) {
    throw new Error(explainHomeStudios(err.message));
  }
}

/* Writes a dancer's whole ordered list of studios: the rows left in it are inserted or renumbered,
 * the ones that fell out of it are removed. Written in one call rather than as an add-or-remove per
 * button because that is what makes the editor's single Save honest - what you see in the list is
 * what is written, order included, and there is no in-between state where half of it has landed.
 *
 * An empty list is a real answer ("I would rather not say where I train"), which is why the caller
 * passes an array and this never treats it as "nothing changed". */
export async function replaceHomeStudios(userId, ids) {
  requireUser();
  if (!userId) throw new Error('That dancer is not available.');
  const wanted = [...new Set(ids.filter(Boolean))];
  for (const id of wanted) {
    if (!studioById(id)) throw new Error('That studio is not in the list.');
  }
  try {
    if (!wanted.length) {
      must(await supabase.from('profile_studios').delete().eq('user_id', userId));
    } else {
      /* Off the list, in one statement; what is left is renumbered below with the new order. An
       * empty list has to be its own case rather than `not in ()`, because a list of nobody is not a
       * filter SQL can express as "not in nothing" - it would match no rows and quietly keep them. */
      must(await supabase.from('profile_studios').delete().eq('user_id', userId)
        .not('studio_id', 'in', `(${wanted.join(',')})`));
      must(await supabase.from('profile_studios')
        .upsert(wanted.map((studioId, i) => ({ user_id: userId, studio_id: studioId, position: i })),
          { onConflict: 'user_id,studio_id' }));
    }
  } catch (err) {
    throw new Error(explainHomeStudios(err.message));
  }
  homeStudios.set(userId, wanted);
  return wanted;
}

/* ---------- the Instagram accounts a studio's members have added ---------- */

/* A dancer has one handle and it is a column on their profile; a studio has as many as its members
 * care to contribute, so that is a table of its own - same fact, different number of them. Both come
 * from supabase/instagram.sql, which is why one flag covers the pair: until that file has been run
 * the studio page offers no form and a profile save leaves the handle alone.
 *
 * The whole table is read in one call, like the studio directory: it is small, every studio page
 * needs its own rows anyway, and a page that has already loaded them draws without waiting. */
let studioLinks = [];          // every contributed handle, loaded with the directory
let instagramReady = true;     // false once the table turns out to be missing

/* True once supabase/instagram.sql has been run. */
export const instagramEnabled = () => instagramReady;

const explainInstagram = (message) =>
  (/does not exist|schema cache|permission denied|could not find/i.test(message) ? INSTAGRAM_HINT : message);

/* Named separately from the studios hint because the two files are two problems: a missing
 * profile_studios table is home-studios.sql, and anything else about studios is studios.sql. */
const explainHomeStudios = (message) =>
  (/profile_studios/i.test(message) ? HOME_STUDIOS_HINT : explainStudios(message));

const toStudioLink = (r) => ({
  id: r.id, studioId: r.studio_id, handle: r.handle,
  addedBy: r.added_by ?? null, createdAt: r.created_at,
});

/* Synchronous, reads the cache. Ordered oldest first, because a list of accounts reads as a history
 * of who said what - and the row that says who added it makes that readable either way. */
export const listStudioInstagrams = (studioId) => studioLinks.filter((l) => l.studioId === studioId);

async function refreshStudioLinks() {
  studioLinks = [];
  instagramReady = true;
  if (!me) return studioLinks;
  try {
    const rows = must(await supabase.from('studio_instagrams').select('*').order('created_at'));
    studioLinks = rows.map(toStudioLink);
  } catch {
    /* Like the levels, the studios and the follows: the rest of the app carries on without it. */
    instagramReady = false;
  }
  return studioLinks;
}

/* Adds a handle to a studio, or hands back the one already listed.
 *
 * instagram.sql has a unique index on the studio and the handle, so adding the same account twice
 * would fail - and "that is already on the page" is not a mistake worth an error message. Matching
 * here means the button does the obvious thing, the way addStudio does. */
export async function addStudioInstagram(studioId, value) {
  requireUser();
  if (!studioId || !studioById(studioId)) throw new Error('That studio is not in the list.');
  const handle = readInstagram(value);
  if (!handle) throw new Error("Type the studio's Instagram name first - the part after the @.");

  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const existing = studioLinks.find((l) => l.studioId === studioId && same(l.handle, handle));
  if (existing) return existing;

  let row;
  try {
    row = must(await supabase.from('studio_instagrams')
      .insert({ studio_id: studioId, handle }).select().single());
  } catch (err) {
    /* Lost a race with another member adding the same account: hand back theirs. */
    if (/duplicate key|unique/i.test(err.message)) {
      await refreshStudioLinks();
      const now = studioLinks.find((l) => l.studioId === studioId && same(l.handle, handle));
      if (now) return now;
    }
    throw new Error(explainInstagram(err.message));
  }

  const link = toStudioLink(row);
  studioLinks = [...studioLinks, link];
  return link;
}

/* Takes an account off a studio. The rules are the ones instagram.sql writes: the member who added
 * it, or an admin. Asking for the deleted row back is what tells a refusal from a success - a policy
 * that matches nothing still answers without an error - which is the same reason removeFollower
 * asks (see social.sql). */
export async function removeStudioInstagram(id) {
  requireUser();
  let rows;
  try {
    rows = must(await supabase.from('studio_instagrams').delete().eq('id', id).select());
  } catch (err) {
    throw new Error(explainInstagram(err.message));
  }
  if (!rows.length) {
    throw new Error('That account could not be removed: only the member who added it, or an admin, can take it off.');
  }
  studioLinks = studioLinks.filter((l) => l.id !== id);
}

/* ---------- the community feed ---------- */

/* Every recent update in one list, moves and uploads together, newest first.
 *
 * The two live in different tables, so this is two queries and a merge rather than one clever
 * query - but the merge belongs here rather than in the view, because the ordering is the whole
 * point of a feed and it should not depend on which screen is drawing it. `kind` says which of the
 * two shapes the item carries. */
/* Recorded by the database when a public dancer adds a move to their goals or marks it achieved.
 * Only the rows the policies allow arrive, and a row whose move or owner can't be read is dropped. */
export async function feedEvents(limit = 24) {
  requireUser();
  const rows = must(await supabase.from('activity').select('*')
    .order('created_at', { ascending: false }).limit(limit));
  if (!rows.length) return [];
  const owners = await loadProfiles([...new Set(rows.map((r) => r.user_id))]);
  const names = new Map();
  const moveIds = [...new Set(rows.map((r) => r.move_id))];
  for (const m of must(await supabase.from('moves').select('id, name').in('id', moveIds))) {
    names.set(m.id, m.name);
  }
  return rows
    .map((r) => ({ kind: 'event', id: r.id, at: r.created_at, owner: owners.get(r.user_id),
      event: r.kind, moveId: r.move_id, moveName: names.get(r.move_id) }))
    .filter((e) => e.owner && e.moveName);
}

export async function feedActivity({ moves: moveLimit = 24, media: mediaLimit = 24 } = {}) {
  requireUser();
  const [moveRows, mediaRows, eventRows] = await Promise.all([
    feedMoves(moveLimit), feedMedia(mediaLimit), feedEvents(),
  ]);
  return [
    ...moveRows.map((m) => ({ kind: 'move', id: m.id, at: m.updatedAt, owner: m.owner, move: m })),
    ...mediaRows.map((m) => ({ kind: 'media', id: m.id, at: m.createdAt, owner: m.owner, media: m })),
    ...eventRows,
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
}

/* ---------- export ---------- */

/* ---------- journal (private: the policies only let a dancer read their own entries) ---------- */

const toJournal = (r) => ({ id: r.id, date: r.entry_date, body: r.body, createdAt: r.created_at });

/* Newest day first, then the most recent write first within a day. */
export async function listJournal(limit = 60) {
  const user = requireUser();
  const rows = must(await supabase.from('journal_entries').select('*').eq('user_id', user.id)
    .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit));
  return rows.map(toJournal);
}

/* `date` is the dancer's own local day, YYYY-MM-DD, so the entry lands on the day they see. */
export async function addJournalEntry({ date, body } = {}) {
  const user = requireUser();
  const text = String(body ?? '').trim();
  if (!text) throw new Error('Write what you worked on first.');
  if (text.length > 2000) throw new Error('Keep the entry under 2000 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) throw new Error('That date is not valid.');
  return toJournal(must(await supabase.from('journal_entries')
    .insert({ user_id: user.id, entry_date: date, body: text }).select().single()));
}

export async function deleteJournalEntry(id) {
  requireUser();
  must(await supabase.from('journal_entries').delete().eq('id', id));
}

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
      dictionaryEntry: r.dictionary_entries?.name ?? null,
      achievedAt: r.achieved_at,
    })),
  };
}

/* ---------- support ---------- */

/* Where a support message goes and how it is sent. The sending itself lives in the `support` Edge
 * Function - supabase/functions/support/index.ts - because the email provider's API key is a secret
 * and a browser can never be trusted with one. That function is deployed without a JWT check, since
 * the people who most need to write in are the ones who cannot log in.
 *
 * The address the mail lands on is decided there, not here, so it is not sitting in a public file. */

const SUPPORT_NOT_READY = 'Support is not switched on for this project yet. Deploy the support '
  + 'function (supabase/functions/support/index.ts) and give it a RESEND_API_KEY secret - the file '
  + 'says how, in its first comment block.';

/* The inbox the Edge Function writes into: the message itself, whether the email reached anybody,
 * and whether an admin has dealt with it. Only an admin may read it (support.sql says so), so this
 * is asked for from one screen - the one behind the Account page - and nowhere else. */
let supportReady = true;       // false once the table turns out to be missing
const SUPPORT_INBOX_HINT = 'The support inbox is not switched on for this project yet: run supabase/support.sql in the Supabase SQL editor, then reload.';
const explainSupport = (message) =>
  (/does not exist|schema cache|permission denied|could not find/i.test(message) ? SUPPORT_INBOX_HINT : message);

export const supportInboxEnabled = () => supportReady;

const toSupportMessage = (r) => ({
  id: r.id, name: r.name ?? '', email: r.email, subject: r.subject ?? '', message: r.message,
  username: r.username ?? null,
  emailed: !!r.emailed, emailError: r.email_error ?? '', handled: !!r.handled,
  createdAt: r.created_at,
});

/* Newest first, and capped: an unbounded list is a screen that gets slower every month. */
export async function listSupportMessages() {
  requireUser();
  try {
    const rows = must(await supabase.from('support_messages').select('*')
      .order('created_at', { ascending: false }).limit(200));
    supportReady = true;
    return rows.map(toSupportMessage);
  } catch (err) {
    supportReady = false;
    throw new Error(explainSupport(err.message));
  }
}

/* Marking a message handled. The row comes back, so a policy that quietly matched nothing is not
 * reported as a success. */
export async function setSupportMessageHandled(id, handled) {
  requireUser();
  let rows;
  try {
    rows = must(await supabase.from('support_messages')
      .update({ handled: !!handled }).eq('id', id).select());
  } catch (err) {
    throw new Error(explainSupport(err.message));
  }
  if (!rows.length) throw new Error('That message could not be updated. Only an admin can change it.');
  return toSupportMessage(rows[0]);
}

export async function sendSupportMessage({ name, email, subject, message, website }) {
  const from = String(email ?? '').trim();
  const body = {
    name: String(name ?? '').trim().slice(0, 80),
    email: from,
    subject: String(subject ?? '').trim().slice(0, 120),
    message: String(message ?? '').trim().slice(0, 4000),
    /* The honeypot: hidden from people, filled in by any bot that fills every box it finds. The
     * function answers 200 and throws the message away, so the bot has nothing to tune against. */
    website: String(website ?? '').trim().slice(0, 100),
    /* Who it came from, so a reply can still be tied to an account if the address has a typo in it. */
    username: me?.username ?? null,
  };

  /* Checked here as well as in the function: a round trip to be told the obvious is a poor trade. */
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) throw new Error('That email address does not look right.');
  if (body.message.length < 1) throw new Error('Please add a little more detail so we can help.');

  const { data, error } = await supabase.functions.invoke('support', { body });
  /* The function answers with a receipt - { ok, stored, emailed, note } - because the two halves can
   * fail separately: a message can be saved and never emailed, and the dancer is owed the truth about
   * which happened rather than the same thank-you either way. */
  if (!error) return data ?? { ok: true, stored: true, emailed: true };

  /* The function answers with { error } for the failures it understands. A function that was never
   * deployed answers 404 with nothing usable, and that is a setup problem rather than something the
   * dancer did - so it names the file to deploy, the way the rest of the app names its SQL. */
  let detail = '';
  try { detail = (await error.context?.json())?.error ?? ''; } catch { detail = ''; }
  if (detail) throw new Error(detail);
  throw new Error(SUPPORT_NOT_READY);
}