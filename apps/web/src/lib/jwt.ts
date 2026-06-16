/** Access-token claims the backend signs (`{ sub, role }` + standard times). */
export interface JwtClaims {
  sub: number
  role: string
  iat?: number
  exp?: number
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  // Handle UTF-8 payloads.
  return decodeURIComponent(
    json
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  )
}

/** Decode a JWT payload without verifying the signature (claims are read-only
 *  hints; the server re-verifies on every request). Returns null if malformed. */
export function decodeJwt(token: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const claims = JSON.parse(base64UrlDecode(parts[1])) as JwtClaims
    if (typeof claims.sub !== 'number' || typeof claims.role !== 'string') {
      return null
    }
    return claims
  } catch {
    return null
  }
}
