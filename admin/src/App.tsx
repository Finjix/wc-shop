import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AdminLayout } from './components/Layout';
import { AdminAccess } from './components/AdminAccess';
import { HomeContentPage, OverviewPage, ProductsPage } from './pages/Pages';
import { AfterSalesPage, CommentsPage, OrderDetailPage, OrdersPage, SettingsPage } from './pages/CommercePages';
import { CategoriesPage } from './pages/CategoriesPage';
import { SkuInventoryPage } from './pages/SkuInventoryPage';
import { MaintenancePage } from './pages/MaintenancePage';

const router = createHashRouter([
  {
      element: <AdminLayout />,
      children: [
        { index: true, element: <Navigate to="/overview" replace /> },
        { path: 'overview', element: <OverviewPage /> },
        { path: 'maintenance', element: <MaintenancePage /> },
        { path: 'products', element: <ProductsPage /> },
        { path: 'products/new', element: <ProductsPage key="new" editorMode /> },
        { path: 'products/:productId/edit', element: <ProductsPage key="edit" editorMode /> },
        { path: 'categories', element: <CategoriesPage /> },
        { path: 'skus', element: <SkuInventoryPage /> },
        { path: 'inventory', element: <Navigate to="/skus" replace /> },
        { path: 'home-content', element: <HomeContentPage /> },
        { path: 'orders', element: <OrdersPage /> },
        { path: 'orders/:orderNo', element: <OrderDetailPage /> },
        { path: 'comments', element: <CommentsPage /> },
        { path: 'after-sales', element: <AfterSalesPage /> },
        { path: 'after-sales/:afterSaleId', element: <AfterSalesPage /> },
        { path: 'after-sales/address', element: <SettingsPage /> },
        { path: 'settings', element: <Navigate to="/after-sales/address" replace /> },
      ],
  },
  { path: '*', element: <Navigate to="/overview" replace /> },
]);

export function App() { return <AdminAccess><RouterProvider router={router} /></AdminAccess>; }
