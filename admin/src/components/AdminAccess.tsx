import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { adminApi, ApiError } from '../lib/api';

export function AdminAccess({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('正在连接后台…');
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try { await adminApi.call('auth.check'); setReady(true); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : '连接失败，请重试'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void verify(); }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault(); sessionStorage.setItem('wc-shop.admin-token', token.trim()); void verify();
  };
  if (ready) return children;
  return <main style={{ maxWidth: 420, margin: '15vh auto', padding: 24 }}>
    <h1>商城管理后台</h1>
    <p>{message}</p>
    <form onSubmit={submit}>
      <label htmlFor="admin-token">后台访问口令</label>
      <input id="admin-token" type="password" autoComplete="off" value={token}
        onChange={(event) => setToken(event.target.value)} style={{ display: 'block', width: '100%', margin: '12px 0', padding: 10 }} />
      <button type="submit" disabled={busy}>{busy ? '验证中…' : '进入后台'}</button>
    </form>
  </main>;
}
