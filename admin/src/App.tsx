import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AdminLayout } from './components/Layout';
import { AfterSalesPage, CategoriesPage, CommentsPage, HomeContentPage, OrderDetailPage, OrdersPage, OverviewPage, ProductsPage, SkuPage } from './pages/Pages';
import { LoginPage } from './pages/LoginPage';
import { LoadingState } from './components/Ui';

function ProtectedRoute() {
  const { loading, loginState, member } = useAuth();
  if (loading) return <LoadingState />;
  if (!loginState || !member) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createHashRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [{
      element: <AdminLayout />,
      children: [
        { index: true, element: <Navigate to="/overview" replace /> },
        { path: 'overview', element: <OverviewPage /> },
        { path: 'products', element: <ProductsPage /> },
        { path: 'categories', element: <CategoriesPage /> },
        { path: 'skus', element: <SkuPage /> },
        { path: 'inventory', element: <Navigate to="/skus" replace /> },
        { path: 'home-content', element: <HomeContentPage /> },
        { path: 'orders', element: <OrdersPage /> },
        { path: 'orders/:orderNo', element: <OrderDetailPage /> },
        { path: 'comments', element: <CommentsPage /> },
        { path: 'after-sales', element: <AfterSalesPage /> },
      ],
    }],
  },
  { path: '*', element: <Navigate to="/overview" replace /> },
]);

export function App() { return <RouterProvider router={router} />; }
