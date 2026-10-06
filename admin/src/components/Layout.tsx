import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ImageLightbox } from './ImageLightbox';
import { useConfirm } from './ConfirmProvider';

export type AdminOutletContext = { setUnsavedChanges: (value: boolean) => void };

const navItems = [
  { to: '/overview', label: '概览' },
  { to: '/home-content', label: '首页' },
  { to: '/products', label: '商品' },
  { to: '/skus', label: '库存' },
  { to: '/categories', label: '分类' },
  { to: '/orders', label: '订单' },
  { to: '/comments', label: '评价', disabled: true },
  { to: '/after-sales', label: '售后', disabled: true },
];

export function AdminLayout() {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: string; id: number } | null>(null);
  const { logout } = useAuth();
  const handleLogout = async () => {
    if (unsavedChanges && !await confirm('设置尚未保存。确定放弃修改并退出吗？')) return;
    await logout();
  };
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; kind?: string }>).detail;
      if (!detail?.text) return;
      setNotice({ text: detail.text, kind: detail.kind || 'success', id: Date.now() });
    };
    window.addEventListener('admin:message', receive);
    return () => window.removeEventListener('admin:message', receive);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  return (
    <div className="admin-shell">
      <ImageLightbox />
      <div className={`sidebar-backdrop ${open ? 'visible' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <nav className="side-nav">
          {navItems.map((item) => item.disabled ? (
            <span key={item.to} className="nav-link nav-link-disabled" aria-disabled="true" title="暂未开放">{item.label}</span>
          ) : (
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
        {notice && <div key={notice.id} className={`admin-toast ${notice.kind}`} role="status" aria-live="polite">{notice.text}</div>}
        <div className="page-content">
          <button className="menu-button" onClick={() => setOpen(true)} aria-label="打开导航">☰</button>
          <Outlet context={{ setUnsavedChanges } satisfies AdminOutletContext} />
        </div>
      </main>
    </div>
  );
}
