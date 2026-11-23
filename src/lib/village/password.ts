/* Node-only primitive; not connected to any route or database. Rate limiting,
 * session issuance and access control remain mandatory before use. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, OPTIONS, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_PASSWORD_BYTES = 1024;
// Fixed parameters prevent a corrupted stored record from choosing expensive KDF settings.
const OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const FORMAT = /^scrypt-v1\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length > 0 && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
}

export async function hashRoomPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error('Invalid room password');
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** False for invalid records; storage failures must not be converted to access. */
export async function verifyRoomPassword(password: unknown, record: unknown): Promise<boolean> {
  if (!validPassword(password) || typeof record !== 'string') return false;
  const parsed = FORMAT.exec(record);
  if (!parsed) return false;
  const salt = Buffer.from(parsed[1], 'hex');
  const expected = Buffer.from(parsed[2], 'hex');
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}
