import { lazy } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AdminLayout } from './components/Layout';

const OverviewPage = lazy(() => import('./pages/Pages').then(m => ({ default: m.OverviewPage })));
const ProductsPage = lazy(() => import('./pages/Pages').then(m => ({ default: m.ProductsPage })));
const HomeContentPage = lazy(() => import('./pages/HomeContentPage').then(m => ({ default: m.HomeContentPage })));
const AfterSalesPage = lazy(() => import('./pages/CommercePages').then(m => ({ default: m.AfterSalesPage })));
const CommentsPage = lazy(() => import('./pages/CommercePages').then(m => ({ default: m.CommentsPage })));
const OrderDetailPage = lazy(() => import('./pages/CommercePages').then(m => ({ default: m.OrderDetailPage })));
const OrdersPage = lazy(() => import('./pages/CommercePages').then(m => ({ default: m.OrdersPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const SkuInventoryPage = lazy(() => import('./pages/SkuInventoryPage').then(m => ({ default: m.SkuInventoryPage })));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage').then(m => ({ default: m.MaintenancePage })));
const ActivityPage = lazy(() => import('./pages/ActivityPage').then(m => ({ default: m.ActivityPage })));
const ReturnAddressesPage = lazy(() => import('./pages/ReturnAddressesPage').then(m => ({ default: m.ReturnAddressesPage })));

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
        { path: 'activity', element: <ActivityPage /> },
        { path: 'orders', element: <OrdersPage /> },
        { path: 'orders/:orderNo', element: <OrderDetailPage /> },
        { path: 'comments', element: <CommentsPage /> },
        { path: 'after-sales', element: <AfterSalesPage /> },
        { path: 'after-sales/:afterSaleId', element: <AfterSalesPage /> },
        { path: 'after-sales/address', element: <ReturnAddressesPage /> },
        { path: 'settings', element: <Navigate to="/after-sales/address" replace /> },
      ],
  },
  { path: '*', element: <Navigate to="/overview" replace /> },
]);

export function App() { return <RouterProvider router={router} />; }
