import { useMemo, useState } from 'react';
import type { InstallmentState, Segment } from '@vayrassrochka/shared';
import { api, errorText, useResource } from '../api';
import { addDays, dateRu, money as fmt, plural, todayISO } from '../format';
import { match, navigate, usePath } from '../router';
import { useAuth } from '../store';
import { Btn, Empty, Icons, Link, Money, ProductTile, SegmentBar, Sheet, Skeletons, StaleNote, Stepper } from '../ui';
import type { PotView } from './Pots';
import { PotCard } from './Pots';

export interface InstView {
  installment: {
    id: string; title: string; category: string; icon: string; sellerType: string; published: boolean; feedState: string; doubtful: boolean;
    seller: { name: string; address: string; phone: string; type: string } | null; purchaseDate: string; paymentDay: number;
    extraTerms: string; couldNotContact: number; contacted: number; monthlyPayment: number | null;
  };
  state: InstallmentState;
  events: { id: string; type: 'payment' | 'skip'; date: string; amount: number | null; voidedAt: string | null }[];
}

export function InstallmentCard({ v }: { v: InstView }) {
  const { installment: i, state: s } = v;
  const archived = s.status === 'completed';
  return (
    <Link to={`/installments/${i.id}`} className="card stack" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
      <div className="row">
        <ProductTile icon={i.icon} category={i.category} />
        <div className="grow"><b>{i.title}</b><div className="muted">{i.seller?.name || 'Личная запись'}</div></div>
      </div>
      <div style={{ marginTop: 12 }}>
        {archived ? <div style={{ fontWeight: 800 }}>Выплачено полностью</div> : s.dueNow.isOverdue ? (
          <div><div className="bad">! К оплате сейчас</div><Money className="big bad" value={s.dueNow.total} />
            <div className="muted">просрочено {fmt(s.dueNow.overdue)} + ближайший {fmt(s.dueNow.next)}</div></div>
        ) : s.nextPayment ? (
          <div><div className="muted">Ближайший платёж · {dateRu(s.nextPayment.dueDate)}</div><Money className="big" value={s.nextPayment.amount} /></div>
        ) : null}
      </div>
      <div style={{ marginTop: 10 }}><SegmentBar segments={s.segments} /></div>
      <div className="muted" style={{ marginTop: 6 }}>Выплачено <Money value={s.totalPaid} /> · остаток <Money value={s.remaining} /></div>
    </Link>
  );
}

type Filter = 'all' | 'active' | 'archive' | 'pot';

export function InstallmentsScreen() {
  const { me } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const insts = useResource<{ items: InstView[] }>(me ? `inst:${me.id}` : null, me ? '/api/installments' : null);
  const pots = useResource<{ items: PotView[] }>(me ? `pots:${me.id}` : null, me ? '/api/pots' : null);
  if (!me) return <div className="page"><Empty title="Войдите, чтобы вести рассрочки"><Btn onClick={() => navigate('/login')}>Войти</Btn></Empty></div>;

  const list = insts.data?.items ?? [];
  const potList = pots.data?.items ?? [];
  const remaining = list.reduce((a, v) => a + v.state.remaining, 0);
  const overdue = list.reduce((a, v) => a + v.state.dueNow.overdue, 0) + potList.reduce((a, p) => a + p.state.overdueAmount, 0);
  const shownInst = list.filter((v) => (filter === 'all' ? true : filter === 'active' ? v.state.status === 'active' : filter === 'archive' ? v.state.status === 'completed' : false));
  const showPots = filter === 'all' || filter === 'pot';
  const loading = (insts.loading && !insts.data) || (pots.loading && !pots.data);

  return (
    <>
      <header className="hero"><div className="hero-in stack">
        <h1>Рассрочки</h1>
        <div><div className="muted">Остаток по рассрочкам</div><Money className="big" value={remaining} /></div>
        {overdue > 0 && <div className="banner bad" style={{ background: '#fff' }}>! К оплате сейчас: <Money value={overdue} /></div>}
      </div></header>
      <div className="page wide stack">
        <StaleNote at={insts.staleAt} />
        <div className="pills">{([['all', 'Все'], ['active', 'Активные'], ['archive', 'Архив'], ['pot', 'Котёл']] as const).map(([id, label]) => <button key={id} className={`pill ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <div className="row"><Btn className="grow" onClick={() => navigate('/installments/new')}>{Icons.plus} Рассрочка</Btn><Btn className="grow" kind="o" onClick={() => navigate('/pots/new')}>{Icons.plus} Котёл</Btn></div>
        {loading && <Skeletons />}
        {!loading && list.length === 0 && potList.length === 0 && <Empty title="Пока ничего нет">Добавьте первую рассрочку или котёл: приложение посчитает график и подскажет, когда платить.</Empty>}
        <div className="grid2" style={{ display: 'grid', gap: 12 }}>
          {shownInst.map((v) => <InstallmentCard key={v.installment.id} v={v} />)}
          {showPots && potList.map((p) => <PotCard key={p.pot.id} v={p} />)}
        </div>
      </div>
    </>
  );
}

export function InstallmentDetail() {
  const id = match('/installments/:id', usePath())?.id ?? '';
  const { me, toast } = useAuth();
  const res = useResource<InstView>(me ? `inst:${me.id}:${id}` : null, me ? `/api/installments/${id}` : null);
  const [pay, setPay] = useState(false);
  const [seg, setSeg] = useState<Segment | null>(null);
  const [hist, setHist] = useState(false);
  const [data, setData] = useState<InstView | null>(null);
  const v = data ?? res.data;
  if (res.loading && !v) return <div className="page"><Skeletons n={2} /></div>;
  if (!v) return <div className="page"><Empty title="Запись не найдена" /></div>;
  const { installment: i, state: s } = v;

  const act = async (fn: () => Promise<InstView>, ok?: string) => {
    try { setData(await fn()); if (ok) toast(ok); } catch (e) { toast(errorText(e)); }
  };
  const skip = (segmentId?: string) => act(() => api('POST', `/api/installments/${id}/events`, { type: 'skip', date: todayISO(), ...(segmentId ? { segmentId } : {}) }), 'Пропуск отмечен');
  const canSkip = s.status === 'active' && (s.overdueCount > 0 || s.nextPayment);
  const skippedEvent = (seg: Segment) => seg.status === 'skipped' ? v.events.filter((e) => e.type === 'skip' && !e.voidedAt)[v.state.segments.filter((x) => x.status === 'skipped').findIndex((x) => x.id === seg.id)] : undefined;
  const sellerFix = i.couldNotContact > 0;

  return (
    <>
      <header className="hero"><div className="hero-in stack">
        <div className="row"><button className="iconbtn" onClick={() => history.back()} aria-label="Назад">{Icons.back}</button><h1 className="grow" style={{ fontSize: 22 }}>{i.title}</h1></div>
        <div className="muted">{i.seller?.name || 'Личная запись'}</div>
        {s.status === 'completed' ? <div className="big">Выплачено</div> : s.dueNow.isOverdue
          ? <div><div style={{ color: '#ffb3a8', fontWeight: 700 }}>! К оплате сейчас</div><Money className="big" value={s.dueNow.total} /><div className="muted">просрочено {fmt(s.dueNow.overdue)} + ближайший {fmt(s.dueNow.next)}</div></div>
          : s.nextPayment && <div><div className="muted">Ближайший платёж · {dateRu(s.nextPayment.dueDate)}</div><Money className="big" value={s.nextPayment.amount} /></div>}
      </div></header>
      <div className="page stack">
        <StaleNote at={res.staleAt} />
        <div className="card stack">
          <SegmentBar segments={s.segments} onSegment={(x) => (x.status === 'skipped' ? setSeg(x) : undefined)} />
          <div className="legend"><span>Остаток платежей: {s.remainingPayments}</span>{s.extended && s.originalEndDate && <span>Срок удлинился: по договору было {dateRu(s.originalEndDate, true)}</span>}</div>
        </div>
        {s.status === 'active' && <div className="row"><Btn className="grow" onClick={() => setPay(true)}>Отметить платёж</Btn>{canSkip && <Btn kind="o" onClick={() => skip()}>Я пропустил платёж</Btn>}</div>}

        <div className="card stack">
          <Row k="Стоимость" v={<Money value={s.cost} />} /><Row k="Первый взнос" v={<Money value={s.downPayment} />} />
          <Row k="Всего выплачено" v={<Money value={s.totalPaid} />} /><Row k="Остаток" v={<Money value={s.remaining} />} />
          <Row k="Обычный платёж" v={<Money value={s.regularPayment} />} />
          <Row k="Срок" v={`${s.initialTermMonths} ${plural(s.initialTermMonths, 'месяц', 'месяца', 'месяцев')}`} />
          <Row k={s.status === 'completed' ? 'Закрыта' : 'Расчётное завершение'} v={s.completedOn ? dateRu(s.completedOn, true) : s.estimatedEndDate ? dateRu(s.estimatedEndDate, true) : '—'} />
        </div>

        {sellerFix && (
          <div className="card stack">
            <div className="bad">! {i.couldNotContact} {plural(i.couldNotContact, 'человек', 'человека', 'человек')} не смогли связаться с продавцом</div>
            <div className="row"><Btn kind="g" className="grow" onClick={async () => { await api('POST', `/api/installments/${id}/seller/confirm`); toast('Данные подтверждены'); res.reload(); setData(null); }}>Данные верны</Btn><Btn className="grow" onClick={() => navigate(`/installments/${id}/edit`)}>Исправить</Btn></div>
          </div>
        )}
        <div className="row"><Btn kind="g" className="grow" onClick={() => setHist(true)}>История платежей</Btn><Btn kind="g" className="grow" onClick={() => navigate(`/installments/${id}/edit`)}>Изменить</Btn></div>
        <div className="muted">{i.published ? `В ленте${i.feedState !== 'visible' ? ' (скрыта модератором)' : ''}${i.doubtful ? ' · данные продавца под вопросом' : ''}` : 'Видно только вам'}</div>
        <Btn kind="danger" onClick={async () => { if (confirm('Удалить эту рассрочку вместе с историей?')) { await api('DELETE', `/api/installments/${id}`); navigate('/installments', true); } }}>Удалить рассрочку</Btn>
      </div>

      {pay && <PaySheet v={v} onClose={() => setPay(false)} onDone={(n) => { setData(n); setPay(false); toast('Платёж отмечен'); }} />}
      {seg && (
        <Sheet title="Пропущенный платёж" onClose={() => setSeg(null)}>
          <p style={{ margin: 0 }}>Платёж на {fmt(seg.amount)} пропущен по договорённости с продавцом.</p>
          <Btn block kind="o" onClick={() => { const ev = skippedEvent(seg); setSeg(null); if (ev) void act(() => api('POST', `/api/installments/${id}/events/${ev.id}/void`), 'Пропуск отменён'); }}>Отменить пропуск</Btn>
          <Btn block onClick={async () => { const ev = skippedEvent(seg); setSeg(null); if (ev) { await act(() => api('POST', `/api/installments/${id}/events/${ev.id}/void`)); setPay(true); } }}>Оплатить</Btn>
        </Sheet>
      )}
      {hist && (
        <Sheet title="История" onClose={() => setHist(false)}>
          {v.events.length === 0 && <div className="muted">Пока пусто.</div>}
          {v.events.map((e) => (
            <div key={e.id} className="row between" style={{ opacity: e.voidedAt ? 0.5 : 1 }}>
              <div><b>{e.type === 'payment' ? `Платёж ${fmt(e.amount ?? 0)}` : 'Пропуск'}</b><div className="muted">{dateRu(e.date, true)}{e.voidedAt ? ' · отменён' : ''}</div></div>
              {!e.voidedAt && <Btn kind="g" sm onClick={() => act(() => api('POST', `/api/installments/${id}/events/${e.id}/void`), 'Запись отменена')}>Отменить</Btn>}
            </div>
          ))}
          <p className="muted">Исправить сумму: отмените запись и добавьте новую. История сохраняется.</p>
        </Sheet>
      )}
    </>
  );
}
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="row between"><span className="muted">{k}</span><b>{v}</b></div>;

function PaySheet({ v, onClose, onDone }: { v: InstView; onClose: () => void; onDone: (v: InstView) => void }) {
  const { toast } = useAuth();
  const s = v.state;
  const [amount, setAmount] = useState(s.dueNow.isOverdue ? s.dueNow.overdue : (s.nextPayment?.amount ?? s.regularPayment));
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    if (amount > s.remaining) return 'Сумма больше остатка: лишнее не будет учтено.';
    const target = s.dueNow.isOverdue ? s.dueNow.overdue + s.dueNow.next : (s.nextPayment?.amount ?? 0);
    if (amount > target) return `Переплата ${fmt(amount - target)}: график сократится с конца.`;
    if (amount < (s.dueNow.isOverdue ? s.dueNow.overdue : (s.nextPayment?.amount ?? 0))) return 'Недоплата: месяц закроется, недостающая сумма уйдёт в конец графика.';
    return '';
  }, [amount, s]);
  const save = async () => {
    setBusy(true);
    try { onDone(await api<InstView>('POST', `/api/installments/${v.installment.id}/events`, { type: 'payment', date, amount })); }
    catch (e) { toast(errorText(e)); setBusy(false); }
  };
  return (
    <Sheet title="Отметить платёж" onClose={onClose}>
      <Stepper label="Сумма" value={amount} step={1000} min={0} onChange={setAmount} hint="Кнопки меняют сумму на 1 000 ₽, можно ввести вручную" />
      <div className="stack"><div className="muted">Дата платежа</div>
        <div className="stepper"><Btn kind="g" onClick={() => setDate(addDays(date, -1))} aria-label="Вчера">{Icons.minus}</Btn><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><Btn kind="g" onClick={() => setDate(addDays(date, 1))} aria-label="Завтра">{Icons.plus}</Btn></div></div>
      {preview && <div className="banner">{preview}</div>}
      <Btn block disabled={busy || amount < 1} onClick={save}>Сохранить {fmt(amount)}</Btn>
    </Sheet>
  );
}
