# Production readiness

A standard pre-launch checklist, item by item, against this repo. Written to be readable next to the
code: every "done" names the file that proves it, and every "missing" names what it would take.

**The status words mean specific things.**

| Word | Meaning |
|---|---|
| **tested** | A test in `tests/` fails if this stops being true. Nothing to remember. |
| **done** | It is in the repo and works, but nothing would notice it breaking. |
| **missing** | It is not there. |
| **yours** | It cannot be done from this repo — it lives in a Supabase project, a host, or a billing page. |
| **n/a** | It does not apply to this app. |

Run everything that is automated with:

```
npm run check      # palette (colour + contrast) then the 40 tests
npm test           # just the tests
npm run stamp      # after bumping CACHE in sw.js - see below
```

Node 22 or newer, no dependencies to install. CI runs the same two commands on every push
(`.github/workflows/tests.yml`).

## What the tests are, and what they are not

40 tests, ~0.7s, no browser. They cover the contracts *between* files — the class of bug this app
actually has, because five files have to agree about a name, a path or a cache version and nothing at
runtime compares them:

| File | What it holds to account |
|---|---|
| `tests/manifest.test.mjs` | manifest ↔ icons ↔ `index.html`: declared sizes match the real pixels, the Apple icon is 180×180 and opaque, and the theme key and pre-paint script still agree with `js/app.js` |
| `tests/service-worker.test.mjs` | every path in `SHELL` exists, every file a page loads is in it, every pickable avatar is cached, the CDN constant matches the real import, and **`CACHE` was bumped** whenever a cached file changed |
| `tests/router.test.mjs` | every hash in the app resolves to something that renders; nav sections are real; legacy hashes still redirect |
| `tests/security.test.mjs` | no secret value is committed; the browser holds only the publishable key; every table has row level security; no policy is `for anon`; no write is unconditional; the public-read tables are exactly the four documented ones |
| `tests/smoke.test.mjs` | every script parses, every path in `index.html` exists, and a static server serves all of it with content types a browser will use |

They do **not** render anything. There is no DOM test, no visual check and no real-device check — that
is `docs/iphone-testing.md`, run by hand on a phone. Adding Playwright would close that gap; it is the
obvious next step for the suite, and it costs a browser download plus a real test runner.

**The suite was verified by breaking things on purpose.** In a copy of the repo, seven mutations were
applied at once — `display: "browser"` in the manifest, a renamed route in `js/app.js`, a
`pleaser-pink.jpg` that does not exist, a wrong CDN host in `sw.js`, a deleted
`enable row level security`, an edited `css/style.css` with no cache bump, and a fake secret key. All
seven were caught, by the intended test each time, and `node --test` exited 1.

## The cache-version rule, now enforced

`sw.js` says *"bump CACHE whenever you change any file below, or users keep the old copy"*. That is
the one rule nobody can hold in their head, and getting it wrong is invisible on the developer's
machine — the old copy is right there in the cache.

`tests/shell-baseline.json` records a hash of every cached file and the `CACHE` it was recorded at.
Change a cached file without bumping `CACHE` and the test fails, naming the files. Bump it and:

```
npm run stamp
```

moves the baseline forward. Two commands, and the rule stops depending on memory.

## The checklist

| Item | Status | Where it stands |
|---|---|---|
| add CI/CD | **done** | `.github/workflows/tests.yml` runs the palette check and the tests on push and pull request. There is no deploy job: no host has been chosen yet, and that is the next step below. |
| add unit tests | **done, with a caveat** | The 40 tests are contract-level rather than function-level: `js/store.js` imports the Supabase client from a CDN and `js/app.js` needs a DOM, so neither can be imported by a plain Node test. Function-level units would need the modules split (pure helpers out of the DOM code) or a stub loader. |
| add smoke tests | **tested** | `tests/smoke.test.mjs` runs a static server over the repo and fetches every path the service worker caches, asserting 200, a non-empty body and a content type a browser will use. |
| add regression tests | **tested** | The router, the shell list and the cache version are all regression tests — each one guards something that has already been broken once during development (the cache bump, the `#/Bible` rename, the avatar list). |
| validate SEO and AEO (sitemap, robots.txt, structured data) | **missing** | No `robots.txt`, no `sitemap.xml`, no JSON-LD. `index.html` has a title and a description, which is all a crawler gets: this is a hash-routed single page behind a login, so there is no set of URLs to index. Worth doing only if you want the landing page findable; `robots.txt` and a one-URL sitemap are ten minutes, structured data would be for the login page only. |
| add alerting | **missing** | Nothing fires when the app breaks. Supabase can email on project usage; nothing watches the app itself. |
| include performance monitoring | **missing** | No measurement at all. For what it is worth, the measured payload: the whole shell is 286 KB uncompressed and **78 KB gzipped**, of which `js/app.js` is 30 KB and `js/store.js` 24 KB. That is small enough that the first fix is a host with gzip and caching, not a bundler. |
| create analytics | **missing** | Nothing. No analytics, no error tracking, no cookies — which is also why there is no cookie banner to write. Adding one changes that. |
| check auth on every endpoint | **tested, plus one manual tool** | There is no server of ours: PostgREST and Storage *are* the API, so the policies are the auth. All 12 tables enable row level security, every policy is `to authenticated`, no write policy is unconditional, and the four tables readable without an ownership rule are pinned by test. `supabase/security-check.sql` goes further and *attacks* the review path from inside Postgres (can a dancer publish without review, can they make themselves an admin), rolling everything back with a sentinel. Run it after any policy change. |
| run a dependency audit | **n/a, with one thing to fix** | There are zero npm dependencies and no build step. The one third-party dependency is `@supabase/supabase-js` loaded from `esm.sh`, and **the version is a floating major** (`@supabase/supabase-js@2` in `js/supabase.js`). An upstream `2.x` release can change what the app receives with no commit here. Pin it to an exact version for a release; `sw.js` already caches it, so the pin also makes the offline copy deterministic. |
| test it on multiple devices | **yours, documented** | `docs/iphone-testing.md` is the iPhone pass: standalone launch, notch and home-indicator insets, the keyboard, the Photos picker, offline. Not automated, and not done on any device yet. |
| test it on slow networks | **missing** | No throttled test. The manual workflow can do it on a phone (Wi-Fi off is a brutal 4G simulation); the automated version is Playwright with network throttling, which this suite does not have. The app's shape helps here: after one visit it opens from cache. |
| set spend caps and billing alerts | **yours** | Supabase project settings. Worth doing before anything is public — Storage is the line item that grows, since uploads are the one thing a stranger can make bigger. |
| back up your database | **yours, partly automatic** | Supabase's own backups depend on the plan. What is in the repo is the schema (`supabase/*.sql`), so the data is the part a backup protects. |
| actually test a restore | **yours** | Nothing here can test a restore: it needs the Supabase project. The honest version of this step is restoring into a scratch project and pointing a copy of the app at it — which is also the staging environment below. |
| have a rollback plan for bad deploys | **partly** | Two levers, both real. The host rolls back to the previous deploy; the service worker's `CACHE` version is what makes the *clients* move — a bad build can be replaced, but a client that has cached it needs the new `CACHE` to replace its copy on the next load. That is exactly what `tests/service-worker.test.mjs` enforces. |
| keep secrets out of the repo | **tested** | `tests/security.test.mjs` fails on a Supabase secret key, a JWT, a private key, an AWS/GitHub/Slack/OpenAI/Resend key shape, or any `.env` file. The only key here is the **publishable** one in `js/supabase.js`, which is designed to be public — the README says so, and a test pins it. `.gitignore` now covers `.env`, `node_modules` and OS droppings. |
| rotate any keys that leaked | **nothing to rotate** | The scan finds no leaked secret, and there is nothing in the repo that would need rotating if there were: the client key is public by design and revoked from the dashboard if you ever want to. The Resend key and the service-role key live as Supabase secrets, outside the repo. |
| add rate limiting | **missing, and the weakest spot** | `supabase/support.sql` guards the contact form with a honeypot, a minimum length and caps, and the README is explicit that this is "no substitute for a rate limit". Supabase Edge Functions have none of their own, and neither does the sign-in path, so today a script can post the support form, hammer sign-in with guesses, or walk the dictionary search as fast as it likes. The cheap fix is a CAPTCHA on the support form (Cloudflare Turnstile is free) and a per-IP limit at the edge; the honest fix is a small counter table checked from the function. |
| add error tracking | **missing** | A crash in a dancer's browser is invisible: `route()` catches its errors and shows "Something went wrong" with the message, which is right for the dancer and useless for you. On a phone there is no console to read either (`docs/iphone-testing.md` says so). A `window.onerror`/`unhandledrejection` beacon to Supabase would fit the existing stack. |
| add logging | **partly** | The `support` Edge Function logs server-side, and the Support inbox keeps the message even if the mail fails. Nothing in the browser logs anywhere but the console. |
| set up uptime monitoring | **missing** | Nothing checks whether the app is up — which matters more than usual here, because a static app has two dependencies: the host and Supabase. Two checks, not one. |
| create a staging environment | **missing** | One Supabase project, used as production. The natural shape: a second Supabase project plus the same folder deployed to a preview URL, which also gives you somewhere to test a restore. |
| set up your custom domain and SSL | **missing** | No host yet. Any static host gives HTTPS free, and HTTPS is not optional here: installing to a home screen and the service worker both need a secure context. That is why the phone workflow has to tunnel. |
| configure email auth (SPF/DKIM/DMARC) | **partly, and yours** | Supabase sends the auth mail (confirmation, password reset) from its own domain, so its SPF/DKIM are already in place — but that also means the mail comes from `supabase.io`, and a custom sender needs a verified domain. The support function defaults to Resend's test sender `onboarding@resend.dev`, which only delivers to the address on the Resend account: a real sender needs a domain with SPF, DKIM and DMARC records before the form can mail a stranger. |

## What I would do next, in this order

1. **Deploy it.** Every remaining item that is "yours" gets easier with a host: a URL, HTTPS, the
   iPhone install without a tunnel, the Supabase Site URL to set, and somewhere for a reviewer to look.
2. **Pin the Supabase client version** in `js/supabase.js` (one line, and the cache makes it stick).
3. **Rate-limit the support form** — the one place a stranger can reach the backend for free.
4. **Staging**: a second Supabase project, used for the restore test as well.
5. **Error tracking**: a beacon on `window.onerror`, aimed at a table rather than a vendor.
6. **Playwright**: the browser-level tests (routes rendering, slow network, installed-mode behaviour)
   that the current suite deliberately does not attempt.

## Two small things found while writing the tests

Both are reported by the suite as diagnostics rather than failures, because both are judgement calls
rather than breakage:

- **`#/Bible` is in `SECTION` but nothing renders it.** The dictionary was renamed and the legacy
  entry in the `SECTION` map was kept (`Bible: 'dictionary'`) while the branch that handled the old
  hash is gone, so an old bookmark to `#/Bible` lands on the not-found panel. Redirect it, or drop it
  from `SECTION` and let it 404 honestly.
- **A condition is tested twice.** `route()` has
  `else if ((view === 'dictionary' || view === 'dictionary') && a)` — a rename left the same
  comparison on both sides of an `||`. Harmless, but the branch now reads as if it handles two
  routes when it handles one.

And one thing the tests *pin* rather than fix: `icons/icon-192.png`, `icons/icon-512.png` and
`icons/icon-maskable-512.png` all carry an alpha channel, and there is no 1024×1024 icon. Neither
matters for the web app; both matter for an App Store submission.
