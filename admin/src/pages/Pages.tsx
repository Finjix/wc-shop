import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Input, MessagePlugin, Tag } from 'tdesign-react';
import { adminApi, ApiError } from '../lib/api';
import type { Address, AfterSale, Category, Comment, Order, Product, ProductDraft, Sku, User } from '../types';
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

export function OverviewPage() {
  const { data, loading, error } = useResource<Record<string, unknown>>('dashboard.summary');
  const metrics = (data?.metrics || data || {}) as Record<string, unknown>;
  const value = (keys: string[]) => {
    const found = keys.map((key) => metrics[key]).find((item) => item !== undefined && item !== null);
    return found === undefined ? '—' : String(found);
  };
  return <>
    <PageIntro title="概览" description="查看商城云端数据的实时摘要。" />
    {loading && <LoadingState />}
    {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
    {!loading && !error && <>
      <div className="metric-grid">
        <Metric label="商品总数" value={value(['productCount', 'products'])} note="来自 products" />
        <Metric label="订单总数" value={value(['orderCount', 'orders'])} note="来自 orders" />
        <Metric label="用户总数" value={value(['userCount', 'users'])} note="来自 users" />
        <Metric label="待处理售后" value={value(['afterSalePending', 'pendingAfterSales'])} note="来自 afterSales" />
      </div>
      <Panel className="overview-note"><h3>后台连接状态</h3><p>当前数据来自 CloudBase 的 admin 云函数。若云端尚未创建集合或没有数据，列表会保持为空，不会生成演示内容。</p></Panel>
    </>}
  </>;
}

const emptyProduct: ProductDraft = {
  title: '', subtitle: '', description: '', categoryId: '', primaryImage: '', images: [],
  minSalePrice: '', maxSalePrice: '', minLinePrice: '', maxLinePrice: '', isPutOnSale: true,
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
      title: product.title || '', subtitle: product.subtitle || '', description: product.description || '',
      categoryId: String(product.categoryId || product.categoryIds?.[0] || ''),
      primaryImage: product.primaryImage || '', images: product.images || [],
      minSalePrice: String(product.minSalePrice ?? ''), maxSalePrice: String(product.maxSalePrice ?? ''),
      minLinePrice: String(product.minLinePrice ?? ''), maxLinePrice: String(product.maxLinePrice ?? ''),
      isPutOnSale: Boolean(product.isPutOnSale ?? true),
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
    const { categoryId, ...productDraft } = draft;
    await run('products.save', {
      ...(editing ? { id: editing._id || editing.spuId } : {}),
      ...productDraft,
      categoryIds: categoryId ? [categoryId] : [],
    }, '商品已保存');
    setEditing(null); setDraft(emptyProduct); setEditorOpen(false); setRefreshKey((key) => key + 1);
  };
  return <>
    <PageIntro title="商品管理" description="管理商品基础信息、分类、上下架状态和云存储图片。" action={<Button theme="primary" onClick={() => openEditor()}>新建商品</Button>} />
    {loading && <LoadingState />}{error && <ErrorState message={error} />}
    {!loading && !error && <Panel><Table><thead><tr><th>商品</th><th>分类</th><th>销售价</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {rows.length === 0 && <EmptyTable colSpan={5} />}
      {rows.map((product) => {
        const fileID = String(product.primaryImage || '');
        const resolvedImage = imageUrls[fileID];
        const imageSource = isRenderableImageSource(resolvedImage) ? resolvedImage : isRenderableImageSource(fileID) ? fileID : '';
        return <tr key={String(product._id || product.spuId)}><td><div className="product-cell">{imageSource ? <img src={imageSource} alt="" /> : <span className="image-placeholder">图</span>}<div><strong>{product.title || '未命名商品'}</strong><small>ID：{String(product._id || product.spuId || '—')}</small></div></div></td><td>{String(product.categoryName || product.categoryId || product.categoryIds?.[0] || '—')}</td><td>{formatMoney(product.minSalePrice)}</td><td><Tag theme={Boolean(product.isPutOnSale) ? 'success' : 'default'} variant="light">{Boolean(product.isPutOnSale) ? '出售中' : '已下架'}</Tag></td><td><Button variant="text" onClick={() => openEditor(product)}>编辑</Button></td></tr>;
      })}
    </tbody></Table></Panel>}
    {editorOpen ? <Panel className="editor-panel"><div className="panel-heading"><h3>{editing ? '编辑商品' : '新建商品'}</h3><Button variant="text" onClick={() => { setEditing(null); setDraft(emptyProduct); setEditorOpen(false); }}>关闭</Button></div><div className="form-grid">
      <Field label="商品名称"><Input value={draft.title} onChange={(value) => setValue('title', value)} placeholder="请输入商品名称" /></Field>
      <Field label="分类"><select value={draft.categoryId} onChange={(event) => setValue('categoryId', event.target.value)}><option value="">请选择分类</option>{categoryRows.map((category) => <option key={String(category._id || category.id)} value={String(category._id || category.id)}>{category.name}</option>)}</select></Field>
      <Field label="销售价（分）"><Input value={draft.minSalePrice} onChange={(value) => setValue('minSalePrice', value)} placeholder="例如 29900" /></Field>
      <Field label="划线价（分）"><Input value={draft.minLinePrice} onChange={(value) => setValue('minLinePrice', value)} placeholder="例如 39900" /></Field>
      <Field label="副标题"><Input value={draft.subtitle} onChange={(value) => setValue('subtitle', value)} /></Field>
      <Field label="状态"><select value={draft.isPutOnSale ? 'on' : 'off'} onChange={(event) => setValue('isPutOnSale', event.target.value === 'on')}><option value="on">出售中</option><option value="off">已下架</option></select></Field>
      <Field label="商品描述"><textarea value={draft.description} onChange={(event) => setValue('description', event.target.value)} rows={4} /></Field>
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

export function SkuPage({ inventory = false }: { inventory?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0); const [query, setQuery] = useState(''); const [stock, setStock] = useState('');
  const { data, loading, error } = useResource<unknown>('skus.list', { page: 1, pageSize: 100, query }, refreshKey); const rows = readList<Sku>(data); const { busy, run } = useAction();
  const filtered = useMemo(() => query ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())) : rows, [rows, query]);
  const updateStock = async (row: Sku) => { await run('inventory.update', { skuId: row._id || row.skuId, stockQuantity: Number(stock) }, '库存已更新'); setStock(''); setRefreshKey((key) => key + 1); };
  return <><PageIntro title={inventory ? '库存管理' : 'SKU 管理'} description={inventory ? '查看并调整云端 SKU 库存，库存变化由后台接口记录。' : '查看商品 SKU、规格、售价和库存信息。'} /><Panel className="toolbar"><Input value={query} onChange={setQuery} placeholder="搜索 SKU、商品或规格" /><Button onClick={() => setRefreshKey((key) => key + 1)}>刷新</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>SKU</th><th>商品</th><th>规格</th><th>售价</th><th>库存</th>{inventory && <th>调整库存</th>}</tr></thead><tbody>{filtered.length === 0 && <EmptyTable colSpan={inventory ? 6 : 5} />}{filtered.map((row) => <tr key={String(row._id || row.skuId)}><td>{String(row.skuId || row._id || '—')}</td><td>{String(row.productTitle || row.title || row.spuId || row.productId || '—')}</td><td>{Array.isArray(row.specInfo) ? JSON.stringify(row.specInfo) : String(row.specInfo || '—')}</td><td>{formatMoney(row.price)}</td><td className={Number(row.stockQuantity) <= Number(row.safeStockQuantity || 0) ? 'warning-text' : ''}>{String(row.stockQuantity ?? '—')}</td>{inventory && <td><div className="inline-action"><Input value={stock} onChange={setStock} placeholder="数量" /><Button size="small" loading={busy} onClick={() => void updateStock(row)}>保存</Button></div></td>}</tr>)}</tbody></Table></Panel>}</>;
}

export function HomeContentPage() {
  const [refreshKey, setRefreshKey] = useState(0); const [slot, setSlot] = useState('home.notice'); const [type, setType] = useState('notice'); const [title, setTitle] = useState(''); const [content, setContent] = useState('');
  const { data, loading, error } = useResource<unknown>('homeContent.list', { page: 1, pageSize: 100 }, refreshKey); const rows = readList<Record<string, unknown>>(data); const { busy, run } = useAction();
  const save = async () => { if (!slot.trim()) { await MessagePlugin.warning('请输入稳定槽位 key'); return; } if (!title.trim()) { await MessagePlugin.warning('请输入内容标题'); return; } await run('homeContent.save', { slot: slot.trim(), type, title, content }, '首页内容已保存'); setTitle(''); setContent(''); setRefreshKey((key) => key + 1); };
  return <><PageIntro title="首页内容" description="维护小程序首页的公告、轮播和推荐内容。使用稳定槽位 key 保存或更新同一块内容。" /><Panel className="form-panel"><div className="form-grid"><Field label="稳定槽位 key" hint="例如 home.notice；相同 key 会更新原内容。"><Input value={slot} onChange={setSlot} placeholder="home.notice" /></Field><Field label="标题"><Input value={title} onChange={setTitle} placeholder="请输入内容标题" /></Field><Field label="内容类型"><select value={type} onChange={(event) => setType(event.target.value)}><option value="notice">公告</option><option value="banner">轮播</option><option value="recommend">推荐</option></select></Field><Field label="内容"><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={4} placeholder="请输入内容或图片 fileID" /></Field></div><Button theme="primary" loading={busy} onClick={() => void save()}>保存内容</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>标题</th><th>类型</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={4} />}{rows.map((row) => <tr key={String(row._id || row.id)}><td>{String(row.title || '—')}</td><td>{String(row.type || '—')}</td><td>{String(row.status || '启用')}</td><td>{formatDate(row.updatedAt || row.updateTime)}</td></tr>)}</tbody></Table></Panel>}</>;
}

const statusLabels: Record<string, string> = { pending_payment: '待支付', paid: '已支付', shipped: '已发货', received: '已收货', completed: '已完成', cancelled: '已取消', refund_requested: '申请退款', refunding: '退款中', refunded: '已退款' };

export function OrdersPage() {
  const [orderNoQuery, setOrderNoQuery] = useState(''); const [userIdQuery, setUserIdQuery] = useState(''); const [status, setStatus] = useState(''); const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useResource<unknown>('orders.list', { page: 1, pageSize: 100, orderNo: orderNoQuery.trim() || undefined, userId: userIdQuery.trim() || undefined, status: status || undefined }, refreshKey); const rows = readList<Order>(data);
  const { busy, run } = useAction(); const cancel = async (order: Order) => { await run('orders.cancel', { orderNo: order.orderNo || order._id, reason: '管理员取消' }, '订单已取消'); setRefreshKey((key) => key + 1); };
  return <><PageIntro title="订单管理" description="查询订单、查看详情、取消订单和记录物流信息。支付状态只显示云端真实结果。" /><Panel className="toolbar"><Input value={orderNoQuery} onChange={setOrderNoQuery} placeholder="订单号" /><Input value={userIdQuery} onChange={setUserIdQuery} placeholder="用户 ID" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button onClick={() => setRefreshKey((key) => key + 1)}>查询</Button></Panel>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>订单号</th><th>用户</th><th>金额</th><th>支付状态</th><th>订单状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={7} />}{rows.map((order) => { const orderNo = String(order.orderNo || order._id || ''); const normalized = String(order.status || '').toLowerCase(); const cancelable = normalized === 'pending_payment'; return <tr key={orderNo}><td><Link to={`/orders/${encodeURIComponent(orderNo)}`}>{orderNo || '—'}</Link></td><td>{String(order.uid || order.userId || '—')}</td><td>{formatMoney(order.paymentAmount ?? order.totalAmount)}</td><td>{String(order.paymentStatus ?? '—')}</td><td><Tag theme={normalized.includes('cancel') ? 'default' : 'primary'} variant="light">{statusLabels[normalized] || String(order.orderStatusName || order.status || '—')}</Tag></td><td>{formatDate(order.createTime)}</td><td><Link className="text-button" to={`/orders/${encodeURIComponent(orderNo)}`}>详情</Link>{cancelable && <Button variant="text" loading={busy} onClick={() => void cancel(order)}>取消</Button>}</td></tr>; })}</tbody></Table></Panel>}</>;
}

export function OrderDetailPage() {
  const { orderNo = '' } = useParams(); const navigate = useNavigate(); const [refreshKey, setRefreshKey] = useState(0); const [company, setCompany] = useState(''); const [trackingNo, setTrackingNo] = useState('');
  const { data, loading, error } = useResource<Order>('orders.detail', { orderNo: decodeURIComponent(orderNo) }, refreshKey); const { busy, run } = useAction();
  if (loading) return <LoadingState />; if (error) return <ErrorState message={error} />; if (!data) return <EmptyState title="订单不存在" />;
  const items = readList<Record<string, unknown>>(data.items || data.orderItemVOs);
  const saveLogistics = async () => { await run('orders.logistics.save', { orderNo: data.orderNo || orderNo, logisticsCompanyName: company, logisticsNo: trackingNo }, '物流信息已记录'); setRefreshKey((key) => key + 1); };
  return <><PageIntro title={`订单详情 · ${String(data.orderNo || orderNo)}`} description="订单详情来源于云端。后台不会将未完成支付的订单标记为支付成功。" action={<Button variant="outline" onClick={() => navigate('/orders')}>返回列表</Button>} /><div className="detail-grid"><Panel><div className="panel-heading"><h3>订单信息</h3><Tag theme="primary" variant="light">{String(data.orderStatusName || data.status || '—')}</Tag></div><dl className="detail-list"><dt>订单号</dt><dd>{String(data.orderNo || orderNo)}</dd><dt>用户 ID</dt><dd>{String(data.uid || data.userId || '—')}</dd><dt>支付状态</dt><dd>{String(data.paymentStatus ?? '—')}（不在后台伪造支付结果）</dd><dt>支付金额</dt><dd>{formatMoney(data.paymentAmount ?? data.totalAmount)}</dd><dt>创建时间</dt><dd>{formatDate(data.createTime)}</dd></dl></Panel><Panel><h3>物流信息</h3><div className="form-grid"><Field label="物流公司"><Input value={company || String(data.logistics?.companyName || data.logisticsVO?.logisticsCompanyName || '')} onChange={setCompany} placeholder="例如：中通" /></Field><Field label="物流单号"><Input value={trackingNo || String(data.logistics?.trackingNo || data.logisticsVO?.logisticsNo || '')} onChange={setTrackingNo} placeholder="请输入物流单号" /></Field></div><Button theme="primary" loading={busy} onClick={() => void saveLogistics()}>记录物流</Button></Panel></div><Panel><h3>商品明细</h3><Table><thead><tr><th>商品</th><th>SKU</th><th>数量</th><th>金额</th></tr></thead><tbody>{items.length === 0 && <EmptyTable colSpan={4} />}{items.map((item, index) => <tr key={String(item._id || item.skuId || index)}><td>{String(item.goodsName || item.productName || item.title || '—')}</td><td>{String(item.skuId || '—')}</td><td>{String(item.buyQuantity || item.quantity || 0)}</td><td>{formatMoney(item.itemPaymentAmount || item.amount)}</td></tr>)}</tbody></Table></Panel></>;
}

export function UsersPage() {
  const [tab, setTab] = useState<'users' | 'addresses'>('users'); const users = useResource<unknown>('users.list', { page: 1, pageSize: 100 }); const addresses = useResource<unknown>('addresses.list', { page: 1, pageSize: 100 });
  const rows = tab === 'users' ? readList<User>(users.data) : readList<Address>(addresses.data); const loading = tab === 'users' ? users.loading : addresses.loading; const error = tab === 'users' ? users.error : addresses.error;
  return <><PageIntro title="用户 / 地址" description="只读查看用户资料和收货地址，不在后台暴露客户端写权限。" /><div className="tabs"><button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>用户</button><button className={tab === 'addresses' ? 'active' : ''} onClick={() => setTab('addresses')}>地址</button></div>{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead>{tab === 'users' ? <tr><th>UID</th><th>昵称</th><th>手机号</th><th>创建时间</th></tr> : <tr><th>用户 ID</th><th>收货人</th><th>电话</th><th>地址</th></tr>}</thead><tbody>{rows.length === 0 && <EmptyTable colSpan={4} />}{tab === 'users' ? (rows as User[]).map((row) => <tr key={String(row._id || row.uid)}><td>{String(row.uid || row._id || '—')}</td><td>{row.nickname || '—'}</td><td>{row.phone || '—'}</td><td>{formatDate(row.createdAt)}</td></tr>) : (rows as Address[]).map((row) => <tr key={String(row._id)}><td>{String(row.uid || '—')}</td><td>{row.name || '—'}</td><td>{row.phone || '—'}</td><td>{[row.province, row.city, row.district, row.detail].filter(Boolean).join(' ') || '—'}</td></tr>)}</tbody></Table></Panel>}</>;
}

export function CommentsPage() {
  const [refreshKey, setRefreshKey] = useState(0); const { data, loading, error } = useResource<unknown>('comments.list', { page: 1, pageSize: 100 }, refreshKey); const rows = readList<Comment>(data); const { busy, run } = useAction();
  const moderate = async (row: Comment, status: string) => { await run('comments.moderate', { id: row._id, status }, '评论状态已更新'); setRefreshKey((key) => key + 1); };
  return <><PageIntro title="评论管理" description="审核评论展示状态，评论正文和时间显示云端真实数据。" />{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>用户</th><th>评分</th><th>内容</th><th>订单</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={6} />}{rows.map((row) => <tr key={String(row._id)}><td>{row.userName || row.userId || '—'}</td><td>{String(row.score ?? row.commentScore ?? '—')}</td><td className="long-text">{row.content || row.commentContent || '—'}</td><td>{row.orderNo || '—'}</td><td>{String(row.status || '待审核')}</td><td><Button variant="text" loading={busy} onClick={() => void moderate(row, 'active')}>通过</Button><Button variant="text" loading={busy} onClick={() => void moderate(row, 'rejected')}>隐藏</Button></td></tr>)}</tbody></Table></Panel>}</>;
}

export function AfterSalesPage() {
  const [refreshKey, setRefreshKey] = useState(0); const { data, loading, error } = useResource<unknown>('afterSales.list', { page: 1, pageSize: 100 }, refreshKey); const rows = readList<AfterSale>(data); const { busy, run } = useAction();
  const review = async (row: AfterSale, status: string) => { await run('afterSales.review', { id: row._id, status }, '售后状态已更新'); setRefreshKey((key) => key + 1); };
  return <><PageIntro title="售后管理" description="处理售后申请并查看原因，不自动执行退款资金操作。" />{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Table><thead><tr><th>售后单号</th><th>订单号</th><th>用户</th><th>类型</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.length === 0 && <EmptyTable colSpan={7} />}{rows.map((row) => <tr key={String(row._id || row.afterSaleNo)}><td>{row.afterSaleNo || row._id || '—'}</td><td>{row.orderNo || '—'}</td><td>{row.userId || '—'}</td><td>{row.type || '—'}</td><td className="long-text">{row.reason || '—'}</td><td>{row.status || '待处理'}</td><td><Button variant="text" loading={busy} onClick={() => void review(row, 'approved')}>同意</Button><Button variant="text" loading={busy} onClick={() => void review(row, 'rejected')}>拒绝</Button></td></tr>)}</tbody></Table></Panel>}</>;
}

export function SettingsPage() {
  const [refreshKey, setRefreshKey] = useState(0); const { data, loading, error } = useResource<Record<string, unknown>>('settings.get', {}, refreshKey); const [json, setJson] = useState(''); const { busy, run } = useAction();
  useEffect(() => { if (data) setJson(JSON.stringify(data, null, 2)); }, [data]);
  const save = async () => { try { const value = JSON.parse(json || '{}') as Record<string, unknown>; await run('settings.save', { settings: value }, '系统设置已保存'); setRefreshKey((key) => key + 1); } catch (err) { await MessagePlugin.error(err instanceof Error ? err.message : '设置必须是合法 JSON'); } };
  return <><PageIntro title="系统设置" description="读取并保存 CloudBase 中的商城设置；请按云函数约定维护字段。" />{loading && <LoadingState />}{error && <ErrorState message={error} />}{!loading && !error && <Panel><Field label="设置 JSON" hint="空对象表示云端当前没有设置，不会自动填充演示内容。"><textarea className="json-editor" value={json} onChange={(event) => setJson(event.target.value)} rows={18} /></Field><div className="form-actions"><Button theme="primary" loading={busy} onClick={() => void save()}>保存设置</Button></div></Panel>}</>;
}
