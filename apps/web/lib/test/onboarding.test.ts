import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  dismissOnboarding,
  faucetLinkEnabled,
  ONBOARDING_KEY,
  OPEN_FAUCET_EVENT,
  onboardingCopy,
  requestFaucet,
  shouldShowOnboarding,
  stepText,
} from '../onboarding.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

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
    const all = c.steps.map(stepText).join(' ');
    for (const word of [/devnet/, /faucet/, /Changuito/, /escrow/, /Día/]) assert.match(all, word);
  });

  it('is the short copy, in both languages', () => {
    assert.deepEqual(
      { ...onboardingCopy('es'), steps: onboardingCopy('es').steps.map(stepText) },
      {
        title: 'Así funciona la beta',
        steps: [
          'Estamos en devnet.',
          'Iniciá sesión y cargá USDC gratis en el faucet.',
          'Pedile a Changuito lo que necesitás.',
          'Pagás y tus USDC quedan en un escrow.',
          'Changuito compra en Día y libera el pago.',
        ],
        note: 'Si algo falla, tus USDC vuelven solos.',
        dismiss: 'Dale, empecemos',
      },
    );
    assert.deepEqual(
      { ...onboardingCopy('en'), steps: onboardingCopy('en').steps.map(stepText) },
      {
        title: 'How the beta works',
        steps: [
          "We're on devnet.",
          'Sign in and get free USDC from the faucet.',
          'Ask Changuito for what you need.',
          'You pay and your USDC sits in an escrow.',
          'Changuito buys at Día and releases the payment.',
        ],
        note: 'If something fails, your USDC comes back on its own.',
        dismiss: "OK, let's go",
      },
    );
  });

  it('keeps every line short enough for a phone', () => {
    for (const lang of ['es', 'en'] as const) {
      const c = onboardingCopy(lang);
      for (const line of [c.title, ...c.steps.map(stepText), c.note]) assert.ok(line.length <= 60, `${lang}: "${line}"`);
    }
  });

  it('splits step 2 around the word "faucet", which is the only linkable part', () => {
    for (const lang of ['es', 'en'] as const) {
      const steps = onboardingCopy(lang).steps;
      const step = steps[1];
      assert.equal(typeof step, 'object');
      assert.equal(step.link, 'faucet');
      assert.ok(step.before.endsWith(' ') && step.after === '.');
      assert.ok(steps.every((s, i) => i === 1 || typeof s === 'string'), 'no other step carries a link');
    }
  });

  it('links "faucet" only when signed in', () => {
    assert.equal(faucetLinkEnabled({ address: null }), false);
    assert.equal(faucetLinkEnabled({ address: '' }), false);
    assert.equal(faucetLinkEnabled({ address: '9rYNexampleWallet' }), true);
  });

  it('the link asks for the faucet with a window event, and nothing else', () => {
    const target = new EventTarget();
    const seen: Event[] = [];
    target.addEventListener(OPEN_FAUCET_EVENT, (e) => void seen.push(e));
    requestFaucet(target);
    assert.equal(seen.length, 1);
    assert.equal(OPEN_FAUCET_EVENT, 'changuito:open-faucet');
    assert.equal((seen[0] as CustomEvent).detail, null, 'carries no address or destination');
    assert.doesNotThrow(() => requestFaucet(null));
  });

  it('renders the link signed in, plain text signed out, and never dismisses or logs in from it', () => {
    const comp = read('../../components/BetaOnboarding.tsx');
    assert.match(comp, /faucetLinkEnabled\(useWallet\(\)\)/);
    // The link is a real, focusable button; the signed-out branch is the bare word.
    assert.match(comp, /linked \? \(\s*<button\s+type="button"\s+className="onb-link"/);
    assert.match(comp, /\) : \(\s*step\.link\s*\)/);
    const faucetText = comp.slice(comp.indexOf('function FaucetText'));
    assert.match(faucetText, /onClick=\{\(\) => requestFaucet\(window\)\}/);
    assert.doesNotMatch(faucetText, /dismissOnboarding|setShow|login/);
  });

  it('the top bar opens the existing FaucetConfirm on the event, only with a wallet', () => {
    const widget = read('../../components/WalletWidget.tsx');
    const listener = widget.slice(widget.indexOf('OPEN_FAUCET_EVENT, open') - 400, widget.indexOf('OPEN_FAUCET_EVENT, open'));
    assert.match(listener, /if \(!address \|\| funding\) return;/);
    assert.match(listener, /setConfirming\(true\)/);
    assert.doesNotMatch(listener, /login/);
    // The fund button itself only exists in the signed-in branch, after the `!address` early return.
    const signedOut = widget.indexOf('if (!address) {');
    assert.ok(signedOut > 0 && widget.indexOf('data-testid="wallet-fund"') > signedOut);
    assert.doesNotMatch(widget.slice(signedOut, widget.indexOf('\n  }\n', signedOut)), /wallet-fund|setConfirming/);
  });

  it('the faucet confirm asks for no address and the client posts none', () => {
    assert.doesNotMatch(read('../../components/FaucetConfirm.tsx'), /<input|<select|<textarea|address/i);
    const widget = read('../../components/WalletWidget.tsx');
    const call = widget.match(/fetchAs\([^\n]*'\/api\/faucet'[^\n]*\)/)?.[0];
    assert.ok(call, 'the faucet call is found');
    assert.match(call, /\{ method: 'POST' \}\)$/);
    assert.doesNotMatch(call, /body/);
  });

  it('is inline, not a modal, so it never covers the login button', () => {
    const comp = readFileSync(new URL('../../components/BetaOnboarding.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(comp, /aria-modal|modal-backdrop/);
  });
});
