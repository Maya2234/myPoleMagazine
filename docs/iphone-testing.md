# Testing on an iPhone, as an app

This is the workflow for putting the app on a real iPhone as a **home-screen app** — no Safari
chrome, its own icon, its own entry in the app switcher — and checking the parts that a desktop
browser cannot tell you about. It runs before publishing, so that what you publish is the thing you
already watched work.

Do it in this order. Steps 1 and 2 get a URL onto the phone; steps 3 to 6 are the actual test.

## What this workflow proves, and what it does not

It proves the app installs, launches standalone, lays out correctly against the notch and the home
indicator, takes an upload from the Photos library, keeps a session across a force-quit, and opens
offline after one warm visit.

It does **not** produce an App Store app. A home-screen web app is still a web app: it cannot be
submitted to App Review, it has no push notifications on iOS, and its storage is separate from
Safari's. That last one matters during testing and is called out in step 4. The App Store route is
a Capacitor wrapper built in Xcode — see the end.

## 0. One-time prerequisites

- An iPhone on **iOS 15.4 or later** (that is the floor for `<dialog>`, `:has()` and `dvh`; every
  iPhone from the 6s onward qualifies). **Settings → General → About** shows the version.
- The app must be loaded over **HTTPS**. A LAN address like `http://192.168.4.112:8000` is not a
  secure context, so `display: standalone` and the service worker are both inert and you get a
  bookmark, not an app. That is why step 1 opens a tunnel.
- In the Supabase dashboard, **Authentication → URL Configuration**: put the HTTPS origin you are
  about to use in **Site URL**, and add the same origin to **Redirect URLs**. Without it Supabase
  refuses to send a dancer back and the reset screen reports the link as expired. The quick-tunnel
  origin changes every time you start one, so either re-paste it here or plan the account test for
  a stable deploy.
- Only **Safari** can create a home-screen app on iOS. Chrome and Firefox on an iPhone can only
  bookmark the page.

## 1. Start the server and the tunnel

Two terminals, both left running. From the project folder:

```bash
python -m http.server 8000
```

```bash
npx --yes cloudflared@latest tunnel --url http://localhost:8000
```

The tunnel prints a banner and then a line containing `https://something-random.trycloudflare.com`.
That is your URL. Confirm it answers before picking up the phone:

```bash
curl.exe -s -o NUL -w "%{http_code}\n" https://YOUR-SUBDOMAIN.trycloudflare.com/
```

`200` means the whole chain — phone-reachable DNS, TLS, Cloudflare, your Python server — is up. If
it is not `200`, fix that here rather than debugging it on the phone.

It is `curl.exe` on purpose. In **Windows PowerShell**, `curl` is an alias for `Invoke-WebRequest`,
which does not understand `-s`, `-o` or `-w` and instead reports **"Missing an argument for parameter
'SessionVariable'"** — a message that says nothing about the real problem. `curl.exe` is the genuine
curl and ships with Windows 10 and later, so the line above runs unchanged in PowerShell and in Git
Bash. If you would rather not leave PowerShell:

```powershell
(Invoke-WebRequest -Uri https://YOUR-SUBDOMAIN.trycloudflare.com/ -UseBasicParsing).StatusCode
```

Notes:

- The tunnel is **public**. Anyone with the URL can open your app while it runs. It is a dev
  server, not a deploy.
- The URL **dies when you stop the tunnel**, and a new one is minted next time. An icon made from a
  dead URL stays on the home screen and shows an error when tapped — delete it.
- `python -m http.server` is fine for testing but serves every file in the folder. Do not leave it
  exposed longer than the test.
- To stop: `Ctrl+C` in each terminal. If a stray process is holding port 8000, find that one and
  stop only it — in PowerShell:

  ```powershell
  Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object -ExpandProperty OwningProcess
  Stop-Process -Id <that pid>
  ```

  `netstat -ano | grep :8000` is the Git Bash equivalent (and works in PowerShell too when Git's
  `bin` folder is on `PATH`, which it is if you are reading this repo with Git installed).

## 2. Install it on the home screen

On the iPhone, in Safari:

1. Open the tunnel URL. **Let the first load finish** — the service worker has to install, and an
   install interrupted by locking the phone gives you an app that cannot open offline.
2. Tap **Share** → scroll → **Add to Home Screen**.
3. The name should read **PoleMag** (the manifest's `short_name`). If it says "myPoleMagazine" or
   the page title, the manifest did not load — recheck step 1's content types.
4. **Add**, then launch from the home-screen icon, not from Safari.

Success looks like: no address bar, no Safari toolbar, the app's own top bar at the top, and a card
in the app switcher labelled PoleMag with your icon.

If the icon is blank or stale, remove it and re-add: iOS caches the icon at install time, so a new
`icons/icon-192.png` needs a fresh install to appear.

## 3. The device-only checklist

These are the things a desktop browser cannot verify, ordered by how likely they are to bite. Tick
each one on the phone.

**Launch and chrome**

- [ ] Opens standalone — no address bar, no Safari toolbar, no "Done".
- [ ] Status bar and top bar read as one surface; the `theme-color` matches the app background
      rather than showing a white band.
- [ ] Rotating the phone keeps it in portrait (the manifest locks `orientation`).
- [ ] Force-quit from the app switcher and relaunch: it opens to the same screen, not a blank page.

**Notch, home indicator, keyboard**

- [ ] Nothing in the top bar sits under the notch or the clock; the first row of content starts
      below them.
- [ ] The bottom navigation clears the home indicator — the last row of labels is fully tappable
      and not on top of the swipe-up bar.
- [ ] Tap the dictionary search field: iOS does **not** zoom the page (inputs inherit 16px), and the
      keyboard does not cover the field you are typing into.
- [ ] With the keyboard open, the bottom navigation does not jump into the middle of the screen or
      float above the keyboard in a broken way. Whatever it does, it should do it the same way twice.
- [ ] Scrolling a long list (dictionary, community activity) is smooth, and scrolling past the end
      does not reveal a white gap behind the page.

**Current goals**

- [ ] **+ Add new goal → My Moves** lists every move you have logged. The ones already in goals are
      dimmed with a disabled **In Current Goals** button (**Already in** in a collection) - a move you
      know you logged is never missing from the list - and they sit at the bottom, under everything
      that can still be added. The add button on the ones that are not is a **+**, the same mark the
      tab beside it uses.
- [ ] The **Dictionary** tab lists every trick too, and one already in the list is drawn the same way
      as on **My Moves**: the card dimmed and the same disabled button, rather than a sentence under
      the name. The **+** on a trick that is not in yet adds it.
- [ ] **+ New move** at the top of **My Moves** opens the move form with the list you opened the panel
      from already ticked, and the panel is gone behind it. Saving puts the move in that list. With no
      moves logged at all it is still the first thing in the panel.
- [ ] Hold the six-dot grip on a card and drag: the card follows your thumb, the card it would take
      the place of shows a pink top edge, and letting go drops it there. The page does not scroll
      while you are dragging, and a tap on the grip does nothing.
- [ ] Leave the app and come back: the order is the one you left. (It is stored in the database, so
      it is the same order on another device - this needs `supabase/goal-order.sql` run once; until
      then letting a card go shows a message naming that file.)
- [ ] A card's link and its status dropdown still work after the reorder.
- [ ] Tapping anywhere on a card - its padding, its detail line, the dashes - opens that move. The
      status dropdown, the **—** and the drag grip still do their own thing instead of navigating, and
      holding a card does not show iOS's "open in new tab" menu on top of the page.
- [ ] The **—** on a card asks first, in the app's own box in the middle of the page rather than the
      browser's: it names the move and says it stays in My Moves. **Cancel** and Escape keep the goal,
      **Take it off** takes it off and the toast confirms it - and opening the box never removes the
      goal by itself.
- [ ] On a profile, the studio reads as its name alone - no "— City" - and the studio's page still
      shows the town.

**A trick in the dictionary**

- [ ] The third fact on a trick's page, **Your moves**, is a button rather than a line of text: it says
      *Logged* when the trick is one of your moves and *Not yet* when it is not.
- [ ] Hovering it (or reaching it with the keyboard) turns *Your moves* into **Open in My Moves**, or
      **+ Add to my moves**; the strip does not change height while the pointer is on it.
- [ ] A tap does the same thing without waiting for a hover: *Logged* opens your move, *Not yet* opens
      the move form with this trick already linked: the title is the trick's name and the details box
      names it under **Dictionary entry**.
- [ ] There is no second, larger button under the facts doing the same job.

**A move you own**

- [ ] The name, the **Current goal** dropdown and the **Difficulty** dashes are together at the top of
      the page, above the hairline; on a phone the pair sits under the name and the written level under
      the dashes, with no sideways scroll.
- [ ] When the move is filed under a dictionary trick, the name in the title is a link to it, and
      tapping it opens the trick. A move that is not linked has a plain title, not a link to nowhere.
- [ ] The pencil beside the title opens **Name and dictionary entry**: the name box with the caret in
      it, the linked trick as a link (or *Not linked*), and the dropdown of tricks is folded away -
      **Change** opens it, and it is not shown until then. Escape closes the box and leaves the page.
- [ ] A new move opens that box on arrival. Typing a name the dictionary knows links it and says so;
      one it does not know leaves it on *Not linked* and offers the suggestion box on the form.

- [ ] Entries, exits and combos are rows of pills, every pill keeping its **×**, with a **+** beside
      the row's title and no pencil and no box drawn around them. Tapping a **+** opens a pill-shaped
      box at the end of the row: Enter adds the chip and leaves the box open, tapping elsewhere adds
      what was typed and closes it, and Escape closes it on nothing.
- [ ] Every **+** on the page is beside the title of what it adds to - entries, exits, combos,
      collections, media, notes - and none sits at the end of a row or on a line of its own.
- [ ] A **×** on a pill takes that one off straight away, including while the box is open, and the
      press lands rather than closing the box and doing nothing.
- [ ] Notes is the only field with a pencil: it shows the paragraph, and the pencil opens the box to
      write in without losing what was there.
- [ ] Collections are a plain list of ticks and names: no bordered pill around each one, and no pink
      fill on a ticked one. The **+** beside **Collections** opens **New collection**, and what you name
      there is ticked on before the form is saved.
- [ ] Saving keeps every chip and the notes, whichever field was last touched.

**Your profile**

- [ ] The pencil at the top right of **Account** has no white box behind it: it sits on the page's own
      colour, in the quiet grey, and turns pink under the thumb. The **Request edit** pencils on a trick
      and on a studio are drawn the same way.
- [ ] **Edit profile** lists your studios one per row, each name on one line and shortened with **...**
      when it is too long for the row - it neither wraps nor widens the sheet. The first row is marked
      **On my profile** and carries no reorder arrows; the last row has no **down** arrow; a row in the
      middle has both, and they swap it with the row beside it.
- [ ] The **+** under that list opens a small panel with a search box and every studio. Ones you have
      already listed are there too, dimmed and marked **Added**, and cannot be pressed. Typing filters
      the list by name and town, and a search that matches nothing says so.
- [ ] The panel opens upwards when it would otherwise run off the bottom of the phone, and opening it
      never moves the list it belongs to. Escape closes the panel and leaves the editor open; a tap
      anywhere else in the editor closes it too.
- [ ] **Add a studio that is not listed** opens the name and town fields inside the panel, and adding
      one puts it in your list straight away, ready to save.

**Sharing a collection**

- [ ] On a collection of your own, **Invite dancers** in the sharing panel opens it to invitations and
      puts the cursor in the username box; there is no code to copy anywhere.
- [ ] Inviting a dancer puts them under **Waiting to hear back** with a Cancel beside the name.
- [ ] Signed in as the invited dancer, the invitation is a tile at the top of the **Collections** grid
      on **Moves**, full width, dashed edge, marked **Invitation**, with **Accept** and **Decline** on
      it. On a phone the two buttons stay on the row or drop together under the name, never clipped.
- [ ] **Accept** opens the collection; back on **Moves**, the tile is now an ordinary collection marked
      `shared`. **Decline** takes the tile away and says so.
- [ ] **Stop sharing** on the collection's page asks first, then comes back with nobody in it and the
      invitation gone from the other dancer's **Moves** page.

**The floating notepad**

- [ ] The notepad disc sits clear of the bottom bar, not on top of it or under it.
- [ ] Dragging it with a thumb moves it in both directions and it stays exactly where you let go -
      it does not spring back to an edge; a plain tap opens the journal and never drags.
- [ ] Where you left it survives force-quitting the app and reopening it from the home screen.
- [ ] Rotating the phone leaves it on screen and clear of the bar (both coordinates are stored as
      fractions, so it should follow the new viewport).

**Sheets and dialogs**

- [ ] The goals sheet and the profile sheets rise from the bottom and sit inside the screen — no
      content clipped under the notch, no sheet taller than the viewport.
- [ ] The journal is a drawer docked to the right edge, opened by the floating notepad button; it
      covers the full width on a phone, and Escape or its Close button puts it away.
- [ ] The background dims and is not tappable behind the sheet.
- [ ] The sheet's close (cross or Done) is reachable with a thumb, one-handed.
- [ ] With the keyboard open on a sheet's text field, the sheet's save action is still reachable.

**Media**

- [ ] Log a move with the **+** beside **Media** → Photos → pick a photo. It uploads and displays
      right side up, not rotated or squashed.
- [ ] Take a live photo or a HEIC and upload it: confirm it lands and renders (Safari normally
      transcodes to JPEG, but this is the one place a code path can surprise you).
- [ ] Upload a video and play it: it plays **inline**, not forced into the iOS fullscreen player,
      and audio behaves.
- [ ] A photo taken in portrait does not appear cropped to a square in a card.

## 4. The account round-trip, and the trap in it

The trap: **an installed web app and Safari are separate storage containers on iOS.** Signing in
inside Safari does not sign you in inside the home-screen app, and a session in the app is invisible
to Safari. Test the flow the way a new dancer would meet it.

- [ ] In the **installed app**, register with an email you can read on the phone.
- [ ] The confirmation email's link opens in **Safari**, not in your app — that is normal for a PWA,
      not a bug you can fix here. Confirm there.

      Expect this to change once the app is wrapped for the App Store: a universal link can bring
      the dancer back into the installed app, which is one of the concrete reasons to wrap it.
- [ ] Return to the home-screen app and log in with the email and password. It should sign in
      without asking you to confirm again.
- [ ] Force-quit the app, reopen: still signed in.
- [ ] **Forgot password** → the email arrives → the link opens in Safari → set a new password →
      return to the app → log in with the new one. If the reset screen says the link expired,
      the Supabase Site URL / Redirect URLs do not match the origin you are testing on (step 0).
- [ ] Sign out, and confirm the app returns to the landing screen with no stale cards behind it.

## 5. Offline, which is the point of the service worker

- [ ] With the app already loaded once on this URL, turn on **Airplane Mode** (or just lock the
      phone and disable Wi-Fi) and launch the app from the icon.
- [ ] The shell renders: the top bar, the navigation and the last screen's structure appear rather
      than Safari's "no internet" page.
- [ ] Know the expected limit. In a WebKit test of this build, an offline reload rendered the shell
      but the Supabase module from `esm.sh` failed to load, so signing in while genuinely offline
      does not work yet. What matters now is how the app fails: a message is acceptable; a spinner
      that never stops, or a blank screen, is a real bug to fix before publishing. Self-hosting that
      module instead of importing it from `esm.sh` is the fix if you want true offline.
- [ ] Turn Airplane Mode off, force-quit, relaunch: everything works again with no reinstall.

## 6. After you change the code

The service worker is network-first now, so a reload usually picks up edits, but an installed app
needs a nudge:

1. Bump `CACHE` in `sw.js` (`mypolemagazine-v51` → `v52`). The file says to; this is the rule that
   keeps testers off a stale copy.
2. Force-quit the app from the app switcher and launch it again. If it is still stale, remove the
   home-screen icon and re-add it, which also refreshes the icon.
3. If you restarted the tunnel, the URL is new — the old icon is dead. Remove it first.

## 7. If it goes wrong

| What you see | What it is |
|---|---|
| Safari cannot connect at all | The tunnel or the server died. Re-run step 1's `curl.exe`; a non-200 means the chain is broken, not the phone. |
| `Missing an argument for parameter 'SessionVariable'` | You typed `curl` in PowerShell, which is `Invoke-WebRequest` in disguise. Use `curl.exe` (step 1). |
| The phone loads the site but there is no "Add to Home Screen" | You are in Chrome or Firefox. It is a Safari-only feature on iOS. |
| Installed, but it opens with an address bar | The origin is not HTTPS, or the manifest did not load — check step 1's content types, then remove and re-add the icon. |
| White screen on launch | The first load did not finish, so the service worker never installed. Remove the icon, reload the URL in Safari until it fully renders, then re-add. |
| The app shows an old build | Bump `CACHE` in `sw.js`, force-quit, relaunch. See step 6. |
| Signed in in Safari, still signed out in the app | Expected: separate storage containers. Sign in inside the app (step 4). |
| Upload fails with `crypto.randomUUID is not a function` | You are on an insecure origin — a LAN IP rather than an HTTPS URL. That path is already patched with a fallback, so seeing it again means the patch is not in the build you are testing. |
| Reset or confirmation link reports expired | Supabase **Site URL** / **Redirect URLs** do not match the current origin. The tunnel origin changes every run; re-paste it (step 0). |

## 8. Record the run

Keep one of these per test round. It is what makes "it works on my phone" into something you can
compare across iOS versions and builds.

| Field | Value |
|---|---|
| Date | |
| Device / iOS version | |
| Origin tested | `https://____.trycloudflare.com` (or the deploy URL) |
| Build (sw.js CACHE) | `mypolemagazine-v__` |
| Steps 3–6 result | pass / fail — failures listed |
| Notes (what looked wrong) | |

## 9. When this workflow is not enough

This workflow is the right one for the pre-publish check. The moment you need a URL that survives
overnight, a link a reviewer can open, or a place for a tester who is not on your Wi-Fi, put the
folder on a static host — GitHub Pages, Netlify or Cloudflare Pages all serve it with HTTPS, and
the same install steps then work from a permanent origin (and step 0's Supabase settings stop
moving).

For an actual App Store submission this stops being enough, because a PWA cannot be submitted:

- **A Capacitor iOS wrapper** is the usual route. It needs macOS + Xcode, or a cloud Mac runner
  (Codemagic, Bitrise, GitHub Actions macOS runners), to build and archive.
- **App Review 1.2** requires reporting, blocking, filtering and published contact info for
  user-generated content. The app has the support form; the report and block paths do not exist yet.
- **App Review 4.2** rejects apps that are "just a website in a webview" — the native behaviours
  (share sheet, haptics, offline-first data, a real icon set) are what argue against that.
- **Icons**: App Store needs a **1024×1024** icon with **no alpha channel**; `icon-192.png` and
  `icon-512.png` currently carry alpha. `apple-touch-icon.png` is already opaque and correct.

There is one more thing worth knowing before you spend a weekend on iOS 15 devices: this app's floor
is iOS 15.4, but if you decide to support only iOS 16+, `dvh` and `:has()` get simpler and you can
lean on modern units without fallbacks. That is a product decision, not a bug.
