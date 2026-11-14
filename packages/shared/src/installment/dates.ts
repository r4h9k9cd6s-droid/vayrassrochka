/** Даты хранятся строками «ГГГГ-ММ-ДД» (без часовых поясов). */
export type ISODate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month: 1..12
}

export function isValidDate(value: string): boolean {
  const m = RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function assertDate(value: string, name: string): void {
  if (!isValidDate(value)) throw new RangeError(`${name}: ожидается дата ГГГГ-ММ-ДД, получено «${value}»`);
}

export function parts(date: ISODate): { y: number; m: number; d: number } {
  const m = RE.exec(date);
  if (!m) throw new RangeError(`Неверная дата «${date}»`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function format(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Дата с заданным днём в месяце (месяц сдвинут на `offset` от месяца `base`); день обрезается по длине месяца. */
export function monthlyDate(base: ISODate, offset: number, day: number): ISODate {
  const { y, m } = parts(base);
  const index = y * 12 + (m - 1) + offset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return format(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Сравнение строк-дат: <0, 0, >0. */
export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
