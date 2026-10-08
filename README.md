# MyPoleMagazine
cross platform (web, ios, android) application for logging pole dance moves achieved and progress. This will help standardize trick naming across the community and allow individuals practicing to create collections, add notes to a particular move, remember exits, entries, and other important features about certain tricks in one place.

## User experience & percieved benefit
How do you currently track your moves? Is it working for you?
What could be better about that process?
What non-physical struggles do you have with learning new moves, combos, and routines?

Personally, I do not think ai provides value here. I think this is a section of software engineering that should be extremely simple and straightforward. I think ai could make up a lot of content here that could sound somewhat plausible, but at the end of the day, the ai is not providing a real or valuable experience.

- As a pole dancer, I want to group certain pole moves together so I can categorize by personal difficulty, achieved, in progress, and future goals.
- As a pole dancer, I want to have the ability to create a detail page for each move I learn so I can document entries, exits, and good combo moves for each trick.
- As a pole dancer, I want to be able to browse other dancers collections of moves and share mine (contribution to standarized naming)
- As a pole dancer, I want to be able to friend other pole dancers, see when they unlock a new move and congratulate them on that progress
- As a pole instructor, I want to see what students are working on, what they have achieved and what their goals are

Application must provide the ability for users to register/login, create entries for each move, add entry, exits and other notes, and group moves by personalized category. There will be a "pole Bible" of entries, and users can link moves to the corresponding pole Bible entry or create a new trick. These will be added to the pole Bible upon review by admin. Pole Bible entries will acculmate differing names for a singular move, as this is a common issue in the community. Users will be able to view each others collections and entries, unless the account is set to private.




## Run it

Modules and service workers need http, so don't double-click `index.html`. From this folder, any static server works:

```
python3 -m http.server 8000
# or, without Python:  npx serve -l 8000
```

Open http://localhost:8000.

**Changes not showing up?** The service worker keeps an offline copy of the app shell. It is
network-first now, so a reload picks up your edits - but if you ever get stuck on an old build
(which is what the old cache-first version did), unregister it in DevTools → Application →
Service Workers and reload.

**On your phone:** run the server, find your computer's local IP, open `http://<that-ip>:8000` on the same wifi, then use "Add to Home Screen". Note that installing and offline mode need HTTPS, which `localhost` counts as but a LAN IP does not. For a real install on your phone, deploy the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages), which gives you HTTPS for free.

**Accounts.** Register on the landing screen with an email, a password and a username. You log
in with the email; the username is the public handle other dancers see. Confirming your email
address is on in the Supabase project, so click the link before your first login.

The old seeded demo logins (`juniper` / `pat` / `admin`) only exist if you recreated them in
Supabase - accounts now live there, not in the browser.

## Your user stories and where they live

| Story | Where |
|---|---|
| Track what you are working on | **Home** is your **Current goals** collection, created with your profile; add any of your moves to it and take it off with "Done for now". **Collections** for your own groupings (a move can be in several) |
| Detail page per move with entries, exits, combos | **Moves → a move**; add or edit with chips (type, press Enter) |
| Browse and share collections (standardized naming) | **Community → Dancers** → a dancer → their moves and collections; "Save to my goals" copies the name into your list and into your current goals |
| See what the community is doing | **Community → New moves & uploads**: the newest public moves and photos/videos, with a filter for the dancers you follow |
| Follow other dancers | **Community → Dancers**, or the button on a dancer's page; **Account** shows nothing to manage - a follow is yours to give and take back |
| Show how long you have been Poler | **Account → Poler since** (a year), shown on your profile next to your avatar |
| Pick an avatar | **Account → Avatar**: five pleaser photos, or your initial on a colour of its own |
| Register / login | Landing screen |
| Pole Bible, linked or newly suggested, admin review | **Bible** to search and suggest; the move form auto-links on a name match; **Review** (admin only) approves or rejects |
| Private accounts | **Account → Private account** |

Not built (per our scoping): congratulating someone on a new move, the instructor view, multiple names per trick.

## How it is organized

```
index.html              page shell
css/style.css           all styling (light + dark mode via CSS variables)
js/supabase.js          the Supabase client (project URL + publishable key)
js/store.js             the data layer: all reads/writes, async calls to Supabase
js/app.js               router + one function per screen
sw.js                   service worker (offline app shell)
manifest.webmanifest    makes it installable
icons/                  app icons
icons/avatars/          the built-in avatar photos
```

**The one design decision that matters:** `app.js` never touches storage. Every action goes through a function in `store.js` (`saveMove`, `submitEntry`, `reviewEntry`...). That is why swapping localStorage for Supabase only meant rewriting `store.js` and adding `await` in the screens: the router and the views kept their shape. Every store function that talks to the database is async, so every call site in `app.js` awaits it.

The rules themselves - you can only edit your own moves, private accounts are invisible, pending Bible suggestions are only visible to their submitter and admins - now live in Postgres row-level security policies in the Supabase project rather than in this repo.

### Data model

```
profiles            id, username, is_private, is_admin, poling_since, avatar
moves               id, user_id, name, status, difficulty, entries[], exits[], combos[],
                    notes, dictionary_entry_id (optional), achieved_at, updated_at
categories          id, user_id, name, is_default           (your collections)
move_categories     move_id, category_id                    (a move can be in several)
dictionary_entries  id, name, status (approved | pending), submitted_by
follows             follower_id, followee_id                (one row per follow)
media               id, owner_id, move_id | dictionary_entry_id, storage_path, kind,
                    mime_type, size_bytes, caption, created_at
```

**Why the SQL still says `dictionary` while the app says Bible.** The trick list is called the *Bible*
everywhere a dancer sees it, and the screens, the `#/Bible` route and all the copy use that word. The
database keeps its original table and column names, because renaming a table that already holds data
means a migration for no visible gain - and a find-and-replace over the code is exactly what breaks
these screens, since the app then asks for a table that does not exist (`Could not find the table
'public.Bible_entries'`). `#/dictionary` routes were kept as aliases so old links still land. If you do
want the tables renamed, rename them in Postgres first (`alter table ... rename to ...`), then update
every reference in one commit.

`status` on a move is `goal | progress | achieved`, and `achieved_at` records when it got there. Both are still columns and still part of the JSON export, but the app no longer shows or sets them: **Current goals** is how a dancer says what they are working on. `is_default` marks the one collection the home screen uses.

### What the Supabase project has to provide

The SQL lives in your Supabase project, not in this repo. A few things have to be true, and each
one fails in a way that looks like an app bug:

1. **A `profiles` row per user.** A trigger on `auth.users` insert creates it, copying
   `raw_user_meta_data ->> 'username'` into `profiles.username`. Without it, logging in succeeds
   and then drops you back at the login screen - the app now names this case explicitly.
2. **Table privileges for the `authenticated` role.** Privileges and row-level security are
   different layers: a missing policy returns no rows, while a missing privilege throws
   `permission denied for table ...`. If you hit that, run:

   ```sql
   grant usage on schema public to authenticated;
   grant select, insert, update, delete on all tables in schema public to authenticated;
   ```

3. **Policies for the rules** (you can only edit your own moves, private accounts are invisible,
   pending suggestions only visible to their submitter and admins). Those live in `pg_policies`.
4. **Optional: the signup availability check.** Running `supabase/signup-availability.sql` installs
   a function the registration form calls so it can report a taken email or username *before*
   attempting a signup. Without it the form still catches both, one round trip later.
5. **Photos and videos: `supabase/media.sql`.** Creates a private `media` bucket, the `media` table
   and the policies behind them: you always see your own uploads, and you see someone else's when
   their account is public - the same rule their moves follow. Files are addressed by a signed URL
   that lasts an hour, never a public one. Uploads are capped at 50 MB in the bucket and again in
   `store.js`; change both if a video needs more room. Until this is run, the move and trick
   screens say so on the page instead of failing silently.
6. **Account deletion: `supabase/delete-account.sql`.** Installs `delete_my_account()`, because a
   browser can never remove a row from `auth.users`. It deletes that dancer's moves, collections,
   uploads and still-pending suggestions, and keeps approved tricks they suggested (clearing
   `submitted_by`) since other dancers have linked moves to them.
7. **Current goals: `supabase/current-goals.sql`.** Adds `categories.is_default`, gives the
   profiles that already exist a `Current goals` collection, and gives every profile created from
   now on one automatically. Until it is run the home screen still works - it creates the
   collection the first time you open it - but then it is an ordinary collection matched by name,
   so it can be renamed or deleted like any other.
8. **Avatars, Poler since and following: `supabase/social.sql`.** Adds `profiles.poling_since`,
   `profiles.avatar` and the `follows` table, and the policies that let a dancer follow, unfollow
   and remove a follower. Until it is run the app still works, with the social parts switched off
   rather than broken: everyone gets a coloured letter avatar, the profile screen says there is
   nothing to save into yet, and the Community page says what to run instead of showing Follow
   buttons. It is safe to run again, so re-run it to pick up the remove-a-follower policy if you
   ran an earlier copy: without it the Remove button refuses with a message rather than pretending
   to work.

Two queries that answer most questions when a screen comes up empty:

```sql
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'profiles';
select policyname, cmd, roles from pg_policies where schemaname = 'public';
```

`dictEntryId` is optional on purpose: a dancer can log a move before it exists in the Bible and link it later. Entries and exits are plain text lists for now; making them links between moves (a graph) is the natural next step and would enable combo suggestions.

## Honest limitations (good to say in your writeup)

- **The Supabase project is the security boundary.** `js/supabase.js` holds the project URL and the publishable key, which is meant to be public - so the row-level security policies in Supabase are what actually protect your data. This repo can be public because of them; loosen a policy and the data follows.
- **Privacy rules are enforced in Postgres**, and `store.js` no longer repeats them. A missing policy shows up as an empty screen rather than an error, so check the Supabase logs when something looks absent.
- **Offline mode is partial.** The app shell and the Supabase client are cached so the app opens without a network, but reading or writing moves still needs to reach Supabase.
- **Following is one-directional and unlocks nothing.** Following a private account does not let you see their moves - the policies on `moves` still decide that. A follow only fills the "People I follow" filter on the Community page.
- **Friends are worked out, not stored.** A friendship is two `follows` rows pointing at each other, so the Friends list on a profile is the intersection of the two lists and Following is the rest of what that account follows. Nothing to keep in step, and no friendship table to fall out of agreement with `follows`. Removing a follower deletes the row they made, so they can follow again; it does not block them.
- **The Community feed is the newest 24 moves and 12 uploads**, with no paging and no ranking. Two queries, both filtered by row level security, which is why a private account can never appear in it.
- **Avatars are a name and a file, not a file name.** `AVATAR_FILES` in `store.js` maps an id (what `profiles.avatar` stores) to a file in `icons/avatars/`, and its order is the order of the picker. The file's real extension decides how it is drawn: an `.svg` gets a light disc behind it as line art, anything else fills the circle like a photo. To add one, drop the file in and add a line - `'my-avatar': 'my-photo.jpg'` - then add the file to `SHELL` in `sw.js` and bump `CACHE`. The file must actually be the format its extension claims: a JPEG saved as `.svg` is served as `image/svg+xml`, fails to parse, and renders as nothing. An id that is no longer in the map is not an error: `avatarSrc` returns null and that dancer falls back to their initial.
- **Duplicate suggestions** are blocked only by exact name match. Merging near-duplicates ("Fireman spin" vs "Fireman Spinn") is an admin task not yet supported.

## Suggested next steps

1. ~~**Backend:** Supabase gives you auth, Postgres and row-level security.~~ **Done:** accounts are Supabase Auth, data is Postgres, and the rules are RLS policies.
2. **Aliases:** add an `aliases` table (name, entry_id) so one entry collects several names. This is the heart of your standardization idea.
3. **Move graph:** replace entries/exits text with links to other moves.
4. **Friends and activity feed**, then the instructor view as a permission on top of friends.
5. **Native stores:** wrap the PWA with Capacitor if you ever need App Store / Play Store listings.