import { useState } from 'react';
import { AdminApp } from './admin/Admin';
import { match, navigate, usePath } from './router';
import { AuthScreen } from './screens/Auth';
import { FeedDetail, FeedScreen } from './screens/Feed';
import { HomeScreen } from './screens/Home';
import { InstallmentDetail, InstallmentsScreen } from './screens/Installments';
import { InstallmentForm } from './screens/InstallmentForm';
import { PotDetail, PotForm } from './screens/Pots';
import { SettingsScreen } from './screens/Settings';
import { Welcome, welcomeSeen } from './screens/Welcome';
import { useAuth } from './store';
import { Nav, useOnline } from './ui';

export function App() {
  const path = usePath().split('?')[0]!;
  const { me, ready } = useAuth();
  const online = useOnline();
  const [welcomed, setWelcomed] = useState(welcomeSeen());

  if (path.startsWith('/admin')) return <AdminApp />;
  if (path === '/welcome') return <Welcome onDone={() => { setWelcomed(true); navigate(me ? '/settings' : '/', true); }} />;
  // Первое открытие без ссылки на покупку: сначала приветственные экраны.
  if (!me && ready && !welcomed && (path === '/' || path === '/home')) return <Welcome onDone={() => setWelcomed(true)} />;
  if (path === '/login') return <div className="app"><main className="main"><AuthScreen /></main></div>;

  let screen: React.ReactNode;
  if (path === '/' || path === '/feed') screen = <FeedScreen />;
  else if (match('/feed/:id', path)) screen = <FeedDetail />;
  else if (path === '/home') screen = <HomeScreen />;
  else if (path === '/installments') screen = <InstallmentsScreen />;
  else if (path === '/installments/new' || match('/installments/:id/edit', path)) screen = me ? <InstallmentForm /> : <AuthScreen />;
  else if (match('/installments/:id', path)) screen = me ? <InstallmentDetail /> : <AuthScreen />;
  else if (path === '/pots/new') screen = me ? <PotForm /> : <AuthScreen />;
  else if (match('/pots/:id', path)) screen = me ? <PotDetail /> : <AuthScreen />;
  else if (path === '/settings') screen = <SettingsScreen />;
  else screen = <FeedScreen />;

  return (
    <div className="app">
      <Nav />
      <main className="main">
        {!online && <div className="banner" role="status" style={{ borderRadius: 0, textAlign: 'center' }}>Нет интернета: показаны сохранённые данные</div>}
        {screen}
      </main>
    </div>
  );
}
