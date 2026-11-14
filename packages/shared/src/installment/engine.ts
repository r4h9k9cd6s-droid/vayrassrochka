import { assertDate, compareDates, monthlyDate, type ISODate } from './dates';
import type {
  DueNow,
  InstallmentParams,
  InstallmentState,
  JournalEvent,
  OriginalSegment,
  RejectedEvent,
  Segment,
} from './types';

interface Slot {
  id: string;
  dueDate: ISODate;
  /** Плановая сумма при создании (для ширины полоски). */
  planned: number;
  /** Текущая требуемая сумма (может уменьшаться переплатой с конца). */
  required: number;
  paid: number;
  state: 'open' | 'closed' | 'skipped' | 'removed';
  added: boolean;
}

const MAX_TERM = 600;

function assertInt(value: number, name: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name}: ожидается целое число не меньше ${min}, получено ${value}`);
  }
}

export function validateParams(p: InstallmentParams): void {
  assertInt(p.cost, 'Стоимость', 1);
  assertInt(p.downPayment, 'Первый взнос', 0);
  if (p.downPayment > p.cost) throw new RangeError('Первый взнос больше стоимости');
  assertInt(p.termMonths, 'Срок', 1);
  if (p.termMonths > MAX_TERM) throw new RangeError('Срок слишком большой');
  if (p.monthlyPayment !== undefined) assertInt(p.monthlyPayment, 'Платёж в месяц', 1);
  assertDate(p.purchaseDate, 'Дата покупки');
  assertInt(p.paymentDay, 'День платежа', 1);
  if (p.paymentDay > 31) throw new RangeError('День платежа: от 1 до 31');
}

/** Обычный платёж по умолчанию: целая часть от (стоимость − взнос) ÷ срок. */
export function defaultMonthlyPayment(cost: number, downPayment: number, termMonths: number): number {
  return Math.floor((cost - downPayment) / termMonths);
}

/** Исходный график: обычные платежи, остаток округления — в последнем. */
export function buildOriginalSchedule(p: InstallmentParams): OriginalSegment[] {
  validateParams(p);
  const financed = p.cost - p.downPayment;
  if (financed === 0) return [];
  const regular = p.monthlyPayment ?? defaultMonthlyPayment(p.cost, p.downPayment, p.termMonths);
  if (regular < 1) {
    // Сумма меньше срока (например, 3 ₽ на 12 мес.): платим по 1 ₽, платежей меньше срока.
    return buildFromRegular(p, financed, 1, financed);
  }
  const count = p.monthlyPayment === undefined ? p.termMonths : Math.ceil(financed / regular);
  return buildFromRegular(p, financed, regular, count);
}

function buildFromRegular(p: InstallmentParams, financed: number, regular: number, count: number): OriginalSegment[] {
  const result: OriginalSegment[] = [];
  let left = financed;
  for (let i = 1; i <= count; i++) {
    const amount = i === count ? left : Math.min(regular, left);
    result.push({ id: `o${i}`, dueDate: monthlyDate(p.purchaseDate, i, p.paymentDay), amount });
    left -= amount;
  }
  return result;
}

/**
 * Главная функция: по параметрам рассрочки и журналу событий считает полоску и показатели.
 * Чистая и детерминированная: входные данные не меняются, результат зависит только от
 * параметров, журнала и даты `today`.
 */
export function computeInstallment(
  params: InstallmentParams,
  journal: readonly JournalEvent[],
  today: ISODate,
): InstallmentState {
  validateParams(params);
  assertDate(today, 'Сегодня');

  const originalSchedule = buildOriginalSchedule(params);
  const financed = params.cost - params.downPayment;
  const regular =
    params.monthlyPayment ?? Math.max(1, defaultMonthlyPayment(params.cost, params.downPayment, params.termMonths));

  const slots: Slot[] = originalSchedule.map((s) => ({
    id: s.id,
    dueDate: s.dueDate,
    planned: s.amount,
    required: s.amount,
    paid: 0,
    state: 'open',
    added: false,
  }));

  const rejected: RejectedEvent[] = [];
  let paymentsApplied = 0;
  let excessPayment = 0;
  let completedOn: ISODate | null = null;
  let addedCounter = 0;

  const open = () => slots.filter((s) => s.state === 'open');
  const remainingOf = (s: Slot) => s.required - s.paid;

  function appendSlot(amount: number): void {
    const last = [...slots].reverse().find((s) => s.state !== 'removed');
    const base = last ? last.dueDate : params.purchaseDate;
    const dueDate = monthlyDate(base, 1, params.paymentDay);
    addedCounter += 1;
    slots.push({ id: `x${addedCounter}`, dueDate, planned: amount, required: amount, paid: 0, state: 'open', added: true });
  }

  // Порядок: по дате, при равных датах — как записано в журнале.
  const events = journal
    .filter((e) => e.voidedAt === undefined)
    .map((e, index) => ({ e, index }))
    .sort((a, b) => compareDates(a.e.date, b.e.date) || a.index - b.index)
    .map((x) => x.e);

  for (const event of events) {
    assertDate(event.date, `Дата события ${event.id}`);
    const openSlots = open();
    const overdue = openSlots.filter((s) => compareDates(s.dueDate, event.date) < 0);
    const nearest = openSlots.find((s) => compareDates(s.dueDate, event.date) >= 0);

    if (event.type === 'payment') {
      if (!Number.isInteger(event.amount) || event.amount < 1) {
        rejected.push({ eventId: event.id, reason: 'invalid_amount' });
        continue;
      }
      if (openSlots.length === 0) {
        rejected.push({ eventId: event.id, reason: 'no_open_payments' });
        continue;
      }
      let left = event.amount;

      // 1. Сначала просрочка, начиная с самого старого платежа.
      for (const s of overdue) {
        if (left === 0) break;
        const take = Math.min(left, remainingOf(s));
        s.paid += take;
        left -= take;
        if (remainingOf(s) === 0) s.state = 'closed';
      }

      // 2. Затем ближайший платёж.
      if (left > 0 && nearest) {
        const need = remainingOf(nearest);
        if (left < need) {
          // Недоплата: месяц закрыт, недостающее — в конец графика.
          const shortfall = need - left;
          nearest.paid += left;
          nearest.state = 'closed';
          left = 0;
          const tail = open().filter((s) => s !== nearest);
          const last = tail[tail.length - 1];
          let rest = shortfall;
          if (last && last.required < regular) {
            const add = Math.min(rest, regular - last.required);
            last.required += add;
            rest -= add;
          }
          if (rest > 0) appendSlot(rest);
        } else {
          nearest.paid += need;
          nearest.state = 'closed';
          left -= need;
          // Переплата: уменьшаем график с конца.
          let used = 0;
          const tail = open().filter((s) => s !== nearest);
          for (let i = tail.length - 1; i >= 0 && left > 0; i--) {
            const s = tail[i]!;
            const r = remainingOf(s);
            if (r <= left) {
              s.state = 'removed';
              left -= r;
              used += r;
            } else {
              s.required -= left;
              used += left;
              left = 0;
            }
          }
          nearest.paid += used;
        }
      }

      excessPayment += left;
      paymentsApplied += event.amount - left;
      if (open().length === 0 && completedOn === null) completedOn = event.date;
    } else {
      // Пропуск по договорённости: только просроченный или ближайший.
      const candidates = nearest ? [...overdue, nearest] : overdue;
      if (candidates.length === 0) {
        rejected.push({ eventId: event.id, reason: 'skip_not_allowed' });
        continue;
      }
      let target = candidates[0]!;
      if (event.segmentId !== undefined) {
        const found = candidates.find((s) => s.id === event.segmentId);
        if (!found) {
          rejected.push({
            eventId: event.id,
            reason: slots.some((s) => s.id === event.segmentId) ? 'skip_not_allowed' : 'skip_target_not_found',
          });
          continue;
        }
        target = found;
      }
      const amount = remainingOf(target);
      target.state = 'skipped';
      appendSlot(amount);
    }
  }

  // Итоговое представление на дату `today`.
  const visible = slots.filter((s) => s.state !== 'removed');
  const segments: Segment[] = visible.map((s) => {
    if (s.state === 'closed') {
      return { id: s.id, dueDate: s.dueDate, status: 'paid', amount: s.paid, paid: s.paid, planned: s.planned, added: s.added };
    }
    const rem = remainingOf(s);
    const status = s.state === 'skipped' ? 'skipped' : compareDates(s.dueDate, today) < 0 ? 'overdue' : 'upcoming';
    return { id: s.id, dueDate: s.dueDate, status, amount: rem, paid: s.paid, planned: s.planned, added: s.added };
  });

  const overdueSegs = segments.filter((s) => s.status === 'overdue');
  const nextSeg = segments.find((s) => s.status === 'upcoming') ?? null;
  const overdueAmount = overdueSegs.reduce((sum, s) => sum + s.amount, 0);
  const nextAmount = nextSeg ? nextSeg.amount : 0;
  const dueNow: DueNow = {
    overdue: overdueAmount,
    next: nextAmount,
    total: overdueAmount + nextAmount,
    isOverdue: overdueAmount > 0,
  };

  const payable = segments.filter((s) => s.status === 'overdue' || s.status === 'upcoming');
  // Пропущенный платёж в остаток не входит: вместо него в конец добавлен такой же сегмент.
  const remaining = payable.reduce((sum, s) => sum + s.amount, 0);
  const originalEndDate = originalSchedule.length ? originalSchedule[originalSchedule.length - 1]!.dueDate : null;
  const lastPayable = payable[payable.length - 1];
  const estimatedEndDate = lastPayable ? lastPayable.dueDate : null;

  return {
    segments,
    originalSchedule,
    status: payable.length === 0 ? 'completed' : 'active',
    cost: params.cost,
    downPayment: params.downPayment,
    financed,
    totalPaid: params.downPayment + paymentsApplied,
    remaining,
    regularPayment: regular,
    nextPayment: nextSeg ? { segmentId: nextSeg.id, dueDate: nextSeg.dueDate, amount: nextSeg.amount } : null,
    overdueAmount,
    overdueCount: overdueSegs.length,
    dueNow,
    remainingPayments: payable.length,
    initialTermMonths: params.termMonths,
    originalEndDate,
    estimatedEndDate,
    extended: estimatedEndDate !== null && originalEndDate !== null && compareDates(estimatedEndDate, originalEndDate) > 0,
    completedOn: payable.length === 0 ? completedOn : null,
    excessPayment,
    rejected,
  };
}

/** Отмена записи журнала: запись остаётся в истории, но в расчёте не участвует. */
export function voidEvent(journal: readonly JournalEvent[], eventId: string, voidedAt: ISODate): JournalEvent[] {
  assertDate(voidedAt, 'Дата отмены');
  if (!journal.some((e) => e.id === eventId)) throw new RangeError(`В журнале нет записи ${eventId}`);
  return journal.map((e) => (e.id === eventId && e.voidedAt === undefined ? { ...e, voidedAt } : e));
}
