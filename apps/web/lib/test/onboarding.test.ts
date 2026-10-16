import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { dismissOnboarding, ONBOARDING_KEY, onboardingCopy, shouldShowOnboarding } from '../onboarding.ts';

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('beta onboarding', () => {
  it('shows once, then stays dismissed', () => {
    const s = mem();
    assert.equal(shouldShowOnboarding(s), true);
    dismissOnboarding(s);
    assert.ok(s.getItem(ONBOARDING_KEY));
    assert.equal(shouldShowOnboarding(s), false);
  });

  it('does not nag when storage is missing or throws', () => {
    assert.equal(shouldShowOnboarding(null), false);
    const broken = { getItem: () => { throw new Error('denied'); } };
    assert.equal(shouldShowOnboarding(broken), false);
    assert.doesNotThrow(() => dismissOnboarding({ setItem: () => { throw new Error('denied'); } }));
  });

  it('covers devnet, faucet, cart, escrow and Día, in Spanish', () => {
    const c = onboardingCopy('es');
    assert.equal(c.steps.length, 5);
    const all = c.steps.join(' ');
    for (const word of [/devnet/, /faucet/, /changuito/, /escrow/, /Día/]) assert.match(all, word);
  });

  it('is inline, not a modal, so it never covers the login button', () => {
    const comp = readFileSync(new URL('../../components/BetaOnboarding.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(comp, /aria-modal|modal-backdrop/);
  });
});
