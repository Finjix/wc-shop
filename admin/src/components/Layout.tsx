import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export type AdminOutletContext = { setUnsavedChanges: (value: boolean) => void };

const navItems = [
  { to: '/overview', label: '概览' },
  { to: '/home-content', label: '首页内容' },
  { to: '/products', label: '商品' },
  { to: '/categories', label: '分类' },
  { to: '/skus', label: 'SKU / 库存' },
  { to: '/orders', label: '订单' },
  { to: '/comments', label: '评论' },
  { to: '/after-sales', label: '售后' },
];

export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const { logout } = useAuth();
  const handleLogout = async () => {
    if (unsavedChanges && !window.confirm('首页设置尚未保存。确定放弃修改并退出吗？')) return;
    await logout();
  };

  return (
    <div className="admin-shell">
      <div className={`sidebar-backdrop ${open ? 'visible' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <nav className="side-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="logout-button" onClick={() => void handleLogout()}>退出</button>
        </div>
      </aside>

      <main className="main-area">
        <div className="page-content">
          <button className="menu-button" onClick={() => setOpen(true)} aria-label="打开导航">☰</button>
          <Outlet context={{ setUnsavedChanges } satisfies AdminOutletContext} />
        </div>
      </main>
    </div>
  );
}
