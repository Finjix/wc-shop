import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from 'tdesign-react';
import { useAuth } from '../auth/AuthProvider';

export function LoginPage() {
  const { configured, loading, error, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    if (!username.trim() || !password) { setLocalError('请输入用户名和密码。'); return; }
    try { await login(username.trim(), password); navigate('/overview', { replace: true }); } catch { /* AuthProvider 已展示错误 */ }
  };
  return <div className="login-page"><main className="login-card">{!configured && <div className="notice warning">未配置环境 ID，请设置 <code>VITE_CLOUDBASE_ENV_ID</code>。</div>}{(error || localError) && <div className="notice error">{localError || error}</div>}<form onSubmit={submit}><label className="login-field"><span>用户名</span><Input value={username} onChange={setUsername} placeholder="用户名" autocomplete="username" /></label><label className="login-field"><span>密码</span><Input value={password} onChange={setPassword} type="password" placeholder="密码" autocomplete="current-password" /></label><Button type="submit" block theme="primary" size="large" loading={loading} disabled={!configured}>登录</Button></form></main></div>;
}
