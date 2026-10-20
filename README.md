# MyPoleMagazine
cross platform (web, ios, android) application for logging pole dance moves achieved and progress. This will help standardize trick naming across the community and allow individuals practicing to create collections, add notes to a particular move, remember exits, entries, and other important features about certain tricks in one place.

## User experience & percieved benefit
How do you currently track your moves? Is it working for you?
What could be better about that process?
What non-physical struggles do you have with learning new moves, combos, and routines?

Personally, I do not think ai provides value here. I think this is a section of software engineering that should be extremely simple and straightforward. I think ai could make up a lot of content here that could sound somewhat plausible, but at the end of the day, the ai is not providing a real or valuable experience.

- As a pole dancer, I want to group certain pole moves together so I can categorize by personal difficulty, achieved, in progress, and future goals.
- As a pole dancer, I want to have the ability to create a detail page for each move I learn so I can document entries, exits, and good combo moves for each trick.
- As a pole dancer, I want to be able to browse other members collections of moves and share mine (contribution to standarized naming)
- As a pole dancer, I want to be able to friend other pole members, see when they unlock a new move and congratulate them on that progress
- As a pole instructor, I want to see what students are working on, what they have achieved and what their goals are

Application must provide the ability for users to register/login, create entries for each move, add entry, exits and other notes, and group moves by personalized category. There will be a "pole dictionary" of entries, and users can link moves to the corresponding pole dictionary entry or create a new trick. These will be added to the pole dictionary upon review by admin. Pole dictionary entries will acculmate differing names for a singular move, as this is a common issue in the community. Users will be able to view each others collections and entries, unless the account is set to private.




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

**On your phone:** run the server, find your computer's local IP, open `http://<that-ip>:8000` on the same wifi, then use "Add to Home Screen". Note that installing and offline mode need HTTPS, which `localhost` counts as but a LAN IP does not. For a real install on your phone, deploy the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages), which gives you HTTPS for free. The full pre-publish pass on a real device - the tunnel, the install, and the things only a phone shows you, like the notch, the keyboard and the Photos picker - is in [docs/iphone-testing.md](docs/iphone-testing.md).

**Accounts.** Register on the landing screen with an email, a password and a username. You log
in with the email; the username is the public handle other members see. Confirming your email
address is on in the Supabase project, so click the link before your first login.


**Forgot a password?** The login screen links to a screen that emails a Supabase recovery link,
and the link comes back to the app to set a new one. No SQL is involved - the only setup is in the
dashboard: under **Authentication → URL Configuration**, set **Site URL** to the app's origin and
add that same origin to **Redirect URLs**, or Supabase refuses to send a dancer back and the reset
screen reports the link as expired. A stale or already-used link says so and offers to send a
fresh one rather than failing silently.

**Something wrong, or locked out?** `#/support` - linked from the login screen and from the row under
**Profile → Support** - is a contact form that needs no account, which is the point: a dancer who
cannot get in is the one most likely to need it. Sending writes the message down in the app first
(`supabase/support.sql`, item 16 below) and emails it second through the `support` Edge Function,
**User Support** `#/support` - linked from the login screen and from the row under
**Profile → Support** - is a contact form that needs no account. Sending writes the message down in the app first
(`supabase/support.sql`, item 15 below) and emails it second through the `support` Edge Function,
so a mail failure leaves a message an admin can still read rather than nothing at all. The form
itself holds no address and no key. Where the mail lands is decided in that function: `SUPPORT_TO`,
which defaults to `mayato223@gmail.com`, sent from `SUPPORT_FROM`, which defaults to Resend's test
sender `onboarding@resend.dev`. Both are secrets on the function, not values in this repo.

## Checks and tests

Two things can be checked without a browser, and both are one command:

```
npm run check      # the palette check, then the test suite
```

40 tests in `tests/`, on Node's own runner, with nothing to install. They cover what nothing else
notices, because nothing at runtime compares them: that `CACHE` in `sw.js` was bumped when a cached
file changed - the rule at the top of that file, now enforced rather than remembered - that every
avatar in `AVATAR_FILES` is in `SHELL`, that every hash the app links to is one the router renders,
that every table in `supabase/` has row level security and no policy answers `true` to a write, and
that no secret value is committed. `docs/production-readiness.md` walks a standard pre-launch
checklist against this repo: what is tested, what is missing, and what is a decision rather than a
bug.

After bumping `CACHE`, record the new state so the next run compares against it:

```
npm run stamp
```

Rendering is deliberately not covered here - `docs/iphone-testing.md` is the pass you run on a real
phone.

## Your user stories and where they live

| Story | Where |
|---|---|
| Track what you are working on | **Home** is your **Current goals** collection, created with your profile; add any of your moves to it - each one arrives as a card - and take one off with **Remove**. **Collections** for your own groupings (a move can be in several). The add panel names its two ways in down the side of the box - one of your moves, or a trick from the dictionary - and shows the one you pick, so the box is only ever as tall as the way in you are using; the **My Moves** side carries a **+ New move** for the move the app has not got yet, which opens the move form with this list already ticked. It closes on the cross in its corner rather than a Close button |
| Say where a move has got to | Every card in the **Current goals** window, and the top of a move's own page - there it sits beside the name, under the label **Current goal** (everywhere else the pill is under the move's name and needs no label): **Not started**, **In progress** or **Achieved**, as a dropdown painted in the colour of the answer it holds. It writes the moment it changes, so there is no Save button to forget. A move nobody has said anything about reads **Not started** rather than nothing, which is the honest name for a move you have logged and not started working on. The status is *read* in the Current goals window only, so the Moves page stays a list of what you know rather than a board of what you are doing |
| Detail page per move with entries, exits, combos | **Moves → a move**; entries, exits, combos and notes each read as what they hold until the pencil beside the label is tapped, and then it is chips you type and press Enter on. A chip whose text is a dictionary trick's name links to that trick |
| Track what you are working on | **Home** is your **Current goals** collection, created with your profile; add any of your moves to it - each one arrives as a card - and take one off with **Remove**. **Collections** for your own groupings (a move can be in several). The add panel names its three sources down the side of the box - one of your moves, a trick from the dictionary, a move that is not in the dictionary yet - and shows the one you pick, so the box is only ever as tall as the way in you are using; it closes on the cross in its corner rather than a Close button |
| Detail page per move with entries, exits, combos | **Moves → a move**; add or edit with chips (type, press Enter), and a chip whose text is a dictionary trick's name links to that trick |
| Photos and videos on a move | While logging it: "+ Add photo or video" in the move form, which uploads what you picked as soon as the move is saved, and lists the clips already on it when you edit |
| Browse and share collections (standardized naming) | **Community → Members** → a dancer → their moves and collections; "Save to my goals" copies the name into your list and into your current goals |
| Community Updates | **Community → Activity**, whose panel is **New moves & uploads**: the newest public moves and photos/videos. A move post is the same preview card the Moves page and the dictionary use - the name with its dashes, and who posted it when underneath - with the poster's avatar beside it; an upload keeps its picture. The view is one segmented control at the top of the page and the audience is a smaller switch beside that panel's heading - Everyone, or only the members you follow - so the two questions are answered in two different places |
| Follow other members | **Community → Members**, or the button on a dancer's page; **Account** shows nothing to manage - a follow is yours to give and take back |
| Show how long you have been Poler | **Account → Edit profile → Poler since** (a year), shown on your profile next to your avatar |
| Pick or upload an avatar | **Account → the camera on your photo → Upload a photo**, or choose one of the five pleaser photos or your initial on one of the two brand colours - hot pink or black, picked stably from your name. A letter avatar wears the same pink rim as the heel photos. Uploads are your own public bucket file, and replacing one removes the file it replaced (`supabase/custom-avatars.sql`). The picker is behind Edit profile because a row of circles is not worth scrolling past on every visit |
| Keep a private journal, with photos or videos | The floating notepad opens a drawer for today's entry; **+ Add photo or video** stages files beside the note, and they upload when the entry is saved. Entries are private to you, files live in their own bucket, and deleting an entry removes its files (`supabase/journal.sql`). The notepad itself can be dragged anywhere on screen |
| Register / login | Landing screen |
| Pole dictionary | **dictionary** to search and suggest; the move form auto-links on a name match; **Review** (admin only, once `supabase/admins.sql` has made someone an admin) approves or rejects. One queue lives there now - new tricks waiting to be published - and the count in the navigation is that queue's length |
| AKAs | **dictionary → a trick → Also known as**: write down what members actually call it - a nickname, the word one studio uses, the description that never had a name - and the dictionary finds the trick by it. Any signed-in dancer may add one; whoever added it, or an admin, can take it off. Nothing is renamed and nothing is queued: the trick keeps the one name every move links to, and the other names sit under it where a search can reach them |
| search by AKAs| The **dictionary**'s search box matches a trick's own name and every nickname filed under it, and the card that matched on one says which - "also called ...". The add-a-goal panel searches the dictionary the same way, so a dancer who types the name their studio uses gets the trick, not an empty list |
| Private accounts | **Account → Private account** |
| Community difficulty | **dictionary → a trick**: mark it beginner, intermediate or advanced and see what share of members chose each; the **dictionary** page filters and sorts by level. The bars only appear once somebody has answered - until then there is nothing to show, so they are not drawn, and the panel says in words that nobody has marked it yet |
| Add a trick from the dictionary to your own moves | Every card in the **dictionary** carries **+ Add to My Moves** at the right of the trick's name, which opens the move form with the trick already linked to it - and reads **In your moves** once you have logged it, linking to your move. The button is on the card rather than appearing when you hover: the list is cards now, and a control that hides itself until a pointer arrives is one half the members never find |
| Suggest a trick, and say how hard it is | **dictionary → Add a trick** opens a dialogue: the name is the only required answer, with an optional level and optional photos that attach to the trick itself. The level starts on **Unrated**, which is the honest answer for a trick nobody has an opinion about yet - one dancer picking a level is the first vote, not the verdict |
| Read a trick at a glance | **dictionary → a trick** is a short article rather than a pile of cards: what the trick is and who logs it, then the facts worth having before you read anything else, then the community's difficulty, the names it goes by, how members get into and out of it, and the clips last |
| Rate your own moves 1-5 | **Add or edit a move**: Beginner, Beginner+, Intermediate, Intermediate+, Advanced. It is your own rating, one per move, and it shows as five pink dashes at the far end of the name on every card that previews a move - the Moves page, the Current goals window and the Community feed - and on the move's own page the same five dashes sit beside the name, where they are the thing you change. The dashes are the whole reading; the written level (*Intermediate*, say) is the tooltip when you hover them, and the accessible name a screen reader reads, so the level is there when it is asked for and never competes with the name it belongs to |
| Light or dark mode | **Account → Settings → Appearance**: System follows this device's own setting, Light and Dark override it, and the choice is remembered on that device only |
| Delete Account | **Account → Settings** (`#/settings`): download your moves as JSON, or delete the account behind a type-your-username confirmation. The three groups on that screen are one shape each, so nothing there is louder than anything else until you read it |
| Ask for help, signed in or not | **Profile → Support** (`#/support`), also linked from the login screen: writes to the owner's inbox and needs no account. The message is written down in the app before any email is attempted, so a mail outage cannot lose it. It sits on the profile rather than in Settings, and logging out sits apart from both, past a rule |
| Read what people send you (admin) | **Account → Support inbox** (`#/support/inbox`): every message the contact form has taken, newest first, each saying whether the email actually went, with a **Mark handled** toggle for the ones dealt with |
| Studio pages and studio members| **Community → Members** → pick a studio → **Studio page**, or follow the studio's name on any profile: the members who have added it, counted in the heading, each with a follow button, and the Instagram accounts its members have added. Anyone signed in can add one; whoever added it, or an admin, can take it off |
| Connect your Instagram to your profile | **Account → the pencil → Instagram**: optional, and just the @ name - your profile then links to instagram.com/yours. A studio's accounts live on the studio's page rather than on a profile, because a studio usually has more than one (`supabase/instagram.sql`) |

## Organization

```
index.html              page shell
css/style.css           all styling: one black / white / hot pink token set, four theme blocks
js/supabase.js          the Supabase client (project URL + publishable key)
js/store.js             the data layer: all reads/writes, async calls to Supabase
js/app.js               router + one function per screen
sw.js                   service worker (offline app shell)
manifest.webmanifest    makes it installable
icons/                  app icons
icons/avatars/          the built-in avatar photos
supabase/               SQL run for project database, not used by application
supabase/functions/     Edge Functions - the support form's mail sender, and the reason
                        the email provider's key is never in a file the browser can read
tools/check-palette.mjs checks the stylesheet; see "Checking the palette" below
```

**Light, dark, or the device's own choice.** There is no second stylesheet. The whole palette is six colours in `css/style.css` - black, white, hot pink and three greys - and a theme is a second set of values for the same token names. Which set applies is decided by `html[data-theme="light"|"dark"]`, which **Account → Settings → Appearance** writes and remembers in `localStorage`; when no choice has been made the attribute is absent and a `prefers-color-scheme` media query decides, which is what makes "System" mean the same thing as having never chosen. A small inline script in `index.html` applies the saved value before the first paint, so a dancer who chose dark never sees a white flash. The one cost of doing it this way is that the light values appear twice in the file and the dark values twice more, because a media query cannot be reused for an attribute selector -the file says so where it matters, and the two copies of each set have to be changed together.

**Two hot pinks, and the rule that keeps them apart.** `--accent` is the pink you *see*; `--accent-strong` is the pink you *read*. They are not interchangeable. `--accent` (#ff2d85 on light) is a fill - a button, the active tab in the bar, a meter bar, a selected row's border on a neutral card - and a dark label or a neutral background sits on it. `--accent-strong` (#a8004a on light) is ink, for anything legible against a light background: links, the eyebrow labels, the count pill. The same pink cannot do both jobs: `--accent` as text on white is only ~3.5:1, and `--accent-strong` as a button fill would hide its own label. There is a third case that is easy to miss - a shape drawn on a *pink* fill rather than a neutral one. There the edge has to be `--accent-strong` too, because `--accent` on `--accent-soft` is 2.99:1 and the edge stops reading as an edge; the rule is therefore decided by the background, not by the element. Ten rules do this - among them the open follow bar, a ticked checkbox row, the pressed icon button and the chosen source in the add-a-goal rail - and `tools/check-palette.mjs` fails the build if one of them draws an `--accent` edge on that fill.

**Checking the palette.** Two mistakes are possible in that duplicated token set and neither is visible in a browser: a colour changed in three of the four blocks, and a text pair that has slipped below WCAG AA. `node tools/check-palette.mjs` covers both - it asserts the light copies match each other and the dark copies match each other, that light and dark declare the same colour names, that every text pair the app renders clears 4.5:1 in each theme, that a shape on a neutral surface clears 3:1, and that nothing draws the low-contrast `--accent` on an `--accent-soft` fill. It reads the real `css/style.css`, prints the measured ratio for every pair, and exits non-zero on the first problem, so it is safe to run before a commit. The syntax of the scripts is a separate check: `node --check js/app.js`, `node --check js/store.js`, `node --check sw.js`.

**Two difficulty scales, deliberately not the same thing.** A move's own `difficulty` is one dancer's rating of one dancer's move: a number 1-5, shown as *Beginner, Beginner+, Intermediate, Intermediate+, Advanced*, owned by whoever logged it and changeable whenever it feels different. A trick's community level is the `entry_levels` table in the dictionary, where every member's answer counts and `levels.sql` keeps the individual answers private while publishing only the totals. The screens never mix them: five pink dashes on your own move, with the written level on them as a tooltip, and the community's answer on a shared trick as a level in the facts strip with three bars under it - and no bars at all until somebody has answered, with the fact strip and the panel both reading *Unrated* until then.

**Shown before offered.** A move you own is a card of what you know about it, so it reads as one: entries, exits and combos are plain pills, notes is the paragraph the move's own page draws, and a field with nothing in it says *None yet* rather than sitting there as an empty box. Each of the four carries a pencil beside its label, and one tap turns that one field into the one you write in - the × on every pill, the box to type in - which is also how the card stops being nine inputs at once. The chip fields are drawn once and the pencil only hides their × buttons and their box, never clears them, so a half-typed entry survives the pencil being closed and is committed when it is: what you finally Save is what the field holds, whether you last touched it open or shut. The **+** that adds a collection follows the same rule as the collections themselves: it sits in the row of the ones the move is already in, at the end of it, rather than on a line of its own underneath, and the box to name a new one opens in that row.

**Three facts on the first line.** A move's own page used to introduce the move and then ask about it further down: the name at the top, where it had got to underneath, and how hard it is buried among the fields. All three are things you would say about the move in one breath, so they now sit together in the page head - the name, the status dropdown, and the five difficulty dashes with the written level beside them. The status carries the label **Current goal**, because a pink pill on its own reads as a state of the page rather than of this move, and the dashes carry **Difficulty**, because five dashes on their own read as decoration. Both labels go quiet (they are not the thing you are reading) and both controls wrap: on a phone the pair drops under the name and the written level drops under its dashes, so nothing is squeezed to fit a line it cannot hold. The dashes are the same control they were in the form - tapped, they write the answer the form saves - and the hidden input that carries it stays inside the form, since that is what `saveMove` reads.

**Writing a move down from the list it belongs to.** The add panel once had a third way in - *New Move*, which filled in a whole move form inside the panel - and it was removed, because the page for writing a move down already exists and a panel for picking something to add to a list is the wrong place to grow a second, smaller one. What was missing was the way *to* that page: a dancer in **Current goals**, with nothing logged yet, was told to go and find the + on My Moves. So the **My Moves** side of the panel now carries **+ New move**, which opens the move form with the list you opened the panel from already ticked, so a move written down from here lands in it. It is a link rather than a button because it navigates - and the sheet closes itself on the hash change, the same way it does for every other row that goes somewhere. The dictionary side has no such +: writing a move down is not what that side is for.

**One preview shape, four lists.** A trick or a move is previewed by one piece of `app.js` - `trickPreview`, styled as `.trick-card` and friends in the stylesheet - and every list that shows one draws it through that: the Moves page's cards, every card in the **Current goals** window, the **dictionary**'s list and the move posts in the Community feed. The shape is a name, the dashes at the far end of that line, one line of detail underneath and the action on the right; what changes from screen to screen is only which of those slots are filled - a drag grip, a status dropdown and a Remove button under the name in the goals window, a *Pending* mark in the dictionary, who posted it and when in the feed. The one action that belongs to the name it sits beside, *+ Add to My Moves*, rides on the name's own line at the right-hand edge of the card (`actionsInHead`), because it is a thing you do about that trick rather than a step in the card. A long name on a phone can use the whole line, and then the action wraps onto a line of its own - still against the right edge (`.trick-tail` carries `margin-left: auto`), so it is never left starting back at the left under the name as though it were a second thing rather than the end of the first. Every one of these cards takes the pink border on hover, the way the Moves page's and the collections' cards always have: in the stylesheet it is `.card:has(.trick-card):hover`, so it follows the preview rather than the container, and the anchor that a Moves card happens to be is no longer what earns the edge. The same relationship decides where a click goes: the name's link is stretched over the card by a pseudo-element, so the whole card opens the move or the trick. It is not done by wrapping the card in an anchor, because these cards hold a status dropdown, a Remove button and a drag grip, and a browser treats the first click on any of those inside an anchor as a navigation. The link does the work - still focusable, still the href a status bar shows - the controls are given a stacking order to sit above the overlay, and the difficulty tooltip moved to card hover, since the overlay is what the pointer now meets where the dashes are. Three things follow from doing it once. The dictionary's list is cards rather than table-like rows; its cards carry no level at all, since your own 1-5 difficulty is a rating of your own move and a trick's community level is everybody's answer, which belongs in that trick's facts strip rather than beside its name in a list whose job is to find names; and they no longer carry a row of the members who log the trick, for the same reason - who logs a shared trick is a fact about the trick, and it is on the trick's page under its name.

### Data model

```
profiles            id, username, is_private, is_admin, poling_since, avatar, city,
                    home_studio_id, instagram
studios             id, name, city, created_by
profile_studios     user_id, studio_id, position, added_at  (where a dancer trains, in their order)
moves               id, user_id, name, status, difficulty, entries[], exits[], combos[],
                    notes, dictionary_entry_id (optional), achieved_at, updated_at
categories          id, user_id, name, is_default           (your collections)
move_categories     move_id, category_id, position          (a move can be in several, in its own
                    place in each)
categories          id, user_id, name, is_default
move_categories     move_id, category_id
dictionary_entries  id, name, status (approved | pending), submitted_by
entry_aliases       id, dictionary_entry_id, alias, added_by, created_at
entry_edits         id, dictionary_entry_id, submitted_by, proposed_name, note,
                    status (pending | approved | rejected), reviewed_at, reviewed_by
                    (retired: nothing reads or writes it any more, and nobody can file one)
entry_levels        dictionary_entry_id, user_id, level (beginner | intermediate | advanced)
follows             follower_id, followee_id                (one row per follow)
media               id, owner_id, move_id | dictionary_entry_id, storage_path, kind,
                    mime_type, size_bytes, caption, created_at
studio_instagrams   id, studio_id, handle, added_by    (retired: its oldest handle was copied into
                    studios.instagram; nothing reads it any more)
journal_entries     id, user_id, entry_date, body, created_at  (private to its author)
journal_media       id, journal_entry_id, owner_id, storage_path, kind, mime_type, size_bytes,
                    created_at   (photos and videos attached to one journal entry)
support_messages    id, name, email, subject, message, username, emailed, email_error,
                    handled, created_at
```

**Two tables that arrived later, and both of them optional.** `entry_aliases` is where the other names a trick goes by live: one row per nickname, readable and addable by any signed-in dancer, and removable by whoever added it or an admin. That is what lets the dictionary's search box answer to the name a dancer's own studio uses - the row that matched says "also called ..." rather than appearing out of nowhere. `profile_studios` is where a dancer trains, one row per studio with the position they put it in, because plenty of dancers train in more than one place and a single column makes them pick a favourite and throw the rest away. Neither is needed to use the app: without `aliases.sql` a trick simply has one name, and without `home-studios.sql` a profile shows the one studio the older `home_studio_id` column holds.

###SupaBase
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
   screens say so on the page instead of failing silently, and the add-move form - which takes the
   photos and videos a move is logged with - leaves its upload field out and says the same thing,
   so the move still saves without them.
6. **Account deletion: `supabase/delete-account.sql`.** Installs `delete_my_account()`, because a
   browser can never remove a row from `auth.users`. It deletes that dancer's moves, collections,
   uploads and their studios, and keeps approved tricks they suggested (clearing `submitted_by`)
   since other members have linked moves to them. Nicknames they filed stay with their tricks too,
   with the author cleared - `entry_aliases.added_by` is `on delete set null` - because by then a
   nickname is a fact about the trick rather than about the member who typed it.
7. **Current goals: `supabase/current-goals.sql`.** Adds `categories.is_default`, gives the
   profiles that already exist a `Current goals` collection, and gives every profile created from
   now on one automatically. Until it is run the home screen still works - it creates the
   collection the first time you open it - but then it is an ordinary collection matched by name,
   so it can be renamed or deleted like any other.
8. **Avatars, Poler since and following: `supabase/social.sql`.** Adds `profiles.poling_since`,
   `profiles.avatar` and the `follows` table, and the policies that let a dancer follow, unfollow
   and remove a follower. Until it is run the app still works, with the social parts switched off
   rather than broken: everyone gets a letter avatar on one of the two brand colours, the profile screen says there is
   nothing to save into yet, and the Community page says what to run instead of showing Follow
   buttons. It is safe to run again, so re-run it to pick up the remove-a-follower policy if you
   ran an earlier copy: without it the Remove button refuses with a message rather than pretending
   to work.

9. **Admin membership: `supabase/admins.sql`.** Moves who-is-an-admin into its own table and
   narrows the browser's `update` on `profiles` to the four columns the app writes, so a dancer can
   no longer set `is_admin` on themselves; `grant_admin` / `revoke_admin` then promote or demote by
   username. Until it is run the app works the way it always has: someone is an admin only while
   `profiles.is_admin` says so, review only appears for them, and - the reason for the file - any
   signed-in dancer can set that column on themselves. The first admin is promoted by hand in the
   SQL editor, and that one file says how; an account already flagged in `profiles` is carried over
   by it automatically. `profiles.is_admin` stays and follows the new table, so the screens and any policy reading
   it keep working - one way only: editing that column by hand no longer makes anyone an admin. The
   file also replaces the project's own `is_admin()` function rather than adding a second one, which
   is what lets policies that already call it switch over untouched.

10. **Community difficulty: `supabase/levels.sql`.** Adds the `entry_levels` table - one row per
    dancer per trick, `beginner` / `intermediate` / `advanced` - and the `entry_level_totals()`
    function that hands the app each trick's counts plus whether one of them is the caller's.
    Row-level security keeps the two apart: a dancer writes and reads only their own answer,
    while the totals - which count answers and never name anyone - are readable by any signed-in
    dancer. Until this is run the app still works: the dictionary and the trick pages say to run the
    file instead of drawing the level controls, and nothing else changes.

11. **Support email: the `support` Edge Function.** `supabase/functions/support/index.ts` is
    what the contact form posts to. Resend's API key is a secret, and anything the browser
    holds a visitor can read, so the page never sees the key or even the destination address -
    it posts here, and this posts to Resend. Deploy it once, either way:

    ```
    supabase functions deploy support --no-verify-jwt
    supabase secrets set RESEND_API_KEY=re_your_key_here
    ```

    or by hand in the dashboard: **Edge Functions → Deploy a new function**, paste the file,
    then **Edge Functions → Secrets → add `RESEND_API_KEY`**, leaving "Enforce JWT
    verification" **off**. The JWT check is off on purpose - this is the one endpoint a dancer
    has to reach while signed out, because somebody locked out of their account is exactly who
    needs to write in - so it pays for that with a honeypot field and hard length caps instead
    of a session. It cannot read the database at all, and the one thing it writes is the message
itself, in a table the browser may not insert into (`supabase/support.sql`, item 16), using the
service role key that Edge Functions are given. The message
    goes to `mayato223@gmail.com` unless you set `SUPPORT_TO`, and comes from `onboarding@
    resend.dev` until you verify a domain in Resend and set `SUPPORT_FROM`. Until the function
    is deployed the form still renders and says what is missing, the way the SQL files do; until
    `supabase/support.sql` has been run but the function has, the form still sends and still
    emails - it simply has nowhere to write the copy down, and the inbox says so.


12. **Studios and cities: `supabase/studios.sql`.** A `studios` table the app itself can add to,
    plus optional `city` and `home_studio_id` columns on `profiles`. The point is the one thing
    a profile could not answer before: two members who train at the same place had no way to see
    each other. A studio is a row rather than a text box, because "Studio 54" typed forty times
    is forty studios and none of them can answer "who else goes here". Any signed-in dancer can
    read the directory and add to it - the list has to be able to grow from the app - while only
    the dancer who added a studio can correct it, and nothing can be deleted from the app: a
    studio others have chosen as their home would leave their profile pointing at nothing.
    Nothing is required to use the app: leave the studio unchosen and your profile looks exactly as
    it did before. Until this is run, the Community page has no studio picker and the profile
    editor says what to run instead.

    `profiles.city` is still a column and still comes out in the JSON export, but the profile no
    longer edits it: a studio carries its own town, and a profile carrying a second copy of the same
    fact is a second thing that can be wrong or out of date. A profile names the studio and nothing
    else - "Studio 54", not "Studio 54 — Leeds" - because the dash is a directory label: it is how
    `store.studioLabel` tells two studios with the same name apart in a dropdown, and read as prose
    in a sentence it is just punctuation in the middle of it. The town has not gone anywhere: it is
    the link's title, and the studio's own page leads with it.

    It also re-grants the browser's `update` on `profiles` with the two new columns on the list.
    That part matters: `supabase/admins.sql` narrows that grant to named columns so nobody can
    make themselves an admin, and a column missing from the list cannot be saved from the app at
    all - the failure reads as a broken form, not as a missing grant. The list is named in three
    files now - `admins.sql`, this one, and `supabase/instagram.sql` - so if you add another
    writable column to `profiles`, add it to all of them.

    **Where you train is a list now: `supabase/home-studios.sql`.** It adds `profile_studios` - one
    row per studio a dancer has listed, each with the position they put it in - and copies the single
    studio anybody already chose (`profiles.home_studio_id`) into the first row of their list, so
    nothing anybody picked is lost. A profile shows that first studio and folds the rest behind a
    "+N" beside it; the profile editor lists them all with arrows to change the order and writes the
    whole list in one save, so what is on screen is what is stored. The Community filter matches any
    of them, and a studio's own page lists the members who have added it. The old column is not
    dropped and not renamed: once `profile_studios` exists the app neither reads nor writes it, and
    until this file has been run that column is what the same screens fall back to - which is why the
    file's own last query lists anybody whose column has fallen behind their list.

13. **Nicknames for tricks: `supabase/aliases.sql`.** Adds the `entry_aliases` table - one row per
    nickname per trick, unique per trick ignoring case and stray spaces, so "Pole sit" and "pole sit "
    are one name. Any signed-in dancer may read every alias and add one to a trick they can see,
    because the names dancers actually use are the ones only they know; the member who added one, or
    an admin, may take it off, so a typo does not need an admin. Nothing here can rename a trick: the
    name every move links to is the one `dictionary_entries.name` holds, which is exactly why this is
    safe to let everybody do freely. A nickname may only be attached to a trick its author is allowed
    to see, and it cannot be parked on somebody else's unreviewed suggestion - the same subquery
    `levels.sql` uses for a vote. There is no edit, only add and remove: correcting a nickname means
    taking it off and writing the right one, which keeps the author's name honest. The whole table is read at start-up, so the dictionary's search box
    matches a trick by any of its names without a query per keystroke. Until this file is run the app
    is unchanged: tricks simply have one name, and the trick page says what to run instead of offering
    the form.

    **This replaces the suggest-a-rename flow, and `supabase/entry-edits.sql` with it.** That file is
    still on disk and nothing reads or writes it any more: the `entry_edits` table it made and any
    rows in it stay exactly as they are - dropping data is not a "safe to run again" thing to do -
    and it can be dropped by hand if you would rather. Nobody can file a rename proposal now, which is
    why the admin Review queue is one list rather than two, and why a member who calls a trick
    something else writes that down where a search finds it instead of arguing it into a new name.

14. **Instagram: `supabase/instagram.sql`, then `supabase/studio-instagram.sql`.** The first gives
    a dancer one optional `instagram` handle on their profile - a column, because a dancer has one
    account - and re-grants the browser's `update` on `profiles` with `instagram` on the list. The
    second gives a studio one optional `instagram` handle on its own row, which is what the studio
    page now shows as an account or a **+**. Only the handle is stored, never a URL: `readInstagram`
    in `store.js` reduces whatever somebody pastes - `@name`, `instagram.com/name`, a trailing
    slash, a query string - to the one form Instagram itself treats as the account name, and the app
    builds `instagram.com/...` from that. Any signed-in member may set or clear the studio's one
    handle; the write goes through `set_studio_instagram()`, a security-definer function that can
    change that column and nothing else, so a member cannot rename the studio or move it to another
    town. The older `studio_instagrams` table is left in place for its history, and the oldest handle
    for each studio is copied into the column once. Until the second file is run the studio page
    says what to run instead of offering the control.

15. **The order of your goals: `supabase/goal-order.sql`.** Adds `move_categories.position` and the
    policy that lets a dancer renumber their own links, which is what a dragged card in Current goals
    writes. The place belongs to the link rather than to the move, because the same move can sit in
    Current goals and in a collection of your own, first in one and last in the other. Until it is
    run the app is exactly as it was: the home screen lists goals newest-edit first, the grip still
    appears so the list is not lying about what it can do, and letting one go says which file to run
    instead of silently forgetting the order. The backfill numbers every existing link in the order
    the list already reads in, so the first visit after running it looks the same as the one before.

16. **A stored copy of every support message: `supabase/support.sql`.** The `support_messages`
    table the Edge Function writes into *before* it tries to email, so the row is the record and
    the email is a notification about the record. The **Request edit** pencil on a studio or
    trick page uses the same road: its comment, the page address and the member who sent it arrive
    here as a message rather than in a queue of their own. Only an admin can read it - the policies call
    `public.is_admin()`, which comes from `supabase/admins.sql` - and no browser can insert into
    it at all: the one writer is the function, with the service role key. Spam never reaches the
    table either, because the honeypot is checked first. Every row says whether Resend accepted
    the message and, when it did not, what it said, so "written down but never emailed" is a
    state you can see in **Account → Support inbox** (`#/support/inbox`) rather than a message
    that quietly went nowhere. Until this file is run the form still sends and still emails, and
    the inbox says what is missing.

17. **Uploaded profile photos: `supabase/custom-avatars.sql`.** A public `avatars` bucket with a
    5 MB image limit, where a dancer may write only inside their own `<user-id>/` folder. The file
    path is stored in the existing `profiles.avatar` column as `user:<path>`; a preset key is still
    the same column's other form, so no profile grant changed. Only the owner may replace or delete
    a photo, and the app removes the object it replaced. Until this file is run the upload button
    says what to run, and the preset and letter avatars keep working.

18. **Journal photos and videos: `supabase/journal.sql`.** The private `journal_entries` table (if
    your project does not already have one), `journal_media` for the files attached to an entry,
    and the private `journal` bucket. Every policy is owner-only, including the storage folder
    rule, because a journal is not part of the public profile. Text entries keep working without
    the file - `listJournal` falls back to notes only when the media table is missing - and the
    UI says what to run when a file upload is attempted.

**To check the rules rather than trust them: `supabase/security-check.sql`.** Run it in the SQL
editor after any change to a policy or a grant. It impersonates three sessions - a dancer, an admin
and a visitor with no account - and tries the things you would not want done: publishing a trick
without review, approving or rejecting someone else's suggestion, reading their pending ones,
making yourself an admin, writing the `admins` table. Nothing it does changes the database: each
attempt runs inside a subtransaction that is rolled back on the next line, fixtures included. It
reports `ok`, `VULNERABLE` (fix this), `UNEXPECTED` (it refused something an admin needs), or
`not applicable` (that table or function does not exist yet), then lists the grants and policies
behind the verdicts.

Two queries that answer most questions when a screen comes up empty:

```sql
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'profiles';
select policyname, cmd, roles from pg_policies where schemaname = 'public';
```

`dictEntryId` is optional on purpose: a dancer can log a move before it exists in the dictionary and link it later. Entries and exits are still text a dancer types on their own move - but a name that is a dictionary trick is linked to it wherever it appears, and a trick's own page gathers what every member wrote for that trick, counted and commonest first, which is the one question a single move's list can never answer. A full move graph - every entry and exit a link the dancer picks, rather than a name matched against the trick list - is the natural next step and would enable combo suggestions.

## Honest limitations

- **The Supabase project is the security boundary.** `js/supabase.js` holds the project URL and the publishable key, which is meant to be public - so the row-level security policies in Supabase are what actually protect your data. This repo can be public because of them; loosen a policy and the data follows.
- **Privacy rules are enforced in Postgres**, and `store.js` no longer repeats them. A missing policy shows up as an empty screen rather than an error, so check the Supabase logs when something looks absent.
- **Offline mode is partial.** The app shell and the Supabase client are cached so the app opens without a network, but reading or writing moves still needs to reach Supabase. The cache is only the fallback: while there is a network the shell is fetched from it, bypassing the browser's own HTTP cache, so a release always arrives as one whole build on the next reload - the failure it prevents is a new `app.js` being served next to an old `store.js`, which crashes the moment one calls something the other has never exported.
- **The theme is a device preference, not an account setting.** It lives in `localStorage` and applies before the first paint, so it never flashes the wrong way round, but it does not follow a dancer to another browser or phone and it is not in the JSON export. "System" is the absence of a choice rather than a stored one, which is why it keeps following the device live.
- **Following is one-directional and unlocks nothing.** Following a private account does not let you see their moves - the policies on `moves` still decide that. A follow only fills the "People I follow" filter on the Community page.
- **Friends are worked out, not stored.** A friendship is two `follows` rows pointing at each other, so the Friends list on a profile is the intersection of the two lists and Following is the rest of what that account follows. Nothing to keep in step, and no friendship table to fall out of agreement with `follows`. Removing a follower deletes the row they made, so they can follow again; it does not block them.
- **The Community feed is the newest 24 moves and 12 uploads**, with no paging and no ranking. Two queries, both filtered by row level security, which is why a private account can never appear in it.
- **Avatars are a name and a file, not a file name.** `AVATAR_FILES` in `store.js` maps an id (what `profiles.avatar` stores for a preset) to a file in `icons/avatars/`, and its order is the order of the picker. An uploaded photo is the same column with a `user:` prefix followed by its public storage path, so `avatarSrc` returns a URL for it and a local path for a preset. The file's real extension decides how a preset is drawn: an `.svg` gets a light disc behind it as line art, anything else fills the circle like a photo. To add a preset, drop the file in and add a line - `'my-avatar': 'my-photo.jpg'` - then add the file to `SHELL` in `sw.js` and bump `CACHE`. The file must actually be the format its extension claims: a JPEG saved as `.svg` is served as `image/svg+xml`, fails to parse, and renders as nothing. An id that is no longer in the map is not an error: `avatarSrc` returns null and that dancer falls back to their initial.
- **Difficulty is the community's opinion, not a fact.** Every signed-in dancer gets one answer per
  trick and can change it as often as they like; a trick's level is what most of those answers say,
  with a tie going to the gentler one, and a trick nobody has marked shows no level at all. It is
  hidden on a pending suggestion - a trick is approved before members can weigh in on it.
- **Support mail depends on things outside this repo:** a deployed `support` Edge Function, a
  Resend API key stored as a Supabase secret, and `supabase/support.sql` run so the message is
  written down before the mail is attempted. `store.js` sends the message and nothing else - no
  address, no key - so this repo being public cannot be turned into a way to send mail. Resend's
  test sender only delivers to the address on the Resend account, so a custom sender needs a
  verified domain. A mail outage is now a stored message marked "not emailed" in the Support
  inbox rather than a lost one: the row is written first and the two outcomes are recorded
  separately. What the app still cannot do is reply - the address is on the row, and answering it
  is a mail client's job.
- **The support form is open to anyone**, since it has to be. The guard against spam is a honeypot
  field, a minimum message length and hard length caps - enough to stop a dumb script, no
  substitute for a rate limit, which Supabase Edge Functions do not give you for free.
- **A studio is a row, not a sentence.** Two people spelling the same gym differently make two
  studios, which is why the app offers the list before an empty box and matches on name *and* city
  (ignoring case and stray spaces). There is no merge tool for two rows that turn out to be one:
  that is a job for the SQL editor, where you can see who is attached to each first.
- **Duplicate suggestions** are blocked only by exact name match. Merging near-duplicates ("Fireman spin" vs "Fireman Spinn") is an admin task not yet supported.
- **A nickname is not a merge, and cannot rename anything.** An alias hangs under one entry, so
  writing one down is a statement about that trick: the name every move links to does not move, and
  two entries that turn out to be one trick are still two entries with a nickname list each. Merging
  them is a job for the SQL editor, where you can see which moves are linked to each first. The same
  nickname may legitimately belong to two different tricks - *Cupid* really is what one studio calls
  something another studio calls something else - which is why the pair, not the name, is unique.
- **A rejected trick is deleted, not hidden.** Rejecting removes the entry from the dictionary, because
  that row never belonged in it; a nickname is deleted row by row instead, and only by whoever wrote
  it or an admin. There is no history of either - a name that was taken off is simply gone.

## Future Changes

1. Shared / Collaborative Collections, Class collections
2. Messaging
   
## AI Experience and Protocol
This appliction was wrote with the assistance of FreeBuff and Github Copilot. This was spec driven developed with several hours with of prompting and edits. Although AI was used to write specific features and files, there was very heavy manual editing and testing required. I am quite certain that the manual testing was necessary to achieve a high performance quality and ensure the application performs as expected.
