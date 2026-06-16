import { describe, it, expect } from 'vitest'
import { decodeJwt } from '@/lib/jwt'

function makeToken(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('decodeJwt', () => {
  it('extracts sub and role from a valid token', () => {
    const token = makeToken({ sub: 42, role: 'TRAINER', exp: 9999999999 })
    expect(decodeJwt(token)).toMatchObject({ sub: 42, role: 'TRAINER' })
  })

  it('returns null for a malformed token', () => {
    expect(decodeJwt('not.a.jwt.at.all')).toBeNull()
    expect(decodeJwt('onlyonesegment')).toBeNull()
  })

  it('returns null when required claims are missing or wrong-typed', () => {
    expect(decodeJwt(makeToken({ role: 'USER' }))).toBeNull()
    expect(decodeJwt(makeToken({ sub: '1', role: 'USER' }))).toBeNull()
  })
})
