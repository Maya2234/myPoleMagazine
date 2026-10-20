/* Two things this app has to keep true, both invisible from the running app.
 *
 * 1. NO SECRETS IN THE REPO. `js/supabase.js` ships a project URL and a *publishable* key, and both
 *    are meant to be public - that is what makes a public repo safe here. What must never appear is
 *    the other half of that pair: a secret key, a service-role JWT, a private key, or an API key
 *    pasted into an Edge Function instead of read from the environment.
 *
 * 2. THE RULES ARE THE DATABASE'S. There is no server of ours in front of PostgREST, so row level
 *    security *is* the API auth. A table created without RLS, or a policy that answers `true` to a
 *    write, is an open endpoint - and it looks exactly like a closed one from the browser, because
 *    the app only ever asks for its own rows.
 *
 * Run:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, walk, exists } from './support/repo.mjs';

const TEXT = ['.js', '.mjs', '.ts', '.sql', '.json', '.html', '.css', '.md', '.webmanifest', '.yml', '.txt'];
const files = walk('', { exts: TEXT }).filter((f) => !f.startsWith('tests/'));

/* --- 1. secrets ----------------------------------------------------------------------------- */

const SECRET_SHAPES = [
  [/sb_secret_[A-Za-z0-9_-]{6,}/, 'a Supabase secret key (the publishable one is the only key that belongs in a browser)'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, 'a JWT - only a service_role one has a use in this repo, and it must not be committed'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'a GitHub token'],
  [/\bsk-[A-Za-z0-9]{24,}\b/, 'an OpenAI-style API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\bre_[A-Za-z0-9]{16,}\b/, 'a Resend API key'],
];

test('no secret value is committed anywhere in the repo', () => {
  const hits = [];
  for (const file of files) {
    const text = read(file);
    text.split('\n').forEach((line, i) => {
      for (const [pattern, what] of SECRET_SHAPES) {
        if (pattern.test(line)) hits.push(`${file}:${i + 1} looks like ${what}`);
      }
    });
  }
  assert.deepEqual(hits, [], `secret-looking values found:\n  ${hits.join('\n  ')}`);
});

test('the key in the browser is the publishable one', () => {
  /* Documented in the README: "js/supabase.js holds the project URL and the publishable key, which is
   * meant to be public - so the row-level security policies in Supabase are what actually protect
   * your data." A secret key here would be readable by every visitor. */
  const client = read('js/supabase.js');
  assert.match(client, /https:\/\/[a-z0-9]+\.supabase\.co/, 'js/supabase.js should name the project URL');
  assert.match(client, /sb_publishable_[A-Za-z0-9_-]+/, 'js/supabase.js should use the publishable key');
  assert.doesNotMatch(client, /sb_secret_|service_role/, 'js/supabase.js must never carry a secret or service-role key');
});

test('the client code never names a service role', () => {
  const offenders = files
    .filter((f) => f.startsWith('js/'))
    .filter((f) => /service_role|SERVICE_ROLE/.test(read(f)));
  assert.deepEqual(offenders, [], `service-role access belongs on the server only: ${offenders.join(', ')}`);
});

test('Edge Functions read their secrets from the environment', () => {
  const functions = walk('supabase/functions', { exts: ['.ts'] });
  assert.ok(functions.length, 'the support function should be there');

  for (const file of functions) {
    const text = read(file);
    assert.match(text, /Deno\.env\.get\(/, `${file} should read its configuration with Deno.env.get`);

    /* A literal handed straight to a key-shaped name is the mistake: `= 'sk-live-...'`. A default
     * after `??` is fine when it is not a secret, which is why only the direct assignment is caught. */
    const bad = [...text.matchAll(/\b(\w*(?:KEY|SECRET|TOKEN|PASSWORD)\w*)\s*=\s*'([^']{12,})'/gi)]
      .filter(([, , value]) => !/^https?:|^\d+$/.test(value));
    assert.deepEqual(
      bad.map((m) => m[1]),
      [],
      `${file} assigns a literal to a secret-shaped name instead of reading it from the environment`,
    );
  }
});

test('no environment file is in the repo', () => {
  /* .env files are how a key gets committed by accident; there is nothing here that needs one, since
   * the browser config is a publishable key and the server config lives in Supabase. */
  const envish = walk('').filter((f) => /(^|\/)\.env/.test(f));
  assert.deepEqual(envish, [], `environment files should not be in the repo: ${envish.join(', ')}`);
  const hasIgnore = exists('.gitignore');
  assert.ok(hasIgnore, '.gitignore should exist so the next .env or node_modules cannot be committed by accident');
  const ignore = read('.gitignore');
  for (const pattern of ['.env', 'node_modules']) {
    assert.ok(ignore.includes(pattern), `.gitignore should ignore ${pattern}`);
  }
});

/* --- 2. row level security ------------------------------------------------------------------- */

const sqlFiles = walk('supabase', { exts: ['.sql'] });
const sql = Object.fromEntries(sqlFiles.map((f) => [f, read(f)]));

const tables = [];
for (const [file, text] of Object.entries(sql)) {
  for (const m of text.matchAll(/create table if not exists (public\.\w+)/g)) tables.push({ file, table: m[1] });
}

const policies = [];
for (const [file, text] of Object.entries(sql)) {
  for (const m of text.matchAll(/create policy (\w+) on ([\w.]+) for (select|insert|update|delete|all)([^;]*);/gi)) {
    policies.push({
      file,
      name: m[1],
      table: m[2],
      op: m[3].toLowerCase(),
      to: m[4].match(/^\s*to\s+(\w+)/i)?.[1] ?? '',
      body: m[4].replace(/\s+/g, ' ').trim(),
    });
  }
}

test('the SQL was found and parsed', () => {
  assert.ok(tables.length >= 10, `expected the schema to create at least ten tables (found ${tables.length})`);
  assert.ok(policies.length >= 30, `expected at least thirty policies (found ${policies.length})`);
  for (const p of policies) assert.ok(p.to, `could not read the role a policy applies to: ${p.name} in ${p.file}`);
});

test('every table the schema creates has row level security switched on', () => {
  const missing = tables.filter(({ file, table }) => !sql[file].includes(`alter table ${table} enable row level security`));
  assert.deepEqual(
    missing.map((t) => `${t.table} (${t.file})`),
    [],
    'a table without RLS is readable and writable by anyone holding the publishable key',
  );
});

test('every policy is for a signed-in dancer, never for anon', () => {
  const wrong = policies.filter((p) => p.to !== 'authenticated').map((p) => `${p.name} in ${p.file} is for "${p.to}"`);
  assert.deepEqual(wrong, [], `policies should be granted to authenticated only:\n  ${wrong.join('\n  ')}`);
});

test('no policy allows a write unconditionally', () => {
  /* `using (true)` on a write means anyone with the publishable key can write anyone's row. Reads are
   * a deliberate decision (see the next test); writes never are. */
  const offenders = policies
    .filter((p) => p.op !== 'select')
    .filter((p) => /using \(true\)|with check \(true\)/.test(p.body))
    .map((p) => `${p.name} on ${p.table} (${p.op}) in ${p.file}`);
  assert.deepEqual(offenders, [], `these policies give away a write:\n  ${offenders.join('\n  ')}`);
});

test('the studio Instagram setter is authenticated and column-limited', () => {
  /* This is the one write that deliberately reaches a row the caller does not own: any member may
   * correct a studio's handle. Because it is SECURITY DEFINER it bypasses RLS, so the auth check
   * inside it and the grant to authenticated only are what keep it from becoming an anon endpoint. */
  const file = read('supabase/studio-instagram.sql');
  assert.match(file, /security definer/i);
  assert.match(file, /if auth\.uid\(\) is null/i);
  assert.match(file, /update public\.studios set instagram = clean where id = p_studio/i);
  assert.match(file, /grant execute on function public\.set_studio_instagram\(uuid, text\) to authenticated/i);
  assert.match(file, /revoke all on function public\.set_studio_instagram\(uuid, text\) from public, anon/i);
});

test('the tables readable without an ownership rule are the documented ones', () => {
  /* Reference data two dancers have to see the same copy of: who trains where, the studio list, the
   * studio Instagrams, and who follows whom. Anything else answering `true` to a read is either a
   * mistake or a decision that has not been written down - which is why this list is exact rather
   * than a minimum. */
  const PUBLIC_READS = ['public.follows', 'public.profile_studios', 'public.studio_instagrams', 'public.studios'];

  const open = policies
    .filter((p) => p.op === 'select' && /using \(true\)/.test(p.body))
    .map((p) => p.table)
    .sort();
  assert.deepEqual(
    [...new Set(open)],
    [...PUBLIC_READS].sort(),
    'the set of tables with a public read policy changed; if that is deliberate, update PUBLIC_READS here and say why',
  );
});
