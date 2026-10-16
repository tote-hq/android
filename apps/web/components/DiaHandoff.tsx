'use client';

import { useState } from 'react';

import type { EscrowCopy } from '../lib/checkout/copy.ts';

/**
 * The hand-off: Changuito built the cart, the shopper finishes it at Día.
 *
 * Día's checkout asks for a reCAPTCHA that our cloud browser cannot (and
 * should not) solve, and a person passes in a click. So this says plainly who
 * does the last step, lists what is in the basket, and gives two ways to get
 * it there: the cart link, or the list on the clipboard when there is no link
 * or the link opens an empty cart on another device.
 */
export function DiaHandoff({
  copy,
  url,
  lines,
  total,
  onOpen,
}: {
  copy: EscrowCopy;
  url: string | null;
  lines: { name: string; quantity: number }[];
  total: string;
  /** Fires on the link click; the caller tracks `dia_handoff`. */
  onOpen: (via: 'link' | 'copy') => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyList() {
    try {
      await navigator.clipboard.writeText(copy.handoffText(lines, total));
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
      onOpen('copy');
    } catch {
      // No clipboard (permission, insecure context): the list is on screen and selectable.
    }
  }

  return (
    <div className="ck-handoff" data-testid="checkout-handoff-block">
      <h3 className="ck-title">{copy.handoffTitle}</h3>
      <ol className="ck-handoff-steps">
        {copy.handoffSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="ck-note">{copy.handoffWhy}</p>
      {lines.length > 0 ? (
        <div className="ck-handoff-list">
          <p className="ck-note">{copy.handoffListLabel}</p>
          <ul data-testid="checkout-handoff-lines">
            {lines.map((l, i) => (
              <li key={`${i}-${l.name}`}>
                {l.quantity} × {l.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {url ? null : <p className="ck-note">{copy.handoffNoLink}</p>}
      <div className="modal-actions">
        {lines.length > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => void copyList()} data-testid="checkout-handoff-copy">
            {copied ? copy.handoffCopied : copy.handoffCopy}
          </button>
        ) : null}
        {url ? (
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer" data-testid="checkout-handoff" onClick={() => onOpen('link')}>
            {copy.handoffCta} ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
