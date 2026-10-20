#!/usr/bin/env node
/* Records what the cached shell looks like right now, so the next test run can tell it changed.
 *
 * This is the second half of the rule at the top of sw.js - "bump CACHE whenever you change any file
 * below, or users keep the old copy". The test notices that a cached file changed while CACHE stayed
 * the same; this records the new state once you have bumped it. Two commands, in this order:
 *
 *   1. edit a shell file, bump CACHE in sw.js
 *   2. npm run stamp
 *
 * Run it without bumping and the next test run will fail on the next change, pointing at whatever it
 * thinks is unversioned. Run it after bumping and the baseline moves forward.
 *
 * Run:  npm run stamp      (or: node tools/stamp-shell.mjs)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sha, shell, shellPath, cacheName, exists, abs } from '../tests/support/repo.mjs';

const baselinePath = 'tests/shell-baseline.json';
const previous = existsSync(abs(baselinePath)) ? JSON.parse(readFileSync(abs(baselinePath), 'utf8')) : { files: {} };

const files = {};
const changed = [];
const added = [];
for (const entry of shell()) {
  const path = shellPath(entry);
  if (!exists(path)) {
    console.log(`FAIL  ${entry} is in SHELL in sw.js but not in the repo`);
    process.exit(1);
  }
  const hash = sha(path);
  /* Two entries can name the same file: SHELL lists both './' and 'index.html', which are one cache
   * entry each and one file here. */
  if (path in files) continue;
  files[path] = hash;
  if (!previous.files[path]) added.push(path);
  else if (previous.files[path] !== hash) changed.push(path);
}
const gone = Object.keys(previous.files).filter((p) => !(p in files));

const cache = cacheName();
writeFileSync(abs(baselinePath), `${JSON.stringify({ cache, files }, null, 2)}\n`);

console.log(`${baselinePath}: ${Object.keys(files).length} files at ${cache}`);
if (previous.cache && previous.cache !== cache) console.log(`  cache: ${previous.cache} -> ${cache}`);
for (const p of added) console.log(`  added    ${p}`);
for (const p of changed) console.log(`  changed  ${p}`);
for (const p of gone) console.log(`  removed  ${p}`);
if (!added.length && !changed.length && !gone.length) console.log('  no change since the last stamp');
