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

Application must provide the ability for users to register/login, create entries for each move, add entry, exits and other notes, and group moves by personalized category. There will be a "pole dictionary" of entries, and users can link moves to the corresponding pole dictionary entry or create a new trick. These will be added to the pole dictionary upon review by admin. Pole dictionary entries will acculmate differing names for a singular move, as this is a common issue in the community. Users will be able to view each others collections and entries, unless the account is set to private.




## Run it

Modules and service workers need http, so don't double-click `index.html`. From this folder:

```
python3 -m http.server 8000
```

Open http://localhost:8000.

**On your phone:** run the server, find your computer's local IP, open `http://<that-ip>:8000` on the same wifi, then use "Add to Home Screen". Note that installing and offline mode need HTTPS, which `localhost` counts as but a LAN IP does not. For a real install on your phone, deploy the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages), which gives you HTTPS for free.

**Demo accounts** (seeded on first load):

| Username | Password | Notes |
|---|---|---|
| `juniper` | `demo` | public, has moves and collections |
| `pat` | `demo` | private account |
| `admin` | `admin` | reviews dictionary suggestions |

Or register your own. **Account → Reset demo data** restores the starting state.

## Your user stories and where they live

| Story | Where |
|---|---|
| Group moves by difficulty, achieved, in progress, goals | Status + 1–5 difficulty on every move; **Collections** for your own groupings (a move can be in several) |
| Detail page per move with entries, exits, combos | **Moves → a move**; add or edit with chips (type, press Enter) |
| Browse and share collections (standardized naming) | **Browse** → a dancer → their moves and collections; "Save to my goals" copies a name into your list |
| Register / login | Landing screen |
| Pole dictionary, linked or newly suggested, admin review | **Dictionary** to search and suggest; the move form auto-links on a name match; **Review** (admin only) approves or rejects |
| Private accounts | **Account → Private account** |

Not built (per our scoping): friends and congratulations, the instructor view, multiple names per trick.

## How it is organized

```
index.html              page shell
css/style.css           all styling (light + dark mode via CSS variables)
js/store.js             the data layer: all reads/writes/rules, saved to localStorage
js/app.js               router + one function per screen
sw.js                   service worker (offline app shell)
manifest.webmanifest    makes it installable
icons/                  app icons
```

**The one design decision that matters:** `app.js` never touches storage. Every action goes through a function in `store.js` (`saveMove`, `submitEntry`, `reviewEntry`...). That file also enforces the rules (you can only edit your own moves, private accounts are invisible, pending dictionary entries are only visible to their submitter and admins). To turn this into a real multi-user app, you rewrite `store.js` to call a backend and leave the screens alone.

### Data model

```
users       id, username, passHash, isAdmin, isPrivate
moves       id, userId, name, status, difficulty, entries[], exits[], combos[],
            notes, categoryIds[], dictEntryId (optional), achievedAt
categories  id, userId, name                       (your collections)
dictionary  id, name, status (approved | pending), submittedBy
```

`dictEntryId` is optional on purpose: a dancer can log a move before it exists in the dictionary and link it later. Entries and exits are plain text lists for now; making them links between moves (a graph) is the natural next step and would enable combo suggestions.

## Honest limitations (good to say in your writeup)

- **Data lives in one browser.** localStorage means "other dancers" only exist in the seeded demo data. Real sharing needs a backend (see below).
- **Passwords are only SHA-256 hashed in the browser.** That is demo-grade, not security. A real system hashes server-side with bcrypt/argon2 or uses a managed auth provider.
- **Privacy rules are enforced in client code**, so they are only real once they move server-side (e.g. Postgres row-level security).
- **Duplicate suggestions** are blocked only by exact name match. Merging near-duplicates ("Fireman spin" vs "Fireman Spinn") is an admin task not yet supported.

## Suggested next steps

1. **Backend:** Supabase gives you auth, Postgres and row-level security. Map the four tables above, then reimplement the functions in `store.js` against it.
2. **Aliases:** add an `aliases` table (name, entry_id) so one entry collects several names. This is the heart of your standardization idea.
3. **Move graph:** replace entries/exits text with links to other moves.
4. **Friends and activity feed**, then the instructor view as a permission on top of friends.
5. **Native stores:** wrap the PWA with Capacitor if you ever need App Store / Play Store listings.