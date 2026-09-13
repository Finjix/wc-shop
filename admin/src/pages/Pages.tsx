import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Input, MessagePlugin, Tag } from 'tdesign-react';
import { adminApi } from '../lib/api';
import type { AfterSale, Category, Comment, Order, Product, ProductDraft, Sku } from '../types';
import { EmptyState, EmptyTable, ErrorState, Field, LoadingState, PageIntro, Panel, Table, formatDate, formatMoney, readList, readTotal } from '../components/Ui';

function useResource<T>(action: string, payload: Record<string, unknown> = {}, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
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
  }, [action, JSON.stringify(payload), refreshKey]); // payload 是页面内的只读请求参数
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

const productStatusLabels: Record<string, string> = {
  active: '出售中',
  inactive: '已下架',
};

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
  const metrics = (data?.metrics || data || {}) as Record<string, unknown>;
  const value = (keys: string[]) => {
    const found = keys.map((key) => metrics[key]).find((item) => item !== undefined && item !== null);
    return found === undefined ? '—' : String(found);
  };
  return <>
    <PageIntro title="概览" description="查看商城数据的实时摘要。" />
    {loading && <LoadingState />}
    {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
    {!loading && !error && <>
      <div className="metric-grid">
        <Metric label="商品总数" value={value(['productCount', 'products'])} />
        <Metric label="订单总数" value={value(['orderCount', 'orders'])} />
        <Metric label="待处理售后" value={value(['pendingAfterSaleCount', 'afterSalePending', 'pendingAfterSales'])} />
      </div>
    </>}
  </>;
}

const emptyProduct: ProductDraft = {
  title: '', categoryId: '', primaryImage: '', images: [],
  minSalePrice: '', specList: '',
};

function isRenderableImageSource(value: unknown): value is string {
  return typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value);
}

export function ProductsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct);
  const [uploading, setUploading] = useState(false);
  const { data, loading, error } = useResource<unknown>('products.list', { page: 1, pageSize: 50 }, refreshKey);
  const categories = useResource<unknown>('categories.list', { page: 1, pageSize: 100 });
  const { busy, run } = useAction();
  const rows = useMemo(() => readList<Product>(data), [data]);
  const categoryRows = readList<Category>(categories.data);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const fileIDs = Array.from(new Set(rows
      .map((product) => product.primaryImage)
      .filter((fileID): fileID is string => typeof fileID === 'string' && fileID.startsWith('cloud://'))));
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
  const openEditor = (product?: Product) => {
    setEditorOpen(true);
    setEditing(product || null);
    setDraft(product ? {
      ...emptyProduct,
      title: product.title || '',
      categoryId: String(product.categoryId || product.categoryIds?.[0] || ''),
      primaryImage: product.primaryImage || '', images: product.images || [],
      minSalePrice: String(product.minSalePrice ?? ''),
      specList: JSON.stringify(product.specList || [], null, 2),
    } : emptyProduct);
  };
  const setValue = (key: keyof ProductDraft, value: string | boolean | string[]) => setDraft((old) => ({ ...old, [key]: value }));
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const fileID = await adminApi.upload(file);
      setDraft((old) => ({ ...old, primaryImage: old.primaryImage || fileID, images: [...old.images, fileID] }));
      await MessagePlugin.success('图片已上传，保存商品后会写入商品记录。');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败');
    } finally { setUploading(false); }
  };
  const save = async () => {
    if (!draft.title.trim()) { await MessagePlugin.warning('请填写商品名称'); return; }
    let specList: unknown[] = [];
    try {
      specList = JSON.parse(draft.specList || '[]') as unknown[];
      if (!Array.isArray(specList)) throw new Error('规格必须是数组');
    } catch (err) {
      await MessagePlugin.warning(err instanceof Error ? `规格配置格式错误：${err.message}` : '规格配置必须是合法 JSON 数组');
      return;
    }
    const { categoryId, ...productDraft } = draft;
    await run('products.save', {
      ...(editing ? { id: editing._id || editing.spuId } : {}),
      ...productDraft,
      specList,
      categoryIds: categoryId ? [categoryId] : [],
    }, '商品已保存');
    setEditing(null); setDraft(emptyProduct); setEditorOpen(false); setRefreshKey((key) => key + 1);
  };
  return <>
    <PageIntro title="商品管理" description="管理小程序商品卡片使用的名称、分类、起售价和商品图片；SKU 售价、库存与状态在 SKU / 库存管理中维护。" action={<Button theme="primary" onClick={() => openEditor()}>新建商品</Button>} />
    {loading && <LoadingState />}{error && <ErrorState message={error} />}
    {!loading && !error && <Panel><Table><thead><tr><th>商品</th><th>分类</th><th>销售价</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {rows.length === 0 && <EmptyTable colSpan={5} />}
      {rows.map((product) => {
        const fileID = String(product.primaryImage || '');
        const resolvedImage = imageUrls[fileID];
        const imageSource = isRenderableImageSource(resolvedImage) ? resolvedImage : isRenderableImageSource(fileID) ? fileID : '';
        const status = productStatusOf(product);
        return <tr key={String(product._id || product.spuId)}><td><div className="product-cell">{imageSource ? <img src={imageSource} alt="" /> : <span className="image-placeholder">图</span>}<div><strong>{product.title || '未命名商品'}</strong><small>ID：{String(product._id || product.spuId || '—')}</small></div></div></td><td>{String(product.categoryName || product.categoryId || product.categoryIds?.[0] || '—')}</td><td>{formatMoney(product.minSalePrice)}</td><td><Tag theme={status === 'active' ? 'success' : 'default'} variant="light">{productStatusLabels[status] || status || '—'}</Tag></td><td><Button variant="text" onClick={() => openEditor(product)}>编辑</Button></td></tr>;
      })}
    </tbody></Table></Panel>}
    {editorOpen ? <Panel className="editor-panel"><div className="panel-heading"><h3>{editing ? '编辑商品' : '新建商品'}</h3><Button variant="text" onClick={() => { setEditing(null); setDraft(emptyProduct); setEditorOpen(false); }}>关闭</Button></div><div className="form-grid">
       <Field label="商品名称"><Input value={draft.title} onChange={(value) => setValue('title', value)} placeholder="请输入商品名称" /></Field>
       <Field label="分类"><select value={draft.categoryId} onChange={(event) => setValue('categoryId', event.target.value)}><option value="">请选择分类</option>{categoryRows.map((category) => <option key={String(category._id || category.id)} value={String(category._id || category.id)}>{category.name}</option>)}</select></Field>
       <Field label="商品起售价（分）" hint="用于商品列表展示；SKU 实际成交价在 SKU / 库存管理中维护。"><Input value={draft.minSalePrice} onChange={(value) => setValue('minSalePrice', value)} placeholder="例如 29900" /></Field>
       <Field label="规格配置" hint="例如：[{&quot;specId&quot;:&quot;color&quot;,&quot;title&quot;:&quot;颜色&quot;,&quot;specValueList&quot;:[{&quot;specValueId&quot;:&quot;red&quot;,&quot;specValue&quot;:&quot;红色&quot;}]}]"><textarea value={draft.specList} onChange={(event) => setValue('specList', event.target.value)} rows={6} placeholder="没有规格可留空；有规格时需填写 JSON 数组" /></Field>
       <Field label="商品图片" hint="上传结果为 CloudBase fileID，会随商品保存。"><input type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} disabled={uploading} />{uploading && <small>正在上传...</small>}<div className="file-list">{draft.images.map((image) => <code key={image}>{image}</code>)}</div></Field>
    </div><div className="form-actions"><Button theme="primary" loading={busy} onClick={() => void save()}>保存商品</Button><Button variant="outline" onClick={() => { setEditing(null); setDraft(emptyProduct); setEditorOpen(false); }}>取消</Button></div></Panel> : null}
  </>;
}

export function CategoriesPage() {
  const [refreshKey, setRefreshKey] = useState(0); const [name, setName] = useState(''); const [parentId, setParentId] = useState('');
  const { data, loading, error } = useResource<unknown>('categories.list', { page: 1, pageSize: 100 }, refreshKey); const rows = readList<Category>(data); const { busy, run } = useAction();
  const save = async () => { if (!name.trim()) { await MessagePlugin.warning('请输入分类名称'); return; } await run('categories.save', { name, parentId: parentId || null }, '分类已保存'); setName(''); setParentId(''); setRefreshKey((key) => key + 1); };
  return <><PageIntro title="分类管理" description="维护商品分类层级与展示名称。" /><Panel className="quick-form"><Field label="分类名称"><Input value={name} onChange={setName} placeholder="例如：日用百货" /></Field><Field label="父分类 ID"><Input value={parentId} onChange={setParentId} placeholder="顶级分类可留空" /></Field><Button theme="primary" loading={busy} onClick={() => void save()}>新增分类</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>名称</th><th>父分类</th><th>排序</th><th>状态</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={4} />}{rows.map((row) => <tr key={String(row._id || row.id)}><td><strong>{row.name}</strong></td><td>{String(row.parentId || '顶级')}</td><td>{String(row.sort ?? '—')}</td><td>{row.enabled === false ? '停用' : '启用'}</td></tr>)}</tbody></Table></Panel>}</>;
}

interface SkuDraft {
  skuId: string;
  productId: string;
  spuId: string;
  specInfo: string;
  skuImage: string;
  salePrice: string;
  stockQuantity: string;
  status: string;
}

const emptySku: SkuDraft = {
  skuId: '', productId: '', spuId: '', specInfo: '[]', skuImage: '', salePrice: '', stockQuantity: '0', status: 'active',
};

export function SkuPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [stock, setStock] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [draft, setDraft] = useState<SkuDraft>(emptySku);
  const [uploading, setUploading] = useState(false);
  const { data, loading, error } = useResource<unknown>('skus.list', { page: 1, pageSize: 100, query }, refreshKey);
  const products = useResource<unknown>('products.list', { page: 1, pageSize: 100 });
  const rows = readList<Sku>(data);
  const productRows = readList<Product>(products.data);
  const { busy, run } = useAction();
  const filtered = useMemo(() => query ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())) : rows, [rows, query]);
  const productFor = (value: unknown) => productRows.find((product) => String(product._id || '') === String(value || '') || String(product.spuId || '') === String(value || ''));
  const reset = () => { setEditing(null); setDraft(emptySku); setEditorOpen(false); };
  const openEditor = (row?: Sku) => {
    if (!row) { setEditing(null); setDraft(emptySku); setEditorOpen(true); return; }
    setEditing(row);
    setDraft({
      skuId: String(row.skuId || ''),
      productId: String(row.productId || row.spuId || ''),
      spuId: String(row.spuId || row.productId || ''),
      specInfo: JSON.stringify(row.specInfo || [], null, 2),
      skuImage: String(row.skuImage || ''),
      salePrice: String(row.salePrice ?? row.price ?? ''),
      stockQuantity: String(row.stockQuantity ?? '0'),
      status: String(row.status || 'active'),
    });
    setEditorOpen(true);
  };
  const setValue = (key: keyof SkuDraft, value: string) => setDraft((old) => ({ ...old, [key]: value }));
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const fileID = await adminApi.upload(file, 'admin/products');
      setValue('skuImage', fileID);
      await MessagePlugin.success('SKU 图片已上传，保存后会写入 SKU。');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败');
    } finally { setUploading(false); }
  };
  const save = async () => {
    const skuId = draft.skuId.trim();
    const productId = draft.productId.trim();
    const salePrice = Number(draft.salePrice);
    const stockQuantity = Number(draft.stockQuantity);
    if (!skuId) { await MessagePlugin.warning('请输入 SKU ID'); return; }
    if (!productId) { await MessagePlugin.warning('请选择关联商品'); return; }
    if (!Number.isSafeInteger(salePrice) || salePrice <= 0) { await MessagePlugin.warning('销售价必须是大于 0 的整数（分）'); return; }
    if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) { await MessagePlugin.warning('库存必须是不小于 0 的整数'); return; }
    let specInfo: unknown[] = [];
    try {
      specInfo = JSON.parse(draft.specInfo || '[]') as unknown[];
      if (!Array.isArray(specInfo)) throw new Error('规格信息必须是数组');
    } catch (err) {
      await MessagePlugin.warning(err instanceof Error ? `规格信息格式错误：${err.message}` : '规格信息必须是合法 JSON 数组');
      return;
    }
    const product = productFor(productId);
    const payload = {
      ...(editing ? { id: editing._id || editing.skuId } : {}),
      skuId,
      productId,
      spuId: draft.spuId.trim() || product?.spuId || product?._id || productId,
      specInfo,
      skuImage: draft.skuImage.trim(),
      salePrice,
      stockQuantity,
      status: draft.status,
    };
    await run(editing ? 'skus.update' : 'skus.create', payload, editing ? 'SKU 已保存' : 'SKU 已创建');
    reset();
    setRefreshKey((key) => key + 1);
  };
  const updateStock = async (row: Sku) => {
    const nextStock = Number(stock);
    if (!stock.trim() || !Number.isInteger(nextStock) || nextStock < 0) { await MessagePlugin.warning('请输入不小于 0 的整数库存'); return; }
    await run('inventory.update', { skuId: row._id || row.skuId, stockQuantity: nextStock }, '库存已更新'); setStock(''); setRefreshKey((key) => key + 1);
  };
  const updateStatus = async (row: Sku, status: string) => { await run('skus.update', { id: row._id || row.skuId, status }, 'SKU 状态已更新'); setRefreshKey((key) => key + 1); };
  return <>
    <PageIntro title="SKU 与库存管理" description="这里维护小程序规格弹窗实际读取的 SKU 售价、规格、库存和上下架状态；下架 SKU 将不能被前端选购。" action={<Button theme="primary" onClick={() => openEditor()}>新建 SKU</Button>} />
    {editorOpen && <Panel className="editor-panel"><div className="panel-heading"><h3>{editing ? '编辑 SKU' : '新建 SKU'}</h3><Button variant="text" onClick={reset}>关闭</Button></div><div className="form-grid">
      <Field label="关联商品"><select value={draft.productId} onChange={(event) => { const product = productFor(event.target.value); setDraft((old) => ({ ...old, productId: event.target.value, spuId: String(product?.spuId || event.target.value) })); }}><option value="">请选择商品</option>{productRows.map((product) => <option key={String(product._id || product.spuId)} value={String(product._id || product.spuId)}>{product.title}（{String(product._id || product.spuId)}）</option>)}</select></Field>
      <Field label="SKU ID" hint="前端用此 ID 识别规格和下单 SKU。"><Input value={draft.skuId} onChange={(value) => setValue('skuId', value)} placeholder="例如 sku-color-red" /></Field>
      <Field label="销售价（分）"><Input value={draft.salePrice} onChange={(value) => setValue('salePrice', value)} placeholder="例如 29900" /></Field>
      <Field label="初始库存"><Input value={draft.stockQuantity} onChange={(value) => setValue('stockQuantity', value)} placeholder="例如 100" /></Field>
      <Field label="SKU 状态"><select value={draft.status} onChange={(event) => setValue('status', event.target.value)}><option value="active">出售中</option><option value="inactive">已下架</option></select></Field>
      <Field label="SKU 图片" hint="可选；未填写时前端使用商品主图。"><input type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} disabled={uploading} />{uploading && <small>正在上传...</small>}<Input value={draft.skuImage} onChange={(value) => setValue('skuImage', value)} placeholder="可填写 URL 或 fileID" /></Field>
      <Field label="规格信息" hint="需与商品规格配置的 specId / specValueId 对应。"><textarea value={draft.specInfo} onChange={(event) => setValue('specInfo', event.target.value)} rows={6} placeholder="例如：[{&quot;specId&quot;:&quot;color&quot;,&quot;specValueId&quot;:&quot;red&quot;}]" /></Field>
    </div><div className="form-actions"><Button theme="primary" loading={busy} onClick={() => void save()}>{editing ? '保存 SKU' : '创建 SKU'}</Button><Button variant="outline" onClick={reset}>取消</Button></div></Panel>}
    <Panel className="toolbar"><Input value={query} onChange={setQuery} placeholder="搜索 SKU、商品或规格" /><Button onClick={() => setRefreshKey((key) => key + 1)}>刷新</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>SKU</th><th>商品</th><th>规格</th><th>售价</th><th>库存</th><th>状态</th><th>调整库存</th><th>操作</th></tr></thead><tbody>{filtered.length === 0 && <EmptyTable colSpan={8} />}{filtered.map((row) => <tr key={String(row._id || row.skuId)}><td>{String(row.skuId || row._id || '—')}</td><td>{String(row.productTitle || row.title || productFor(row.productId || row.spuId)?.title || row.spuId || row.productId || '—')}</td><td>{formatSpecInfo(row.specInfo)}</td><td>{formatMoney(row.price ?? row.salePrice)}</td><td className={Number(row.stockQuantity) <= Number(row.safeStockQuantity || 0) ? 'warning-text' : ''}>{String(row.stockQuantity ?? '—')}</td><td><select value={String(row.status || 'active')} onChange={(event) => void updateStatus(row, event.target.value)} disabled={busy}><option value="active">出售中</option><option value="inactive">已下架</option></select></td><td><div className="inline-action"><Input value={stock} onChange={setStock} placeholder="目标库存" /><Button size="small" loading={busy} onClick={() => void updateStock(row)}>保存</Button></div></td><td><Button variant="text" onClick={() => openEditor(row)}>编辑</Button></td></tr>)}</tbody></Table></Panel>}
  </>;
}

interface HomeContentDraft {
  slot: string;
  type: string;
  title: string;
  content: string;
  image: string;
  sort: string;
  status: string;
}

const emptyHomeContent: HomeContentDraft = {
  slot: 'home.banner.1',
  type: 'banner',
  title: '',
  content: '',
  image: '',
  sort: '0',
  status: 'active',
};

export function HomeContentPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<HomeContentDraft>(emptyHomeContent);
  const [imagePreview, setImagePreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const { data, loading, error } = useResource<unknown>('homeContent.list', { page: 1, pageSize: 100 }, refreshKey);
  const rows = readList<Record<string, unknown>>(data);
  const { busy, run } = useAction();
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const fileIDs = Array.from(new Set(rows.map((row) => {
      const value = row.image || (row.type === 'banner' ? row.content : '');
      return typeof value === 'string' && value.startsWith('cloud://') ? value : '';
    }).filter(Boolean)));
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

  const reset = () => {
    setEditing(null);
    setDraft(emptyHomeContent);
    setImagePreview('');
  };
  const openEditor = (row?: Record<string, unknown>) => {
    if (!row) {
      reset();
      return;
    }
    const image = String(row.image || (row.type === 'banner' ? row.content : '') || '');
    setEditing(row);
    setDraft({
      slot: String(row.slot || row._id || ''),
      type: String(row.type || 'banner'),
      title: String(row.title || ''),
      content: String(row.content || ''),
      image,
      sort: String(row.sort ?? '0'),
      status: String(row.status || 'active'),
    });
    setImagePreview(imageUrls[image] || (isRenderableImageSource(image) ? image : ''));
  };
  useEffect(() => {
    if (!editing) return;
    const image = String(editing.image || (editing.type === 'banner' ? editing.content : '') || '');
    if (image && imageUrls[image]) setImagePreview(imageUrls[image]);
  }, [editing, imageUrls]);
  const setValue = (key: keyof HomeContentDraft, value: string) => setDraft((old) => ({ ...old, [key]: value }));
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const fileID = await adminApi.upload(file, 'home');
      setValue('image', fileID);
      setImagePreview(await adminApi.getTempFileUrl(fileID).catch(() => ''));
      await MessagePlugin.success('首页图片已上传，保存后会写入首页内容。');
    } catch (err) {
      await MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败');
    } finally { setUploading(false); }
  };
  const save = async () => {
    if (!draft.slot.trim()) { await MessagePlugin.warning('请输入稳定槽位 key'); return; }
    const sort = Number(draft.sort || 0);
    if (!Number.isInteger(sort)) { await MessagePlugin.warning('排序必须是整数'); return; }
    await run('homeContent.save', {
      ...(editing ? { id: editing._id || editing.id } : {}),
      slot: draft.slot.trim(),
      type: draft.type,
      title: draft.title.trim(),
      content: draft.content.trim(),
      image: draft.image.trim(),
      sort,
      status: draft.status,
    }, '首页内容已保存');
    reset();
    setRefreshKey((key) => key + 1);
  };
  return <>
    <PageIntro title="首页内容" description="维护小程序当前会读取的轮播图和首页内容。轮播图片使用 CloudBase fileID 保存，槽位 key 相同会更新原内容。" action={<Button theme="primary" onClick={() => openEditor()}>新增内容</Button>} />
    <Panel className="form-panel"><div className="panel-heading"><h3>{editing ? '编辑首页内容' : '新增首页内容'}</h3>{editing && <Button variant="text" onClick={reset}>取消编辑</Button>}</div><div className="form-grid">
      <Field label="稳定槽位 key" hint="例如 home.banner.1；相同 key 会更新原内容。"><Input value={draft.slot} onChange={(value) => setValue('slot', value)} placeholder="home.banner.1" /></Field>
      <Field label="内容类型"><select value={draft.type} onChange={(event) => setValue('type', event.target.value)}><option value="banner">轮播</option><option value="recommend">推荐</option><option value="notice">公告</option></select></Field>
      <Field label="标题"><Input value={draft.title} onChange={(value) => setValue('title', value)} placeholder="可选" /></Field>
      <Field label="排序"><Input value={draft.sort} onChange={(value) => setValue('sort', value)} placeholder="数字越小越靠前" /></Field>
      <Field label="首页图片" hint="前端首页会优先读取 image；也兼容旧数据中 banner 的 content 图片 fileID。"><input type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} disabled={uploading} />{uploading && <small>正在上传...</small>}{imagePreview && <img className="content-preview" src={imagePreview} alt="首页内容预览" />}<Input value={draft.image} onChange={(value) => setValue('image', value)} placeholder="也可以直接填写图片 URL 或 fileID" /></Field>
      <Field label="文本内容" hint="公告或旧数据可填写；当前首页轮播主要使用图片。"><textarea value={draft.content} onChange={(event) => setValue('content', event.target.value)} rows={4} placeholder="可选" /></Field>
      <Field label="状态"><select value={draft.status} onChange={(event) => setValue('status', event.target.value)}><option value="active">启用</option><option value="inactive">停用</option></select></Field>
    </div><Button theme="primary" loading={busy} onClick={() => void save()}>{editing ? '保存修改' : '保存内容'}</Button></Panel>
    {loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table minWidth={900}><thead><tr><th>槽位</th><th>标题</th><th>类型</th><th>图片</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={7} />}{rows.map((row) => { const value = String(row.image || (row.type === 'banner' ? row.content : '') || ''); const source = isRenderableImageSource(imageUrls[value]) ? imageUrls[value] : isRenderableImageSource(value) ? value : ''; return <tr key={String(row._id || row.id)}><td>{String(row.slot || row._id || '—')}</td><td>{String(row.title || '—')}</td><td>{String(row.type || '—')}</td><td>{source ? <img className="content-thumb" src={source} alt="" /> : value ? '已配置' : '—'}</td><td>{String(row.status || 'active') === 'active' ? '启用' : '停用'}</td><td>{formatDate(row.updatedAt || row.updateTime)}</td><td><Button variant="text" onClick={() => openEditor(row)}>编辑</Button></td></tr>; })}</tbody></Table></Panel>}
  </>;
}

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
    <PageIntro title="订单管理" description="订单状态与小程序订单页保持一致：待支付、待发货、待收货、已完成、已取消；支付能力仍以云端真实状态为准。" />
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
    <PageIntro
      title={`订单详情 · ${String(data.orderNo || orderNo)}`}
      description="订单详情与小程序订单页保持同一状态；收货信息仅随订单按需展示，不建立独立地址列表。"
      action={<Button variant="outline" onClick={() => navigate('/orders')}>返回列表</Button>}
    />
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
  return <><PageIntro title="评论管理" description="审核小程序评价内容；通过后才会出现在商品详情的评价列表中。" />{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table minWidth={900}><thead><tr><th>用户</th><th>评分</th><th>内容</th><th>商品</th><th>订单</th><th>图片</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={8} />}{rows.map((row) => { const status = commentStatusKey(row.status); const imageCount = Array.isArray(row.images) ? row.images.length : 0; return <tr key={String(row._id)}><td>{String(row.userName || row.userId || '—')}</td><td>{String(row.score ?? row.commentScore ?? row.rating ?? '—')}</td><td className="long-text">{String(row.content || row.commentContent || '—')}</td><td>{String(row.productId || row.spuId || '—')}</td><td>{String(row.orderNo || '—')}</td><td>{imageCount ? `${imageCount} 张` : '—'}</td><td>{commentStatusLabel(row.status)}</td><td>{status !== 'active' && <Button variant="text" loading={busy} onClick={() => void moderate(row, 'active')}>通过</Button>}{status === 'active' && <Button variant="text" loading={busy} onClick={() => void moderate(row, 'rejected')}>隐藏</Button>}</td></tr>; })}</tbody></Table></Panel>}</>;
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
    <PageIntro title="售后管理" description="处理小程序提交的售后申请；关联订单的收货信息进入订单详情后按需查看。" />
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
