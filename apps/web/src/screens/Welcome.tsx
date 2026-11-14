import { useState } from 'react';
import { Btn, ProductTile } from '../ui';
import { navigate } from '../router';

export const WELCOME_KEY = 'vr:welcome-seen';
export const markWelcomeSeen = () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ } };
export const welcomeSeen = () => { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return true; } };

const SLIDES = [
  { title: 'Приложение для людей, а не для продавцов', text: 'ВайРассрочка создана покупателями для покупателей. Здесь люди делятся тем, как они покупают в рассрочку, и ведут свои платежи в удобном счётчике.', demo: 'people' },
  { title: 'В ленте настоящие покупки людей', text: 'Здесь условия, на которых люди купили товар: цена, срок, платёж в месяц и продавец. Покупки добавляют сами покупатели. Ваше имя и платежи не показываются, только условия сделки. Чем больше покупок в ленте, тем полезнее она всем.', demo: 'feed' },
  { title: 'Следите за своими финансами', text: 'Добавьте свои рассрочки и котёл: приложение посчитает график, остаток и сколько осталось заплатить. Настройте напоминания, и оно подскажет, когда и сколько платить. Всё это видно только вам.', demo: 'bar' },
] as const;

function Demo({ kind }: { kind: (typeof SLIDES)[number]['demo'] }) {
  if (kind === 'feed')
    return (
      <div className="stack" aria-hidden="true">
        {[['phone', 'Смартфон', '9 мес.', '8 500 ₽'], ['sofa', 'Диван угловой', '12 мес.', '6 200 ₽']].map(([i, t, term, pay]) => (
          <div key={t} className="card row"><ProductTile icon={i!} category={i === 'sofa' ? 'furniture' : 'electronics'} /><div className="grow"><b>{t}</b><div className="muted">{term} · платёж {pay}</div></div></div>
        ))}
      </div>
    );
  if (kind === 'bar')
    return (
      <div className="card stack" aria-hidden="true">
        <div className="muted">Ближайший платёж · 15 марта</div>
        <div className="big">7 000 ₽</div>
        <div className="bar"><i className="paid" style={{ flex: 1 }} /><i className="paid" style={{ flex: 1 }} /><i style={{ flex: 1 }} /><i style={{ flex: 1 }} /></div>
      </div>
    );
  return (
    <div className="card row" aria-hidden="true" style={{ justifyContent: 'center', gap: 20, padding: 32 }}>
      {['🤝', '🧾', '📱'].map((e) => <span key={e} style={{ fontSize: 44 }}>{e}</span>)}
    </div>
  );
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i]!;
  const finish = (to?: string) => { markWelcomeSeen(); onDone(); if (to) navigate(to); };
  return (
    <div className="welcome">
      <div className="row between" style={{ minHeight: 44 }}>
        <b style={{ fontSize: 18 }}>ВайРассрочка</b>
        <Btn kind="g" sm onClick={() => finish()}>Пропустить</Btn>
      </div>
      <div className="grow stack" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Demo kind={s.demo} />
        <h1 style={{ fontSize: 26, marginTop: 24 }}>{s.title}</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>{s.text}</p>
      </div>
      <div className="dots" style={{ margin: '16px 0' }}>{SLIDES.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
      {i < SLIDES.length - 1 ? (
        <Btn block onClick={() => setI(i + 1)}>Дальше</Btn>
      ) : (
        <div className="stack">
          <Btn block onClick={() => finish('/login?mode=register')}>Создать аккаунт</Btn>
          <Btn block kind="o" onClick={() => finish('/login')}>Войти</Btn>
        </div>
      )}
    </div>
  );
}
