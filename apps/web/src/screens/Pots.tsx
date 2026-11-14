import { useState } from 'react';
import type { PotState } from '@vayrassrochka/shared';
import { api, errorText, useResource } from '../api';
import { dateRu, money as fmt, todayISO } from '../format';
import { match, navigate, usePath } from '../router';
import { useAuth } from '../store';
import { Btn, Empty, Field, Icons, Link, Money, ProductTile, Skeletons, Stepper } from '../ui';

export interface PotView {
  pot: { id: string; name: string; participants: number; contribution: number; paymentDay: number; myTurn: number; startDate: string; alreadyPaid: number; received: boolean };
  state: PotState;
}

function PotBar({ s }: { s: PotState }) {
  return (
    <div>
      <div className="bar" role="img" aria-label={`Взносов внесено ${s.paidCount} из ${s.contributions.length}`}>
        {s.contributions.map((c) => <i key={c.month} className={c.status === 'paid' ? 'paid' : c.status === 'overdue' ? 'overdue' : ''} style={{ flex: 1 }} />)}
      </div>
      {s.overdueCount > 0 && <div className="legend"><b className="bad">Просрочено: {s.overdueCount}</b></div>}
    </div>
  );
}

export function PotCard({ v }: { v: PotView }) {
  const { pot, state: s } = v;
  return (
    <Link to={`/pots/${pot.id}`} className="card stack" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
      <div className="row"><ProductTile icon="bag" /><div className="grow"><b>{pot.name}</b><div className="muted">Котёл · {pot.participants} участников</div></div></div>
      <div style={{ marginTop: 12 }}>
        {s.overdueCount > 0 ? <div><div className="bad">! К оплате сейчас</div><Money className="big bad" value={s.overdueAmount} /></div>
          : s.next ? <div><div className="muted">Следующий взнос · {dateRu(s.next.dueDate)}</div><Money className="big" value={s.next.amount} /></div> : <b>Круг завершён</b>}
      </div>
      <div style={{ marginTop: 10 }}><PotBar s={s} /></div>
      <div className="muted" style={{ marginTop: 6 }}>{pot.received ? 'Сумма получена' : <>Получу в {pot.myTurn}-й месяц · <Money value={s.receive.amount} /></>}</div>
    </Link>
  );
}

export function PotForm() {
  const { toast } = useAuth();
  const [f, setF] = useState({ name: '', participants: 10, contribution: 5000, paymentDay: Math.min(28, new Date().getDate()), myTurn: 1, startDate: todayISO(), started: false, alreadyPaid: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api<PotView>('POST', '/api/pots', { name: f.name, participants: f.participants, contribution: f.contribution, paymentDay: f.paymentDay, myTurn: Math.min(f.myTurn, f.participants), startDate: f.startDate, alreadyPaid: f.started ? Math.min(f.alreadyPaid, f.participants) : 0 });
      toast('Котёл добавлен'); navigate(`/pots/${r.pot.id}`, true);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return (
    <div className="page stack">
      <div className="row"><button className="btn g sm" onClick={() => history.back()} aria-label="Назад">{Icons.back}</button><h1 style={{ fontSize: 24 }}>Новый котёл</h1></div>
      <p className="muted" style={{ margin: 0 }}>Это личный учёт вашего участия: котёл никому не виден и в ленту не попадает.</p>
      <form className="stack" onSubmit={submit}>
        <Field label="Название"><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} required maxLength={100} /></Field>
        <Stepper label="Участников" value={f.participants} step={1} min={2} max={120} onChange={(n) => set({ participants: n, myTurn: Math.min(f.myTurn, n) })} hint="Круг идёт столько же месяцев, сколько участников" />
        <Stepper label="Взнос в месяц, ₽" value={f.contribution} step={1000} min={1} onChange={(n) => set({ contribution: n })} />
        <Stepper label="День взноса" value={f.paymentDay} step={1} min={1} max={31} onChange={(n) => set({ paymentDay: n })} />
        <Stepper label="Моя очередь (месяц получения)" value={f.myTurn} step={1} min={1} max={f.participants} onChange={(n) => set({ myTurn: n })} />
        <Field label="Дата начала"><input className="input" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} required /></Field>
        <label className="check"><input type="checkbox" checked={f.started} onChange={(e) => set({ started: e.target.checked })} />Котёл уже начался</label>
        {f.started && <Stepper label="Уже внесено взносов" value={f.alreadyPaid} step={1} min={0} max={f.participants} onChange={(n) => set({ alreadyPaid: n })} hint="Прошлые месяцы отметятся оплаченными" />}
        <div className="card">Вы получите <b>{fmt(f.participants * f.contribution)}</b> в {Math.min(f.myTurn, f.participants)}-й месяц.</div>
        {error && <div className="banner bad" role="alert">! {error}</div>}
        <Btn block disabled={busy}>Добавить котёл</Btn>
      </form>
    </div>
  );
}

export function PotDetail() {
  const id = match('/pots/:id', usePath())?.id ?? '';
  const { me, toast } = useAuth();
  const res = useResource<PotView>(me ? `pot:${id}` : null, me ? `/api/pots/${id}` : null);
  const [data, setData] = useState<PotView | null>(null);
  const v = data ?? res.data;
  if (res.loading && !v) return <div className="page"><Skeletons n={2} /></div>;
  if (!v) return <div className="page"><Empty title="Котёл не найден" /></div>;
  const { pot, state: s } = v;
  const act = async (fn: () => Promise<PotView>) => { try { setData(await fn()); } catch (e) { toast(errorText(e)); } };
  return (
    <>
      <header className="hero"><div className="hero-in stack">
        <div className="row"><button className="iconbtn" onClick={() => history.back()} aria-label="Назад">{Icons.back}</button><h1 className="grow" style={{ fontSize: 22 }}>{pot.name}</h1></div>
        {s.overdueCount > 0 ? <div><div style={{ color: '#ffb3a8', fontWeight: 700 }}>! Просрочено</div><Money className="big" value={s.overdueAmount} /></div>
          : s.next ? <div><div className="muted">Следующий взнос · {dateRu(s.next.dueDate)}</div><Money className="big" value={s.next.amount} /></div> : <div className="big">Круг завершён</div>}
      </div></header>
      <div className="page stack">
        <div className="card stack"><PotBar s={s} /><div className="muted">Внесено {s.paidCount} из {pot.participants} · осталось внести <Money value={s.remainingTotal} /></div></div>
        <div className="card stack">
          <div className="row between"><span className="muted">Получу в {pot.myTurn}-й месяц ({dateRu(s.receive.dueDate)})</span><b><Money value={s.receive.amount} /></b></div>
          <Btn kind={pot.received ? 'g' : 'o'} onClick={() => act(() => api('POST', `/api/pots/${id}/received`, { received: !pot.received }))}>{pot.received ? '✓ Получено (отменить отметку)' : 'Отметить «получено»'}</Btn>
        </div>
        <div className="card stack">
          <b>Взносы</b>
          {s.contributions.map((c) => (
            <div key={c.month} className="row between">
              <div><b>{c.month}-й месяц</b> · {dateRu(c.dueDate)}<div className={c.status === 'overdue' ? 'bad' : 'muted'}>{c.status === 'paid' ? 'Внесён' : c.status === 'overdue' ? '! Просрочен' : c.status === 'next' ? 'Ближайший' : 'Впереди'}</div></div>
              {s.payableMonths.includes(c.month) && <Btn sm onClick={() => act(() => api('POST', `/api/pots/${id}/pay`, { month: c.month }))}>Отметить</Btn>}
              {c.status === 'paid' && c.month > pot.alreadyPaid && <Btn sm kind="g" onClick={() => act(() => api('DELETE', `/api/pots/${id}/pay/${c.month}`))}>Отменить</Btn>}
            </div>
          ))}
          <p className="muted" style={{ margin: 0 }}>Вносить заранее нельзя: отмечаются просроченные и ближайший взнос. Пропустить взнос нельзя.</p>
        </div>
        <Btn kind="danger" onClick={async () => { if (confirm('Удалить этот котёл?')) { await api('DELETE', `/api/pots/${id}`); navigate('/installments', true); } }}>Удалить котёл</Btn>
      </div>
    </>
  );
}
