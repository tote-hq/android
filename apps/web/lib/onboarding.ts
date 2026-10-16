import type { Lang } from './lang.ts';

/**
 * The first-visit explainer for beta testers: what this is, and the five
 * things they will do. Shown once per browser, dismissed into localStorage.
 *
 * An inline card above the chat, not a modal: it must never cover the
 * "Iniciar sesión" button or the composer (the production smokes in e2e/ click
 * those on a fresh browser), and a tester who already knows can just ignore it.
 */
export const ONBOARDING_KEY = 'changuito:onboarding:v1';

export interface OnboardingCopy {
  title: string;
  steps: [string, string, string, string, string];
  note: string;
  dismiss: string;
}

const ES: OnboardingCopy = {
  title: '¡Hola! Así funciona la beta',
  steps: [
    'Todo corre en devnet, la red de prueba de Solana: no se usa plata de verdad.',
    'Iniciá sesión y cargá USDC de prueba desde el faucet. Es gratis.',
    'Contale a Changuito qué necesitás y armá tu changuito con él.',
    'Pagás con esos USDC, que quedan guardados en un escrow hasta que se resuelve la compra.',
    'El final lo hacés vos en Día: te pasamos el carrito listo y confirmás la compra ahí.',
  ],
  note: 'Si algo se traba, tus USDC no se pierden: vuelven solos a tu billetera.',
  dismiss: 'Dale, empecemos',
};

const EN: OnboardingCopy = {
  title: "Hi! Here's how the beta works",
  steps: [
    "Everything runs on devnet, Solana's test network: no real money involved.",
    'Sign in and get test USDC from the faucet. It is free.',
    'Tell Changuito what you need and build your basket together.',
    'You pay with that USDC, which sits in an escrow until the purchase is settled.',
    'You finish at Día: we hand you the ready cart and you confirm the purchase there.',
  ],
  note: "If something gets stuck, your USDC isn't lost: it goes back to your wallet on its own.",
  dismiss: "OK, let's go",
};

export function onboardingCopy(lang: Lang): OnboardingCopy {
  return lang === 'en' ? EN : ES;
}

/** True when the explainer should show. Any storage error means "don't nag". */
export function shouldShowOnboarding(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return Boolean(storage) && storage!.getItem(ONBOARDING_KEY) === null;
  } catch {
    return false;
  }
}

export function dismissOnboarding(storage: Pick<Storage, 'setItem'> | null | undefined): void {
  try {
    storage?.setItem(ONBOARDING_KEY, String(Date.now()));
  } catch {
    // Private mode: it shows again next visit, which is harmless.
  }
}
