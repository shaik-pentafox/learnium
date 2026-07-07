/** Default persona accent (indigo) when none is configured. */
export const DEFAULT_PERSONA_COLOR = '#6366f1'

/** Curated brand accents offered as quick-pick swatches in the color picker. */
export const PERSONA_SWATCHES = [
  '#6366f1', // indigo (brand)
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#14b8a6', // teal
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#ec4899', // pink
  '#ef4444', // red
  '#64748b', // slate
] as const

export function isHexColor(value?: string | null): value is string {
  return !!value && /^#[0-9a-fA-F]{6}$/.test(value)
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** Mix a hex color toward white by `amount` (0–1). */
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mix = (c: number) => clampByte(c + (255 - c) * amount)
  const to2 = (c: number) => c.toString(16).padStart(2, '0')
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`
}

/** Two-stop gradient [base, lighter] for the orb, from one persona color. */
export function personaOrbColors(color?: string | null): [string, string] {
  const base = isHexColor(color) ? color : DEFAULT_PERSONA_COLOR
  return [base, lighten(base, 0.3)]
}
