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
  return <div className="login-page"><div className="login-decoration"><span className="decoration-circle circle-one" /><span className="decoration-circle circle-two" /><div className="login-brand"><span className="brand-mark">W</span><div><strong>wc-shop</strong><small>CloudBase 管理后台</small></div></div><p>商品、订单、内容与用户数据的云端工作台。</p></div><main className="login-card"><div className="mobile-login-brand"><span className="brand-mark">W</span><strong>wc-shop 管理后台</strong></div><h1>欢迎回来</h1><p className="login-subtitle">使用 CloudBase 用户名登录</p>{!configured && <div className="notice warning">尚未配置 <code>VITE_CLOUDBASE_ENV_ID</code>，请在 admin 项目环境变量中设置环境 ID。</div>}{(error || localError) && <div className="notice error">{localError || error}</div>}<form onSubmit={submit}><label className="login-field"><span>用户名</span><Input value={username} onChange={setUsername} placeholder="请输入 CloudBase 用户名" autocomplete="username" /></label><label className="login-field"><span>密码</span><Input value={password} onChange={setPassword} type="password" placeholder="请输入密码" autocomplete="current-password" /></label><Button type="submit" block theme="primary" size="large" loading={loading} disabled={!configured}>登录管理后台</Button></form><p className="login-footnote">仅 adminMembers 中启用的管理员账号可访问。</p></main></div>;
}
