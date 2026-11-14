import type { ISODate } from './dates';

/** Параметры рассрочки (целые рубли). */
export interface InstallmentParams {
  /** Стоимость товара. */
  cost: number;
  /** Первый взнос (0, если нет). */
  downPayment: number;
  /** Срок в месяцах. */
  termMonths: number;
  /**
   * Обычный платёж. Если не указан: floor((стоимость − взнос) ÷ срок),
   * остаток округления уходит в последний платёж.
   */
  monthlyPayment?: number;
  purchaseDate: ISODate;
  /** День платежа в месяце (1–31; в коротких месяцах — последний день). */
  paymentDay: number;
}

interface EventBase {
  /** Уникальный номер записи в журнале (задаёт приложение). */
  id: string;
  /** Дата события (дата платежа / дата пропуска). */
  date: ISODate;
  /**
   * Если запись отменена — когда. Отменённая запись остаётся в журнале
   * (история не стирается), но в расчёте не участвует.
   */
  voidedAt?: ISODate;
}

export interface PaymentEvent extends EventBase {
  type: 'payment';
  /** Внесённая сумма, целые рубли, > 0. */
  amount: number;
}

export interface SkipEvent extends EventBase {
  type: 'skip';
  /**
   * Какой платёж пропущен. Допустим только просроченный или ближайший.
   * Если не указан: самый старый просроченный, иначе ближайший.
   */
  segmentId?: string;
}

export type JournalEvent = PaymentEvent | SkipEvent;

export type SegmentStatus = 'paid' | 'overdue' | 'skipped' | 'upcoming';

export interface Segment {
  /** Стабильный номер: o1…oN — исходные платежи, x1… — добавленные (после пропуска/недоплаты). */
  id: string;
  dueDate: ISODate;
  status: SegmentStatus;
  /**
   * Сумма для подписи:
   *  - оплачен — сколько внесено в этот сегмент (включая переплату, ушедшую на уменьшение графика);
   *  - иначе — сколько ещё нужно внести.
   */
  amount: number;
  /** Внесено в этот сегмент. */
  paid: number;
  /** Плановая сумма сегмента (для ширины зелёной части при недоплате: paid / planned). */
  planned: number;
  /** Добавлен после пропуска или недоплаты. */
  added: boolean;
}

export interface OriginalSegment {
  id: string;
  dueDate: ISODate;
  amount: number;
}

export interface RejectedEvent {
  eventId: string;
  reason: 'no_open_payments' | 'invalid_amount' | 'skip_not_allowed' | 'skip_target_not_found';
}

export interface DueNow {
  /** Сумма просроченных платежей. */
  overdue: number;
  /** Ближайший (не просроченный) платёж. */
  next: number;
  /** «К оплате сейчас» = просрочено + ближайший. */
  total: number;
  isOverdue: boolean;
}

export interface InstallmentState {
  /** Текущая полоска (без «исчезнувших» из-за переплаты платежей). */
  segments: Segment[];
  /** Исходный график — не меняется никогда. */
  originalSchedule: OriginalSegment[];
  status: 'active' | 'completed';

  cost: number;
  downPayment: number;
  financed: number;
  /** Всего выплачено, включая первый взнос. */
  totalPaid: number;
  /** Остаток к оплате. */
  remaining: number;
  /** Обычный платёж. */
  regularPayment: number;
  /** Ближайший (не просроченный) платёж. */
  nextPayment: { segmentId: string; dueDate: ISODate; amount: number } | null;
  overdueAmount: number;
  overdueCount: number;
  dueNow: DueNow;
  /** Число оставшихся платежей (просроченные + будущие, без пропущенных). */
  remainingPayments: number;
  initialTermMonths: number;
  /** Срок по договору (дата последнего исходного платежа); null, если платежей нет. */
  originalEndDate: ISODate | null;
  /** Расчётная дата завершения (последний неоплаченный платёж); null, если всё оплачено. */
  estimatedEndDate: ISODate | null;
  /** Срок удлинился относительно договора («по договору было …»). */
  extended: boolean;
  /** Дата платежа, которым рассрочка закрыта. */
  completedOn: ISODate | null;
  /** Сумма, внесённая сверх остатка (не учтена в totalPaid). */
  excessPayment: number;
  /** События, которые не удалось применить (например, пропуск не там, где разрешено). */
  rejected: RejectedEvent[];
}
