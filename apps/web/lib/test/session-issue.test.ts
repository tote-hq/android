import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HUMAN_COOKIE, mintHumanToken } from '../human-gate.ts';
import { issueUserSession } from '../session-issue.ts';

/**
 * POST /api/session/login. The QA finding (audit C2): any address the
 * browser named got a 30-day `chg_user`, which skips the guest limits.
 *
 * Solana build: the browser sends a Privy access token and the server reads
 * the wallet from Privy. These cases cover every path that refuses before
 * Privy is asked, so they need no network. Verifying a real token against
 * Privy's JWKS is left to E2E.
 */

const TURNSTILE = 'turnstile-test-secret';
const SESSION = 'session-test-secret';
const now = Date.now();
const ADDRESS = 'So1anaTestAddress1111111111111111111111111';

const env = {
  NODE_ENV: 'production',
  TURNSTILE_SECRET_KEY: TURNSTILE,
  CHG_SESSION_SECRET: SESSION,
} as NodeJS.ProcessEnv;

async function post(body: unknown, { human = true, raw = false } = {}): Promise<Request> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (human) headers.cookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(TURNSTILE))}`;
  return new Request('https://app.changuito.me/api/session/login', {
    method: 'POST',
    headers,
    body: raw ? String(body) : JSON.stringify(body),
  });
}

const noCookie = (r: Response) => assert.equal(r.headers.get('set-cookie'), null);

describe('issueUserSession', () => {
  it('RULE: an address alone never gets a session', async () => {
    const r = await issueUserSession(await post({ address: ADDRESS }), env, now);
    assert.equal(r.status, 401);
    assert.equal(((await r.json()) as { error: string }).error, 'session_proof_required');
    noCookie(r);
  });

  it('refuses an empty token', async () => {
    const r = await issueUserSession(await post({ token: '   ' }), env, now);
    assert.equal(r.status, 401);
    noCookie(r);
  });

  it('refuses a body that is not JSON', async () => {
    const r = await issueUserSession(await post('not json', { raw: true }), env, now);
    assert.equal(r.status, 400);
    noCookie(r);
  });

  it('RULE: refuses to sign anything when the session secret is missing', async () => {
    const noSecret = { ...env, CHG_SESSION_SECRET: '' } as NodeJS.ProcessEnv;
    const r = await issueUserSession(await post({ token: 'x' }), noSecret, now);
    assert.equal(r.status, 503);
    noCookie(r);
  });

  it('RULE: the human gate runs first', async () => {
    const r = await issueUserSession(await post({ token: 'x' }, { human: false }), env, now);
    assert.notEqual(r.status, 200);
    noCookie(r);
  });
});
