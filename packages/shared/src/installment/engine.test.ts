import { describe, expect, it } from 'vitest';
import { buildOriginalSchedule, computeInstallment, voidEvent } from './engine';
import { monthlyDate } from './dates';
import type { InstallmentParams, JournalEvent } from './types';

// 4 платежа по 5 000: куплено 2026-01-10, платёж каждое 15-е, первый — 15 февраля.
const base: InstallmentParams = {
  cost: 20000,
  downPayment: 0,
  termMonths: 4,
  purchaseDate: '2026-01-10',
  paymentDay: 15,
};
const pay = (id: string, date: string, amount: number): JournalEvent => ({ id, type: 'payment', date, amount });
const skip = (id: string, date: string, segmentId?: string): JournalEvent => ({ id, type: 'skip', date, segmentId });
const view = (s: ReturnType<typeof computeInstallment>) => s.segments.map((x) => `${x.amount}:${x.status}`);

describe('исходный график', () => {
  it('4 × 5 000, даты — 15 числа следующих месяцев', () => {
    const s = computeInstallment(base, [], '2026-01-20');
    expect(s.originalSchedule.map((x) => [x.dueDate, x.amount])).toEqual([
      ['2026-02-15', 5000],
      ['2026-03-15', 5000],
      ['2026-04-15', 5000],
      ['2026-05-15', 5000],
    ]);
    expect(view(s)).toEqual(['5000:upcoming', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
    expect(s.remaining).toBe(20000);
    expect(s.totalPaid).toBe(0);
    expect(s.regularPayment).toBe(5000);
  });

  it('первый взнос вычитается: (стоимость − взнос) ÷ срок', () => {
    const s = computeInstallment({ ...base, cost: 50000, downPayment: 10000 }, [], '2026-01-20');
    expect(s.regularPayment).toBe(10000);
    expect(s.remaining).toBe(40000);
    expect(s.totalPaid).toBe(10000);
  });

  it('округление: остаток уходит в последний платёж', () => {
    const sched = buildOriginalSchedule({ ...base, cost: 10000, termMonths: 3 });
    expect(sched.map((x) => x.amount)).toEqual([3333, 3333, 3334]);
    const s = computeInstallment({ ...base, cost: 10000, termMonths: 3 }, [], '2026-01-20');
    expect(s.remaining).toBe(10000);
  });

  it('свой платёж в месяц: последний — остаток', () => {
    const sched = buildOriginalSchedule({ ...base, cost: 10000, termMonths: 3, monthlyPayment: 4000 });
    expect(sched.map((x) => x.amount)).toEqual([4000, 4000, 2000]);
  });

  it('день платежа 31 в коротких месяцах — последний день месяца', () => {
    expect(monthlyDate('2026-01-10', 1, 31)).toBe('2026-02-28');
    expect(monthlyDate('2028-01-10', 1, 31)).toBe('2028-02-29');
    expect(monthlyDate('2026-11-10', 2, 15)).toBe('2027-01-15');
  });

  it('взнос равен стоимости — платежей нет, рассрочка закрыта', () => {
    const s = computeInstallment({ ...base, downPayment: 20000 }, [], '2026-01-20');
    expect(s.segments).toEqual([]);
    expect(s.status).toBe('completed');
  });

  it('неверные данные отвергаются', () => {
    expect(() => computeInstallment({ ...base, cost: 0 }, [], '2026-01-20')).toThrow();
    expect(() => computeInstallment({ ...base, downPayment: 30000 }, [], '2026-01-20')).toThrow();
    expect(() => computeInstallment({ ...base, termMonths: 0 }, [], '2026-01-20')).toThrow();
    expect(() => computeInstallment({ ...base, paymentDay: 32 }, [], '2026-01-20')).toThrow();
    expect(() => computeInstallment({ ...base, purchaseDate: '2026-02-30' }, [], '2026-01-20')).toThrow();
  });
});

describe('оплата', () => {
  it('обычный платёж закрывает ближайший', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 5000)], '2026-02-16');
    expect(view(s)).toEqual(['5000:paid', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
    expect(s.remaining).toBe(15000);
    expect(s.totalPaid).toBe(5000);
    expect(s.nextPayment).toEqual({ segmentId: 'o2', dueDate: '2026-03-15', amount: 5000 });
    expect(s.remainingPayments).toBe(3);
  });

  it('ПЕРЕПЛАТА: 4×5 000, внесено 12 000 → «12 000 (оплачено) | 5 000 | 3 000»', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 12000)], '2026-02-16');
    expect(view(s)).toEqual(['12000:paid', '5000:upcoming', '3000:upcoming']);
    expect(s.remaining).toBe(8000);
    expect(s.totalPaid).toBe(12000);
    // ближайший платёж и его дата не меняются
    expect(s.nextPayment).toEqual({ segmentId: 'o2', dueDate: '2026-03-15', amount: 5000 });
    // исходный график не стёрт
    expect(s.originalSchedule).toHaveLength(4);
    expect(s.excessPayment).toBe(0);
  });

  it('переплата, закрывающая всё: рассрочка завершена', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 20000)], '2026-02-16');
    expect(view(s)).toEqual(['20000:paid']);
    expect(s.status).toBe('completed');
    expect(s.remaining).toBe(0);
    expect(s.completedOn).toBe('2026-02-15');
    expect(s.estimatedEndDate).toBeNull();
  });

  it('сумма сверх остатка не теряется и не портит итоги', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 25000)], '2026-02-16');
    expect(s.totalPaid).toBe(20000);
    expect(s.excessPayment).toBe(5000);
    expect(s.status).toBe('completed');
  });

  it('НЕДОПЛАТА: 4×5 000, внесено 3 000 → «3 000 | 5 000 | 5 000 | 5 000 | 2 000»', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 3000)], '2026-02-16');
    expect(view(s)).toEqual(['3000:paid', '5000:upcoming', '5000:upcoming', '5000:upcoming', '2000:upcoming']);
    expect(s.remaining).toBe(17000);
    expect(s.segments[0]!.planned).toBe(5000); // зелёная часть — 60% ширины
    expect(s.segments[4]!.added).toBe(true);
    expect(s.segments[4]!.dueDate).toBe('2026-06-15');
    expect(s.extended).toBe(true);
    expect(s.originalEndDate).toBe('2026-05-15');
    expect(s.estimatedEndDate).toBe('2026-06-15');
  });

  it('недоплата добавляется к последнему платежу, если он меньше обычного', () => {
    // 3 платежа: 3333, 3333, 3334; обычный 3333; последний 3334 ≥ обычного → новый сегмент
    const p: InstallmentParams = { ...base, cost: 10000, termMonths: 3 };
    const s1 = computeInstallment(p, [pay('p1', '2026-02-15', 1000)], '2026-02-16');
    expect(view(s1)).toEqual(['1000:paid', '3333:upcoming', '3334:upcoming', '2333:upcoming']);
    // платёж 4000 по 3 × 4000 и свой платёж: последний 2000 < обычного 4000 → доплата в него
    const q: InstallmentParams = { ...base, cost: 10000, termMonths: 3, monthlyPayment: 4000 };
    const s2 = computeInstallment(q, [pay('p1', '2026-02-15', 3000)], '2026-02-16');
    expect(view(s2)).toEqual(['3000:paid', '4000:upcoming', '3000:upcoming']);
    expect(s2.remaining).toBe(7000);
    // доплата не превышает обычный платёж: излишек — в новый сегмент
    const s3 = computeInstallment(q, [pay('p1', '2026-02-15', 500)], '2026-02-16');
    expect(view(s3)).toEqual(['500:paid', '4000:upcoming', '4000:upcoming', '1500:upcoming']);
    expect(s3.remaining).toBe(9500);
  });

  it('недоплата последнего платежа — новый сегмент на недостающую сумму', () => {
    const j = [
      pay('p1', '2026-02-15', 5000),
      pay('p2', '2026-03-15', 5000),
      pay('p3', '2026-04-15', 5000),
      pay('p4', '2026-05-15', 4000),
    ];
    const s = computeInstallment(base, j, '2026-05-16');
    expect(view(s)).toEqual(['5000:paid', '5000:paid', '5000:paid', '4000:paid', '1000:upcoming']);
    expect(s.remaining).toBe(1000);
  });

  it('несколько платежей подряд, затем полное закрытие', () => {
    const j = ['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15'].map((d, i) => pay(`p${i}`, d, 5000));
    const s = computeInstallment(base, j, '2026-05-16');
    expect(s.status).toBe('completed');
    expect(s.totalPaid).toBe(20000);
    expect(s.completedOn).toBe('2026-05-15');
  });

  it('платёж, когда платить нечего, отклоняется и фиксируется', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 20000), pay('p2', '2026-02-20', 100)], '2026-03-01');
    expect(s.rejected).toEqual([{ eventId: 'p2', reason: 'no_open_payments' }]);
  });

  it('нулевая и дробная суммы отклоняются', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 0), pay('p2', '2026-02-15', 10.5)], '2026-02-16');
    expect(s.rejected.map((r) => r.reason)).toEqual(['invalid_amount', 'invalid_amount']);
    expect(s.totalPaid).toBe(0);
  });
});

describe('просрочка', () => {
  it('срок прошёл, не оплачено → просрочен (в день платежа ещё нет)', () => {
    expect(view(computeInstallment(base, [], '2026-02-15'))[0]).toBe('5000:upcoming');
    const s = computeInstallment(base, [], '2026-02-16');
    expect(view(s)[0]).toBe('5000:overdue');
    expect(s.overdueCount).toBe(1);
  });

  it('«К оплате сейчас» = просрочено + ближайший (7 000 + 7 000 = 14 000)', () => {
    const p: InstallmentParams = { ...base, cost: 28000 }; // 4 × 7 000
    const s = computeInstallment(p, [], '2026-03-01'); // февральский платёж просрочен, мартовский ближайший
    expect(s.dueNow).toEqual({ overdue: 7000, next: 7000, total: 14000, isOverdue: true });
    expect(s.overdueAmount).toBe(7000);
    expect(s.nextPayment?.dueDate).toBe('2026-03-15');
  });

  it('без просрочки «К оплате сейчас» — просто ближайший платёж, не красный', () => {
    const s = computeInstallment(base, [], '2026-02-01');
    expect(s.dueNow).toEqual({ overdue: 0, next: 5000, total: 5000, isOverdue: false });
  });

  it('нет процентов и пеней: сумма просрочки не растёт со временем', () => {
    const a = computeInstallment(base, [], '2026-03-01');
    const b = computeInstallment(base, [], '2026-12-01');
    expect(a.remaining).toBe(20000);
    expect(b.remaining).toBe(20000);
  });

  it('платёж сначала закрывает самую старую просрочку, потом ближайший', () => {
    const p: InstallmentParams = { ...base, cost: 28000 };
    const s = computeInstallment(p, [pay('p1', '2026-03-20', 10500)], '2026-03-21');
    // просрочены были фев (7000) и март (7000) [15 марта < 20 марта]; ближайший — апрель
    expect(view(s)).toEqual(['7000:paid', '3500:overdue', '7000:upcoming', '7000:upcoming']);
    expect(s.dueNow).toEqual({ overdue: 3500, next: 7000, total: 10500, isOverdue: true });
  });

  it('частично оплаченная просрочка остаётся красной на остаток', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-20', 2000)], '2026-02-21');
    expect(view(s)[0]).toBe('3000:overdue');
    expect(s.segments[0]!.paid).toBe(2000);
    expect(s.remaining).toBe(18000);
  });

  it('оплата просрочки и ближайшего одним платежом', () => {
    const p: InstallmentParams = { ...base, cost: 28000 };
    const s = computeInstallment(p, [pay('p1', '2026-03-01', 14000)], '2026-03-02');
    expect(view(s)).toEqual(['7000:paid', '7000:paid', '7000:upcoming', '7000:upcoming']);
    expect(s.overdueCount).toBe(0);
  });

  it('просрочка покрыта, остаток меньше ближайшего: ближайший закрывается недоплатой', () => {
    const p: InstallmentParams = { ...base, cost: 28000 };
    const s = computeInstallment(p, [pay('p1', '2026-03-01', 10000)], '2026-03-02');
    // фев просрочен 7000 → закрыт; ближайший (март) получает 3000 → закрыт, недостающие 4000 в конец
    expect(view(s)).toEqual(['7000:paid', '3000:paid', '7000:upcoming', '7000:upcoming', '4000:upcoming']);
  });
});

describe('пропуск по договорённости', () => {
  it('ближайший платёж → чёрный, такой же сегмент в конец, остаток не меняется', () => {
    const s = computeInstallment(base, [skip('k1', '2026-02-10')], '2026-02-11');
    expect(view(s)).toEqual(['5000:skipped', '5000:upcoming', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
    expect(s.remaining).toBe(20000);
    expect(s.remainingPayments).toBe(4);
    expect(s.extended).toBe(true);
    expect(s.originalEndDate).toBe('2026-05-15');
    expect(s.estimatedEndDate).toBe('2026-06-15');
    expect(s.nextPayment?.dueDate).toBe('2026-03-15');
  });

  it('просроченный платёж можно пропустить; по умолчанию — самый старый просроченный', () => {
    const p: InstallmentParams = { ...base, cost: 28000 };
    const s = computeInstallment(p, [skip('k1', '2026-03-20')], '2026-03-21');
    expect(s.segments[0]!.status).toBe('skipped');
    expect(s.segments[1]!.status).toBe('overdue');
    expect(s.remaining).toBe(28000);
  });

  it('можно пропускать каждый месяц', () => {
    const j = [skip('k1', '2026-02-10'), skip('k2', '2026-03-10'), skip('k3', '2026-04-10')];
    const s = computeInstallment(base, j, '2026-04-11');
    expect(s.segments.filter((x) => x.status === 'skipped')).toHaveLength(3);
    expect(s.remaining).toBe(20000);
    expect(s.estimatedEndDate).toBe('2026-08-15');
  });

  it('нельзя пропустить платёж, который не просрочен и не ближайший', () => {
    const s = computeInstallment(base, [skip('k1', '2026-02-10', 'o3')], '2026-02-11');
    expect(s.rejected).toEqual([{ eventId: 'k1', reason: 'skip_not_allowed' }]);
    expect(s.segments.every((x) => x.status !== 'skipped')).toBe(true);
  });

  it('несуществующий платёж отклоняется', () => {
    const s = computeInstallment(base, [skip('k1', '2026-02-10', 'zzz')], '2026-02-11');
    expect(s.rejected).toEqual([{ eventId: 'k1', reason: 'skip_target_not_found' }]);
  });

  it('отмена пропуска: сегмент снова серый, добавленный исчезает, запись остаётся в истории', () => {
    const journal = [skip('k1', '2026-02-10')];
    const voided = voidEvent(journal, 'k1', '2026-02-12');
    const s = computeInstallment(base, voided, '2026-02-13');
    expect(view(s)).toEqual(['5000:upcoming', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
    expect(s.extended).toBe(false);
    expect(voided).toHaveLength(1);
    expect(voided[0]!.voidedAt).toBe('2026-02-12');
    expect(journal[0]!.voidedAt).toBeUndefined(); // исходный журнал не изменён
  });

  it('«Отменить пропуск → Оплатить»: отмена пропуска и платёж', () => {
    const j = [...voidEvent([skip('k1', '2026-02-10')], 'k1', '2026-02-12'), pay('p1', '2026-02-12', 5000)];
    const s = computeInstallment(base, j, '2026-02-13');
    expect(view(s)).toEqual(['5000:paid', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
  });

  it('пропуск и недоплата вместе', () => {
    const j = [skip('k1', '2026-02-10'), pay('p1', '2026-03-15', 3000)];
    const s = computeInstallment(base, j, '2026-03-16');
    expect(view(s)).toEqual([
      '5000:skipped', '3000:paid', '5000:upcoming', '5000:upcoming', '5000:upcoming', '2000:upcoming',
    ]);
    expect(s.remaining).toBe(17000);
  });

  it('переплата сокращает и добавленный после пропуска сегмент', () => {
    const j = [skip('k1', '2026-02-10'), pay('p1', '2026-03-15', 12000)];
    const s = computeInstallment(base, j, '2026-03-16');
    // сегменты: пропущен | март (12000 оплачено) | апр 5000 | май 5000 | июнь(доб.) 5000 → с конца: июнь −5000, май −2000
    expect(view(s)).toEqual(['5000:skipped', '12000:paid', '5000:upcoming', '3000:upcoming']);
    expect(s.remaining).toBe(8000);
  });
});

describe('исправление и отмена оплаты', () => {
  const j = [pay('p1', '2026-02-15', 12000)];

  it('отмена платежа возвращает график', () => {
    const s = computeInstallment(base, voidEvent(j, 'p1', '2026-02-16'), '2026-02-10');
    expect(view(s)).toEqual(['5000:upcoming', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
    expect(s.totalPaid).toBe(0);
  });

  it('исправление суммы: отмена + новая запись', () => {
    const fixed = [...voidEvent(j, 'p1', '2026-02-16'), pay('p2', '2026-02-15', 5000)];
    const s = computeInstallment(base, fixed, '2026-02-17');
    expect(view(s)).toEqual(['5000:paid', '5000:upcoming', '5000:upcoming', '5000:upcoming']);
    expect(fixed).toHaveLength(2); // старая запись осталась в истории
  });

  it('отмена раннего платежа пересчитывает последующие детерминированно', () => {
    const journal = [pay('p1', '2026-02-15', 5000), pay('p2', '2026-03-15', 5000)];
    const s = computeInstallment(base, voidEvent(journal, 'p1', '2026-03-16'), '2026-03-20');
    // платёж p2 теперь идёт в февральский (просроченный) платёж
    expect(view(s)).toEqual(['5000:paid', '5000:overdue', '5000:upcoming', '5000:upcoming']);
    expect(s.totalPaid).toBe(5000);
  });

  it('порядок записей в журнале не важен: считается по датам', () => {
    const a = [pay('p1', '2026-02-15', 5000), pay('p2', '2026-03-15', 3000)];
    const b = [a[1]!, a[0]!];
    expect(computeInstallment(base, a, '2026-03-16')).toEqual(computeInstallment(base, b, '2026-03-16'));
  });

  it('voidEvent с неизвестной записью — ошибка', () => {
    expect(() => voidEvent(j, 'nope', '2026-02-16')).toThrow();
  });
});

describe('показатели', () => {
  it('сводка по рассрочке с первым взносом', () => {
    const p: InstallmentParams = { ...base, cost: 60000, downPayment: 12000, termMonths: 6 };
    const s = computeInstallment(p, [pay('p1', '2026-02-15', 8000)], '2026-02-20');
    expect(s.cost).toBe(60000);
    expect(s.downPayment).toBe(12000);
    expect(s.financed).toBe(48000);
    expect(s.totalPaid).toBe(20000);
    expect(s.remaining).toBe(40000);
    expect(s.regularPayment).toBe(8000);
    expect(s.remainingPayments).toBe(5);
    expect(s.initialTermMonths).toBe(6);
    expect(s.originalEndDate).toBe('2026-07-15');
    expect(s.estimatedEndDate).toBe('2026-07-15');
    expect(s.extended).toBe(false);
  });

  it('при переплате расчётная дата завершения раньше срока по договору', () => {
    const s = computeInstallment(base, [pay('p1', '2026-02-15', 12000)], '2026-02-16');
    expect(s.estimatedEndDate).toBe('2026-04-15');
    expect(s.originalEndDate).toBe('2026-05-15');
    expect(s.extended).toBe(false);
  });
});

describe('свойства (много случайных сценариев)', () => {
  // Небольшой детерминированный генератор: тесты должны повторяться один в один.
  function rng(seed: number) {
    let x = seed;
    return () => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  }

  it('остаток, итоги и сумма полоски всегда сходятся; вход не меняется; расчёт повторяем', () => {
    const rand = rng(42);
    for (let run = 0; run < 300; run++) {
      const term = 1 + Math.floor(rand() * 12);
      const cost = 1000 + Math.floor(rand() * 200) * 500;
      const down = rand() < 0.4 ? Math.floor((rand() * cost) / 2 / 100) * 100 : 0;
      const params: InstallmentParams = {
        cost,
        downPayment: down,
        termMonths: term,
        purchaseDate: '2026-01-31',
        paymentDay: 1 + Math.floor(rand() * 31),
        ...(rand() < 0.3 ? { monthlyPayment: 500 + Math.floor(rand() * 10) * 500 } : {}),
      };
      const journal: JournalEvent[] = [];
      const n = Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const month = 2 + Math.floor(rand() * 10);
        const date = `2026-${String(month).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
        if (rand() < 0.25) journal.push({ id: `e${i}`, type: 'skip', date });
        else journal.push({ id: `e${i}`, type: 'payment', date, amount: 1 + Math.floor(rand() * 30) * 500 });
        if (rand() < 0.15) journal[i] = { ...journal[i]!, voidedAt: '2026-12-31' };
      }
      const snapshot = JSON.stringify([params, journal]);
      const today = '2026-12-01';
      const s = computeInstallment(params, journal, today);

      expect(JSON.stringify([params, journal])).toBe(snapshot);
      expect(computeInstallment(params, journal, today)).toEqual(s);

      const payable = s.segments.filter((x) => x.status === 'overdue' || x.status === 'upcoming');
      expect(payable.reduce((a, x) => a + x.amount, 0)).toBe(s.remaining);
      // всё, что оплачено + осталось = стоимость
      expect(s.totalPaid + s.remaining).toBe(params.cost);
      expect(s.remaining).toBeGreaterThanOrEqual(0);
      expect(s.status === 'completed').toBe(s.remaining === 0);
      expect(s.originalSchedule.reduce((a, x) => a + x.amount, 0)).toBe(params.cost - params.downPayment);
      expect(s.dueNow.total).toBe(s.overdueAmount + (s.nextPayment?.amount ?? 0));
      for (const seg of s.segments) expect(seg.amount).toBeGreaterThan(0);
    }
  });
});
