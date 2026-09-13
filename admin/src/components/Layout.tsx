import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Button } from 'tdesign-react';
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
      { to: '/skus', label: 'SKU / 库存', icon: '◇' },
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
];

export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { logout } = useAuth();

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
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setOpen(true)} aria-label="打开导航">☰</button>
          <div className="topbar-actions">
            <div className="account-menu">
              <Button variant="text" theme="default" onClick={() => void logout()}>退出</Button>
            </div>
          </div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  );
}
