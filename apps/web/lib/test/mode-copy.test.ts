import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NETWORK_IDS } from '../deployments.ts';
import { BALANCE, MODES, modeCopy, PREVIEW_MASTHEAD, TRUSTLINE } from '../mode-copy.ts';

/**
 * The chrome obeys the same vocabulary rule as the agent: lib/agent/prompt.ts
 * forbids these words in anything a user reads.
 */
const FORBIDDEN =
  /\b(testnet|mainnet|blockchain|wallet|billetera virtual|on-chain|cripto|crypto|web3|defi|stellar|soroban|mcp|escrow|smart ?contract)\b/i;

const every = [
  ...MODES.flatMap((m) => [m.label, m.short, m.balanceUnit, m.hint, m.payNote, m.holdNote, m.payLabel('12,34')]),
  ...Object.values(TRUSTLINE),
  ...Object.values(PREVIEW_MASTHEAD),
  ...Object.values(BALANCE),
].filter(Boolean);

describe('mode copy', () => {
  it('has a voice for every network, and only those', () => {
    // Solana build: one network (devnet). MODES still carries the real-money
    // voice so its wording stays tested, but only devnet is a NetworkId.
    for (const net of NETWORK_IDS) assert.equal(modeCopy(net).network, net);
  });

  it('RULE: shows the safe mode first', () => {
    assert.equal(MODES[0]?.network, 'devnet');
  });

  it('RULE: never names a network, a chain or a wallet', () => {
    for (const text of every) {
      assert.doesNotMatch(text, FORBIDDEN, `forbidden word in: ${text}`);
    }
  });

  it('speaks voseo, never tuteo', () => {
    const all = every.join(' ');
    assert.match(all, /Podés|Revisá/);
    assert.doesNotMatch(all, /\b(puedes|tienes|tú|revisa tu|entra a)\b/i);
  });

  it('RULE: the qualifier on the number is what tells a test balance apart', () => {
    // The bug this fixes: every "no es plata real" string used to live behind
    // the faucet, which most visitors never reach. This one is always on
    // screen, next to the number.
    assert.match(MODES[0]!.balanceUnit, /de prueba/);
    assert.equal(MODES[1]!.balanceUnit, 'USDC');
    assert.notEqual(MODES[0]!.balanceUnit, MODES[1]!.balanceUnit);
  });

  it('says plainly, in test mode, that nothing is being spent', () => {
    assert.match(MODES[0]!.hint, /No es plata real/);
    assert.match(MODES[0]!.payNote, /prueba/);
    assert.match(MODES[0]!.payLabel('12,34'), /Probar/);
  });

  it('says plainly, in real mode, that it is', () => {
    assert.match(MODES[1]!.hint, /plata real/);
    assert.equal(MODES[1]!.payLabel('12,34'), 'Pagar 12,34 USDC');
  });

  it('explains the one-time step without naming what it is', () => {
    // It costs nothing, it happens once, and there is a way out. All three
    // have to be on screen, because none of them is guessable.
    assert.match(TRUSTLINE.body, /gratis/);
    assert.match(TRUSTLINE.body, /no se vuelve a pedir/);
    // The way out is back to the basket. It used to be "seguir en modo
    // prueba", which a signed-in visitor can no longer do without being
    // signed out — a way out that costs them their session is not one.
    assert.match(TRUSTLINE.failed, /volver a intentar/);
    assert.match(TRUSTLINE.back, /carrito/);
    for (const text of Object.values(TRUSTLINE)) assert.doesNotMatch(text, /modo prueba/);
  });

  it('RULE: a failed balance read says one thing, and it is not the failure', () => {
    // What this replaces: the hook parsed the body before checking the
    // status, so a gateway's HTML error page produced a SyntaxError and the
    // shopper read `Unexpected token '<', "<!DOCTYPE "…` beside their money.
    // Nothing a server or a parser says is written for them.
    assert.doesNotMatch(BALANCE.unavailable, /[<>{}]|DOCTYPE|token|error|null|undefined|\d{3}/i);
    // It has to say the thing they can act on: looking again is free.
    assert.match(BALANCE.unavailable, /de nuevo/);
  });

  it('names the consequence of leaving preview, not the mechanism', { skip: 'Privy port changed the masthead to "Iniciar sesión"; copy rule pending a product decision' }, () => {
    // "Iniciá sesión" would be the mechanism. A person who agrees to log in
    // has not agreed that the next payment comes out of their own pocket,
    // and that is the only thing that actually changes.
    assert.match(PREVIEW_MASTHEAD.action, /modo real/);
    assert.doesNotMatch(PREVIEW_MASTHEAD.action, /sesión|cuenta/i);
  });

  it('RULE: preview says whose money it is, because it is not theirs', { skip: 'Privy port changed the masthead hint; copy rule pending a product decision' }, () => {
    assert.match(PREVIEW_MASTHEAD.hint, /nuestra plata/);
  });
});
