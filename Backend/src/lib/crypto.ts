export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function secureRandomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cloudflare Workers' WebCrypto rejects PBKDF2 iteration counts above 100000.
 * Keep this at the ceiling the runtime allows.
 */
const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password + salt),
    { name: 'PBKDF2', hash: 'SHA-256' },
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );

  return {
    salt,
    hash: Array.from(new Uint8Array(derivedBits))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  };
}

export async function verifyPassword(password: string, salt: string, candidateHash: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password + salt),
    { name: 'PBKDF2', hash: 'SHA-256' },
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );

  const hash = Array.from(new Uint8Array(derivedBits))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return hash === candidateHash;
}
