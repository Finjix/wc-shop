// Set an entry to true to restore navigation to that page.
export const pageNavigationEnabled: Record<string, boolean> = {
  'pages/cart/index': true,
  'pages/usercenter/index': true,
  'pages/order/order-confirm/index': true,
};

export function isPageNavigationEnabled(url: string) {
  const route = String(url || '').replace(/^\//, '').split(/[?#]/)[0];
  return pageNavigationEnabled[route] !== false;
}
