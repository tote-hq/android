export type ThemeName = 'light' | 'dark'

export type ThemeColors = {
  background: string
  text: string
  muted: string
  card: string
  gold: string
  onGold: string
  coral: string
  onCoral: string
  error: string
  border: string
  focus: string
}

export const themes: Record<ThemeName, ThemeColors> = {
  light: {
    background: '#FAFAF7',
    text: '#2A1A14',
    muted: '#5C463C',
    card: '#FFFFFF',
    gold: '#F4B942',
    onGold: '#2A1A14',
    coral: '#E07A5F',
    onCoral: '#2A1A14',
    error: '#8C2F1B',
    border: '#E7D7C8',
    focus: '#2A1A14',
  },
  dark: {
    background: '#1A1210',
    text: '#FAFAF7',
    muted: '#E4D5CC',
    card: '#2A1A14',
    gold: '#F4B942',
    onGold: '#2A1A14',
    coral: '#E07A5F',
    onCoral: '#2A1A14',
    error: '#FFB4A8',
    border: '#4A372E',
    focus: '#F4B942',
  },
}

/** Text that must clear WCAG AA (4.5:1) against the surface it sits on. */
export function themeTextPairs(theme: ThemeName): { fg: string; bg: string; name: string }[] {
  const c = themes[theme]
  return [
    { fg: c.text, bg: c.background, name: 'body' },
    { fg: c.muted, bg: c.background, name: 'muted' },
    { fg: c.text, bg: c.card, name: 'card' },
    { fg: c.muted, bg: c.card, name: 'card-muted' },
    { fg: c.onGold, bg: c.gold, name: 'gold-button' },
    { fg: c.onCoral, bg: c.coral, name: 'coral-button' },
    { fg: c.error, bg: c.background, name: 'error' },
    { fg: c.error, bg: c.card, name: 'error-on-card' },
  ]
}
