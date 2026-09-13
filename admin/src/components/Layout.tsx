import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, Tag } from 'tdesign-react';
import { useAuth } from '../auth/AuthProvider';

const navGroups = [
  {
    title: '工作台',
    items: [{ to: '/overview', label: '概览', icon: '⌂' }],
  },
  {
    title: '商品中心',
    items: [
      { to: '/products', label: '商品', icon: '▦' },
      { to: '/categories', label: '分类', icon: '◫' },
      { to: '/skus', label: 'SKU', icon: '◇' },
      { to: '/inventory', label: '库存', icon: '▤' },
    ],
  },
  {
    title: '交易与内容',
    items: [
      { to: '/home-content', label: '首页内容', icon: '✦' },
      { to: '/orders', label: '订单', icon: '▣' },
      { to: '/comments', label: '评论', icon: '✎' },
      { to: '/after-sales', label: '售后', icon: '↩' },
    ],
  },
  {
    title: '用户与系统',
    items: [
      { to: '/users', label: '用户 / 地址', icon: '♙' },
      { to: '/settings', label: '系统设置', icon: '⚙' },
    ],
  },
];

export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { member, logout } = useAuth();
  const location = useLocation();
  const current = navGroups.flatMap((group) => group.items).find((item) => location.pathname.startsWith(item.to));

  return (
    <div className="admin-shell">
      <div className={`sidebar-backdrop ${open ? 'visible' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/overview" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">W</span>
          <span>wc-shop <small>ADMIN</small></span>
        </Link>
        <nav className="side-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">CloudBase Web Admin</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setOpen(true)} aria-label="打开导航">☰</button>
          <div>
            <div className="breadcrumb">管理后台 / {current?.label || '页面'}</div>
            <h1>{current?.label || '管理后台'}</h1>
          </div>
          <div className="topbar-actions">
            <Tag theme="success" variant="light">真实云端</Tag>
            <div className="account-menu">
              <span className="avatar">{String(member?.displayName || member?.username || '管').slice(0, 1)}</span>
              <span className="account-name">{member?.displayName || member?.username || '管理员'}</span>
              <Button variant="text" theme="default" onClick={() => void logout()}>退出</Button>
            </div>
          </div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  );
}
