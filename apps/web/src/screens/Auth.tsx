import { useState } from 'react';
import { api, errorText } from '../api';
import { navigate } from '../router';
import { useAuth, type Me } from '../store';
import { Btn, Field } from '../ui';

export function BackupCodeView({ code, login, onDone }: { code: string; login: string; onDone: () => void }) {
  const { toast } = useAuth();
  const [saved, setSaved] = useState(false);
  const text = `ВайРассрочка\nСайт: ${location.origin}\nЛогин: ${login}\nРезервный код: ${code}\n\nКод нужен, если вы забудете пароль. Никому его не показывайте.`;
  const share = async () => {
    try { await navigator.share({ title: 'Резервный код ВайРассрочка', text }); } catch { /* закрыто */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast('Код скопирован'); } catch { toast('Не удалось скопировать'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'vayrassrochka-code.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  const ack = async () => {
    await api('POST', '/api/me/backup-code/ack').catch(() => undefined);
    onDone();
  };
  return (
    <div className="stack">
      <h1 style={{ fontSize: 26 }}>Ваш резервный код</h1>
      <p style={{ margin: 0 }}>Он нужен, чтобы войти, если вы забудете пароль. <b>Показывается один раз.</b> Сохраните его сейчас.</p>
      <div className="card" style={{ textAlign: 'center', fontSize: 30, fontWeight: 800, letterSpacing: 2 }} aria-label="Резервный код">{code}</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {'share' in navigator && <Btn kind="g" onClick={share}>Отправить себе</Btn>}
        <Btn kind="g" onClick={download}>Скачать файл</Btn>
        <Btn kind="g" onClick={copy}>Скопировать</Btn>
      </div>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />Я сохранил код в надёжном месте</label>
      <Btn block disabled={!saved} onClick={ack}>Готово</Btn>
      <button className="btn g block" style={{ height: 44 }} onClick={onDone}>Сохраню позже</button>
    </div>
  );
}

export function AuthScreen() {
  const { setMe, refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        const r = await api<{ user: Me }>('POST', '/api/auth/login', { login, password });
        setMe(r.user);
        navigate('/home', true);
      } else if (mode === 'register') {
        const r = await api<{ backupCode: string }>('POST', '/api/auth/register', { login, password });
        await refresh();
        setIssued(r.backupCode);
      } else {
        const r = await api<{ backupCode: string }>('POST', '/api/auth/reset', { login, backupCode: code, newPassword: password });
        await refresh();
        setIssued(r.backupCode);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (issued) return <div className="page"><BackupCodeView code={issued} login={login.trim().toLowerCase()} onDone={() => navigate('/home', true)} /></div>;

  return (
    <div className="page stack">
      <h1>{mode === 'login' ? 'Вход' : mode === 'register' ? 'Создать аккаунт' : 'Новый пароль'}</h1>
      <form className="stack" onSubmit={submit}>
        <Field label="Логин" hint={mode === 'register' ? 'Без почты и телефона. От 3 знаков: буквы, цифры, _ . -' : undefined}>
          <input className="input" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Field>
        {mode === 'reset' && (
          <Field label="Резервный код" hint="12 знаков, например K7MD-92QX-TH4B">
            <input className="input" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        <Field label={mode === 'reset' ? 'Новый пароль' : 'Пароль'} hint={mode !== 'login' ? 'Не короче 8 знаков' : undefined}>
          <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'login' ? 1 : 8} />
        </Field>
        {error && <div className="banner bad" role="alert">! {error}</div>}
        <Btn block disabled={busy}>{mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Сменить пароль'}</Btn>
      </form>
      <div className="stack">
        {mode !== 'login' && <Btn block kind="g" onClick={() => setMode('login')}>Уже есть аккаунт: войти</Btn>}
        {mode !== 'register' && <Btn block kind="g" onClick={() => setMode('register')}>Создать аккаунт</Btn>}
        {mode === 'login' && <Btn block kind="g" onClick={() => setMode('reset')}>Забыли пароль? Войти по резервному коду</Btn>}
      </div>
      <p className="muted">Администратор не видит ваши пароли. Нужен только логин: почта и телефон не требуются.</p>
    </div>
  );
}
