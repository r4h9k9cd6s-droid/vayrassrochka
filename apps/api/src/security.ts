import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const newId = () => randomUUID();
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export const hashSecret = (plain: string) => hash(plain);
export async function verifySecret(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// Без похожих символов: нет 0/O, 1/I/L.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Резервный код: 12 знаков группами по 4, например «K7MD-92QX-TH4B». */
export function generateBackupCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const hashBackupCode = (code: string) => hashSecret(normalizeBackupCode(code));
export const verifyBackupCode = (hashed: string, code: string) => verifySecret(hashed, normalizeBackupCode(code));

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Телефон → 7XXXXXXXXXX (для сравнения и ссылки WhatsApp). Пустая строка, если это не телефон. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) return '7' + digits.slice(1);
  if (digits.length === 10) return '7' + digits;
  return '';
}

export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}
