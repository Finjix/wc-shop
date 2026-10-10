import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Button, Dialog, Input, Tag } from 'tdesign-react';
import { adminApi, ApiError } from '../lib/api';
import { parseRefundAmount } from '../lib/refund-amount';
import { afterSalePolicy, afterSaleRequestLabel, afterSaleReceiptLabel } from '../lib/after-sale-policy';
import { useConfirm } from '../components/ConfirmProvider';
import type { AfterSale, Comment, ListResult, Order, OrderAddressGroup } from '../types';
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

function Pagination({ page, pageSize, total, onChange, unit = '条', showTotal = true }: { page: number; pageSize: number; total: number; onChange: (page: number) => void; unit?: string; showTotal?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total) return null;
  return <div className="product-list-pagination commerce-pagination">
    <span>{showTotal && <>共 {total} {unit}</>}</span>
    <div><Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button><span>{page} / {pages} 页</span><Button variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</Button></div>
  </div>;
}

function orderStatusKey(value: unknown) {
  return value === 'received' ? 'completed' : String(value ?? '');
}

function orderStatusLabel(value: unknown) {
  return ({ paid: '待发货', shipped: '待收货', completed: '已完成', refunded: '已退款', cancelled: '已取消' } as Record<string, string>)[orderStatusKey(value)] || '—';
}

function orderDisplayStatus(order: Order) {
  if (order.displayStatus) return String(order.displayStatus);
  if (order.status === 'refunded' && (order.closureScenario === 'cancel_order' || order.fulfillmentStatus === 'paid')) return 'cancelled';
  return orderStatusKey(order.status);
}

function statusTag(value: unknown, hasActiveAfterSale = false) {
  const key = orderStatusKey(value);
  return <Tag theme={['refunded', 'cancelled'].includes(key) ? 'default' : 'primary'} variant="light" style={hasActiveAfterSale ? { color: '#d54941' } : undefined}>{orderStatusLabel(key)}{hasActiveAfterSale ? ' · 售后处理中' : ''}</Tag>;
}

function createdAtOf(value: Order) { return value.createdAt; }
function amountOf(order: Order) { return order.paymentAmount; }
function orderIdOf(order: Order) { return String(order._id); }
const PAGE_SIZE = 20;
const orderFilters = [['', '全部状态'], ['paid', '待发货'], ['shipped', '待收货'], ['completed', '已完成'], ['refunded', '已退款'], ['cancelled', '已取消']];

export function OrdersPage() {
  const [shippingOrder, setShippingOrder] = useState<Order | null>(null);
  const [shippingGroup, setShippingGroup] = useState<OrderAddressGroup | null>(null);
  const [editingGroup, setEditingGroup] = useState<OrderAddressGroup | null>(null);
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status') || '';
  const initialStatus = orderFilters.some(([value]) => value === requestedStatus) ? requestedStatus : '';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState({ orderNo: '', status: initialStatus, page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, error } = useResource<unknown>('orders.list', { groupBy: 'address', page: search.page, pageSize: PAGE_SIZE, orderNo: search.orderNo || undefined, status: search.status || undefined }, refreshKey);
  const groups = readList<OrderAddressGroup>(data);
  const total = readTotal(data, groups.length);
  const confirm = useConfirm();
  const { busy, run } = useAction();
  const deleteOrder = async (order: Order) => {
    if (busy || order.hasActiveAfterSale || order.canDeleteAdmin === false) return;
    if (!await confirm(`确定永久删除订单 ${order.orderNo || orderIdOf(order)} 及其所有关联售后单？两端数据都会删除；未发货库存会释放，但删除不会自动退款。操作不可恢复。`)) return;
    const result = await run('orders.delete', { orderId: orderIdOf(order) }, '订单已删除');
    if (result !== undefined) {
      if (groups.length === 1 && groups[0].orders.length === 1 && search.page > 1) setSearch((old) => ({ ...old, page: old.page - 1 }));
      setRefreshKey((key) => key + 1);
    }
  };
  const submitSearch = () => {
    setSearch({ orderNo: query.trim(), status, page: 1 });
    setRefreshKey((key) => key + 1);
  };
  return <div className="orders-page">
    <div className="toolbar commerce-toolbar orders-toolbar">
      <Input value={query} onChange={setQuery} placeholder="订单号" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}>{orderFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Button onClick={submitSearch}>查询</Button>
    </div>
    {loading && <LoadingState />}
    {error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!loading && !error && <div className={`orders-address-groups${groups.length === 0 ? ' orders-address-groups-empty' : ''}`}>
      {groups.length === 0 && <Panel className="orders-empty-panel"><EmptyState /></Panel>}
      {groups.map((group) => {
        const pending = group.orders.filter(orderCanShip);
        return <Panel key={group.key} className="orders-address-group">
          <div className="orders-address-heading">
            <div>
              <div className="orders-address-summary">
                <strong>{group.address.receiver || '收货人未填写'} <span>{group.address.phone}</span></strong>
                <span className="orders-address-text">{group.address.address || '收货地址未填写'}</span>
              </div>
              {!group.canCombine && <small>地址信息不完整，不支持合并发货</small>}
            </div>
            <div className="orders-address-actions">
              {group.orders.some((order) => orderStatusKey(order.status) === 'shipped' && !order.hasActiveAfterSale) && <Button variant="outline" onClick={() => setEditingGroup(group)}>统一修改物流单号</Button>}
              <Button disabled={!group.canCombine || !pending.length} onClick={() => setShippingGroup(group)}>合并发货</Button>
            </div>
          </div>
          <Table minWidth={970}>
            <thead><tr><th>订单号</th><th>商品 / 规格 / 数量</th><th>订单状态</th><th>操作</th></tr></thead>
            <tbody>{group.orders.map((order) => {
              const id = orderIdOf(order);
              const currentStatus = orderDisplayStatus(order);
              return <tr key={id}>
                <td><Link to={`/orders/${encodeURIComponent(String(order.orderNo || id))}`}>{String(order.orderNo || id || '—')}</Link></td>
                <td>{listOf<Record<string, unknown>>(order.items).map((item, index) => <div className="order-list-item" key={index}>{orderItemTitle(item)}<small>{orderItemSpecs(item)} × {itemQuantity(item)}</small></div>)}</td>
                <td>{statusTag(currentStatus, Boolean(order.hasActiveAfterSale))}</td>
                <td className="order-list-actions"><Link className="text-button" to={`/orders/${encodeURIComponent(String(order.orderNo || id))}`}>详情</Link>{orderCanShip(order) && <button className="text-button" type="button" onClick={() => setShippingOrder(order)}>发货</button>}<button className="text-button" type="button" disabled={busy || Boolean(order.hasActiveAfterSale) || order.canDeleteAdmin === false} onClick={() => void deleteOrder(order)}>删除</button></td>
              </tr>;
            })}</tbody>
          </Table>
        </Panel>;
      })}
      <Pagination page={search.page} pageSize={PAGE_SIZE} total={total} showTotal={false} onChange={(page) => setSearch((old) => ({ ...old, page }))} />
    </div>}
    {shippingOrder && <OrderShippingDialog order={shippingOrder} onClose={() => setShippingOrder(null)} onSaved={() => { setShippingOrder(null); setRefreshKey((key) => key + 1); }} />}
    {editingGroup && <BatchShippingDialog editing group={editingGroup} onClose={() => setEditingGroup(null)} onSaved={() => { setEditingGroup(null); setRefreshKey((key) => key + 1); }} />}
    {shippingGroup && <BatchShippingDialog group={shippingGroup} onClose={() => setShippingGroup(null)} onSaved={() => { setShippingGroup(null); setRefreshKey((key) => key + 1); }} />}
  </div>;
}

function shippingQuantityOf(order: Order, item: Record<string, unknown>) {
  const refunded = order.refundedQuantities as Record<string, unknown> | undefined;
  return Math.max(0, itemQuantity(item) - Number(refunded?.[String(item.skuId)] ?? 0));
}

function orderCanShip(order: Order) {
  return orderStatusKey(order.status) === 'paid' && !order.hasActiveAfterSale
    && listOf<Record<string, unknown>>(order.items).some((item) => shippingQuantityOf(order, item) > 0);
}

function BatchShippingDialog({ group, editing = false, onClose, onSaved }: { group: OrderAddressGroup; editing?: boolean; onClose: () => void; onSaved: () => void }) {
  const candidates = group.orders.filter((order) => orderStatusKey(order.status) === (editing ? 'shipped' : 'paid'));
  const eligible = candidates.filter((order) => editing ? !order.hasActiveAfterSale : orderCanShip(order));
  const [selected, setSelected] = useState(() => eligible.map((order) => orderIdOf(order)));
  const [trackingNo, setTrackingNo] = useState('');
  const { busy, run } = useAction();
  const toggle = (id: string, checked: boolean) => {
    setSelected((old) => checked ? [...old, id] : old.filter((value) => value !== id));
  };
  const save = async () => {
    if (busy || !selected.length || !trackingNo.trim()) return;
    const result = await run(editing ? 'orders.logistics.saveBatch' : 'orders.shipBatch', { orderIds: selected, groupKey: group.key, trackingNo: trackingNo.trim() }, editing ? `${selected.length} 笔订单物流单号已修改` : `${selected.length} 笔订单已合并发货`);
    if (result !== undefined) onSaved();
  };
  return <Dialog className="shipping-dialog" placement="center" width="min(1000px, 94vw)" header={editing ? '统一修改物流单号' : '合并发货'} closeBtn={false} closeOnOverlayClick={false} visible onClose={() => { if (!busy) onClose(); }} onConfirm={() => void save()} confirmBtn={{ content: '确定', loading: busy, disabled: busy || !selected.length || !trackingNo.trim() }} cancelBtn={{ content: '取消', disabled: busy }}>
    <div className="shipping-dialog-info">
      <dl className="detail-list"><dt>收货人</dt><dd>{group.address.receiver}</dd><dt>联系电话</dt><dd>{group.address.phone}</dd><dt>收货地址</dt><dd>{group.address.address}</dd></dl>
      <Table minWidth={600}>
        <thead><tr><th>选择</th><th>订单号</th><th>商品 / 规格 / 数量</th></tr></thead>
        <tbody>{candidates.map((order) => {
          const id = orderIdOf(order);
          const items = listOf<Record<string, unknown>>(order.items);
          return <tr key={id}>
            <td><input type="checkbox" aria-label={`选择订单 ${order.orderNo || id}`} checked={selected.includes(id)} disabled={busy || Boolean(order.hasActiveAfterSale) || (!editing && !orderCanShip(order))} onChange={(event) => toggle(id, event.target.checked)} /></td>
            <td>{order.orderNo || id} {statusTag(orderDisplayStatus(order), Boolean(order.hasActiveAfterSale))}</td>
            <td>{items.map((item, index) => <div className="order-list-item" key={index}>{orderItemTitle(item)}<small>{orderItemSpecs(item)} × {shippingQuantityOf(order, item)}</small></div>)}</td>
          </tr>;
        })}</tbody>
      </Table>
    </div>
    <div className="shipping-dialog-tracking"><Field label="物流单号"><Input value={trackingNo} onChange={setTrackingNo} disabled={busy} placeholder={editing ? '请输入新的物流单号' : '请输入本次合并发货的物流单号'} /></Field></div>
  </Dialog>;
}

function OrderShippingDialog({ order, editing = false, onClose, onSaved }: { order: Order; editing?: boolean; onClose: () => void; onSaved: () => void }) {
  const logistics = order.logistics || {};
  const [trackingNo, setTrackingNo] = useState(editing ? String(logistics.trackingNo || '') : '');
  const { busy, run } = useAction();
  const save = async () => {
    if (busy || order.hasActiveAfterSale || !trackingNo.trim()) return;
    const result = await run(editing ? 'orders.logistics.save' : 'orders.ship', { orderId: orderIdOf(order), trackingNo: trackingNo.trim() }, editing ? '物流单号已修改' : '订单已发货');
    if (result !== undefined) onSaved();
  };
  return <Dialog className="shipping-dialog" placement="center" width="min(900px, 92vw)" header={false} closeBtn={false} closeOnOverlayClick={false} visible onClose={() => { if (!busy) onClose(); }} onConfirm={() => void save()} confirmBtn={{ content: '确定', loading: busy, disabled: busy || Boolean(order.hasActiveAfterSale) || !trackingNo.trim() }} cancelBtn={{ content: '取消', disabled: busy }}>
    <ShippingOrderInfo order={order} />
    <div className="shipping-dialog-tracking"><Field label="物流单号"><Input value={trackingNo} onChange={setTrackingNo} placeholder="请输入物流单号" /></Field></div>
  </Dialog>;
}

function ShippingOrderInfo({ order }: { order: Order }) {
  const { data, loading, error } = useResource<Order>('orders.get', { orderId: orderIdOf(order) });
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState title="订单不存在" />;
  const address = addressOf(data);
  const items = listOf<Record<string, unknown>>(data.items);
  return <div className="shipping-dialog-info">
    <dl className="detail-list"><dt>收货人</dt><dd>{address.receiver}</dd><dt>联系电话</dt><dd>{address.phone}</dd><dt>收货地址</dt><dd>{address.address}</dd></dl>
    <Table minWidth={400}>
      <thead><tr><th>商品</th><th>规格</th><th>发货数量</th></tr></thead>
      <tbody>{items.length === 0 && <EmptyTable colSpan={3} />}{items.map((item, index) => <tr key={String(item.skuId || index)}><td>{orderItemTitle(item)}</td><td>{orderItemSpecs(item)}</td><td>{shippingQuantityOf(data, item)}</td></tr>)}</tbody>
    </Table>
  </div>;
}

function addressOf(order: Order) {
  const source = order.addressSnapshot as Record<string, unknown> | undefined;
  if (!source) return { receiver: '—', phone: '—', address: '—' };
  const text = (key: string) => String(source[key] ?? '').trim();
  return {
    receiver: text('receiver') || '—',
    phone: text('phone') || '—',
    address: [text('province'), text('city'), text('district'), text('detail')].filter(Boolean).join(' ') || '—',
  };
}

function listOf<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : readList<T>(value); }
function itemQuantity(item: Record<string, unknown>) { return Math.max(0, Number(item.quantity) || 0); }
function orderItemTitle(item: Record<string, unknown>) {
  const productSnapshot = item.productSnapshot && typeof item.productSnapshot === 'object' ? item.productSnapshot as Record<string, unknown> : {};
  return String(productSnapshot.title || '—');
}
function orderItemSpecs(item: Record<string, unknown>) {
  const snapshot = item.skuSnapshot && typeof item.skuSnapshot === 'object' ? item.skuSnapshot as Record<string, unknown> : {};
  const specs = listOf<Record<string, unknown>>(snapshot.specInfo);
  return specs.map((spec) => {
    return String(spec.specValue || '').trim();
  }).filter(Boolean).join(' / ') || '—';
}

function orderItemAmount(item: Record<string, unknown>) {
  return item.amount;
}

export function OrderDetailPage() {
  const [shippingOpen, setShippingOpen] = useState(false);
  const { orderNo = '' } = useParams();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useResource<Order>('orders.get', { orderNo: decodeURIComponent(orderNo), orderId: decodeURIComponent(orderNo) }, refreshKey);

  const items = listOf<Record<string, unknown>>(data?.items);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />;
  if (!data) return <EmptyState title="订单不存在" />;
  const status = orderStatusKey(data.status);
  const address = addressOf(data);
  const logistics = data.logistics || {};
  const trackingNo = String(logistics.trackingNo || '').trim();

  return <>
    <div className="page-actions">{!data.hasActiveAfterSale && ['paid', 'shipped'].includes(status) && <Button theme="primary" onClick={() => setShippingOpen(true)}>{status === 'paid' ? '发货' : '修改物流单号'}</Button>}<Button variant="outline" onClick={() => navigate('/orders')}>返回列表</Button></div>
    {shippingOpen && <OrderShippingDialog order={data} editing={status === 'shipped'} onClose={() => setShippingOpen(false)} onSaved={() => { setShippingOpen(false); setRefreshKey((key) => key + 1); }} />}
    <div className="detail-grid">
      <Panel>
        <dl className="detail-list">
          <dt>订单号</dt><dd>{String(data.orderNo || orderNo)}</dd>
          <dt>订单状态</dt><dd>{statusTag(orderDisplayStatus(data), Boolean(data.hasActiveAfterSale))}</dd>
          <dt>订单金额</dt><dd>{formatMoney(amountOf(data))}</dd>
          <dt>创建时间</dt><dd>{formatDate(createdAtOf(data))}</dd>
        </dl>
      </Panel>
      <Panel>
        <dl className="detail-list"><dt>收货人</dt><dd>{address.receiver}</dd><dt>联系电话</dt><dd>{address.phone}</dd><dt>收货地址</dt><dd>{address.address}</dd><dt>物流单号</dt><dd>{trackingNo || '无'}</dd></dl>
      </Panel>
    </div>
    <Panel>
      <Table minWidth={600}><thead><tr><th>商品</th><th>规格</th><th>购买数量</th><th>金额</th></tr></thead>
        <tbody>{items.length === 0 && <EmptyTable colSpan={4} />}{items.map((item, index) => <tr key={String(item._id || item.skuId || index)}>
          <td>{orderItemTitle(item)}</td><td>{orderItemSpecs(item)}</td><td>{itemQuantity(item)}</td><td>{formatMoney(orderItemAmount(item))}</td>
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
          const photos = imageIds(row.images);
          const normalized = String(row.status || '').toLowerCase();
          const isActive = normalized === 'active';
          return <tr key={id}>
            <td>{String(row.userName || row.userId || '—')}</td><td>{String(row.rating ?? '—')}</td>
            <td className="long-text">{String(row.content || '—')}{row.reply && <div className="commerce-reply-preview">商家回复：{String(row.reply)}</div>}</td>
            <td>{String(row.productId || '—')}</td><td>{String(row.orderNo || '—')}</td>
            <td><div className="commerce-image-row">{photos.map((src, index) => <ResolvedImage key={`${id}-${index}`} fileID={src} alt={`评价图片 ${index + 1}`} className="commerce-thumb" />)}</div>{photos.length === 0 ? '—' : null}</td>
            <td>{isActive ? '已展示' : normalized === 'rejected' ? '已隐藏' : '待审核'}</td>
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
  return value === 10 ? '退货退款' : value === 20 ? '仅退款' : '—';
}
function afterSaleState(value: unknown) {
  return String(value ?? '');
}
function afterSaleStatusLabel(value: unknown) {
  return ({ pending_review: '待审核', approved: '审核通过 / 待寄回', refunding: '待确认退款', refunded: '退款完成', rejected: '已拒绝', withdrawn: '已撤销' } as Record<string, string>)[afterSaleState(value)] || String(value || '—');
}
function afterSaleItemSpecs(item: Record<string, unknown>) {
  const snapshot = item.skuSnapshot as Record<string, unknown> | undefined;
  const specs = item.specInfo ?? snapshot?.specInfo ?? item.specifications ?? item.specs;
  if (typeof specs === 'string') return specs || '—';
  if (!Array.isArray(specs)) return '—';
  return specs.map((spec) => {
    if (typeof spec === 'string') return spec;
    if (!spec || typeof spec !== 'object') return '';
    return String(spec.specValue ?? spec.specValues ?? spec.value ?? '');
  }).filter(Boolean).join(' / ') || '—';
}
function afterSaleIdOf(row: AfterSale) { return String(row._id); }

export function AfterSalesPage() {
  const { afterSaleId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') || '';
  const [status, setStatus] = useState(initialStatus);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: initialStatus, orderNo: '', page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<AfterSale | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejection, setRejection] = useState<AfterSale | null>(null);
  const [approval, setApproval] = useState<AfterSale | null>(null);
  const [decisionType, setDecisionType] = useState(20);
  const [decisionAmount, setDecisionAmount] = useState('');
  const approvalPolicy = approval ? afterSalePolicy(approval) : null;
  const maximumAmount = approvalPolicy?.maximumAmount ?? 0;
  const isCancellation = approvalPolicy?.fullRefundOnly === true;
  const approvedAmount = isCancellation ? maximumAmount : parseRefundAmount(decisionAmount, maximumAmount);
  const openApproval = (row: AfterSale) => {
    setApproval(row);
    const policy = afterSalePolicy(row);
    setDecisionType(policy.fixedType ?? (Number(row.requestedType ?? row.type) === 10 ? 10 : 20));
    setDecisionAmount((Number(policy.fullRefundOnly ? policy.maximumAmount : row.amount || 0) / 100).toFixed(2));
  };
  const confirm = useConfirm();
  const { data, loading, error } = useResource<unknown>(afterSaleId ? 'afterSales.get' : 'afterSales.list', afterSaleId ? { id: afterSaleId } : { page: search.page, pageSize: PAGE_SIZE, status: search.status || undefined, orderNo: search.orderNo || undefined }, refreshKey);
  useEffect(() => {
    if (afterSaleId && data) setSelected(data as AfterSale);
  }, [afterSaleId, data]);
  const orderAddress = selected?.order ? addressOf(selected.order) : { receiver: '—', phone: '—', address: '—' };
  const orderLogistics = selected?.order?.logistics || {};
  const orderTracking = selected?.order?.tracking || {};
  const orderTrackingNo = String(orderLogistics.trackingNo || orderLogistics.logisticsNo || orderTracking.trackingNo || '').trim();
  const rows = readList<AfterSale>(data).filter((row) => row.status !== 'withdrawn');
  const total = readTotal(data, rows.length);
  const { busy, run } = useAction();
  const review = async (row: AfterSale, next: 'approved' | 'rejected', reason = '') => {
    if (next === 'approved' && approvedAmount === null) return;
    const result = await run('afterSales.review', { id: afterSaleIdOf(row), status: next, ...(next === 'approved' ? { type: afterSalePolicy(row).fixedType ?? decisionType, amount: approvedAmount } : {}), ...(reason ? { reason } : {}) }, next === 'approved' ? '已通过申请，系统已处理模拟退款或等待寄回' : '售后申请已拒绝');
    if (result !== undefined) { setApproval(null); setRejection(null); setRejectReason(''); setSelected(null); setRefreshKey((key) => key + 1); }
  };
  const deleteAfterSale = async (row: AfterSale) => {
    if (busy || !row.canDeleteAdmin) return;
    if (!await confirm(`确定永久删除订单 ${row.orderNo || '—'} 的售后单？两端数据都会删除，操作不可恢复。`)) return;
    const result = await run('afterSales.delete', { id: afterSaleIdOf(row) }, '售后单已删除');
    if (result !== undefined) {
      if (rows.length === 1 && search.page > 1) setSearch((old) => ({ ...old, page: old.page - 1 }));
      setRefreshKey((key) => key + 1);
    }
  };
  const confirmReturn = async (row: AfterSale) => {
    if (!await confirm('确认已收到退货并完成模拟退款？')) return;
    const result = await run('afterSales.confirmReturn', { afterSaleId: afterSaleIdOf(row) }, '已确认退货并完成模拟退款');
    if (result !== undefined) { setSelected(null); setRefreshKey((key) => key + 1); }
  };
  const submitSearch = () => {
    setSearch({ status, orderNo: query.trim(), page: 1 });
    setRefreshKey((key) => key + 1);
  };
  return <div className="orders-page after-sales-page">
    {!afterSaleId && <div className="toolbar commerce-toolbar orders-toolbar"><Input value={query} onChange={setQuery} placeholder="订单号" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="pending_review">待审核</option><option value="approved">待寄回</option><option value="refunding">待确认退款</option><option value="refunded">退款完成</option><option value="rejected">已拒绝</option></select><Button onClick={submitSearch}>查询</Button><Link className="after-sales-address-link" to="/after-sales/address"><Button variant="outline">售后地址设置</Button></Link></div>}
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!afterSaleId && !loading && !error && <Panel className={rows.length === 0 ? 'orders-empty-panel' : undefined}><Table minWidth={700}><thead><tr><th>订单号</th><th>类型</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {rows.length === 0 && <EmptyTable colSpan={5} />}
      {rows.map((row) => {
        const id = afterSaleIdOf(row);
        const state = afterSaleState(row.status);
        const orderNo = String(row.orderNo || '');
        return <tr key={id}>
          <td>{orderNo ? <Link className="text-button" to={`/orders/${encodeURIComponent(orderNo)}`}>{orderNo}</Link> : '—'}</td>
          <td>{afterSaleRequestLabel(row)}</td><td>{formatMoney(row.amount)}</td>
          <td><Tag variant="light">{afterSaleStatusLabel(state)}</Tag></td>
          <td className="commerce-actions">
            <Button variant="text" disabled={busy} onClick={() => navigate(`/after-sales/${encodeURIComponent(id)}`)}>详情</Button>
            <Button variant="text" disabled={busy || !row.canDeleteAdmin} title={row.canDeleteAdmin ? undefined : '仅已完成、已拒绝或已撤销的售后可删除'} onClick={() => void deleteAfterSale(row)}>删除</Button>
          </td>
        </tr>;
      })}
    </tbody></Table></Panel>}
    {!afterSaleId && !loading && !error && <Pagination page={search.page} pageSize={PAGE_SIZE} total={total} showTotal={false} onChange={(page) => setSearch((old) => ({ ...old, page }))} />}
    {afterSaleId && <div className="page-actions after-sales-detail-toolbar">
      {selected && !loading && !error && afterSaleState(selected.status) === 'pending_review' && <>
        <Button theme="primary" disabled={busy} loading={busy} onClick={() => openApproval(selected)}>同意申请</Button>
        <Button variant="outline" disabled={busy} onClick={() => { setRejectReason(''); setRejection(selected); }}>拒绝申请</Button>
      </>}
      {selected && !loading && !error && afterSaleState(selected.status) === 'refunding' && <Button theme="primary" disabled={busy} loading={busy} onClick={() => void confirmReturn(selected)}>确认收到退货并完成模拟退款</Button>}
      <Button variant="outline" disabled={busy} onClick={() => navigate('/after-sales')}>返回列表</Button>
    </div>}
    {afterSaleId && selected && !loading && !error && <>
      <div className="detail-grid">
        <Panel>
          <dl className="detail-list">
            <dt>订单号</dt><dd>{String(selected.orderNo || '—')}</dd>
            <dt>售后状态</dt><dd>{afterSaleStatusLabel(selected.status)}</dd>
            <dt>申请时间</dt><dd>{formatDate(selected.createdAt)}</dd>
            <dt>用户诉求</dt><dd>{afterSaleRequestLabel(selected)}</dd>
            <dt>处理方式</dt><dd>{selected.decidedType ? afterSaleType(selected.decidedType) : '待商家决定'}</dd>
            <dt>实付金额</dt><dd>{formatMoney(selected.order?.paymentAmount ?? selected.reservedRefundAmount ?? selected.refundRequestAmount ?? selected.amount)}</dd>
            <dt>退款金额</dt><dd>{formatMoney(selected.amount ?? selected.refundAmount ?? selected.refundRequestAmount)}</dd>
            <dt>收货状态</dt><dd>{afterSaleReceiptLabel(selected)}</dd>
            <dt>申请原因</dt><dd>{String(selected.reason || '—')}</dd>
            <dt>拒绝原因</dt><dd>{String(selected.reviewReason || '—')}</dd>
          </dl>
        </Panel>
        <Panel>
          <dl className="detail-list">
            <dt>收货人</dt><dd>{orderAddress.receiver}</dd>
            <dt>联系电话</dt><dd>{orderAddress.phone}</dd>
            <dt>收货地址</dt><dd>{orderAddress.address}</dd>
            <dt>物流单号</dt><dd>{orderTrackingNo || '无'}</dd>
          </dl>
        </Panel>
      </div>
      {imageIds(selected.images).length > 0 && <Panel className="after-sales-proof-panel">
        <h3>售后凭证</h3>
        <div className="commerce-image-row">{imageIds(selected.images).map((src, index) => <ResolvedImage key={`${afterSaleIdOf(selected)}-${index}`} fileID={src} alt={`售后凭证 ${index + 1}`} className="commerce-proof-image" />)}</div>
      </Panel>}
      <Panel>
        <Table minWidth={500}><thead><tr><th>规格</th><th>数量</th><th>金额</th></tr></thead><tbody>{listOf<Record<string, unknown>>(selected.items).map((item, index) => <tr key={`${item.skuId || index}`}><td>{afterSaleItemSpecs(item)}</td><td>{String(item.rightsQuantity ?? item.quantity ?? 0)}</td><td>{formatMoney(item.amount ?? item.refundAmount)}</td></tr>)}</tbody></Table>
      </Panel>
    </>}
    {approval && <div className="home-config-dialog-backdrop" role="presentation"><section className="home-config-dialog approval-dialog" role="dialog" aria-modal="true" aria-label="售后处理"><h3>售后处理</h3><p>用户诉求：{afterSaleRequestLabel(approval)}</p>{isCancellation ? <div className="approval-cancellation-summary"><div><span>处理方式</span><strong>仅退款</strong></div><div><span>退款金额</span><strong>{formatMoney(maximumAmount)}</strong></div></div> : <><label className="field"><span>处理方式</span><select value={decisionType} onChange={(event) => setDecisionType(Number(event.target.value))}>{approvalPolicy?.allowedTypes.map((type) => <option key={type} value={type}>{afterSaleType(type)}</option>)}</select></label><label className="field"><span>退款金额（元）</span><input type="number" min="0.01" max={maximumAmount / 100} step="0.01" value={decisionAmount} onChange={(event) => setDecisionAmount(event.target.value)} /><small>最高 {formatMoney(maximumAmount)}，最多两位小数</small>{approvedAmount === null && <small>请输入大于 0 且不超过上限的金额</small>}</label></>}<div className="home-config-dialog-actions approval-dialog-actions"><Button theme="primary" disabled={busy || approvedAmount === null} loading={busy} onClick={() => void review(approval, 'approved')}>确认</Button><Button variant="outline" disabled={busy} onClick={() => setApproval(null)}>取消</Button></div></section></div>}
    {rejection && <div className="home-config-dialog-backdrop" role="presentation"><section className="home-config-dialog" role="dialog" aria-modal="true" aria-label="拒绝售后申请"><label className="field"><span className="rejection-field-heading"><span>拒绝原因</span><small className="rejection-character-count">{rejectReason.length} / 200</small></span><textarea rows={4} style={{ resize: 'none' }} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={200} /></label><div className="home-config-dialog-actions rejection-dialog-actions"><Button theme="primary" disabled={busy || !rejectReason.trim()} loading={busy} onClick={() => void review(rejection, 'rejected', rejectReason.trim())}>确认</Button><Button variant="outline" disabled={busy} onClick={() => setRejection(null)}>取消</Button></div></section></div>}
  </div>;
}

type ReturnAddress = { receiver: string; phone: string; detail: string };
const emptyReturnAddress: ReturnAddress = { receiver: '', phone: '', detail: '' };

function returnAddressFrom(value: unknown): ReturnAddress {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { receiver: String(source.receiver || ''), phone: String(source.phone || ''), detail: String(source.detail || '') };
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
      const base = outer.value as Record<string, unknown>;
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
    if (!value.receiver.trim() || !value.phone.trim() || !value.detail.trim()) { message('请填写收件人、联系电话和地址', 'warning'); return; }
    if (!/^\+?[0-9][0-9\s-]{5,23}$/.test(value.phone.trim())) { message('请填写有效的联系电话', 'warning'); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      let existing: Record<string, unknown> = {};
      try {
        const current = await adminApi.call<Record<string, unknown>>('settings.get', { key: 'global' });
        const outer = current && typeof current === 'object' ? current : {};
        existing = outer.value as Record<string, unknown>;
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
    <div className="panel-heading"><div className="orders-address-actions after-sales-address-link"><Button theme="primary" disabled={loading || Boolean(error) || busy || !dirty} loading={busy} onClick={() => void save()}>保存</Button><Link to="/after-sales"><Button variant="outline">返回</Button></Link></div></div>
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
    {!loading && !error && <Panel className="form-panel commerce-settings-panel">
      <div className="form-grid"><Field label="收件人"><Input value={value.receiver} onChange={(next) => update('receiver', next)} maxlength={40} /></Field><Field label="联系电话"><Input value={value.phone} onChange={(next) => update('phone', next)} maxlength={30} /></Field><Field label="地址"><Input value={value.detail} onChange={(next) => update('detail', next)} placeholder="请输入完整地址（含省市区及详细地址）" maxlength={240} /></Field></div>
    </Panel>}
  </>;
}

export function OverviewWorkQueue({ orders, afterSales }: { orders?: number; afterSales?: number }) {
  return <Panel className="commerce-work-queue"><div className="panel-heading"><h3>待处理订单</h3><Link className="text-button" to="/orders">查看全部</Link></div><div className="commerce-work-queue-counts"><Link to="/orders?status=paid"><strong>{orders ?? '—'}</strong><span>待发货</span></Link><Link to="/after-sales?status=pending_review"><strong>{afterSales ?? '—'}</strong><span>待审核售后</span></Link></div></Panel>;
}
