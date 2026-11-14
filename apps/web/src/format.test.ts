import { describe, expect, it } from 'vitest';
import { addDays, agoRu, dateRu, money, monthPrepositional, phonePretty, plural } from './format';

describe('форматирование', () => {
  it('суммы в рублях с пробелами', () => {
    expect(money(0)).toBe('0 ₽');
    expect(money(1500)).toBe('1 500 ₽');
    expect(money(1234567)).toBe('1 234 567 ₽');
  });
  it('даты и месяцы по-русски', () => {
    expect(dateRu('2026-03-05')).toBe('5 марта');
    expect(dateRu('2026-12-31', true)).toBe('31 декабря 2026');
    expect(monthPrepositional('2026-11')).toBe('ноябре');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('склонение', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, 'день', 'дня', 'дней'))).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней']);
  });
  it('«когда добавлено»', () => {
    const d = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
    expect(agoRu(d(0))).toBe('сегодня');
    expect(agoRu(d(1))).toBe('вчера');
    expect(agoRu(d(5))).toBe('5 дней назад');
  });
  it('телефон', () => {
    expect(phonePretty('79281112233')).toBe('+7 928 111-22-33');
  });
});
