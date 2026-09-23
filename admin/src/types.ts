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
  categoryId?: Id;
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
  status?: string;
  stockQuantity?: number;
  safeStockQuantity?: number;
  soldQuantity?: number;
  [key: string]: unknown;
}

export interface Order {
  _id?: Id;
  orderNo?: string;
  uid?: string;
  userId?: string;
  status?: string | number;
  orderStatusName?: string;
  paymentStatus?: string | number;
  paymentAmount?: number | string;
  totalAmount?: number | string;
  createTime?: string | number;
  items?: unknown[];
  orderItemVOs?: unknown[];
  logistics?: Record<string, unknown>;
  logisticsVO?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Comment {
  _id?: Id;
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
  createdAt?: string | number;
  [key: string]: unknown;
}

export interface AfterSale {
  _id?: Id;
  afterSaleNo?: string;
  rightsNo?: string;
  orderNo?: string;
  userId?: string;
  type?: string | number;
  rightsType?: string | number;
  status?: string;
  rightsStatus?: string | number;
  reason?: string;
  description?: string;
  amount?: number | string;
  refundAmount?: number | string;
  refundRequestAmount?: number | string;
  images?: unknown[];
  logisticsNo?: string;
  logisticsCompanyName?: string;
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
