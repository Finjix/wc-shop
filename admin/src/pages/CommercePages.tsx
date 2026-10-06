import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Button, Input, Tag } from 'tdesign-react';
import { adminApi, ApiError } from '../lib/api';
import { useConfirm } from '../components/ConfirmProvider';
import type { AfterSale, Comment, ListResult, Order } from '../types';
import { EmptyState, EmptyTable, ErrorState, Field, LoadingState, Panel, Table, formatDate, formatMoney, readList, readTotal } from '../components/Ui';
import type { AdminOutletContext } from '../components/Layout';

function useResource<T>(action: string, payload: Record<string, unknown>, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void adminApi.call<T>(action, payload).then((value) => {
      if (active) setData(value);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : '请求失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [action, JSON.stringify(payload), refreshKey]);
  return { data, loading, error };
}

function message(text: string, kind: 'success' | 'error' | 'warning' = 'success') {
  window.dispatchEvent(new CustomEvent('admin:message', { detail: { text, kind } }));
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async <T,>(action: string, payload: Record<string, unknown>, success: string) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await adminApi.call<T>(action, payload);
      message(success);
      return result === undefined ? true as T : result;
    } catch (error) {
      message(error instanceof Error ? error.message : '操作失败', 'error');
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}

function PageTitle({ children }: { children: string }) {
  return <h1 className="overview-title">{children}</h1>;
}

function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total) return null;
  return <div className="product-list-pagination commerce-pagination">
    <span>共 {total} 条</span>
    <div><Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button><span>{page} / {pages} 页</span><Button variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</Button></div>
  </div>;
}

function orderStatusKey(value: unknown) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ({ '10': 'paid', '40': 'shipped', '50': 'completed', '80': 'cancelled', pending_delivery: 'paid', pending_receipt: 'shipped', received: 'completed', complete: 'completed', canceled: 'cancelled' } as Record<string, string>)[key] || key;
}

function orderStatusLabel(value: unknown) {
  return ({ paid: '待发货', shipped: '待收货', completed: '已完成', cancelled: '已取消' } as Record<string, string>)[orderStatusKey(value)] || '—';
}

function statusTag(value: unknown) {
  const key = orderStatusKey(value);
  return <Tag theme={['cancelled', 'refunded'].includes(key) ? 'default' : 'primary'} variant="light">{orderStatusLabel(key)}</Tag>;
}

function paymentLabel(order: Order) {
  const status = String(order.paymentStatus ?? order.payment?.status ?? '').toLowerCase();
  if (['partially_refunded', 'partial_refunded', 'partial_refund'].includes(status)) return '已退款';
  if (['refunded', 'full_refund'].includes(status)) return '已退款';
  if (['paid', 'success', '1', '2'].includes(status)) {
    return order.payment?.mode === 'simulated' || order.paymentMode === 'simulated'
      ? '模拟支付完成' : '已支付';
  }
  return '—';
}

function createdAtOf(value: Order) { return value.createdAt ?? value.createTime; }
function amountOf(order: Order) { return order.paymentAmount ?? order.totalAmount ?? order.amount; }
function refundAmountOf(order: Order) { return order.refundAmount ?? order.refundedAmount ?? order.totalRefundAmount; }
function orderIdOf(order: Order, fallback = '') { return String(order._id || order.orderId || order.orderNo || fallback); }
const PAGE_SIZE = 20;
const orderFilters = [['', '全部状态'], ['paid', '待发货'], ['shipped', '待收货'], ['completed', '已完成'], ['cancelled', '已取消'], ['refunded', '已退款']];

export function OrdersPage() {
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status') || '';
  const initialStatus = orderFilters.some(([value]) => value === requestedStatus) ? requestedStatus : '';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState({ orderNo: '', status: initialStatus, page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useResource<unknown>('orders.list', { page: search.page, pageSize: PAGE_SIZE, orderNo: search.orderNo || undefined, status: search.status || undefined }, refreshKey);
  const rows = readList<Order>(data);
  const total = readTotal(data, rows.length);
  const submitSearch = () => {
    setSearch({ orderNo: query.trim(), status, page: 1 });
    setRefreshKey((key) => key + 1);
  };
  return <>
    <div className="toolbar commerce-toolbar orders-toolbar">
      <Input value={query} onChange={setQuery} placeholder="订单号" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}>{orderFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Button onClick={submitSearch}>查询</Button>
    </div>
    {loading && <LoadingState />}
    {error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!loading && !error && <Panel>
      <Table minWidth={970}>
        <thead><tr><th>订单号</th><th>金额</th><th>订单状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyTable colSpan={5} />}
          {rows.map((order) => {
            const id = orderIdOf(order);
            const currentStatus = orderStatusKey(order.status ?? order.orderStatusName);
            return <tr key={id}>
              <td><Link to={`/orders/${encodeURIComponent(String(order.orderNo || id))}`}>{String(order.orderNo || id || '—')}</Link></td>
              <td>{formatMoney(amountOf(order))}</td>
              <td>{statusTag(currentStatus)}</td><td>{formatDate(createdAtOf(order))}</td>
              <td><Link className="text-button" to={`/orders/${encodeURIComponent(String(order.orderNo || id))}`}>详情</Link></td>
            </tr>;
          })}
        </tbody>
      </Table>
      <Pagination page={search.page} pageSize={PAGE_SIZE} total={total} onChange={(page) => setSearch((old) => ({ ...old, page }))} />
    </Panel>}
  </>;
}

function addressOf(order: Order) {
  const source = [order.addressSnapshot, order.userAddress, order.userAddressReq, order.address]
    .find((value) => value && typeof value === 'object') as Record<string, unknown> | undefined;
  if (!source) return { receiver: '—', phone: '—', address: '—' };
  const text = (...keys: string[]) => keys.map((key) => String(source[key] ?? '').trim()).find(Boolean) || '';
  return {
    receiver: text('receiver', 'name', 'consignee') || '—',
    phone: text('phone', 'phoneNumber', 'mobile') || '—',
    address: [text('province', 'provinceName'), text('city', 'cityName'), text('district', 'districtName'), text('detail', 'detailAddress', 'address')].filter(Boolean).join(' ') || '—',
  };
}

function listOf<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : readList<T>(value); }
function quantityMapValue(map: unknown, item: Record<string, unknown>) {
  if (!map || typeof map !== 'object') return undefined;
  const source = map as Record<string, unknown>;
  const skuId = String(item.skuId || item._id || '');
  if (!skuId || !Object.prototype.hasOwnProperty.call(source, skuId)) return undefined;
  return Math.max(0, Number(source[skuId]) || 0);
}
function itemQuantity(item: Record<string, unknown>) { return Math.max(0, Number(item.buyQuantity ?? item.quantity ?? item.rightsQuantity ?? 0) || 0); }
function refundedQuantity(item: Record<string, unknown>, map?: unknown) {
  return quantityMapValue(map, item) ?? Math.max(0, Number(item.refundedQuantity ?? item.refundQuantity ?? 0) || 0);
}
function shippedQuantity(item: Record<string, unknown>, map?: unknown) {
  return quantityMapValue(map, item) ?? Math.max(0, Number(item.shippedQuantity ?? item.deliveredQuantity ?? 0) || 0);
}
function remainingQuantity(item: Record<string, unknown>, refundedMap?: unknown, shippedMap?: unknown) {
  const explicit = item.remainingShipQuantity ?? item.remainingQuantity;
  if (explicit !== undefined) return Math.max(0, Number(explicit) || 0);
  return Math.max(0, itemQuantity(item) - refundedQuantity(item, refundedMap) - shippedQuantity(item, shippedMap));
}
function orderItemTitle(item: Record<string, unknown>) {
  const productSnapshot = item.productSnapshot && typeof item.productSnapshot === 'object' ? item.productSnapshot as Record<string, unknown> : {};
  const skuSnapshot = item.skuSnapshot && typeof item.skuSnapshot === 'object' ? item.skuSnapshot as Record<string, unknown> : {};
  return String(item.goodsName || item.productName || item.title || productSnapshot.title || productSnapshot.productName || skuSnapshot.title || '—');
}
function orderItemAmount(item: Record<string, unknown>) {
  const saved = item.itemPaymentAmount ?? item.paymentAmount ?? item.amount;
  if (saved !== undefined) return saved;
  const unit = Number(item.unitPrice ?? item.salePrice ?? item.price ?? 0);
  return Number.isFinite(unit) ? unit * itemQuantity(item) : 0;
}

export function OrderDetailPage() {
  const { orderNo = '' } = useParams();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const [company, setCompany] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const { data, loading, error } = useResource<Order>('orders.get', { orderNo: decodeURIComponent(orderNo), orderId: decodeURIComponent(orderNo) }, refreshKey);
  const { busy, run } = useAction();
  useEffect(() => {
    const logistics = data?.logistics || data?.tracking || data?.logisticsVO || {};
    setCompany(String(logistics.companyName || logistics.logisticsCompanyName || logistics.logistics || ''));
    setTrackingNo(String(logistics.trackingNo || logistics.logisticsNo || logistics.no || ''));
  }, [data]);
  const items = listOf<Record<string, unknown>>(data?.items || data?.orderItemVOs);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />;
  if (!data) return <EmptyState title="订单不存在" />;
  const status = orderStatusKey(data.status ?? data.orderStatusName);
  const address = addressOf(data);
  const refundQuantities = data.refundedQuantities;
  const shippedQuantities = data.shippedQuantities;
  const hasShippableItems = items.length === 0 || items.some((item) => remainingQuantity(item, refundQuantities, shippedQuantities) > 0);
  const hasActiveAfterSale = Boolean(data.hasActiveAfterSale || Number(data.pendingRefundAmount || 0) > 0);
  const shipOrder = async () => {
    if (busy) return;
    if (!company.trim() || !trackingNo.trim()) { message('发货前请填写物流公司和物流单号', 'warning'); return; }
    const result = await run('orders.ship', { orderId: orderIdOf(data, orderNo), logistics: { companyName: company.trim() }, trackingNo: trackingNo.trim() }, '订单已发货');
    if (result !== undefined) setRefreshKey((key) => key + 1);
  };
  return <>
    <PageTitle>订单详情</PageTitle>
    <div className="page-actions"><Button variant="outline" onClick={() => navigate('/orders')}>返回列表</Button></div>
    <div className="detail-grid">
      <Panel>
        <div className="panel-heading"><h3>订单信息</h3>{statusTag(status)}</div>
        <dl className="detail-list">
          <dt>订单号</dt><dd>{String(data.orderNo || orderNo)}</dd>
          <dt>订单状态</dt><dd>{orderStatusLabel(status)}</dd>
          <dt>支付状态</dt><dd>{paymentLabel(data)}</dd>
          <dt>支付方式</dt><dd>{data.payment?.mode === 'simulated' || data.paymentMode === 'simulated' ? '模拟支付' : '—'}</dd>
          <dt>订单金额</dt><dd>{formatMoney(amountOf(data))}</dd>
          <dt>已退款金额</dt><dd>{refundAmountOf(data) === undefined ? '¥0.00' : formatMoney(refundAmountOf(data))}</dd>
          <dt>创建时间</dt><dd>{formatDate(createdAtOf(data))}</dd>
        </dl>
        <h3>收货信息</h3>
        <dl className="detail-list"><dt>收货人</dt><dd>{address.receiver}</dd><dt>联系电话</dt><dd>{address.phone}</dd><dt>收货地址</dt><dd>{address.address}</dd></dl>
      </Panel>
      <Panel>
        <h3>物流信息</h3>
        {status === 'paid' ? <>
          <div className="form-grid"><Field label="物流公司"><Input value={company} onChange={setCompany} placeholder="例如：中通" /></Field><Field label="物流单号"><Input value={trackingNo} onChange={setTrackingNo} placeholder="请输入物流单号" /></Field></div>
          {hasActiveAfterSale && <div className="notice warning">订单有退款申请审核中，审核完成前暂不可发货。</div>}
          <div className="form-actions"><Button theme="primary" disabled={busy || hasActiveAfterSale || !company.trim() || !trackingNo.trim() || !hasShippableItems} loading={busy} onClick={() => void shipOrder()}>{hasActiveAfterSale ? '售后审核中，暂不可发货' : '保存物流并发货'}</Button></div>
        </> : <dl className="detail-list"><dt>物流公司</dt><dd>{company || '—'}</dd><dt>物流单号</dt><dd>{trackingNo || '—'}</dd></dl>}
      </Panel>
    </div>
    <Panel>
      <h3>商品明细</h3>
      <Table minWidth={900}><thead><tr><th>商品</th><th>SKU</th><th>购买数量</th><th>已退款数量</th><th>已发货数量</th><th>剩余可发货</th><th>金额</th></tr></thead>
        <tbody>{items.length === 0 && <EmptyTable colSpan={7} />}{items.map((item, index) => <tr key={String(item._id || item.skuId || index)}>
          <td>{orderItemTitle(item)}</td><td>{String(item.skuId || '—')}</td><td>{itemQuantity(item)}</td><td>{refundedQuantity(item, refundQuantities)}</td><td>{shippedQuantity(item, shippedQuantities)}</td><td>{remainingQuantity(item, refundQuantities, shippedQuantities)}</td><td>{formatMoney(orderItemAmount(item))}</td>
        </tr>)}</tbody>
      </Table>
    </Panel>
  </>;
}

function imageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return String(record.fileID || record.fileId || record.url || record.src || '');
    }
    return '';
  }).filter(Boolean);
}

function ResolvedImage({ fileID, alt, className }: { fileID: string; alt: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    void adminApi.getTempFileUrl(fileID).then((url) => { if (active) setSrc(url); }).catch(() => { if (active) setSrc(''); });
    return () => { active = false; };
  }, [fileID]);
  return src ? <img className={className} src={src} alt={alt} /> : <span className="commerce-image-pending">图片暂不可用</span>;
}

export function CommentsPage() {
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: '', orderNo: '', page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [replyOpen, setReplyOpen] = useState('');
  const [replyText, setReplyText] = useState('');
  const { data, loading, error } = useResource<unknown>('comments.list', { page: search.page, pageSize: PAGE_SIZE, status: search.status || undefined, orderNo: search.orderNo || undefined }, refreshKey);
  const rows = readList<Comment>(data);
  const total = readTotal(data, rows.length);
  const { busy, run } = useAction();
  const moderate = async (row: Comment, nextStatus: string) => {
    const result = await run('comments.moderate', { id: row._id || row.id, status: nextStatus }, nextStatus === 'active' ? '评论已公开' : '评论已隐藏');
    if (result !== undefined) setRefreshKey((key) => key + 1);
  };
  const saveReply = async (row: Comment) => {
    if (!replyText.trim()) { message('请输入商家回复', 'warning'); return; }
    const result = await run('comments.reply', { id: row._id || row.id, reply: replyText.trim() }, '商家回复已保存');
    if (result !== undefined) { setReplyOpen(''); setReplyText(''); setRefreshKey((key) => key + 1); }
  };
  return <>
    <PageTitle>评价管理</PageTitle>
    <Panel className="toolbar commerce-toolbar"><Input value={query} onChange={setQuery} placeholder="订单号" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="pending_review">待审核</option><option value="active">已展示</option><option value="rejected">已隐藏</option></select><Button onClick={() => { setSearch({ orderNo: query.trim(), status, page: 1 }); setRefreshKey((key) => key + 1); }}>查询</Button></Panel>
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!loading && !error && <Panel>
      <Table minWidth={1160}><thead><tr><th>用户</th><th>评分</th><th>内容</th><th>商品</th><th>订单</th><th>图片</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {rows.length === 0 && <EmptyTable colSpan={8} />}
        {rows.map((row) => {
          const id = String(row._id || row.id || '');
          const photos = imageIds(row.images || row.resources || row.imageList || row.commentResources);
          const normalized = String(row.status || '').toLowerCase();
          const isActive = ['active', 'approved', '1'].includes(normalized);
          return <tr key={id}>
            <td>{String(row.userName || row.userId || '—')}</td><td>{String(row.score ?? row.commentScore ?? row.rating ?? '—')}</td>
            <td className="long-text">{String(row.content || row.commentContent || '—')}{row.reply && <div className="commerce-reply-preview">商家回复：{String(row.reply)}</div>}</td>
            <td>{String(row.productTitle || row.productId || row.spuId || '—')}</td><td>{String(row.orderNo || '—')}</td>
            <td><div className="commerce-image-row">{photos.map((src, index) => <ResolvedImage key={`${id}-${index}`} fileID={src} alt={`评价图片 ${index + 1}`} className="commerce-thumb" />)}</div>{photos.length === 0 ? '—' : null}</td>
            <td>{isActive ? '已展示' : ['rejected', 'inactive', '2'].includes(normalized) ? '已隐藏' : '待审核'}</td>
            <td className="commerce-actions">{!isActive && <Button variant="text" disabled={busy} loading={busy} onClick={() => void moderate(row, 'active')}>通过</Button>}{isActive && <Button variant="text" disabled={busy} loading={busy} onClick={() => void moderate(row, 'rejected')}>隐藏</Button>}<Button variant="text" disabled={busy} onClick={() => { setReplyOpen(id); setReplyText(String(row.reply || '')); }}>回复</Button></td>
          </tr>;
        })}
      </tbody></Table>
      <Pagination page={search.page} pageSize={PAGE_SIZE} total={total} onChange={(page) => setSearch((old) => ({ ...old, page }))} />
    </Panel>}
    {replyOpen && <div className="home-config-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReplyOpen(''); }}><section className="home-config-dialog" role="dialog" aria-modal="true" aria-label="商家回复"><h3>回复评价</h3><label className="field"><span>回复内容</span><textarea rows={5} value={replyText} onChange={(event) => setReplyText(event.target.value)} maxLength={500} /></label><div className="home-config-dialog-actions"><Button variant="outline" disabled={busy} onClick={() => setReplyOpen('')}>取消</Button><Button theme="primary" disabled={busy} loading={busy} onClick={() => { const row = rows.find((item) => String(item._id || item.id) === replyOpen); if (row) void saveReply(row); }}>保存回复</Button></div></section></div>}
  </>;
}

function afterSaleType(value: unknown) {
  const key = String(value ?? '').toLowerCase();
  return ['10', 'return_refund', 'return', 'return_goods'].includes(key) ? '退货退款' : ['20', 'refund', 'only_refund'].includes(key) ? '仅退款' : key || '—';
}
function afterSaleState(value: unknown) {
  const key = String(value ?? '').toLowerCase();
  return ({ '100': 'pending_review', pending: 'pending_review', '110': 'approved', '120': 'approved', '130': 'refunding', '140': 'refunding', '150': 'refunding', '160': 'refunded', '170': 'rejected' } as Record<string, string>)[key] || key;
}
function afterSaleStatusLabel(value: unknown) {
  return ({ pending_review: '待审核', approved: '审核通过 / 待寄回', refunding: '待确认退款', refunded: '退款完成', rejected: '已拒绝', inactive: '已撤销' } as Record<string, string>)[afterSaleState(value)] || String(value || '—');
}
function afterSaleIdOf(row: AfterSale) { return String(row._id || row.afterSaleId || row.afterSaleNo || row.rightsNo || ''); }

export function AfterSalesPage() {
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const [status, setStatus] = useState(initialStatus);
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: initialStatus, type: '', orderNo: '', page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<AfterSale | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejection, setRejection] = useState<AfterSale | null>(null);
  const confirm = useConfirm();
  const { data, loading, error } = useResource<unknown>('afterSales.list', { page: search.page, pageSize: PAGE_SIZE, status: search.status || undefined, type: search.type || undefined, orderNo: search.orderNo || undefined }, refreshKey);
  const rows = readList<AfterSale>(data);
  const total = readTotal(data, rows.length);
  const { busy, run } = useAction();
  const review = async (row: AfterSale, next: 'approved' | 'rejected', reason = '') => {
    const result = await run('afterSales.review', { id: afterSaleIdOf(row), status: next, ...(reason ? { reason } : {}) }, next === 'approved' ? '已通过申请，系统已处理模拟退款或等待寄回' : '售后申请已拒绝');
    if (result !== undefined) { setRejection(null); setRejectReason(''); setSelected(null); setRefreshKey((key) => key + 1); }
  };
  const confirmReturn = async (row: AfterSale) => {
    if (!await confirm('确认已收到退货并完成模拟退款？')) return;
    const result = await run('afterSales.confirmReturn', { afterSaleId: afterSaleIdOf(row) }, '已确认退货并完成模拟退款');
    if (result !== undefined) { setSelected(null); setRefreshKey((key) => key + 1); }
  };
  const submitSearch = () => {
    setSearch({ status, type, orderNo: query.trim(), page: 1 });
    setRefreshKey((key) => key + 1);
  };
  return <>
    <div className="panel-heading"><PageTitle>售后管理</PageTitle><Link className="text-button" to="/after-sales/address">售后地址设置</Link></div>
    <Panel className="toolbar commerce-toolbar"><Input value={query} onChange={setQuery} placeholder="订单号" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="pending_review">待审核</option><option value="approved">待寄回</option><option value="refunding">待确认退款</option><option value="refunded">退款完成</option><option value="rejected">已拒绝</option></select><select value={type} onChange={(event) => setType(event.target.value)}><option value="">全部类型</option><option value="20">仅退款</option><option value="10">退货退款</option></select><Button onClick={submitSearch}>查询</Button></Panel>
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!loading && !error && <Panel><Table minWidth={1100}><thead><tr><th>售后单号</th><th>订单号</th><th>类型</th><th>退款金额</th><th>申请原因</th><th>物流</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>
      {rows.length === 0 && <EmptyTable colSpan={9} />}
      {rows.map((row) => {
        const id = afterSaleIdOf(row);
        const state = afterSaleState(row.status || row.rightsStatus);
        const orderNo = String(row.orderNo || '');
        const logistics = [row.logisticsCompanyName || row.trackingCompany, row.logisticsNo || row.trackingNo].filter(Boolean).join(' ');
        return <tr key={id}>
          <td><button className="text-button commerce-link-button" onClick={() => setSelected(row)}>{String(row.afterSaleNo || row.rightsNo || id || '—')}</button></td>
          <td>{orderNo ? <Link className="text-button" to={`/orders/${encodeURIComponent(orderNo)}`}>{orderNo}</Link> : '—'}</td>
          <td>{afterSaleType(row.type ?? row.rightsType)}</td><td>{formatMoney(row.amount ?? row.refundAmount ?? row.refundRequestAmount)}</td><td className="long-text">{String(row.reason || row.description || '—')}</td>
          <td>{String(logistics || '—')}</td><td>{afterSaleStatusLabel(state)}</td><td>{formatDate(row.createdAt ?? row.createTime)}</td>
          <td className="commerce-actions">
            {state === 'pending_review' && <><Button variant="text" disabled={busy} loading={busy} onClick={() => void review(row, 'approved')}>同意</Button><Button variant="text" disabled={busy} onClick={() => { setRejection(row); setRejectReason(''); }}>拒绝</Button></>}
            {state === 'refunding' && <Button variant="text" disabled={busy} loading={busy} onClick={() => void confirmReturn(row)}>确认退货并退款</Button>}
            <Button variant="text" disabled={busy} onClick={() => setSelected(row)}>详情</Button>
          </td>
        </tr>;
      })}
    </tbody></Table><Pagination page={search.page} pageSize={PAGE_SIZE} total={total} onChange={(page) => setSearch((old) => ({ ...old, page }))} /></Panel>}
    {selected && <div className="home-config-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelected(null); }}><section className="home-config-dialog commerce-detail-dialog" role="dialog" aria-modal="true" aria-label="售后详情"><div className="panel-heading"><h3>售后详情</h3><Button variant="text" disabled={busy} onClick={() => setSelected(null)}>关闭</Button></div>
      <dl className="detail-list"><dt>售后单号</dt><dd>{String(selected.afterSaleNo || selected.rightsNo || afterSaleIdOf(selected))}</dd><dt>订单号</dt><dd>{String(selected.orderNo || '—')}</dd><dt>类型</dt><dd>{afterSaleType(selected.type ?? selected.rightsType)}</dd><dt>退款金额</dt><dd>{formatMoney(selected.amount ?? selected.refundAmount ?? selected.refundRequestAmount)}</dd><dt>状态</dt><dd>{afterSaleStatusLabel(selected.status || selected.rightsStatus)}</dd><dt>申请原因</dt><dd>{String(selected.reason || selected.description || '—')}</dd><dt>退货地址</dt><dd>{returnAddressLabel(selected.returnAddressSnapshot)}</dd><dt>退货物流</dt><dd>{[selected.logisticsCompanyName || selected.trackingCompany, selected.logisticsNo || selected.trackingNo].filter(Boolean).join(' ') || '—'}</dd></dl>
      <h3>售后凭证</h3><div className="commerce-image-row">{imageIds(selected.images || selected.resources).map((src, index) => <ResolvedImage key={`${afterSaleIdOf(selected)}-${index}`} fileID={src} alt={`售后凭证 ${index + 1}`} className="commerce-proof-image" />)}{imageIds(selected.images || selected.resources).length === 0 && <span>未上传凭证</span>}</div>
      <h3>申请商品</h3><Table minWidth={500}><thead><tr><th>SKU</th><th>数量</th><th>金额</th></tr></thead><tbody>{listOf<Record<string, unknown>>(selected.items || selected.rightsItem).map((item, index) => <tr key={`${item.skuId || index}`}><td>{String(item.skuId || item.goodsName || '—')}</td><td>{String(item.rightsQuantity ?? item.quantity ?? 0)}</td><td>{formatMoney(item.amount ?? item.refundAmount)}</td></tr>)}</tbody></Table>
      {afterSaleState(selected.status || selected.rightsStatus) === 'pending_review' && <div className="form-actions"><Button theme="primary" disabled={busy} loading={busy} onClick={() => void review(selected, 'approved')}>同意申请</Button><Button variant="outline" disabled={busy} onClick={() => { setRejectReason(''); setRejection(selected); setSelected(null); }}>拒绝申请</Button></div>}
      {afterSaleState(selected.status || selected.rightsStatus) === 'refunding' && <div className="form-actions"><Button theme="primary" disabled={busy} loading={busy} onClick={() => void confirmReturn(selected)}>确认收到退货并完成模拟退款</Button></div>}
    </section></div>}
    {rejection && <div className="home-config-dialog-backdrop" role="presentation"><section className="home-config-dialog" role="dialog" aria-modal="true" aria-label="拒绝售后申请"><h3>拒绝售后申请</h3><label className="field"><span>拒绝原因</span><textarea rows={4} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={300} /></label><div className="home-config-dialog-actions"><Button variant="outline" disabled={busy} onClick={() => setRejection(null)}>取消</Button><Button theme="primary" disabled={busy || !rejectReason.trim()} loading={busy} onClick={() => void review(rejection, 'rejected', rejectReason.trim())}>确认拒绝</Button></div></section></div>}
  </>;
}

type ReturnAddress = { receiver: string; phone: string; province: string; city: string; district: string; detail: string };
const emptyReturnAddress: ReturnAddress = { receiver: '', phone: '', province: '', city: '', district: '', detail: '' };

function returnAddressFrom(value: unknown): ReturnAddress {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { receiver: String(source.receiver || source.name || ''), phone: String(source.phone || ''), province: String(source.province || ''), city: String(source.city || ''), district: String(source.district || ''), detail: String(source.detail || source.detailAddress || '') };
}
function returnAddressLabel(value: unknown) {
  if (!value || typeof value !== 'object') return '—';
  const address = value as Record<string, unknown>;
  return [address.receiver || address.name, address.phone, address.province, address.city, address.district, address.detail || address.detailAddress].map((part) => String(part || '').trim()).filter(Boolean).join(' ') || '—';
}

export function SettingsPage() {
  const [value, setValue] = useState<ReturnAddress>(emptyReturnAddress);
  const [saved, setSaved] = useState<ReturnAddress>(emptyReturnAddress);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const { setUnsavedChanges } = useOutletContext<AdminOutletContext>();
  const confirm = useConfirm();
  const dirty = !loading && JSON.stringify(value) !== JSON.stringify(saved);
  const blocker = useBlocker(dirty);
  useEffect(() => { setUnsavedChanges(dirty); return () => setUnsavedChanges(false); }, [dirty, setUnsavedChanges]);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    void confirm('退货地址尚未保存，确定离开吗？').then((confirmed) => {
      if (!active) return;
      if (confirmed) { setValue(saved); setUnsavedChanges(false); blocker.proceed(); }
      else blocker.reset();
    });
    return () => { active = false; };
  }, [blocker.state, blocker.proceed, blocker.reset, confirm, saved, setUnsavedChanges]);
  useEffect(() => {
    let active = true;
    void adminApi.call<Record<string, unknown>>('settings.get', { key: 'global' }).then((result) => {
      const outer = result && typeof result === 'object' ? result : {};
      const base = (outer.value && typeof outer.value === 'object' ? outer.value : outer) as Record<string, unknown>;
      const address = returnAddressFrom(base.returnAddress);
      if (active) { setValue(address); setSaved(address); }
    }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && ['NOT_FOUND', 'SETTING_NOT_FOUND'].includes(String(err.code || '').toUpperCase())) {
        setValue(emptyReturnAddress); setSaved(emptyReturnAddress); return;
      }
      if (err instanceof Error && /请求的数据不存在/.test(err.message)) { setValue(emptyReturnAddress); setSaved(emptyReturnAddress); return; }
      setError(err instanceof Error ? err.message : '设置读取失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const update = (key: keyof ReturnAddress, next: string) => setValue((old) => ({ ...old, [key]: next }));
  const save = async () => {
    if (busyRef.current || !dirty) return;
    if (!value.receiver.trim() || !value.phone.trim() || !value.detail.trim()) { message('请填写收件人、联系电话和详细地址', 'warning'); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      let existing: Record<string, unknown> = {};
      try {
        const current = await adminApi.call<Record<string, unknown>>('settings.get', { key: 'global' });
        const outer = current && typeof current === 'object' ? current : {};
        existing = (outer.value && typeof outer.value === 'object' ? outer.value : outer) as Record<string, unknown>;
      } catch (err) {
        if (!(err instanceof ApiError && ['NOT_FOUND', 'SETTING_NOT_FOUND'].includes(String(err.code || '').toUpperCase()))
          && !(err instanceof Error && /请求的数据不存在/.test(err.message))) throw err;
      }
      await adminApi.call('settings.upsert', { key: 'global', value: { ...existing, returnAddress: value } });
      setSaved(value); setUnsavedChanges(false); message('退货地址已保存');
    } catch (err) { message(err instanceof Error ? err.message : '退货地址保存失败', 'error'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <>
    <div className="panel-heading"><PageTitle>售后地址设置</PageTitle><Link className="text-button" to="/after-sales">返回售后管理</Link></div>
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
    {!loading && !error && <Panel className="form-panel commerce-settings-panel">
      <p className="commerce-settings-note">审核通过退货退款申请后，小程序会向买家展示此地址。</p>
      <div className="form-grid"><Field label="收件人"><Input value={value.receiver} onChange={(next) => update('receiver', next)} maxlength={40} /></Field><Field label="联系电话"><Input value={value.phone} onChange={(next) => update('phone', next)} maxlength={30} /></Field><Field label="省份"><Input value={value.province} onChange={(next) => update('province', next)} /></Field><Field label="城市"><Input value={value.city} onChange={(next) => update('city', next)} /></Field><Field label="区县"><Input value={value.district} onChange={(next) => update('district', next)} /></Field><Field label="详细地址"><Input value={value.detail} onChange={(next) => update('detail', next)} maxlength={200} /></Field></div>
      <div className="form-actions"><Button theme="primary" disabled={busy || !dirty} loading={busy} onClick={() => void save()}>保存退货地址</Button></div>
    </Panel>}
  </>;
}

export function OverviewWorkQueue({ orders, afterSales }: { orders?: number; afterSales?: number }) {
  return <Panel className="commerce-work-queue"><div className="panel-heading"><h3>待处理订单</h3><Link className="text-button" to="/orders">查看全部</Link></div><div className="commerce-work-queue-counts"><Link to="/orders?status=paid"><strong>{orders ?? '—'}</strong><span>待发货</span></Link><Link to="/after-sales?status=pending_review"><strong>{afterSales ?? '—'}</strong><span>待审核售后</span></Link></div></Panel>;
}
