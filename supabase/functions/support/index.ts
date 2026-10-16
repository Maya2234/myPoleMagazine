/* supabase/functions/support/index.ts
 *
 * The contact form on #/support posts here, and this does two things with it: it writes the message
 * into public.support_messages (supabase/support.sql) and then emails it through Resend.
 *
 * It lives in a function rather than in the page because the Resend API key is a secret: anything
 * the browser holds, a visitor can read, and an email key in a public file is an open relay for spam
 * within a day. The same reason applies to the stored copy - the table grants the browser no insert,
 * so this function's service role key is the only way a row gets in.
 *
 * Deploying it, once (either way works):
 *
 *   supabase functions deploy support --no-verify-jwt
 *   supabase secrets set RESEND_API_KEY=re_your_key_here
 *
 * or by hand in the Supabase dashboard: Edge Functions -> Deploy a new function, paste this file,
 * then Edge Functions -> Secrets -> add RESEND_API_KEY, and leave "Enforce JWT verification" OFF.
 *
 * The JWT check is off on purpose. This is the one endpoint a visitor has to reach while signed out
 * - somebody locked out of their account is exactly who needs to write in - so it is open, and pays
 * for that with a honeypot field and hard length caps instead of a session. It cannot read the
 * database at all; the only table it touches is its own write of the message.
 *
 * The stored copy is what makes "sent" mean something. Email is not a delivery guarantee: a spam
 * filter, a wrong key or an unverified sender can swallow a message after Resend has agreed to take
 * it, and before this table existed the visitor was told it was on its way and nobody ever learned
 * otherwise. Now the row is written first and the email is attempted second, so a failed email shows
 * up as "stored, never emailed" in the app's inbox instead of vanishing.
 *
 * Resend's test sender only delivers to the address on the Resend account. If that address is
 * SUPPORT_TO below, nothing else is needed. To send from your own domain instead, verify it in
 * Resend and set SUPPORT_FROM (and optionally SUPPORT_TO) as secrets.
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPPORT_TO = Deno.env.get('SUPPORT_TO') ?? 'mayato223@gmail.com';
const SUPPORT_FROM = Deno.env.get('SUPPORT_FROM') ?? 'myPoleMagazine <onboarding@resend.dev>';

/* Both are injected into every Edge Function by the platform, so the stored copy needs no secret of
 * its own. The service role key is the one that can write a table the browser cannot. */
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/* The page is served from a static host, so the origin is whatever that host is. Nothing here needs
 * a cookie or a token, so a wildcard costs nothing: there is no session to ride along. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* Trim, cap, and drop control characters. Newlines survive because the message is multi-line. */
const clean = (value: unknown, max: number) =>
  String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

const looksLikeEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

/* The table's own API, through PostgREST. Plain fetch rather than the Supabase client: one table,
 * two calls, and no import to keep in step with the deployed runtime. */

type Row = {
  id?: string;
  name: string | null;
  email: string;
  subject: string | null;
  message: string;
  username: string | null;
  emailed?: boolean;
  email_error?: string | null;
};

/* Returns the new row's id, or '' with a reason when it could not be written. The reason is for the
 * logs and for the reply when nothing else worked; it is never the service key or the response body
 * verbatim. */
const storeMessage = async (row: Row): Promise<{ id: string; error: string }> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { id: '', error: 'the function has no SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/support_messages`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        /* return=representation is what brings the id back, so the email outcome can be written onto
         * the row this call created and no other. */
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error('support_messages insert refused:', res.status, (await res.text()).slice(0, 300));
      return { id: '', error: `it could not be written down (HTTP ${res.status})` };
    }
    const stored = await res.json();
    const id = Array.isArray(stored) ? stored[0]?.id : stored?.id;
    if (!id) return { id: '', error: 'the database answered without a row' };
    return { id: String(id), error: '' };
  } catch (err) {
    console.error('support_messages insert failed:', err);
    return { id: '', error: 'it could not be written down' };
  }
};

/* Records what the email did. Failure here is not worth telling the visitor about - the message
 * itself is safely stored either way - but it is worth a log line, because it means the table no
 * longer says which messages were delivered. */
const recordEmail = async (id: string, emailed: boolean, emailError: string) => {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/support_messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ emailed, email_error: emailError || null }),
    });
    if (!res.ok) console.error('support_messages update refused:', res.status, (await res.text()).slice(0, 300));
  } catch (err) {
    console.error('support_messages update failed:', err);
  }
};

/* The email. `refused` is the short reason to keep on the row and, when nothing was stored, to show
 * the visitor; `sender` marks the one failure whose fix is a setting rather than a retry. */
const emailMessage = async (
  { name, email, subject, message, username }: Row,
): Promise<{ emailed: boolean; refused: string; sender: boolean }> => {
  if (!RESEND_API_KEY) {
    return {
      emailed: false,
      refused: 'no RESEND_API_KEY is set for this function',
      sender: false,
    };
  }

  const lines = [
    message,
    '',
    '---',
    `From: ${name || 'a visitor'}${username ? ` (@${username})` : ''}`,
    `Email: ${email}`,
    `Sent: ${new Date().toISOString()}`,
  ];

  try {
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SUPPORT_FROM,
        to: [SUPPORT_TO],
        /* So the owner can just hit reply, whatever name the visitor typed. */
        reply_to: email,
        subject: `[myPoleMagazine] ${subject || 'Support message'}`,
        text: lines.join('\n'),
      }),
    });

    if (sent.ok) return { emailed: true, refused: '', sender: false };

    const detail = (await sent.text()).slice(0, 300);
    console.error('Resend refused the message:', sent.status, detail);
    /* 403 is Resend saying this sender may not write to that address, which is a setup problem with
     * a specific fix, so it is told apart from a general failure. */
    const sender = sent.status === 403;
    return {
      emailed: false,
      sender,
      refused: sender
        ? 'Resend refused this sender. It only sends from onboarding@resend.dev to its own account address, so either use that address or verify your own domain and set SUPPORT_FROM.'
        : `Resend answered HTTP ${sent.status}`,
    };
  } catch (err) {
    console.error('Resend could not be reached:', err);
    return { emailed: false, refused: 'Resend could not be reached', sender: false };
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Send this as a POST.' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'That message could not be read.' }, 400);
  }

  /* A field no human ever sees, let alone fills. A bot that fills every input gives itself away; it
   * gets a cheerful 200 so it has no signal to retune against. Checked before the row is written, so
   * spam never reaches the table the admin has to read. */
  if (clean(body.website, 100)) return json({ ok: true, stored: false, emailed: false });

  const message = clean(body.message, 4000);
  const email = clean(body.email, 160);
  const name = clean(body.name, 80);
  const subject = clean(body.subject, 120);
  const username = clean(body.username, 60);

  if (!looksLikeEmail(email)) return json({ error: 'That email address does not look right.' }, 400);
  if (message.length < 10) return json({ error: 'Please add a little more detail so we can help.' }, 400);

  const row: Row = {
    name: name || null,
    email,
    subject: subject || null,
    message,
    username: username || null,
  };

  /* Written down first. Whatever the email does after this, the message is somewhere a person can
   * read it. */
  const stored = await storeMessage(row);
  const mail = await emailMessage(row);
  if (stored.id) await recordEmail(stored.id, mail.emailed, mail.refused);

  /* Either half is a delivery. Stored means the admin will see it in the app, emailed means it is in
   * the owner's mailbox - and the visitor is told nothing about the machinery beyond that. */
  if (stored.id || mail.emailed) {
    return json({
      ok: true,
      stored: Boolean(stored.id),
      emailed: mail.emailed,
      note: mail.emailed
        ? ''
        : 'The message is saved for the team, but email delivery is not working just now.',
    });
  }

  /* Neither worked, so say so plainly: nothing was received and the visitor should try again. The
   * one failure worth naming is a sender Resend will never accept, because no amount of retrying
   * will fix it. */
  return json({
    error: mail.sender
      ? 'The email service refused this sender. Resend only sends from onboarding@resend.dev to its '
        + 'own account address, so either use that address or verify your own domain and set SUPPORT_FROM.'
      : `Nothing was received just now: ${mail.refused}, and ${stored.error}. Please try again in a `
        + 'little while.',
  }, 500);
});
