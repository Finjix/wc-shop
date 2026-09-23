import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Input, MessagePlugin, Tag } from 'tdesign-react';
import { adminApi } from '../lib/api';
import type { AfterSale, Category, Comment, Order, Product, ProductDraft, Sku } from '../types';
import { EmptyState, EmptyTable, ErrorState, Field, ImageFilePicker, LoadingState, Panel, Table, formatDate, formatMoney, readList } from '../components/Ui';

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
    {loading && <LoadingState />}
    {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
    {!loading && !error && <>
      <div className="metric-grid">
        <Metric label="待发货" value={value(['pendingShipmentCount'])} />
        <Metric label="待处理售后" value={value(['pendingAfterSaleCount', 'afterSalePending', 'pendingAfterSales'])} />
      </div>
    </>}
  </>;
}

const emptyProduct: ProductDraft = {
  title: '', categoryId: '', primaryImage: '', detailImages: [],
};

interface VariantDraft { skuId?: string; name: string; price: string }
const emptyVariant = (): VariantDraft => ({ name: '', price: '' });

function variantName(sku: Sku, product: Product) {
  const info = Array.isArray(sku.specInfo) ? sku.specInfo : [];
  const groups = Array.isArray(product.specList) ? product.specList as Record<string, unknown>[] : [];
  return info.map((entry) => {
    const value = entry as Record<string, unknown>;
    const group = groups.find((item) => String(item.specId) === String(value.specId));
    const options = Array.isArray(group?.specValueList) ? group.specValueList as Record<string, unknown>[] : [];
    const option = options.find((item) => String(item.specValueId) === String(value.specValueId));
    return String(option?.specValue || value.specValue || value.specValueId || '').trim();
  }).filter(Boolean).join(' / ') || '默认规格';
}

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

export function ProductsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct);
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [saveError, setSaveError] = useState('');
  const editorRequest = useRef(0);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [uploading, setUploading] = useState('');
  const [detailUploadProgress, setDetailUploadProgress] = useState('');
  const detailInputRef = useRef<HTMLInputElement>(null);
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
  const openEditor = async (product?: Product) => {
    const request = ++editorRequest.current;
    setSaveError('');
    setEditorOpen(true);
    setEditing(product || null);
    setVariants([emptyVariant()]);
    setVariantsLoading(Boolean(product));
    setUploading('');
    setDetailUploadProgress('');
    setDraft(product ? {
      ...emptyProduct,
      title: product.title || '',
      categoryId: String(product.categoryId || product.categoryIds?.[0] || ''),
      primaryImage: product.primaryImage || product.images?.[0] || '',
      detailImages: productDetailImages(product),
    } : emptyProduct);
    if (product) {
      try {
        const refs = Array.from(new Set([product._id, product.spuId].filter(Boolean).map(String)));
        const results = await Promise.all(refs.map((ref) => adminApi.call<unknown>('skus.list', { productId: ref })));
        if (request !== editorRequest.current) return;
        const existing = Array.from(new Map(results.flatMap((result) => readList<Sku>(result)).map((sku) => [String(sku._id || sku.skuId), sku])).values())
          .filter((sku) => sku.status !== 'inactive');
        setVariants(existing.length ? existing.map((sku) => ({
          skuId: String(sku._id || sku.skuId),
          name: variantName(sku, product),
          price: Number.isFinite(Number(sku.salePrice ?? sku.price)) ? (Number(sku.salePrice ?? sku.price) / 100).toFixed(2) : '',
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
  const setValue = (key: keyof ProductDraft, value: string | boolean | string[]) => setDraft((old) => ({ ...old, [key]: value }));
  const uploadCover = async (file?: File) => {
    if (!file) return;
    const request = editorRequest.current;
    setUploading('cover');
    try {
      const fileID = await adminApi.upload(file);
      if (request !== editorRequest.current) return;
      setDraft((old) => ({ ...old, primaryImage: fileID }));
      await MessagePlugin.success('图片已上传');
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
        const fileID = await adminApi.upload(file);
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
    setSaveError('');
    const fail = async (message: string) => { setSaveError(message); await MessagePlugin.warning(message); };
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
      variants: cleaned.map((variant) => ({ skuId: variant.skuId, name: variant.name, salePrice: Math.round(Number(variant.price) * 100) })),
      categoryIds: categoryId ? [categoryId] : [],
    }, '商品已保存'); }
    catch (error) { setSaveError(error instanceof Error ? error.message : '商品保存失败'); return; }
    setEditing(null); setDraft(emptyProduct); setVariants([emptyVariant()]); setEditorOpen(false); setRefreshKey((key) => key + 1);
  };
  const cancelEditor = () => { editorRequest.current += 1; setSaveError(''); setEditing(null); setDraft(emptyProduct); setEditorOpen(false); };
  return <>
    <div className="page-actions"><Button theme="primary" onClick={() => openEditor()}>新建商品</Button></div>
    {loading && <LoadingState />}{error && <ErrorState message={error} />}
    {!loading && !error && <Panel><Table><thead><tr><th>商品</th><th>分类</th><th>销售价</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {rows.length === 0 && <EmptyTable colSpan={5} />}
      {rows.map((product) => {
        const fileID = String(product.primaryImage || '');
        const resolvedImage = imageUrls[fileID];
        const imageSource = isRenderableImageSource(resolvedImage) ? resolvedImage : isRenderableImageSource(fileID) ? fileID : '';
        const status = productStatusOf(product);
        return <tr key={String(product._id || product.spuId)}><td><div className="product-cell">{imageSource && <img src={imageSource} alt="" />}<div><strong>{product.title || '未命名商品'}</strong><small>ID：{String(product._id || product.spuId || '—')}</small></div></div></td><td>{String(product.categoryName || product.categoryId || product.categoryIds?.[0] || '—')}</td><td>{formatMoney(product.minSalePrice)}</td><td><Tag theme={status === 'active' ? 'success' : 'default'} variant="light">{productStatusLabels[status] || status || '—'}</Tag></td><td><Button variant="text" onClick={() => openEditor(product)}>编辑</Button></td></tr>;
      })}
    </tbody></Table></Panel>}
    {editorOpen ? <Panel className="editor-panel"><div className="product-editor-actions"><Button variant="outline" onClick={cancelEditor}>取消</Button><Button theme="primary" loading={busy || variantsLoading || Boolean(uploading)} onClick={() => void save()}>保存商品</Button></div><div className="panel-heading"><h3>{editing ? '编辑商品' : '新建商品'}</h3></div>{saveError && <p className="home-config-feedback home-config-feedback-error" role="alert">{saveError}</p>}<div className="form-grid">
       <Field label="商品名称"><Input value={draft.title} onChange={(value) => setValue('title', value)} placeholder="请输入商品名称" /></Field>
       <Field label="分类"><select value={draft.categoryId} onChange={(event) => setValue('categoryId', event.target.value)}><option value="">请选择分类</option>{categoryRows.map((category) => <option key={String(category._id || category.id)} value={String(category._id || category.id)}>{category.name}</option>)}</select></Field>
       <div className="variant-field"><strong>商品规格与价格</strong>{variantsLoading && <small>正在读取已有规格…</small>}
         {variants.map((variant, index) => <div className="variant-row" key={variant.skuId || `new-${index}`}>
           <Input value={variant.name} onChange={(value) => setVariants((old) => old.map((item, i) => i === index ? { ...item, name: value } : item))} placeholder="规格，例如：小份" />
           <Input value={variant.price} onChange={(value) => setVariants((old) => old.map((item, i) => i === index ? { ...item, price: value } : item))} placeholder="价格（元），例如：29.90" />
           <Button variant="text" disabled={variants.length === 1} onClick={() => setVariants((old) => old.filter((_, i) => i !== index))}>删除</Button>
         </div>)}
         <Button variant="outline" onClick={() => setVariants((old) => [...old, emptyVariant()])}>添加规格</Button>
       </div>
         <Field label="封面图片（显示比例 1:1）" fileUpload>
         <ImageFilePicker onSelect={(file) => void uploadCover(file)} disabled={Boolean(uploading)} />
         {uploading === 'cover' && <small>正在上传...</small>}
         {draft.primaryImage && <div className="product-image-item product-cover-preview"><ProductImagePreview fileID={draft.primaryImage} alt="商品封面预览" /><Button variant="text" onClick={() => setDraft((old) => ({ ...old, primaryImage: '' }))}>移除</Button></div>}
       </Field>
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
           <input ref={detailInputRef} className="image-file-picker-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple disabled={Boolean(uploading)} aria-label="选择商品详情图片"
             onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadDetails(files); }} />
         </div>{uploading === 'details' && <small>正在上传详情图片 {detailUploadProgress}</small>}</div>
       </div>
    </div></Panel> : null}
  </>;
}

export function CategoriesPage() {
  const [refreshKey, setRefreshKey] = useState(0); const [name, setName] = useState(''); const [parentId, setParentId] = useState('');
  const { data, loading, error } = useResource<unknown>('categories.list', { page: 1, pageSize: 100 }, refreshKey); const rows = readList<Category>(data); const { busy, run } = useAction();
  const save = async () => { if (!name.trim()) { await MessagePlugin.warning('请输入分类名称'); return; } await run('categories.save', { name, parentId: parentId || null }, '分类已保存'); setName(''); setParentId(''); setRefreshKey((key) => key + 1); };
  return <><Panel className="quick-form"><Field label="分类名称"><Input value={name} onChange={setName} placeholder="例如：日用百货" /></Field><Field label="父分类 ID"><Input value={parentId} onChange={setParentId} placeholder="顶级分类可留空" /></Field><Button theme="primary" loading={busy} onClick={() => void save()}>新增分类</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>名称</th><th>父分类</th><th>排序</th><th>状态</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={4} />}{rows.map((row) => <tr key={String(row._id || row.id)}><td><strong>{row.name}</strong></td><td>{String(row.parentId || '顶级')}</td><td>{String(row.sort ?? '—')}</td><td>{row.enabled === false ? '停用' : '启用'}</td></tr>)}</tbody></Table></Panel>}</>;
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
    <div className="page-actions"><Button theme="primary" onClick={() => openEditor()}>新建 SKU</Button></div>
    {editorOpen && <Panel className="editor-panel"><div className="panel-heading"><h3>{editing ? '编辑 SKU' : '新建 SKU'}</h3><Button variant="text" onClick={reset}>关闭</Button></div><div className="form-grid">
      <Field label="关联商品"><select value={draft.productId} onChange={(event) => { const product = productFor(event.target.value); setDraft((old) => ({ ...old, productId: event.target.value, spuId: String(product?.spuId || event.target.value) })); }}><option value="">请选择商品</option>{productRows.map((product) => <option key={String(product._id || product.spuId)} value={String(product._id || product.spuId)}>{product.title}（{String(product._id || product.spuId)}）</option>)}</select></Field>
      <Field label="SKU ID" hint="前端用此 ID 识别规格和下单 SKU。"><Input value={draft.skuId} onChange={(value) => setValue('skuId', value)} placeholder="例如 sku-color-red" /></Field>
      <Field label="销售价（分）"><Input value={draft.salePrice} onChange={(value) => setValue('salePrice', value)} placeholder="例如 29900" /></Field>
      <Field label="初始库存"><Input value={draft.stockQuantity} onChange={(value) => setValue('stockQuantity', value)} placeholder="例如 100" /></Field>
      <Field label="SKU 状态"><select value={draft.status} onChange={(event) => setValue('status', event.target.value)}><option value="active">出售中</option><option value="inactive">已下架</option></select></Field>
      <Field label="SKU 图片" hint="可选；未填写时前端使用商品主图。" fileUpload><ImageFilePicker onSelect={(file) => void upload(file)} disabled={uploading} />{uploading && <small>正在上传...</small>}<Input value={draft.skuImage} onChange={(value) => setValue('skuImage', value)} placeholder="可填写 URL 或 fileID" /></Field>
      <Field label="规格信息" hint="需与商品规格配置的 specId / specValueId 对应。"><textarea value={draft.specInfo} onChange={(event) => setValue('specInfo', event.target.value)} rows={6} placeholder="例如：[{&quot;specId&quot;:&quot;color&quot;,&quot;specValueId&quot;:&quot;red&quot;}]" /></Field>
    </div><div className="form-actions"><Button theme="primary" loading={busy} onClick={() => void save()}>{editing ? '保存 SKU' : '创建 SKU'}</Button><Button variant="outline" onClick={reset}>取消</Button></div></Panel>}
    <Panel className="toolbar"><Input value={query} onChange={setQuery} placeholder="搜索 SKU、商品或规格" /><Button onClick={() => setRefreshKey((key) => key + 1)}>刷新</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>SKU</th><th>商品</th><th>规格</th><th>售价</th><th>库存</th><th>状态</th><th>调整库存</th><th>操作</th></tr></thead><tbody>{filtered.length === 0 && <EmptyTable colSpan={8} />}{filtered.map((row) => <tr key={String(row._id || row.skuId)}><td>{String(row.skuId || row._id || '—')}</td><td>{String(row.productTitle || row.title || productFor(row.productId || row.spuId)?.title || row.spuId || row.productId || '—')}</td><td>{formatSpecInfo(row.specInfo)}</td><td>{formatMoney(row.price ?? row.salePrice)}</td><td className={Number(row.stockQuantity) <= Number(row.safeStockQuantity || 0) ? 'warning-text' : ''}>{String(row.stockQuantity ?? '—')}</td><td><select value={String(row.status || 'active')} onChange={(event) => void updateStatus(row, event.target.value)} disabled={busy}><option value="active">出售中</option><option value="inactive">已下架</option></select></td><td><div className="inline-action"><Input value={stock} onChange={setStock} placeholder="目标库存" /><Button size="small" loading={busy} onClick={() => void updateStock(row)}>保存</Button></div></td><td><Button variant="text" onClick={() => openEditor(row)}>编辑</Button></td></tr>)}</tbody></Table></Panel>}
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
