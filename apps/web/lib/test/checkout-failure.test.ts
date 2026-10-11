import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { openFailureMessage, refundReason } from '../checkout/failure.ts';
import { topUpFor } from '../checkout/open-tx.ts';

/** The simulation that failed on production: the buyer could pay the order's rent but not the vault's. */
const RENT_FAILURE = Object.assign(new Error('Transaction simulation failed'), {
  context: {
    logs: [
      'Program log: Instruction: Open',
      'Transfer: insufficient lamports 1130320, need 1488440',
      'Program 11111111111111111111111111111111 failed: custom program error: 0x1',
    ],
  },
});

describe('the rent top-up on open', () => {
  const NEED = 1_524_000n + 1_488_440n; // order account + vault, devnet rent

  it('tops up a wallet short of rent, by the shortfall plus a margin', () => {
    const top = topUpFor(1_130_320n, NEED);
    assert.ok(top > NEED - 1_130_320n);
    assert.ok(1_130_320n + top >= NEED);
  });

  it('sends nothing to a wallet that can already pay', () => {
    assert.equal(topUpFor(NEED, NEED), 0n);
    assert.equal(topUpFor(10_000_000n, NEED), 0n);
  });
});

describe('why open failed', () => {
  it('names missing SOL rather than "something failed"', () => {
    assert.match(openFailureMessage(RENT_FAILURE), /SOL/);
  });

  it('finds the log in a nested cause too', () => {
    assert.match(openFailureMessage(new Error('send failed', { cause: RENT_FAILURE })), /SOL/);
  });

  it('says the signature expired when the blockhash did', () => {
    assert.match(openFailureMessage(new Error('Blockhash not found')), /venció/);
  });

  it('falls back to the old sentence for anything else', () => {
    assert.equal(openFailureMessage(new Error('boom')), 'No pudimos bloquear el pago. Probá de nuevo.');
  });
});

describe('why a purchase refunded', () => {
  it('names the reCAPTCHA Día asks for', () => {
    const r = refundReason({
      status: 'done',
      payment: 'error',
      detail: 'the store refused to start the payment (3× 403 on /transaction)',
      phase: 'payment',
    });
    assert.match(r, /reCAPTCHA/);
  });

  it('says the card was declined without repeating the store\'s text', () => {
    const r = refundReason({ status: 'done', payment: 'declined', detail: 'Tarjeta rechazada por el emisor 51' });
    assert.equal(r, 'Día rechazó el pago con tarjeta.');
  });

  it('says where a run that never reached payment stopped', () => {
    assert.match(refundReason({ status: 'failed', payment: 'not_attempted', phase: 'login' }), /entrar a tu cuenta/);
  });

  it('says there is no card when the job carried none', () => {
    const r = refundReason({ status: 'done', payment: 'not_attempted', detail: 'the job carried no card (shared_card has no row?)' });
    assert.match(r, /tarjeta configurada/);
  });
});
