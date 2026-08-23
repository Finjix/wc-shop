const COLLECTIONS = Object.freeze({
  categories: 'categories',
  products: 'products',
  skus: 'skus',
  users: 'users',
  addresses: 'addresses',
  carts: 'carts',
  orders: 'orders',
  comments: 'comments',
  afterSales: 'afterSales',
  homeContents: 'homeContents',
  settings: 'settings',
  searchHistories: 'searchHistories',
  adminMembers: 'adminMembers',
});

const STATUS = Object.freeze({
  active: 'active',
  inactive: 'inactive',
  pendingPayment: 'pending_payment',
  paid: 'paid',
  shipped: 'shipped',
  received: 'received',
  completed: 'completed',
  cancelled: 'cancelled',
  refundRequested: 'refund_requested',
  refunding: 'refunding',
  refunded: 'refunded',
  pendingReview: 'pending_review',
  approved: 'approved',
  rejected: 'rejected',
});

const ORDER_STATUS = Object.freeze([
  STATUS.pendingPayment,
  STATUS.paid,
  STATUS.shipped,
  STATUS.received,
  STATUS.completed,
  STATUS.cancelled,
]);

const AFTER_SALE_STATUS = Object.freeze([
  STATUS.pendingReview,
  STATUS.approved,
  STATUS.rejected,
  STATUS.refunding,
  STATUS.refunded,
]);

const ADMIN_ROLES = Object.freeze([
  'superadmin',
  'admin',
  'operations',
  'inventory',
  'customer_service',
  'content',
]);

const ADMIN_SCOPES = Object.freeze({
  read: ADMIN_ROLES,
  catalog: ['superadmin', 'admin', 'operations', 'inventory', 'content'],
  orders: ['superadmin', 'admin', 'operations', 'customer_service'],
  users: ['superadmin', 'admin', 'customer_service'],
  content: ['superadmin', 'admin', 'operations', 'content'],
  settings: ['superadmin', 'admin'],
});

module.exports = {
  COLLECTIONS,
  STATUS,
  ORDER_STATUS,
  AFTER_SALE_STATUS,
  ADMIN_ROLES,
  ADMIN_SCOPES,
};
