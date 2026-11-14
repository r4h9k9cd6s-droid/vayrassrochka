import { assertDate, compareDates, monthlyDate, type ISODate } from './installment/dates';

/**
 * Котёл: N участников, каждый месяц каждый вносит C, один по очереди получает N×C.
 * Круг идёт ровно N месяцев; после получения человек продолжает вносить до конца.
 */
export interface PotParams {
  participants: number;
  contribution: number;
  /** День взноса в месяце (1–31). */
  paymentDay: number;
  /** Месяц получения, 1…participants. */
  myTurn: number;
  /** Дата начала: взнос месяца 1 приходится на месяц этой даты. */
  startDate: ISODate;
  /** Сколько взносов уже внесено до ведения в приложении (месяцы 1…K оплачены автоматически). */
  alreadyPaid: number;
  /** Номера месяцев, отмеченных оплаченными в приложении. */
  paidMonths: readonly number[];
  /** Отметка «получено». */
  received: boolean;
}

export type PotStatus = 'paid' | 'overdue' | 'next' | 'upcoming';

export interface PotContribution {
  month: number;
  dueDate: ISODate;
  amount: number;
  status: PotStatus;
}

export interface PotState {
  contributions: PotContribution[];
  /** Ближайший неоплаченный непросроченный взнос. */
  next: PotContribution | null;
  overdueAmount: number;
  overdueCount: number;
  paidCount: number;
  paidTotal: number;
  /** Сколько ещё внести. */
  remainingTotal: number;
  /** Месяцы, которые сейчас можно отметить: просроченные и ближайший (вносить заранее нельзя). */
  payableMonths: number[];
  receive: { month: number; dueDate: ISODate; amount: number; received: boolean };
  /** Круг закрыт: все взносы внесены. */
  completed: boolean;
}

export function validatePot(p: PotParams): void {
  const int = (v: number, n: string, min: number) => {
    if (!Number.isInteger(v) || v < min) throw new RangeError(`${n}: ожидается целое число не меньше ${min}`);
  };
  int(p.participants, 'Участников', 2);
  if (p.participants > 120) throw new RangeError('Участников слишком много');
  int(p.contribution, 'Взнос', 1);
  int(p.paymentDay, 'День взноса', 1);
  if (p.paymentDay > 31) throw new RangeError('День взноса: от 1 до 31');
  int(p.myTurn, 'Очередь', 1);
  if (p.myTurn > p.participants) throw new RangeError('Очередь больше числа участников');
  int(p.alreadyPaid, 'Уже внесено', 0);
  if (p.alreadyPaid > p.participants) throw new RangeError('Внесено больше, чем месяцев в круге');
  assertDate(p.startDate, 'Дата начала');
}

export function computePot(p: PotParams, today: ISODate): PotState {
  validatePot(p);
  assertDate(today, 'Сегодня');
  const paid = new Set<number>(p.paidMonths.filter((m) => m >= 1 && m <= p.participants));
  for (let m = 1; m <= p.alreadyPaid; m++) paid.add(m);

  const contributions: PotContribution[] = [];
  let nextFound = false;
  for (let m = 1; m <= p.participants; m++) {
    const dueDate = monthlyDate(p.startDate, m - 1, p.paymentDay);
    let status: PotStatus;
    if (paid.has(m)) status = 'paid';
    else if (compareDates(dueDate, today) < 0) status = 'overdue';
    else if (!nextFound) {
      status = 'next';
      nextFound = true;
    } else status = 'upcoming';
    contributions.push({ month: m, dueDate, amount: p.contribution, status });
  }
  const overdue = contributions.filter((c) => c.status === 'overdue');
  const next = contributions.find((c) => c.status === 'next') ?? null;
  const paidCount = contributions.filter((c) => c.status === 'paid').length;
  return {
    contributions,
    next,
    overdueAmount: overdue.length * p.contribution,
    overdueCount: overdue.length,
    paidCount,
    paidTotal: paidCount * p.contribution,
    remainingTotal: (p.participants - paidCount) * p.contribution,
    payableMonths: [...overdue.map((c) => c.month), ...(next ? [next.month] : [])],
    receive: {
      month: p.myTurn,
      dueDate: monthlyDate(p.startDate, p.myTurn - 1, p.paymentDay),
      amount: p.participants * p.contribution,
      received: p.received,
    },
    completed: paidCount === p.participants,
  };
}

/** Можно ли сейчас отметить взнос этого месяца. */
export function canPayMonth(p: PotParams, today: ISODate, month: number): boolean {
  return computePot(p, today).payableMonths.includes(month);
}
