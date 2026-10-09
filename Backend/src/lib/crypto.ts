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

/** HMAC-SHA256 as hex — used to sign server-set identities (visitor cookie). */
export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison: `===` short-circuits on the first differing
 * byte, which leaks how many leading characters matched. The length check is
 * unavoidable but reveals nothing useful for fixed-width hex signatures.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
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

  return timingSafeEqualString(hash, candidateHash);
}
