import { describe, expect, it } from 'vitest';
import { canPayMonth, computePot, type PotParams } from './pot';

const base: PotParams = {
  participants: 10,
  contribution: 5000,
  paymentDay: 5,
  myTurn: 4,
  startDate: '2026-01-01',
  alreadyPaid: 0,
  paidMonths: [],
  received: false,
};
const st = (p: PotParams, t: string) => computePot(p, t).contributions.map((c) => c.status[0]).join('');

describe('котёл', () => {
  it('круг идёт ровно N месяцев; получение — N×C в свой месяц', () => {
    const s = computePot(base, '2025-12-20');
    expect(s.contributions).toHaveLength(10);
    expect(s.contributions[0]!.dueDate).toBe('2026-01-05');
    expect(s.contributions[9]!.dueDate).toBe('2026-10-05');
    expect(s.receive).toEqual({ month: 4, dueDate: '2026-04-05', amount: 50000, received: false });
    expect(s.remainingTotal).toBe(50000);
    expect(s.next?.month).toBe(1);
  });

  it('просроченный взнос остаётся красным, пока не внесён; ближайший — следующий по порядку', () => {
    const s = computePot(base, '2026-03-10'); // янв, фев, март просрочены
    expect(st(base, '2026-03-10')).toBe('ooonuuuuuu'); // янв-мар просрочены, апр ближайший
    expect(s.overdueCount).toBe(3);
    expect(s.overdueAmount).toBe(15000);
    expect(s.next?.month).toBe(4);
    expect(s.payableMonths).toEqual([1, 2, 3, 4]);
  });

  it('вносить заранее нельзя', () => {
    const p = { ...base, paidMonths: [1] };
    expect(canPayMonth(p, '2026-01-10', 2)).toBe(true); // ближайший
    expect(canPayMonth(p, '2026-01-10', 3)).toBe(false); // заранее
    expect(canPayMonth(p, '2026-01-10', 1)).toBe(false); // уже внесён
  });

  it('«котёл уже начался»: прошлые месяцы оплачены автоматически', () => {
    const p = { ...base, alreadyPaid: 3 };
    const s = computePot(p, '2026-04-01');
    expect(s.paidCount).toBe(3);
    expect(s.paidTotal).toBe(15000);
    expect(s.overdueCount).toBe(0);
    expect(s.next?.month).toBe(4);
  });

  it('после получения человек продолжает вносить до конца; в конце круг закрыт', () => {
    const p = { ...base, received: true, paidMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
    const s = computePot(p, '2026-11-01');
    expect(s.completed).toBe(true);
    expect(s.remainingTotal).toBe(0);
    expect(s.next).toBeNull();
    expect(s.receive.received).toBe(true);
  });

  it('день взноса 31 — последний день короткого месяца', () => {
    const s = computePot({ ...base, paymentDay: 31 }, '2026-01-01');
    expect(s.contributions[1]!.dueDate).toBe('2026-02-28');
  });

  it('неверные данные отвергаются', () => {
    expect(() => computePot({ ...base, myTurn: 11 }, '2026-01-01')).toThrow();
    expect(() => computePot({ ...base, participants: 1 }, '2026-01-01')).toThrow();
    expect(() => computePot({ ...base, alreadyPaid: 11 }, '2026-01-01')).toThrow();
    expect(() => computePot({ ...base, contribution: 0 }, '2026-01-01')).toThrow();
  });
});
