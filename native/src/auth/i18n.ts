export type Lang = 'es' | 'en'

const es = {
  appName: 'Changuito',
  signedOutLead: 'Ingresá con la cuenta de este teléfono para armar la compra.',
  signIn: 'Ingresar',
  signingIn: 'Esperando la cuenta…',
  statusConnecting: 'Abriendo la cuenta del teléfono…',
  statusChallenge: 'Preparando la firma…',
  statusSigning: 'Confirmá la firma en la cuenta.',
  statusFinishing: 'Guardando el ingreso…',
  homeLead: 'La cuenta quedó conectada.',
  accountHeading: 'Cuenta',
  disconnect: 'Salir',
  disconnecting: 'Saliendo…',
  networkLabel: 'Red de prueba (devnet)',
  languageToEnglish: 'Cambiar a inglés',
  languageToSpanish: 'Cambiar a español',
  themeLight: 'Tema claro',
  themeDark: 'Tema oscuro',
  errorCancelled: 'Cancelaste el ingreso. Podés intentar de nuevo cuando quieras.',
  errorMissing: 'No encontramos una cuenta en este teléfono. Abrila y probá de nuevo.',
  errorIdentity: 'La app no pudo presentarse a la cuenta. Probá de nuevo.',
  errorAssociation: 'La cuenta se abrió, pero la conexión no se completó. Probá de nuevo.',
  errorHuman: 'El sitio pidió una verificación que esta app todavía no puede completar.',
  errorNetwork: 'No hay conexión con Changuito. Revisá internet y probá de nuevo.',
  errorProof: 'No pudimos confirmar la firma. Intentá de nuevo.',
  errorUnconfigured: 'El ingreso no está disponible ahora. Probá más tarde.',
  errorInvalidAddress: 'La cuenta no devolvió una dirección válida.',
  errorEmptySignature: 'La cuenta no devolvió una firma. Intentá de nuevo.',
  errorCookie: 'El sitio no dejó guardado el ingreso en esta app. Probá de nuevo.',
  errorUnknown: 'No se pudo completar el ingreso. Probá de nuevo.',
} as const

const en: Record<keyof typeof es, string> = {
  appName: 'Changuito',
  signedOutLead: 'Sign in with the account on this phone to start a shop.',
  signIn: 'Sign in',
  signingIn: 'Waiting for the account…',
  statusConnecting: 'Opening the account on this phone…',
  statusChallenge: 'Preparing the signature…',
  statusSigning: 'Confirm the signature in the account.',
  statusFinishing: 'Saving sign-in…',
  homeLead: 'The account is connected.',
  accountHeading: 'Account',
  disconnect: 'Sign out',
  disconnecting: 'Signing out…',
  networkLabel: 'Test network (devnet)',
  languageToEnglish: 'Switch to English',
  languageToSpanish: 'Switch to Spanish',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
  errorCancelled: 'You cancelled sign-in. You can try again whenever you want.',
  errorMissing: 'We could not find an account on this phone. Open it and try again.',
  errorIdentity: 'The app could not introduce itself to the account. Try again.',
  errorAssociation: 'The account opened, but the connection did not finish. Try again.',
  errorHuman: 'The site asked for a check this app cannot complete yet.',
  errorNetwork: 'Changuito could not be reached. Check the connection and try again.',
  errorProof: 'We could not confirm the signature. Try again.',
  errorUnconfigured: 'Sign-in is not available right now. Try again later.',
  errorInvalidAddress: 'The account did not return a valid address.',
  errorEmptySignature: 'The account did not return a signature. Try again.',
  errorCookie: 'The site did not keep this sign-in on the app. Try again.',
  errorUnknown: 'Sign-in could not be completed. Try again.',
}

export type CopyKey = keyof typeof es

export const copy: Record<Lang, Record<CopyKey, string>> = { es, en }

export function deviceLanguage(languageCode: string | null | undefined): Lang {
  return languageCode === 'en' ? 'en' : 'es'
}
