'use client';

import { useEffect, useState } from 'react';

import { dismissOnboarding, onboardingCopy, shouldShowOnboarding } from '../lib/onboarding.ts';
import { useLang } from './LangProvider';

/** First-visit beta explainer. See lib/onboarding.ts for why it is inline. */
export function BetaOnboarding() {
  const copy = onboardingCopy(useLang());
  // Decided after mount: the server has no localStorage, and rendering it on
  // the server would flash it for returning testers.
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(shouldShowOnboarding(typeof window === 'undefined' ? null : window.localStorage));
  }, []);

  if (!show) return null;
  return (
    <section className="onb" aria-label={copy.title} data-testid="beta-onboarding">
      <h2 className="onb-title">{copy.title}</h2>
      <ol className="onb-steps">
        {copy.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="onb-note">{copy.note}</p>
      <div className="onb-actions">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="beta-onboarding-dismiss"
          onClick={() => {
            dismissOnboarding(window.localStorage);
            setShow(false);
          }}
        >
          {copy.dismiss}
        </button>
      </div>
    </section>
  );
}
