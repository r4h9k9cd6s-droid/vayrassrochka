import { api, useResource } from '../api';
import { dateRu, monthNominative, monthPrepositional, money as fmt, plural } from '../format';
import { navigate } from '../router';
import { useAuth } from '../store';
import { Btn, Empty, Icons, Link, Money, ProductTile, Skeletons, StaleNote } from '../ui';

interface Att { kind: string; id?: string; title?: string; amount?: number; dueDate?: string; source?: 'installment' | 'pot'; count?: number; installmentId?: string }
interface HomeData {
  month: string;
  summary: { total: number; paid: number; left: number; installments: { paid: number; left: number }; pots: { paid: number; left: number }; overdue: number };
  installmentsRemaining: number;
  attention: Att[];
  upcoming: { source: 'installment' | 'pot'; id: string; title: string; icon: string; dueDate: string; amount: number }[];
  receive: { potId: string; name: string; month: number; dueDate: string; amount: number }[];
}

export function HomeScreen() {
  const { me, setMe } = useAuth();
  const res = useResource<HomeData>(me ? `home:${me.id}` : null, me ? '/api/home' : null);
  if (!me) return <div className="page"><Empty title="Войдите, чтобы видеть свои платежи"><Btn onClick={() => navigate('/login')}>Войти</Btn></Empty></div>;
  const d = res.data;
  const toggleHide = async () => {
    const r = await api<{ user: typeof me }>('PATCH', '/api/me/settings', { hideAmounts: !me.hideAmounts }).catch(() => null);
    if (r) setMe(r.user);
  };
  const pct = d && d.summary.total > 0 ? Math.round((d.summary.paid / d.summary.total) * 100) : 0;
  const href = (a: { source?: 'installment' | 'pot'; id?: string }) => (a.source === 'pot' ? `/pots/${a.id}` : `/installments/${a.id}`);

  return (
    <>
      <header className="hero"><div className="hero-in stack">
        <div className="row between">
          <h1>Главная</h1>
          <div className="row">
            <button className="iconbtn" onClick={toggleHide} aria-label={me.hideAmounts ? 'Показать суммы' : 'Скрыть суммы'} aria-pressed={me.hideAmounts}>{me.hideAmounts ? Icons.eyeOff : Icons.eye}</button>
            <button className="iconbtn" onClick={() => navigate('/settings')} aria-label="Профиль и настройки">{me.avatar ? <img src={me.avatar} alt="" width={44} height={44} style={{ borderRadius: 22 }} /> : Icons.user}</button>
          </div>
        </div>
        {d && (
          <div className="stack">
            <div className="muted">В {monthPrepositional(d.month)} к оплате</div>
            <Money className="big" value={d.summary.total} />
            <div className="bar" role="img" aria-label={`Оплачено ${pct}%`}><i className="paid" style={{ flex: Math.max(pct, 0.01), background: '#5fd4a0' }} /><i style={{ flex: Math.max(100 - pct, 0.01), background: 'rgba(255,255,255,.25)' }} /></div>
            <div className="row between muted"><span>Оплачено <Money value={d.summary.paid} /></span><span>Осталось <Money value={d.summary.left} /></span></div>
            <div className="row between"><span>Рассрочки</span><Money value={d.summary.installments.paid + d.summary.installments.left} /></div>
            <div className="row between"><span>Котёл</span><Money value={d.summary.pots.paid + d.summary.pots.left} /></div>
            {d.summary.overdue > 0 && <div className="banner bad" style={{ background: '#fff' }}>! Просрочено: <Money value={d.summary.overdue} /></div>}
          </div>
        )}
      </div></header>
      <div className="page wide stack">
        <StaleNote at={res.staleAt} />
        {res.loading && !d && <Skeletons />}
        {d && (
          <div className="grid2" style={{ display: 'grid', gap: 12 }}>
            <section className="card stack" aria-label="Требует внимания">
              <h2>Требует внимания</h2>
              {d.attention.length === 0 && <div className="muted">Всё в порядке: срочных дел нет.</div>}
              {d.attention.map((a, k) => {
                if (a.kind === 'backup_code') return <div key={k} className="banner">Сохраните резервный код. <Link to="/settings">Получить новый код</Link></div>;
                if (a.kind === 'check_seller') return <div key={k} className="stack"><div className="bad">! {a.count} {plural(a.count ?? 0, 'человек', 'человека', 'человек')} не смогли связаться с продавцом: {a.title}</div><Btn kind="o" sm onClick={() => navigate(`/installments/${a.installmentId}`)}>Исправить</Btn></div>;
                const overdue = a.kind === 'overdue';
                return (
                  <div key={k} className="row"><div className="grow"><div className={overdue ? 'bad' : ''}>{overdue ? '! Просрочено' : 'Ближайший платёж'} · {a.title}</div><div className="muted">{a.dueDate && dateRu(a.dueDate)} · <Money value={a.amount ?? 0} /></div></div>
                    <Btn sm onClick={() => navigate(href(a))}>Отметить</Btn></div>
                );
              })}
            </section>
            <div className="stack">
              <section className="card stack" aria-label="Ближайшие платежи">
                <h2>Ближайшие платежи</h2>
                {d.upcoming.length === 0 && <div className="muted">Платежей пока нет. <Link to="/installments">Добавить рассрочку</Link></div>}
                {d.upcoming.map((u, k) => <Link key={k} to={href(u)} className="row" style={{ color: 'inherit', textDecoration: 'none' }}><ProductTile icon={u.icon} /><div className="grow"><b>{u.title}</b><div className="muted">{dateRu(u.dueDate)}</div></div><Money className="" value={u.amount} /></Link>)}
              </section>
              {d.receive.length > 0 && (
                <section className="card stack" aria-label="Получу из котла">
                  <h2>Получу из котла</h2>
                  {d.receive.map((r) => <Link key={r.potId} to={`/pots/${r.potId}`} className="row between" style={{ color: 'inherit', textDecoration: 'none' }}><span>{r.name}<div className="muted">{dateRu(r.dueDate)} · {r.month}-й месяц</div></span><b><Money value={r.amount} /></b></Link>)}
                </section>
              )}
            </div>
          </div>
        )}
        <span hidden>{monthNominative(d?.month ?? '')}{fmt(0)}</span>
      </div>
    </>
  );
}
