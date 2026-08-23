import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AdminLayout } from './components/Layout';
import { AfterSalesPage, CategoriesPage, CommentsPage, HomeContentPage, OrderDetailPage, OrdersPage, OverviewPage, ProductsPage, SettingsPage, SkuPage, UsersPage } from './pages/Pages';
import { LoginPage } from './pages/LoginPage';
import { LoadingState } from './components/Ui';

function ProtectedRoute() {
  const { loading, loginState, member } = useAuth();
  if (loading) return <LoadingState />;
  if (!loginState || !member) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="skus" element={<SkuPage />} />
        <Route path="inventory" element={<SkuPage inventory />} />
        <Route path="home-content" element={<HomeContentPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderNo" element={<OrderDetailPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="comments" element={<CommentsPage />} />
        <Route path="after-sales" element={<AfterSalesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/overview" replace />} />
  </Routes>;
}
