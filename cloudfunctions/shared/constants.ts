// @ts-nocheck

const COLLECTIONS = Object.freeze({
  categories: 'categories',
  products: 'products',
  skus: 'skus',
  addresses: 'addresses',
  carts: 'carts',
  orders: 'orders',
  orderRequests: 'orderRequests',
  comments: 'comments',
  afterSales: 'afterSales',
  homeContents: 'homeContents',
  settings: 'settings',
  searchHistories: 'searchHistories',
});

const STATUS = Object.freeze({
  active: 'active',
  inactive: 'inactive',
  paid: 'paid',
  shipped: 'shipped',
  received: 'received',
  completed: 'completed',
  refundRequested: 'refund_requested',
  refunding: 'refunding',
  refunded: 'refunded',
  withdrawn: 'withdrawn',
  pendingReview: 'pending_review',
  approved: 'approved',
  rejected: 'rejected',
});

const ORDER_STATUS = Object.freeze([
  STATUS.paid,
  STATUS.shipped,
  STATUS.received,
  STATUS.completed,
  STATUS.refunded,
]);

const AFTER_SALE_STATUS = Object.freeze([
  STATUS.pendingReview,
  STATUS.approved,
  STATUS.rejected,
  STATUS.refunding,
  STATUS.refunded,
  STATUS.withdrawn,
]);

module.exports = {
  COLLECTIONS,
  STATUS,
  ORDER_STATUS,
  AFTER_SALE_STATUS,
};
