import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Input, MessagePlugin, Tag } from 'tdesign-react';
import { adminApi } from '../lib/api';
import { IMAGE_ACCEPT, type UploadPhase } from '../lib/image-upload';
import { variantName } from '../lib/sku';
import type { AfterSale, Category, Comment, ListResult, Order, Product, ProductDraft, Sku } from '../types';
import { EmptyState, EmptyTable, ErrorState, Field, ImageFilePicker, LoadingState, Panel, Table, formatDate, formatMoney, readList, readTotal } from '../components/Ui';

function useResource<T>(action: string, payload: Record<string, unknown> = {}, refreshKey = 0, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    setError('');
    adminApi.call<T>(action, payload).then((value) => {
      if (active) setData(value);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '请求失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [action, JSON.stringify(payload), refreshKey, enabled]); // payload 是页面内的只读请求参数
  return { data, loading, error };
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(action: string, payload: Record<string, unknown>, success?: string) => {
    setBusy(true);
    try {
      const result = await adminApi.call<T>(action, payload);
      if (success) await MessagePlugin.success(success);
      return result;
    } catch (error) {
      await MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
      throw error;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

const orderStatusLabels: Record<string, string> = {
  pending_payment: '待支付',
  paid: '待发货',
  shipped: '待收货',
  received: '已完成',
  completed: '已完成',
  cancelled: '已取消',
};

const orderStatusFilterOptions = [
  ['pending_payment', '待支付'],
  ['paid', '待发货'],
  ['shipped', '待收货'],
  ['completed', '已完成'],
  ['cancelled', '已取消'],
] as const;

const paymentStatusLabels: Record<string, string> = {
  unpaid: '未支付',
  pending: '待支付',
  pending_payment: '待支付',
  paid: '已支付',
  success: '已支付',
};

const afterSaleTypeLabels: Record<string, string> = {
  '10': '退货退款',
  return: '退货退款',
  return_goods: '退货退款',
  refund_goods: '退货退款',
  '20': '仅退款',
  refund: '仅退款',
  only_refund: '仅退款',
  refund_money: '仅退款',
  '30': '取消订单',
  order_cancel: '取消订单',
};

const afterSaleStatusLabels: Record<string, string> = {
  pending_review: '待审核',
  approved: '审核通过 / 待寄回',
  refunding: '退款中',
  refunded: '退款完成',
  rejected: '已拒绝',
  inactive: '已关闭',
};

function normalizedKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function productStatusOf(product: Product) {
  return normalizedKey(product.status || (product.isPutOnSale ? 'active' : 'inactive')) || 'inactive';
}

function orderStatusOf(value: unknown) {
  const key = normalizedKey(value);
  return ({
    '5': 'pending_payment',
    '10': 'paid',
    '40': 'shipped',
    '50': 'completed',
    '80': 'cancelled',
    pending: 'pending_payment',
    pending_payment: 'pending_payment',
    paid: 'paid',
    pending_delivery: 'paid',
    shipped: 'shipped',
    pending_receipt: 'shipped',
    received: 'received',
    complete: 'completed',
    completed: 'completed',
    canceled: 'cancelled',
    cancelled: 'cancelled',
  } as Record<string, string>)[key] || key;
}

function orderStatusLabel(value: unknown, fallback = '—') {
  const key = orderStatusOf(value);
  return orderStatusLabels[key] || (String(value ?? '').trim() || fallback);
}

function paymentStatusLabel(value: unknown) {
  const key = normalizedKey(value);
  return paymentStatusLabels[key] || (String(value ?? '').trim() || '—');
}

function formatSpecInfo(value: unknown) {
  if (!Array.isArray(value)) return String(value || '—');
  const items = value.map((item) => {
    if (!item || typeof item !== 'object') return String(item);
    const source = item as Record<string, unknown>;
    const title = source.specTitle || source.title || source.specId || '';
    const content = source.specValue || source.value || source.specValueId || '';
    return [title, content].filter(Boolean).join('：');
  }).filter(Boolean);
  return items.join(' / ') || '—';
}

function orderItemSpecInfo(item: Record<string, unknown>) {
  if (item.specifications !== undefined) return item.specifications;
  if (item.specInfo !== undefined) return item.specInfo;
  const snapshot = item.skuSnapshot;
  return snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>).specInfo : undefined;
}

function recordOf(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstText(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function deliveryAddressOf(order: Order) {
  const source = [order.addressSnapshot, order.userAddress, order.userAddressReq, order.address]
    .map(recordOf)
    .find((value): value is Record<string, unknown> => Boolean(value));
  if (!source) return { receiver: '—', phone: '—', address: '—' };
  const receiver = firstText(source, ['receiver', 'name', 'consignee', 'contactName']);
  const phone = firstText(source, ['phone', 'phoneNumber', 'mobile']);
  const region = [
    firstText(source, ['province', 'provinceName']),
    firstText(source, ['city', 'cityName']),
    firstText(source, ['district', 'districtName', 'countyName']),
  ].filter(Boolean).join(' ');
  const detail = firstText(source, ['detail', 'detailAddress', 'detailInfo', 'address']);
  return {
    receiver: receiver || '—',
    phone: phone || '—',
    address: [region, detail].filter(Boolean).join(' ') || '—',
  };
}

function afterSaleTypeLabel(value: unknown) {
  const key = normalizedKey(value);
  return afterSaleTypeLabels[key] || (String(value ?? '').trim() || '—');
}

function afterSaleStatusKey(value: unknown) {
  const key = normalizedKey(value);
  return ({
    pending: 'pending_review',
    refund_requested: 'pending_review',
    '100': 'pending_review',
    '110': 'approved',
    '120': 'approved',
    '130': 'refunding',
    '140': 'refunding',
    '150': 'refunding',
    '160': 'refunded',
    '170': 'rejected',
  } as Record<string, string>)[key] || key;
}

function afterSaleStatusLabel(value: unknown) {
  const key = afterSaleStatusKey(value);
  return afterSaleStatusLabels[key] || (String(value ?? '').trim() || '待处理');
}

function commentStatusLabel(value: unknown) {
  const key = commentStatusKey(value);
  return ({ pending_review: '待审核', active: '已展示', rejected: '已隐藏', inactive: '已关闭' } as Record<string, string>)[key]
    || (String(value ?? '').trim() || '待审核');
}

function commentStatusKey(value: unknown) {
  const key = normalizedKey(value);
  return ({ '0': 'pending_review', '1': 'active', approved: 'active' } as Record<string, string>)[key] || key;
}

export function OverviewPage() {
  const { data, loading, error } = useResource<Record<string, unknown>>('dashboard.summary');
  const warnings = (data?.inventoryWarnings || []) as { productId: string; title: string; skuId: string; specName: string; stockQuantity: number }[];
  const [warningPage, setWarningPage] = useState(1);
  const warningPageSize = 4;
  const warningPageCount = Math.max(1, Math.ceil(warnings.length / warningPageSize));
  useEffect(() => { setWarningPage((current) => Math.min(current, warningPageCount)); }, [warningPageCount]);
  const visibleWarnings = warnings.slice((warningPage - 1) * warningPageSize, warningPage * warningPageSize);
  const metrics = (data?.metrics || data || {}) as Record<string, unknown>;
  const value = (keys: string[]) => {
    const found = keys.map((key) => metrics[key]).find((item) => item !== undefined && item !== null);
    return found === undefined ? '—' : String(found);
  };
  return <>
    <div className="overview-page">
    <h1 className="overview-title">盛途优品后台管理系统 v261001</h1>
    {loading && <LoadingState />}
    {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
    {!loading && !error && <>
      <div className="metric-grid">
        <Metric label="商品总数" value={value(['productCount'])} />
      </div>
      <Panel className="overview-inventory-warnings">
        <div className="panel-heading"><h3>库存预警</h3></div>
        <div className="overview-inventory-warning-body">
        {warnings.length === 0 && <EmptyState title="暂无" />}
        {warnings.length > 0 && <Table>
          <thead><tr><th>商品</th><th>规格</th><th>当前库存</th><th>操作</th></tr></thead>
          <tbody>{visibleWarnings.map((item) => <tr key={`${item.productId}:${item.skuId}`}>
            <td>{item.title}</td><td>{item.specName}</td><td>{item.stockQuantity}</td>
            <td><div className="overview-warning-actions"><Link to={`/skus?query=${encodeURIComponent(item.title)}`}>补货</Link><Link to={`/products?query=${encodeURIComponent(item.title)}`}>编辑商品</Link></div></td>
          </tr>)}</tbody>
        </Table>}
        </div>
        {warnings.length > 0 && <div className="overview-inventory-pagination">
          <Button variant="outline" disabled={warningPage <= 1} onClick={() => setWarningPage((current) => current - 1)}>上一页</Button>
          <span>{warningPage} / {warningPageCount} 页</span>
          <Button variant="outline" disabled={warningPage >= warningPageCount} onClick={() => setWarningPage((current) => current + 1)}>下一页</Button>
        </div>}
      </Panel>
    </>}
    </div>
  </>;
}

const emptyProduct: ProductDraft = {
  title: '', categoryId: '', primaryImage: '', detailImages: [],
};

const PRODUCT_LIST_PAGE_SIZE = 7;

interface VariantDraft {
  localId: string;
  skuId?: string;
  name: string;
  price: string;
  skuImage: string;
}
const emptyVariant = (): VariantDraft => ({ localId: crypto.randomUUID(), name: '', price: '', skuImage: '' });

function productDetailImages(product: Product) {
  const cover = product.primaryImage || product.images?.[0];
  const images = product.detailImages?.length ? product.detailImages : product.images?.filter((image) => image !== cover) || [];
  return images.slice(0, 6);
}

function isRenderableImageSource(value: unknown): value is string {
  return typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value);
}

function needsTempImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(cloud|local):\/\//i.test(value);
}

function ProductImagePreview({ fileID, alt }: { fileID: string; alt: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    setSrc(isRenderableImageSource(fileID) ? fileID : '');
    if (needsTempImageUrl(fileID)) {
      void adminApi.getTempFileUrl(fileID).then((url) => { if (active) setSrc(url); }).catch(() => { if (active) setSrc(''); });
    }
    return () => { active = false; };
  }, [fileID]);
  return src ? <img className="product-image-preview" src={src} alt={alt} /> : <span className="product-image-filename">{fileID}</span>;
}

type CategoryOption = { id: string; label: string };
const CATEGORY_PICKER_PAGE_SIZE = 12;

function CategoryPicker({ value, onChange, options, disabled }: {
  value: string;
  onChange: (id: string) => void;
  options: CategoryOption[];
  disabled: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [page, query]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);
  const choices = [{ id: '', label: '无类别' }, ...options];
  const visible = choices.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(visible.length / CATEGORY_PICKER_PAGE_SIZE));
  const pageItems = visible.slice((page - 1) * CATEGORY_PICKER_PAGE_SIZE, page * CATEGORY_PICKER_PAGE_SIZE);
  const select = (id: string) => { onChange(id); setOpen(false); setQuery(''); setPage(1); };
  return <div className="home-product-picker product-category-picker" ref={rootRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="home-product-picker-trigger" disabled={disabled} aria-expanded={open} onClick={() => { setQuery(''); setPage(1); setOpen((current) => !current); }}>
      <span>{choices.find((item) => item.id === value)?.label || '原分类不可用，请重新选择'}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="home-product-picker-menu">
      <input autoFocus type="search" value={query} placeholder="搜索类别" aria-label="搜索类别" onChange={(event) => { setQuery(event.target.value); setPage(1); }} onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
        if (event.key === 'Enter' && pageItems.length) { event.preventDefault(); select(pageItems[0].id); }
      }} />
      <div className="home-product-picker-list" ref={listRef}>
        {pageItems.map((item) => <button type="button" key={item.id} onClick={() => select(item.id)}>{item.label}</button>)}
      </div>
      <div className="home-product-picker-footer">
        <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
        <span>{page} / {pageCount}</span>
        <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>下一页</button>
      </div>
    </div>}
  </div>;
}

export function ProductsPage({ editorMode = false }: { editorMode?: boolean }) {
  const navigate = useNavigate();
  const { productId: routeProductId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeEditProductId = editorMode ? routeProductId : searchParams.get('edit') || '';
  const [refreshKey, setRefreshKey] = useState(0);
  const routeProductQuery = searchParams.get('query') || '';
  const [productQueryInput, setProductQueryInput] = useState(routeProductQuery);
  const [productQuery, setProductQuery] = useState(routeProductQuery);
  useEffect(() => {
    if (editorMode) return;
    setProductQueryInput(routeProductQuery);
    setProductQuery(routeProductQuery);
    setProductPage(1);
  }, [routeProductQuery, editorMode]);
  const [productPage, setProductPage] = useState(1);
  const [statusChangingId, setStatusChangingId] = useState('');
  const [deletingProductId, setDeletingProductId] = useState('');
  const statusChangeRef = useRef(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct);
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [savedEditor, setSavedEditor] = useState<string | null>(null);
  const editorSnapshot = JSON.stringify({ draft, variants });
  const editorDirty = savedEditor !== null && editorSnapshot !== savedEditor;
  const editorRequest = useRef(0);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [uploading, setUploading] = useState('');
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('处理图片中…');
  const [detailUploadProgress, setDetailUploadProgress] = useState('');
  const [routeEditLoading, setRouteEditLoading] = useState(false);
  const detailInputRef = useRef<HTMLInputElement>(null);
  const { data, loading, error } = useResource<unknown>('products.list', {
    page: productPage,
    pageSize: PRODUCT_LIST_PAGE_SIZE,
    inactiveFirst: true,
    query: productQuery || undefined,
  }, refreshKey, !editorMode);
  const [categoryRows, setCategoryRows] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState('');
  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      const items: Category[] = [];
      for (let page = 1; ; page += 1) {
        const result = await adminApi.call<ListResult<Category>>('categories.list', { page, pageSize: 100, status: 'active' });
        items.push(...result.items);
        if (result.items.length < 100 || items.length >= (result.total || Infinity)) break;
      }
      if (active) setCategoryRows(items);
    };
    void loadCategories().catch((err: unknown) => { if (active) setCategoriesError(err instanceof Error ? err.message : '分类读取失败'); })
      .finally(() => { if (active) setCategoriesLoading(false); });
    return () => { active = false; };
  }, []);
  const { busy, run } = useAction();
  const rows = useMemo(() => readList<Product>(data), [data]);
  const total = readTotal(data, rows.length);
  const pageCount = Math.max(1, Math.ceil(total / PRODUCT_LIST_PAGE_SIZE));
  useEffect(() => {
    if (productPage > pageCount) setProductPage(pageCount);
  }, [pageCount, productPage]);
  const searchProducts = () => {
    setProductPage(1);
    setProductQuery(productQueryInput.trim());
  };
  useEffect(() => {
    if (productQueryInput.trim() === productQuery) return;
    const timer = window.setTimeout(() => {
      setProductPage(1);
      setProductQuery(productQueryInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [productQueryInput, productQuery]);
  const categoryIdOf = (category: Category) => String(category._id || category.id);
  const categorySort = (a: Category, b: Category) => Number(a.sort || 0) - Number(b.sort || 0) || categoryIdOf(a).localeCompare(categoryIdOf(b));
  const categoryOptions = categoryRows.filter((category) => !category.parentId).sort(categorySort).flatMap((parent) => {
    const children = categoryRows.filter((category) => String(category.parentId || '') === categoryIdOf(parent)).sort(categorySort);
    return children.length
      ? children.map((child) => ({ id: categoryIdOf(child), label: `${parent.name}-${child.name}` }))
      : [{ id: categoryIdOf(parent), label: parent.name }];
  });
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const fileIDs = Array.from(new Set(rows
      .map((product) => product.primaryImage)
      .filter(needsTempImageUrl)));
    if (fileIDs.length === 0) {
      setImageUrls({});
      return () => { active = false; };
    }
    void Promise.all(fileIDs.map(async (fileID) => {
      try {
        return [fileID, await adminApi.getTempFileUrl(fileID)] as const;
      } catch {
        return [fileID, ''] as const;
      }
    })).then((entries) => {
      if (active) setImageUrls(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [rows]);
  useEffect(() => {
    if (editorOpen && !variantsLoading && savedEditor === null) setSavedEditor(editorSnapshot);
  }, [editorOpen, variantsLoading, savedEditor, editorSnapshot]);
  const openEditor = async (product?: Product) => {
    setSavedEditor(null);
    const request = ++editorRequest.current;
    setEditorOpen(true);
    setEditing(product || null);
    setVariants([emptyVariant()]);
    setVariantsLoading(Boolean(product));
    setUploading('');
    setDetailUploadProgress('');
    setDraft(product ? {
      ...emptyProduct,
      title: product.title || '',
      categoryId: String(product.categoryIds?.[0] || product.categoryId || ''),
      primaryImage: product.primaryImage || product.images?.[0] || '',
      detailImages: productDetailImages(product),
    } : emptyProduct);
    if (product) {
      try {
        const refs = Array.from(new Set([product._id, product.spuId].filter(Boolean).map(String)));
        const results = await Promise.all(refs.map((ref) => adminApi.call<unknown>('skus.list', { productId: ref })));
        if (request !== editorRequest.current) return;
        const configuredIds = new Set((Array.isArray(product.specList) ? product.specList : []).flatMap((group) => {
          const values = (group as { specValueList?: { specValueId?: string }[] }).specValueList;
          return Array.isArray(values) ? values.map((value) => String(value.specValueId || '')) : [];
        }));
        const allSkus = Array.from(new Map(results.flatMap((result) => readList<Sku>(result)).map((sku) => [String(sku._id || sku.skuId), sku])).values());
        const existing = Array.isArray(product.specList)
          ? allSkus.filter((sku) => [sku._id, sku.skuId].filter(Boolean).some((id) => configuredIds.has(String(id))))
          : allSkus;
        setVariants(existing.length ? existing.map((sku) => ({
          localId: String(sku._id || sku.skuId),
          skuId: String(sku._id || sku.skuId),
          name: variantName(sku, product),
          price: Number.isFinite(Number(sku.salePrice ?? sku.price)) ? (Number(sku.salePrice ?? sku.price) / 100).toFixed(2) : '',
          skuImage: String(sku.skuImage || ''),
        })) : [emptyVariant()]);
      } catch (err) {
        if (request !== editorRequest.current) return;
        setEditorOpen(false);
        await MessagePlugin.error(err instanceof Error ? err.message : '读取商品规格失败');
      } finally {
        if (request === editorRequest.current) setVariantsLoading(false);
      }
    }
  };
  useEffect(() => {
    if (!editorMode && routeEditProductId) {
      navigate(`/products/${encodeURIComponent(routeEditProductId)}/edit`, { replace: true });
      return;
    }
    if (!routeEditProductId) {
      setRouteEditLoading(false);
      if (editorMode) void openEditor();
      return;
    }
    let active = true;
    setRouteEditLoading(true);
    void (async () => {
      try {
        const product = await adminApi.call<Product>('products.get', { id: routeEditProductId });
        if (active) await openEditor(product);
      } catch (err) {
        if (!active) return;
        await MessagePlugin.error(err instanceof Error ? err.message : '读取商品失败');
        navigate('/products', { replace: true });
      } finally {
        if (active) setRouteEditLoading(false);
      }
    })();
    return () => { active = false; };
  }, [routeEditProductId, editorMode]);
  const setValue = (key: keyof ProductDraft, value: string | boolean | string[]) => setDraft((old) => ({ ...old, [key]: value }));
  const uploadCover = async (file?: File) => {
    if (!file) return;
    const request = editorRequest.current;
    setUploading('cover');
    try {
      const fileID = await adminApi.upload(file, 'admin/products', setUploadPhase);
      if (request !== editorRequest.current) return;
      setDraft((old) => ({ ...old, primaryImage: fileID }));
      await MessagePlugin.success('图片已上传');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败');
    } finally { if (request === editorRequest.current) setUploading(''); }
  };
  const uploadVariantImage = async (localId: string, file?: File) => {
    if (!file || uploading) return;
    const request = editorRequest.current;
    setUploading(`sku:${localId}`);
    try {
      const fileID = await adminApi.upload(file, 'admin/products', setUploadPhase);
      if (request !== editorRequest.current) return;
      setVariants((old) => old.map((item) => item.localId === localId ? { ...item, skuImage: fileID } : item));
      await MessagePlugin.success('SKU 图片已上传');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败');
    } finally { if (request === editorRequest.current) setUploading(''); }
  };
  const uploadDetails = async (files: File[]) => {
    if (!files.length || uploading) return;
    if (draft.detailImages.length + files.length > 6) { await MessagePlugin.warning('商品详情图最多 6 张'); return; }
    const request = editorRequest.current;
    setUploading('details');
    try {
      for (const [index, file] of files.entries()) {
        setDetailUploadProgress(`${index + 1}/${files.length}`);
        const fileID = await adminApi.upload(file, 'admin/products', setUploadPhase);
        if (request !== editorRequest.current) return;
        setDraft((old) => ({ ...old, detailImages: [...old.detailImages, fileID] }));
      }
      await MessagePlugin.success('详情图片已上传');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '详情图片上传失败');
    } finally {
      if (request === editorRequest.current) { setUploading(''); setDetailUploadProgress(''); }
    }
  };
  const save = async () => {
    if (variantsLoading || uploading) return;
    const fail = async (message: string) => { await MessagePlugin.warning(message); };
    if (!draft.title.trim()) { await fail('请填写商品名称'); return; }
    const cleaned = variants.map((variant) => ({ ...variant, name: variant.name.trim(), price: variant.price.trim() }));
    if (!cleaned.length) { await fail('请至少添加 1 种商品规格和价格'); return; }
    if (cleaned.some((variant) => !variant.name || !/^\d+(?:\.\d{1,2})?$/.test(variant.price) || !Number.isSafeInteger(Math.round(Number(variant.price) * 100)) || Number(variant.price) <= 0)) {
      await fail('请为每个规格填写名称和大于 0 的价格（元，最多两位小数）'); return;
    }
    if (new Set(cleaned.map((variant) => variant.name)).size !== cleaned.length) { await fail('规格名称不能重复'); return; }
    if (!draft.primaryImage) { await fail('请上传商品封面图片'); return; }
    if (!draft.detailImages.some(Boolean)) { await fail('请至少上传 1 张商品详情图片'); return; }
    const { categoryId, ...productDraft } = draft;
    try { await run('products.save', {
      ...(editing ? { id: editing._id || editing.spuId } : {}),
      ...productDraft,
      images: [draft.primaryImage],
      detailImages: draft.detailImages.filter(Boolean),
      variants: cleaned.map((variant) => ({
        skuId: variant.skuId,
        name: variant.name,
        salePrice: Math.round(Number(variant.price) * 100),
        skuImage: variant.skuImage,
      })),
      categoryIds: categoryId ? [categoryId] : [],
    }, '商品已保存'); }
    catch (error) {
      await MessagePlugin.error(error instanceof Error ? error.message : '商品保存失败');
      return;
    }
    setEditing(null); setDraft(emptyProduct); setVariants([emptyVariant()]); setEditorOpen(false); setProductPage(1); setRefreshKey((key) => key + 1);
    if (editorMode) { navigate('/products'); return; }
    if (routeEditProductId) setSearchParams({}, { replace: true });
  };
  const cancelEditor = () => {
    if (editorMode) { editorRequest.current += 1; navigate('/products'); return; }
    editorRequest.current += 1;
    setEditing(null);
    setDraft(emptyProduct);
    setEditorOpen(false);
    if (routeEditProductId) setSearchParams({}, { replace: true });
  };
  const toggleProductStatus = async (product: Product) => {
    if (statusChangeRef.current || busy || deletingProductId) return;
    const id = String(product._id || product.spuId);
    const nextStatus = productStatusOf(product) === 'active' ? 'inactive' : 'active';
    if (nextStatus === 'inactive' && !window.confirm(`确定下架商品“${product.title}”吗？下架后小程序中将无法购买该商品。`)) return;
    statusChangeRef.current = true;
    setStatusChangingId(id);
    try {
      await adminApi.call('products.update', { id, status: nextStatus });
      setRefreshKey((key) => key + 1);
      await MessagePlugin.success(nextStatus === 'active' ? '商品已上架' : '商品已下架');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '商品状态更新失败');
    } finally { statusChangeRef.current = false; setStatusChangingId(''); }
  };
  const deleteProduct = async (product: Product) => {
    if (statusChangeRef.current || busy || deletingProductId) return;
    const id = String(product._id || product.spuId);
    if (!window.confirm(`确定删除商品“${product.title}”吗？删除后商品会从管理列表和小程序中移除，且无法直接恢复。`)) return;
    statusChangeRef.current = true;
    setDeletingProductId(id);
    try {
      await adminApi.call('products.delete', { id });
      setRefreshKey((key) => key + 1);
      await MessagePlugin.success('商品已删除');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '商品删除失败');
    } finally {
      statusChangeRef.current = false;
      setDeletingProductId('');
    }
  };
  return <>
    {!editorMode && <><div className="page-actions product-page-actions">
      <div className="product-page-search">
        <Input value={productQueryInput} onChange={setProductQueryInput} onEnter={(_value, { e }) => { e.preventDefault(); searchProducts(); }} placeholder="搜索商品名称" aria-label="搜索商品名称" />
      </div>
      <Button theme="primary" onClick={() => navigate('/products/new')}>新建商品</Button>
    </div>
    {(loading || routeEditLoading) && <LoadingState />}{!routeEditLoading && error && <ErrorState message={error} />}
    {!loading && !routeEditLoading && !error && <Panel className="product-list-panel"><Table><thead><tr><th>商品</th><th>操作</th><th aria-label="商品状态" /></tr></thead><tbody>
      {rows.length === 0 && <tr><td colSpan={3}><EmptyState title={productQuery ? '没有找到相关商品' : '暂无商品'} /></td></tr>}
      {rows.map((product) => {
        const fileID = String(product.primaryImage || '');
        const resolvedImage = imageUrls[fileID];
        const imageSource = isRenderableImageSource(resolvedImage) ? resolvedImage : isRenderableImageSource(fileID) ? fileID : '';
        const status = productStatusOf(product);
        const productId = String(product._id || product.spuId);
        const productActionInProgress = Boolean(statusChangingId || deletingProductId);
        return <tr key={productId} className={status === 'active' ? '' : 'product-list-inactive'}><td><div className="product-cell">{imageSource && <img src={imageSource} alt="" />}<div><strong>{product.title || '未命名商品'}</strong></div></div></td><td><div className="product-list-actions"><Button variant="text" className="product-list-edit" disabled={productActionInProgress || busy} onClick={() => navigate(`/products/${encodeURIComponent(productId)}/edit`)}>编辑</Button><Link className="product-list-sku-link" to={`/skus?query=${encodeURIComponent(product.title)}`}>库存</Link><Button variant="text" className="product-list-edit" loading={statusChangingId === productId} disabled={productActionInProgress || busy} onClick={() => void toggleProductStatus(product)}>{status === 'active' ? '下架' : '上架'}</Button><Button variant="text" className="product-list-delete" loading={deletingProductId === productId} disabled={productActionInProgress || busy} onClick={() => void deleteProduct(product)}>删除</Button></div></td><td className="product-list-status">{status !== 'active' && <strong className="product-list-inactive-label">已下架</strong>}</td></tr>;
      })}
    </tbody></Table>
      <div className="product-list-pagination">
        <span>共 {total} 个商品</span>
        <div>
          <Button variant="outline" disabled={productPage <= 1 || loading} onClick={() => setProductPage((page) => Math.max(1, page - 1))}>上一页</Button>
          <span>{productPage} / {pageCount} 页</span>
          <Button variant="outline" disabled={productPage >= pageCount || loading} onClick={() => setProductPage((page) => Math.min(pageCount, page + 1))}>下一页</Button>
        </div>
      </div>
    </Panel>}
    </>}{editorMode && routeEditLoading && <LoadingState />}
    {editorOpen ? <Panel className="editor-panel"><div className="product-editor-actions floating-save-actions"><Button variant="outline" onClick={cancelEditor}>取消</Button><Button theme="primary" loading={busy || variantsLoading || Boolean(uploading)} disabled={!editorDirty || busy || variantsLoading || Boolean(uploading)} onClick={() => void save()}>保存</Button></div><div className="form-grid">
       <Field label="商品名称"><Input value={draft.title} onChange={(value) => setValue('title', value)} placeholder="请输入商品名称" /></Field>
       <Field label="分类" fileUpload hint={categoriesError || (categoriesLoading ? '分类加载中...' : undefined)}><CategoryPicker value={draft.categoryId} onChange={(id) => setValue('categoryId', id)} options={categoryOptions} disabled={categoriesLoading || Boolean(categoriesError)} /></Field>
       <div className="variant-field"><strong>商品规格</strong>{variantsLoading && <small>正在读取已有规格…</small>}
         {variants.map((variant) => <div className="variant-row" key={variant.localId}>
           <div className="variant-main">
             <label><span>规格名称</span><Input value={variant.name} onChange={(value) => setVariants((old) => old.map((item) => item.localId === variant.localId ? { ...item, name: value } : item))} placeholder="例如：小份" /></label>
             <label><span>售价（元）</span><Input value={variant.price} onChange={(value) => setVariants((old) => old.map((item) => item.localId === variant.localId ? { ...item, price: value } : item))} placeholder="例如：29.90" /></label>
             <Button variant="text" disabled={variants.length === 1} onClick={() => setVariants((old) => old.filter((item) => item.localId !== variant.localId))}>删除</Button>
           </div>
           <div className="variant-image"><span>SKU 图片（可选）</span><ImageFilePicker onSelect={(file) => void uploadVariantImage(variant.localId, file)} disabled={Boolean(uploading)} />{uploading === `sku:${variant.localId}` && <small role="status">{uploadPhase}</small>}
             {variant.skuImage && <div className="product-image-item"><ProductImagePreview fileID={variant.skuImage} alt={`${variant.name || 'SKU'} 图片预览`} /><Button variant="text" onClick={() => setVariants((old) => old.map((item) => item.localId === variant.localId ? { ...item, skuImage: '' } : item))}>移除图片</Button></div>}
           </div>
         </div>)}
         <Button variant="outline" onClick={() => setVariants((old) => [...old, emptyVariant()])}>添加规格</Button>
       </div>
       <div className="product-cover-field"><Field label="封面图片（1:1）" fileUpload>
         <ImageFilePicker onSelect={(file) => void uploadCover(file)} disabled={Boolean(uploading)} />
         {uploading === 'cover' && <small role="status">{uploadPhase}</small>}
         {draft.primaryImage && <div className="product-image-item product-cover-preview"><ProductImagePreview fileID={draft.primaryImage} alt="商品封面预览" /></div>}
       </Field></div>
       <div className="product-detail-images">
         <div className="product-detail-image-heading"><strong>商品详情图片（最多 6 张）</strong></div>
         {draft.detailImages.length > 0 && <div className="product-detail-image-grid">
           {draft.detailImages.map((image, index) => <div className="product-detail-image-card" key={`${image}-${index}`}>
             <ProductImagePreview fileID={image} alt={`详情图 ${index + 1} 预览`} />
             <div className="product-detail-image-card-actions"><span>第 {index + 1} 张</span><Button variant="text" disabled={Boolean(uploading)} onClick={() => setDraft((old) => ({ ...old, detailImages: old.detailImages.filter((_, i) => i !== index) }))}>删除</Button></div>
           </div>)}
         </div>}
         <div className="product-detail-image-upload"><div className="image-file-picker">
           <button type="button" disabled={draft.detailImages.length >= 6 || Boolean(uploading)} onClick={() => detailInputRef.current?.click()}>选择文件</button>
           <span>{draft.detailImages.length ? `已上传 ${draft.detailImages.length} 张` : '未选择文件'}</span>
           <input ref={detailInputRef} className="image-file-picker-input" type="file" accept={IMAGE_ACCEPT} multiple disabled={Boolean(uploading)} aria-label="选择商品详情图片"
             onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadDetails(files); }} />
         </div>{uploading === 'details' && <small role="status">{uploadPhase} {detailUploadProgress}</small>}</div>
       </div>
    </div></Panel> : null}
  </>;
}

export { HomeContentPage } from './HomeContentPage';

export function OrdersPage() {
  const [orderNoQuery, setOrderNoQuery] = useState('');
  const [status, setStatus] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useResource<unknown>('orders.list', { page: 1, pageSize: 100, orderNo: orderNoQuery.trim() || undefined, status: status || undefined }, refreshKey);
  const rows = readList<Order>(data);
  const { busy, run } = useAction();
  const cancel = async (order: Order) => {
    await run('orders.cancel', { orderNo: order.orderNo || order._id, reason: '管理员取消' }, '订单已取消');
    setRefreshKey((key) => key + 1);
  };
  return <>
    <Panel className="toolbar">
      <Input value={orderNoQuery} onChange={setOrderNoQuery} placeholder="订单号" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{orderStatusFilterOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <Button onClick={() => setRefreshKey((key) => key + 1)}>查询</Button>
    </Panel>
    {loading && <LoadingState />}
    {error && <ErrorState message={error} />}
    {!loading && !error && <Panel>
      <Table>
        <thead><tr><th>订单号</th><th>金额</th><th>支付状态</th><th>订单状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyTable colSpan={6} />}
          {rows.map((order) => {
            const orderNo = String(order.orderNo || order._id || '');
            const normalized = orderStatusOf(order.status ?? order.orderStatusName);
            const cancelable = normalized === 'pending_payment';
            return <tr key={orderNo}>
              <td><Link to={`/orders/${encodeURIComponent(orderNo)}`}>{orderNo || '—'}</Link></td>
              <td>{formatMoney(order.paymentAmount ?? order.totalAmount)}</td>
              <td>{paymentStatusLabel(order.paymentStatus)}</td>
              <td><Tag theme={normalized === 'cancelled' ? 'default' : 'primary'} variant="light">{orderStatusLabel(order.status ?? order.orderStatusName)}</Tag></td>
              <td>{formatDate(order.createTime)}</td>
              <td><Link className="text-button" to={`/orders/${encodeURIComponent(orderNo)}`}>详情</Link>{cancelable && <Button variant="text" loading={busy} onClick={() => void cancel(order)}>取消</Button>}</td>
            </tr>;
          })}
        </tbody>
      </Table>
    </Panel>}
  </>;
}

export function OrderDetailPage() {
  const { orderNo = '' } = useParams();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const [company, setCompany] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const { data, loading, error } = useResource<Order>('orders.detail', { orderNo: decodeURIComponent(orderNo) }, refreshKey);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!data) return;
    const logistics = data.logistics || data.logisticsVO || {};
    setCompany(String(logistics.companyName || logistics.logisticsCompanyName || ''));
    setTrackingNo(String(logistics.trackingNo || logistics.logisticsNo || ''));
  }, [data]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState title="订单不存在" />;

  const items = readList<Record<string, unknown>>(data.items || data.orderItemVOs);
  const currentStatus = orderStatusOf(data.status ?? data.orderStatusName);
  const deliveryAddress = deliveryAddressOf(data);
  const saveLogistics = async () => {
    if (!company.trim() || !trackingNo.trim()) { await MessagePlugin.warning('请填写物流公司和物流单号'); return; }
    await run('orders.logistics.save', { orderNo: data.orderNo || orderNo, logisticsCompanyName: company.trim(), logisticsNo: trackingNo.trim() }, '物流信息已记录');
    setRefreshKey((key) => key + 1);
  };
  const shipOrder = async () => {
    if (!company.trim() || !trackingNo.trim()) { await MessagePlugin.warning('发货前请填写物流公司和物流单号'); return; }
    await run('orders.ship', { orderNo: data.orderNo || orderNo, tracking: { carrier: company.trim(), trackingNo: trackingNo.trim() } }, '订单已发货');
    setRefreshKey((key) => key + 1);
  };

  return <>
    <div className="page-actions"><Button variant="outline" onClick={() => navigate('/orders')}>返回列表</Button></div>
    <div className="detail-grid">
      <Panel>
        <div className="panel-heading">
          <h3>订单信息</h3>
          <Tag theme={currentStatus === 'cancelled' ? 'default' : 'primary'} variant="light">{orderStatusLabel(data.status ?? data.orderStatusName)}</Tag>
        </div>
        <dl className="detail-list">
          <dt>订单号</dt><dd>{String(data.orderNo || orderNo)}</dd>
          <dt>订单状态</dt><dd>{orderStatusLabel(data.status ?? data.orderStatusName)}</dd>
          <dt>支付状态</dt><dd>{paymentStatusLabel(data.paymentStatus)}（不在后台伪造支付结果）</dd>
          <dt>支付金额</dt><dd>{formatMoney(data.paymentAmount ?? data.totalAmount)}</dd>
          <dt>创建时间</dt><dd>{formatDate(data.createTime)}</dd>
        </dl>
        <h3>收货信息</h3>
        <dl className="detail-list">
          <dt>收货人</dt><dd>{deliveryAddress.receiver}</dd>
          <dt>联系电话</dt><dd>{deliveryAddress.phone}</dd>
          <dt>收货地址</dt><dd>{deliveryAddress.address}</dd>
        </dl>
      </Panel>
      <Panel>
        <h3>物流信息</h3>
        <div className="form-grid">
          <Field label="物流公司"><Input value={company} onChange={setCompany} placeholder="例如：中通" /></Field>
          <Field label="物流单号"><Input value={trackingNo} onChange={setTrackingNo} placeholder="请输入物流单号" /></Field>
        </div>
        <div className="form-actions">
          <Button theme="primary" loading={busy} onClick={() => void saveLogistics()}>记录物流</Button>
          {currentStatus === 'paid' && <Button variant="outline" loading={busy} onClick={() => void shipOrder()}>发货并更新状态</Button>}
        </div>
      </Panel>
    </div>
    <Panel>
      <h3>商品明细</h3>
      <Table>
        <thead><tr><th>商品</th><th>SKU</th><th>规格</th><th>数量</th><th>金额</th></tr></thead>
        <tbody>
          {items.length === 0 && <EmptyTable colSpan={5} />}
          {items.map((item, index) => <tr key={String(item._id || item.skuId || index)}>
            <td>{String(item.goodsName || item.productName || item.title || '—')}</td>
            <td>{String(item.skuId || '—')}</td>
            <td>{formatSpecInfo(orderItemSpecInfo(item))}</td>
            <td>{String(item.buyQuantity || item.quantity || 0)}</td>
            <td>{formatMoney(item.itemPaymentAmount ?? item.amount ?? item.actualPrice)}</td>
          </tr>)}
        </tbody>
      </Table>
    </Panel>
  </>;
}

export function CommentsPage() {
  const [refreshKey, setRefreshKey] = useState(0); const { data, loading, error } = useResource<unknown>('comments.list', { page: 1, pageSize: 100 }, refreshKey); const rows = readList<Comment>(data); const { busy, run } = useAction();
  const moderate = async (row: Comment, status: string) => { await run('comments.moderate', { id: row._id, status }, '评论状态已更新'); setRefreshKey((key) => key + 1); };
  return <>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table minWidth={900}><thead><tr><th>用户</th><th>评分</th><th>内容</th><th>商品</th><th>订单</th><th>图片</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={8} />}{rows.map((row) => { const status = commentStatusKey(row.status); const imageCount = Array.isArray(row.images) ? row.images.length : 0; return <tr key={String(row._id)}><td>{String(row.userName || row.userId || '—')}</td><td>{String(row.score ?? row.commentScore ?? row.rating ?? '—')}</td><td className="long-text">{String(row.content || row.commentContent || '—')}</td><td>{String(row.productId || row.spuId || '—')}</td><td>{String(row.orderNo || '—')}</td><td>{imageCount ? `${imageCount} 张` : '—'}</td><td>{commentStatusLabel(row.status)}</td><td>{status !== 'active' && <Button variant="text" loading={busy} onClick={() => void moderate(row, 'active')}>通过</Button>}{status === 'active' && <Button variant="text" loading={busy} onClick={() => void moderate(row, 'rejected')}>隐藏</Button>}</td></tr>; })}</tbody></Table></Panel>}</>;
}

export function AfterSalesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useResource<unknown>('afterSales.list', { page: 1, pageSize: 100 }, refreshKey);
  const rows = readList<AfterSale>(data);
  const { busy, run } = useAction();
  const review = async (row: AfterSale, status: string) => {
    await run('afterSales.review', { id: row._id, status }, '售后状态已更新');
    setRefreshKey((key) => key + 1);
  };
  return <>
    {loading && <LoadingState />}
    {error && <ErrorState message={error} />}
    {!loading && !error && <Panel>
      <Table minWidth={1080}>
        <thead><tr><th>售后单号</th><th>订单号</th><th>类型</th><th>退款金额</th><th>原因</th><th>物流</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyTable colSpan={9} />}
          {rows.map((row) => {
            const status = afterSaleStatusKey(row.status || row.rightsStatus);
            const logistics = [row.logisticsCompanyName, row.logisticsNo].filter(Boolean).join(' ');
            const orderNo = String(row.orderNo || '').trim();
            return <tr key={String(row._id || row.afterSaleNo || row.rightsNo)}>
              <td>{String(row.afterSaleNo || row.rightsNo || row._id || '—')}</td>
              <td>{orderNo ? <Link className="text-button" to={`/orders/${encodeURIComponent(orderNo)}`}>{orderNo}</Link> : '—'}</td>
              <td>{afterSaleTypeLabel(row.type ?? row.rightsType)}</td>
              <td>{formatMoney(row.amount ?? row.refundAmount ?? row.refundRequestAmount)}</td>
              <td className="long-text">{String(row.reason || row.description || '—')}</td>
              <td>{String(logistics || '—')}</td>
              <td>{afterSaleStatusLabel(row.status || row.rightsStatus)}</td>
              <td>{formatDate(row.createdAt)}</td>
              <td>
                {status === 'pending_review' && <><Button variant="text" loading={busy} onClick={() => void review(row, 'approved')}>同意</Button><Button variant="text" loading={busy} onClick={() => void review(row, 'rejected')}>拒绝</Button></>}
                {status === 'refunding' && <Button variant="text" loading={busy} onClick={() => void review(row, 'refunded')}>标记退款完成</Button>}
              </td>
            </tr>;
          })}
        </tbody>
      </Table>
    </Panel>}
  </>;
}
