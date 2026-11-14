import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeInstallment, computePot, type InstallmentState } from '@vayrassrochka/shared';
import { requireUser, type User } from '../auth.js';
import { todayFor, type Ctx } from '../context.js';
import { schema } from '../db/index.js';
import { toJournal, toParams } from './installments.js';
import { potParams } from './pots.js';

export interface Upcoming {
  source: 'installment' | 'pot';
  id: string;
  title: string;
  icon: string;
  dueDate: string;
  amount: number;
  overdue: boolean;
}

/** Сводка по всем личным обязательствам пользователя на дату today. */
export async function buildHome(ctx: Ctx, u: User, today: string) {
  const month = today.slice(0, 7);
  const insts = await ctx.db.select().from(schema.installments).where(eq(schema.installments.userId, u.id));
  const pots = await ctx.db.select().from(schema.pots).where(eq(schema.pots.userId, u.id));

  let instPaid = 0, instLeft = 0, potPaid = 0, potLeft = 0, overdueTotal = 0;
  const upcoming: Upcoming[] = [];
  const attention: { kind: string; [k: string]: unknown }[] = [];
  const states = new Map<string, InstallmentState>();
  let instRemaining = 0;

  for (const i of insts) {
    const ev = await ctx.db.select().from(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, i.id));
    const st = computeInstallment(toParams(i), toJournal(ev), today);
    states.set(i.id, st);
    instRemaining += st.remaining;
    for (const seg of st.segments) {
      const inMonth = seg.dueDate.startsWith(month);
      if (seg.status === 'paid' && inMonth) instPaid += seg.paid;
      if (seg.status === 'overdue') {
        overdueTotal += seg.amount;
        instLeft += seg.amount;
        upcoming.push({ source: 'installment', id: i.id, title: i.title, icon: i.icon, dueDate: seg.dueDate, amount: seg.amount, overdue: true });
      } else if (seg.status === 'upcoming') {
        if (inMonth) instLeft += seg.amount;
        upcoming.push({ source: 'installment', id: i.id, title: i.title, icon: i.icon, dueDate: seg.dueDate, amount: seg.amount, overdue: false });
      }
    }
    // «Не удалось связаться» — просьба проверить продавца
    if (i.published) {
      const reports = await ctx.db.select().from(schema.contactReports).where(eq(schema.contactReports.installmentId, i.id));
      const no = reports.filter((r) => r.result === 'no').length;
      if (no > 0) attention.push({ kind: 'check_seller', installmentId: i.id, title: i.title, count: no });
    }
  }

  for (const p of pots) {
    const pays = await ctx.db.select().from(schema.potPayments).where(eq(schema.potPayments.potId, p.id));
    const st = computePot(potParams(p, pays.map((x) => x.month)), today);
    for (const c of st.contributions) {
      const inMonth = c.dueDate.startsWith(month);
      if (c.status === 'paid' && inMonth) potPaid += c.amount;
      if (c.status === 'overdue') {
        overdueTotal += c.amount;
        potLeft += c.amount;
        upcoming.push({ source: 'pot', id: p.id, title: p.name, icon: 'bag', dueDate: c.dueDate, amount: c.amount, overdue: true });
      } else if (c.status === 'next' || c.status === 'upcoming') {
        if (inMonth) potLeft += c.amount;
        upcoming.push({ source: 'pot', id: p.id, title: p.name, icon: 'bag', dueDate: c.dueDate, amount: c.amount, overdue: false });
      }
    }
  }

  upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueItems = upcoming.filter((x) => x.overdue);
  const nearest = upcoming.find((x) => !x.overdue) ?? null;

  const out: { kind: string; [k: string]: unknown }[] = [];
  for (const o of overdueItems) out.push({ kind: 'overdue', ...o });
  if (nearest) out.push({ kind: 'next_payment', ...nearest });
  out.push(...attention);
  if (!u.backupCodeAcked) out.push({ kind: 'backup_code' });

  const receive = [];
  for (const p of pots) {
    if (p.received) continue;
    const pays = await ctx.db.select().from(schema.potPayments).where(eq(schema.potPayments.potId, p.id));
    const st = computePot(potParams(p, pays.map((x) => x.month)), today);
    receive.push({ potId: p.id, name: p.name, month: st.receive.month, dueDate: st.receive.dueDate, amount: st.receive.amount });
  }
  receive.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const total = instPaid + instLeft + potPaid + potLeft;
  return {
    month,
    summary: {
      total,
      paid: instPaid + potPaid,
      left: instLeft + potLeft,
      installments: { paid: instPaid, left: instLeft },
      pots: { paid: potPaid, left: potLeft },
      overdue: overdueTotal,
    },
    installmentsRemaining: instRemaining,
    attention: out,
    upcoming: upcoming.filter((x) => !x.overdue).slice(0, 6),
    receive: receive.slice(0, 3),
  };
}

export function homeRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/home', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    return buildHome(ctx, u, todayFor(ctx, u.timezoneOffsetMin));
  });
}
