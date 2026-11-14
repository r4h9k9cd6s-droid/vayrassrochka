import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, cacheClear, cacheGet, cacheSet, ApiError } from './api';

export interface Me {
  id: string; login: string; backupCodeAcked: boolean; theme: 'auto' | 'light' | 'dark';
  hideAmounts: boolean; pushEnabled: boolean; reminderTime: string; avatar: string | null; welcomeSeen: boolean; timezoneOffsetMin: number;
}
interface Auth {
  me: Me | null;
  ready: boolean;
  setMe: (m: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  toast: (text: string) => void;
}
const Ctx = createContext<Auth>(null as unknown as Auth);
export const useAuth = () => useContext(Ctx);

function applyTheme(theme: string) {
  const h = new Date().getHours();
  const dark = theme === 'dark' || (theme === 'auto' && !(h >= 7 && h < 19));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#16382B' : '#0F3B2B');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(() => cacheGet<Me>('me')?.data ?? null);
  const [ready, setReady] = useState(false);
  const [toastText, setToast] = useState('');

  const setMe = useCallback((m: Me | null) => {
    setMeState(m);
    if (m) cacheSet('me', m);
    else cacheClear();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me | null }>('GET', '/api/me');
      setMe(r.user);
      // Напоминания и «сегодня» считаются по часовому поясу устройства.
      const offset = -new Date().getTimezoneOffset();
      if (r.user && r.user.timezoneOffsetMin !== offset) {
        api<{ user: Me }>('PATCH', '/api/me/settings', { timezoneOffsetMin: offset }).then((x) => setMe(x.user)).catch(() => undefined);
      }
    } catch (e) {
      // без сети остаёмся «вошедшими» по сохранённым данным; сервер сказал «нет» — выходим
      if (e instanceof ApiError && e.status === 401) setMe(null);
    } finally {
      setReady(true);
    }
  }, [setMe]);

  useEffect(() => void refresh(), [refresh]);

  const theme = me?.theme ?? (localStorage.getItem('vr:theme') ?? 'auto');
  useEffect(() => {
    applyTheme(theme);
    const t = setInterval(() => applyTheme(theme), 60_000);
    return () => clearInterval(t);
  }, [theme]);

  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setMe(null);
  }, [setMe]);

  const toast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 3500);
  }, []);

  const value = useMemo(() => ({ me, ready, setMe, refresh, logout, toast }), [me, ready, setMe, refresh, logout, toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastText && <div className="toast" role="status">{toastText}</div>}
    </Ctx.Provider>
  );
}
