export type Id = string | number;

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  requestId?: string;
  message?: string;
  error?: { code?: string; message?: string; details?: Record<string, unknown> } | string;
}

export interface AdminMember {
  _id?: Id;
  uid?: string;
  username?: string;
  displayName?: string;
  role?: string | string[];
  roles?: string | string[];
  enabled?: boolean;
  status?: string;
  [key: string]: unknown;
}

export interface ListResult<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface Product {
  _id?: Id;
  spuId?: Id;
  title: string;
  subtitle?: string;
  description?: string;
  primaryImage?: string;
  images?: string[];
  detailImages?: string[];
  categoryIds?: Id[];
  minSalePrice?: number | string;
  maxSalePrice?: number | string;
  minLinePrice?: number | string;
  maxLinePrice?: number | string;
  isPutOnSale?: boolean | number;
  status?: string;
  specList?: unknown[];
  [key: string]: unknown;
}

export interface Category {
  _id?: Id;
  id?: Id;
  name: string;
  parentId?: Id | null;
  sort?: number;
  image?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface Sku {
  _id?: Id;
  skuId?: Id;
  spuId?: Id;
  productId?: Id;
  title?: string;
  specInfo?: unknown[];
  price?: number | string;
  salePrice?: number | string;
  linePrice?: number | string;
  stockQuantity?: number;
  safeStockQuantity?: number;
  soldQuantity?: number;
  [key: string]: unknown;
}

export type OrderStatus = 'paid' | 'shipped' | 'received' | 'completed' | 'refunded';
export type OrderPaymentStatus = 'paid' | 'partially_refunded' | 'refunded';

export interface Order {
  canDeleteAdmin?: boolean;
  _id?: Id;
  orderId?: Id;
  orderNo?: string;
  uid?: string;
  userId?: string;
  status?: OrderStatus;
  orderStatusName?: string;
  paymentStatus?: OrderPaymentStatus;
  paymentAmount?: number | string;
  totalAmount?: number | string;
  amount?: number | string;
  refundAmount?: number | string;
  refundedAmount?: number | string;
  totalRefundAmount?: number | string;
  createTime?: string | number;
  createdAt?: string | number;
  paymentMode?: string;
  payment?: { mode?: string; status?: OrderPaymentStatus; [key: string]: unknown };
  tracking?: Record<string, unknown>;
  refundStatus?: string;
  items?: unknown[];
  logistics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ShippingAddress {
  receiver: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  address: string;
}

export interface OrderAddressGroup {
  key: string;
  address: ShippingAddress;
  canCombine: boolean;
  orders: Order[];
  orderCount: number;
}

export interface Comment {
  _id?: Id;
  id?: Id;
  orderNo?: string;
  productId?: Id;
  userId?: string;
  userName?: string;
  content?: string;
  commentContent?: string;
  score?: number;
  commentScore?: number;
  rating?: number;
  images?: unknown[];
  status?: string;
  reply?: string;
  repliedAt?: string | number;
  createdAt?: string | number;
  [key: string]: unknown;
}

export interface AfterSale {
  canDeleteAdmin?: boolean;
  scenario?: 'cancel_order' | 'after_sale';
  presentation?: { typeLabel: string; receiptStatusLabel: string };
  reviewPolicy?: { allowedTypes: number[]; fixedType: number | null; fullRefundOnly: boolean; maximumAmount: number };
  actions?: { withdraw: boolean; reapply: boolean; countInBadge: boolean };
  _id?: Id;
  orderNo?: string;
  userId?: string;
  type?: number;
  status?: string;
  reason?: string;
  description?: string;
  amount?: number | string;
  refundAmount?: number | string;
  refundRequestAmount?: number | string;
  images?: unknown[];
  logisticsNo?: string;
  logisticsCompanyName?: string;
  trackingCompany?: string;
  trackingNo?: string;
  orderId?: Id;
  items?: unknown[];
  returnAddressSnapshot?: Record<string, unknown>;
  createdAt?: string | number;
  [key: string]: unknown;
}

export interface LoginState {
  user?: { uid?: string; username?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ProductDraft {
  title: string;
  categoryId: string;
  primaryImage: string;
  detailImages: string[];
  [key: string]: unknown;
}
