import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/** Derive a fixed 32-byte key from an arbitrary-length secret. */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypt plaintext → "iv:tag:ciphertext" (all hex).
 * Random IV per call. GCM auth tag bound to ciphertext.
 */
export function encryptSecret(plain: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt "iv:tag:ciphertext" → plaintext.
 * Throws if format invalid or auth tag mismatch (tamper / wrong key).
 */
export function decryptSecret(encoded: string, secret: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted secret');
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];

  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
