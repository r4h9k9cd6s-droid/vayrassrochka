import { and, eq } from 'drizzle-orm';
import type { Ctx } from './context.js';
import { schema } from './db/index.js';
import { newId, normalizeName, normalizePhone } from './security.js';

export interface SellerInput {
  type: 'shop' | 'person';
  name?: string;
  address?: string;
  phone?: string;
}

/** Для частного лица в публичном виде имя сокращается: «Магомед Иванов» → «Магомед И.». */
export function shortenPersonName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[1]![0]!.toUpperCase()}.`;
}

export const hasSellerData = (s: SellerInput) =>
  Boolean((s.name ?? '').trim() || (s.address ?? '').trim() || normalizePhone(s.phone ?? ''));

/** Находит продавца в справочнике (имя без учёта регистра/пробелов или телефон в любом формате) либо создаёт. */
export async function findOrCreateSeller(ctx: Ctx, s: SellerInput): Promise<string> {
  const phone = normalizePhone(s.phone ?? '');
  const rawName = (s.name ?? '').trim();
  const name = s.type === 'person' ? shortenPersonName(rawName) : rawName;
  const nameNorm = normalizeName(name);
  if (phone) {
    const [hit] = await ctx.db
      .select()
      .from(schema.sellers)
      .where(and(eq(schema.sellers.phone, phone), eq(schema.sellers.type, s.type)));
    if (hit) return hit.id;
  }
  if (nameNorm) {
    const [hit] = await ctx.db
      .select()
      .from(schema.sellers)
      .where(and(eq(schema.sellers.nameNorm, nameNorm), eq(schema.sellers.type, s.type)));
    if (hit && (!phone || !hit.phone)) return hit.id;
  }
  const id = newId();
  await ctx.db.insert(schema.sellers).values({
    id,
    type: s.type,
    name,
    nameNorm,
    address: (s.address ?? '').trim(),
    phone,
  });
  return id;
}
