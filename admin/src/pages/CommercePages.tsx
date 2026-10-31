import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Dialog, Input, Select, Tag } from '../components/NativeUi';
import { adminApi } from '../lib/api';
import { parseRefundAmount } from '../lib/refund-amount';
import { afterSalePolicy, afterSaleRequestLabel, afterSaleReceiptLabel } from '../lib/after-sale-policy';
import { useConfirm } from '../components/ConfirmProvider';
import type { AfterSale, Comment, ListResult, Order, OrderAddressGroup } from '../types';
import { EmptyState, EmptyTable, ErrorState, Field, LoadingState, Panel, Table, formatDate, formatMoney, readList, readTotal } from '../components/Ui';

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
  // Update visible records without rerunning the list's status filter.
  const updateVisible = (id: string, patch: Record<string, unknown>) => {
    const update = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(update);
      if (!value || typeof value !== 'object') return value;
      const record = value as Record<string, unknown>;
      if (String(record._id || record.id || '') === id) return { ...record, ...patch };
      return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, update(child)]));
    };
    setData((current) => update(current) as T | null);
  };
  return { data, loading, error, updateVisible };
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
      message((result as { shippingSyncPending?: boolean })?.shippingSyncPending
        ? `${success}，微信发货信息待同步，将自动重试` : success);
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
  return ({ pending_payment: '待付款', closed: '已关闭', paid: '待发货', shipped: '待收货', completed: '已完成', refunded: '已退款', cancelled: '已取消' } as Record<string, string>)[orderStatusKey(value)] || '—';
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
const orderFilters = [['', '全部'], ['paid', '待发货'], ['shipped', '待收货'], ['completed', '已完成'], ['refunded', '已退款'], ['cancelled', '已取消']];

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
  const { data, loading, error, updateVisible } = useResource<unknown>('orders.list', { groupBy: 'address', page: search.page, pageSize: PAGE_SIZE, orderNo: search.orderNo || undefined, status: search.status || undefined }, refreshKey);
  const groups = readList<OrderAddressGroup>(data);
  const total = readTotal(data, groups.length);
  const confirm = useConfirm();
  const { busy, run } = useAction();
  const updateOrders = async (orders: Order[]) => {
    for (const order of orders) {
      try {
        const updated = await adminApi.call<Order>('orders.get', { orderId: orderIdOf(order) });
        updateVisible(orderIdOf(order), updated as unknown as Record<string, unknown>);
      } catch { message('列表状态更新失败，请点击查询重试', 'warning'); }
    }
  };
  const deleteOrder = async (order: Order) => {
    if (busy || order.hasActiveAfterSale || order.canDeleteAdmin === false) return;
    if (!await confirm(`确定永久删除订单 ${order.orderNo || orderIdOf(order)} 及其所有关联售后单？`, { closeBtn: false })) return;
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
      {groups.length === 0 && <Panel className="orders-empty-panel orders-address-group"><Table minWidth={970}><thead><tr><th>订单号</th><th>商品 / 规格 / 数量</th><th>订单状态</th><th>操作</th></tr></thead><tbody><EmptyTable colSpan={4} description="暂无" /></tbody></Table></Panel>}
      {groups.map((group) => {
        const pending = group.orders.filter(orderCanShip);
        return <Panel key={group.key} className="orders-address-group">
          <div className="orders-address-heading">
            <div>
              <div className="orders-address-summary">
                <strong>{group.address.receiver || '收货人未填写'} <span>{group.address.phone}</span></strong>
                <span className="orders-address-text">{group.address.address || '收货地址未填写'}</span>
              </div>
              {!group.canCombine && group.orders.some((order) => order.status === 'paid') && <small>地址信息不完整，不支持合并发货</small>}
            </div>
            <div className="orders-address-actions">
              {group.addressKey && group.orders.some((order) => orderStatusKey(order.status) === 'shipped' && !order.hasActiveAfterSale) && <Button variant="outline" onClick={() => setEditingGroup(group)}>修改物流单号</Button>}
              {group.canCombine && pending.length > 1 && <Button onClick={() => setShippingGroup(group)}>合并发货</Button>}
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
    {shippingOrder && <OrderShippingDialog order={shippingOrder} onClose={() => setShippingOrder(null)} onSaved={() => { void updateOrders([shippingOrder]); setShippingOrder(null); }} />}
    {editingGroup && <BatchShippingDialog editing group={editingGroup} onClose={() => setEditingGroup(null)} onSaved={() => { void updateOrders(editingGroup.orders); setEditingGroup(null); }} />}
    {shippingGroup && <BatchShippingDialog group={shippingGroup} onClose={() => setShippingGroup(null)} onSaved={() => { void updateOrders(shippingGroup.orders); setShippingGroup(null); }} />}
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

function CarrierPicker({ required, value, onChange }: { required: boolean; value: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    void adminApi.call<{ items: { value: string; label: string }[] }>('shipping.companies')
      .then((result) => setOptions(result.items)).catch(() => setError('快递公司加载失败，请重试'));
  };
  useEffect(() => { if (required) load(); }, [required]);
  if (!required) return null;
  return <Field label="快递公司"><Select value={value} options={options} filterable placeholder="请选择快递公司"
    onChange={(next) => onChange(String(next || ''))} />
    {error && <span>{error} <Button variant="text" onClick={load}>重新加载</Button></span>}</Field>;
}

function BatchShippingDialog({ group, editing = false, onClose, onSaved }: { group: OrderAddressGroup; editing?: boolean; onClose: () => void; onSaved: () => void }) {
  const candidates = group.orders.filter((order) => orderStatusKey(order.status) === (editing ? 'shipped' : 'paid'));
  const eligible = candidates.filter((order) => editing ? !order.hasActiveAfterSale : orderCanShip(order));
  const [selected, setSelected] = useState(() => eligible.map((order) => orderIdOf(order)));
  const [trackingNo, setTrackingNo] = useState('');
  const [expressCompany, setExpressCompany] = useState('');
  const needsCarrier = candidates.some((order) => selected.includes(orderIdOf(order)) && order.payment?.mode === 'wechat');
  const { busy, run } = useAction();
  const toggle = (id: string, checked: boolean) => {
    setSelected((old) => checked ? [...old, id] : old.filter((value) => value !== id));
  };
  const save = async () => {
    if (busy || !selected.length || !trackingNo.trim() || (needsCarrier && !expressCompany)) return;
    const result = await run(editing ? 'orders.logistics.saveBatch' : 'orders.shipBatch', { orderIds: selected, groupKey: group.addressKey || group.key, trackingNo: trackingNo.trim(), expressCompany }, editing ? `${selected.length} 笔订单物流单号已修改` : `${selected.length} 笔订单已合并发货`);
    if (result !== undefined) onSaved();
  };
  return <Dialog className="shipping-dialog" placement="center" width="min(1000px, 94vw)" header={editing ? '修改物流单号' : '合并发货'} closeBtn={false} closeOnOverlayClick={false} visible onClose={() => { if (!busy) onClose(); }} onConfirm={() => void save()} confirmBtn={{ content: '确定', loading: busy, disabled: busy || !selected.length || !trackingNo.trim() || (needsCarrier && !expressCompany) }} cancelBtn={{ content: '取消', disabled: busy }}>
    <div className="shipping-dialog-info">
      <dl className="detail-list"><dt>收货人</dt><dd>{group.address.receiver}</dd><dt>联系电话</dt><dd>{group.address.phone}</dd><dt>收货地址</dt><dd>{group.address.address}</dd></dl>
      <Table minWidth={600}>
        <thead><tr><th>选择</th><th>订单号</th><th>商品 / 规格 / 数量</th><th>备注</th></tr></thead>
        <tbody>{candidates.map((order) => {
          const id = orderIdOf(order);
          const items = listOf<Record<string, unknown>>(order.items);
          return <tr key={id}>
            <td><input type="checkbox" aria-label={`选择订单 ${order.orderNo || id}`} checked={selected.includes(id)} disabled={busy || Boolean(order.hasActiveAfterSale) || (!editing && !orderCanShip(order))} onChange={(event) => toggle(id, event.target.checked)} /></td>
            <td>{order.orderNo || id} {statusTag(orderDisplayStatus(order), Boolean(order.hasActiveAfterSale))}</td>
            <td>{items.map((item, index) => <div className="order-list-item" key={index}>{orderItemTitle(item)}<small>{orderItemSpecs(item)} × {shippingQuantityOf(order, item)}</small></div>)}</td>
            <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{order.remark || '无'}</td>
          </tr>;
        })}</tbody>
      </Table>
    </div>
    <div className="shipping-dialog-tracking"><CarrierPicker required={needsCarrier} value={expressCompany} onChange={setExpressCompany} /><Field label="物流单号"><Input value={trackingNo} onChange={setTrackingNo} disabled={busy} placeholder={editing ? '请输入新的物流单号' : '请输入本次合并发货的物流单号'} /></Field></div>
  </Dialog>;
}

function OrderShippingDialog({ order, editing = false, onClose, onSaved }: { order: Order; editing?: boolean; onClose: () => void; onSaved: () => void }) {
  const logistics = order.logistics || {};
  const [trackingNo, setTrackingNo] = useState(editing ? String(logistics.trackingNo || '') : '');
  const [expressCompany, setExpressCompany] = useState(String(logistics.expressCompany || ''));
  const needsCarrier = order.payment?.mode === 'wechat';
  const { busy, run } = useAction();
  const save = async () => {
    if (busy || order.hasActiveAfterSale || !trackingNo.trim() || (needsCarrier && !expressCompany)) return;
    const result = await run(editing ? 'orders.logistics.save' : 'orders.ship', { orderId: orderIdOf(order), trackingNo: trackingNo.trim(), expressCompany }, editing ? '物流单号已修改' : '订单已发货');
    if (result !== undefined) onSaved();
  };
  return <Dialog className="shipping-dialog" placement="center" width="min(900px, 92vw)" header={false} closeBtn={false} closeOnOverlayClick={false} visible onClose={() => { if (!busy) onClose(); }} onConfirm={() => void save()} confirmBtn={{ content: '确定', loading: busy, disabled: busy || Boolean(order.hasActiveAfterSale) || !trackingNo.trim() || (needsCarrier && !expressCompany) }} cancelBtn={{ content: '取消', disabled: busy }}>
    <ShippingOrderInfo order={order} />
    <div className="shipping-dialog-tracking"><CarrierPicker required={needsCarrier} value={expressCompany} onChange={setExpressCompany} /><Field label="物流单号"><Input value={trackingNo} onChange={setTrackingNo} placeholder="请输入物流单号" /></Field></div>
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
    <dl className="detail-list"><dt>收货人</dt><dd>{address.receiver}</dd><dt>联系电话</dt><dd>{address.phone}</dd><dt>收货地址</dt><dd>{address.address}</dd><dt>备注</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.remark || '无'}</dd></dl>
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
          <dt>订单备注</dt><dd className="order-remark">{data.remark || '无'}</dd>
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
    setSrc('');
    if (/^(wxfile:|https?:\/\/(?:tmp|usr)\/)/i.test(fileID)) return;
    void adminApi.getTempFileUrl(fileID).then((url) => { if (active) setSrc(url); }).catch(() => { if (active) setSrc(''); });
    return () => { active = false; };
  }, [fileID]);
  return src ? <img className={className} src={src} alt={alt} onError={() => setSrc('')} /> : <span className="commerce-image-pending">图片暂不可用</span>;
}

export function CommentsPage() {
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status') || '';
  const initialStatus = ['pending_review', 'active', 'rejected'].includes(requestedStatus) ? requestedStatus : '';
  const [status, setStatus] = useState(initialStatus);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ status: initialStatus, orderNo: '', page: 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [replyOpen, setReplyOpen] = useState<Comment | null>(null);
  const [expandedCommentId, setExpandedCommentId] = useState<string | null>(null);
  const contentExpanded = expandedCommentId !== null;
  const [replyText, setReplyText] = useState('');
  const { data, loading, error, updateVisible } = useResource<unknown>('comments.list', { page: search.page, pageSize: PAGE_SIZE, status: search.status || undefined, orderNo: search.orderNo || undefined }, refreshKey);
  const rows = readList<Comment>(data);
  const total = readTotal(data, rows.length);
  const confirm = useConfirm();
  const { busy, run } = useAction();
  const deleteComment = async (row: Comment) => {
    if (busy) return;
    if (!await confirm(`确定永久删除订单 ${row.orderNo || '—'} 的这条评价及商家回复？`, { closeBtn: false })) return;
    const result = await run('comments.delete', { id: row._id || row.id }, '评价已删除');
    if (result !== undefined) {
      if (rows.length === 1 && search.page > 1) setSearch((old) => ({ ...old, page: old.page - 1 }));
      setRefreshKey((key) => key + 1);
    }
  };
  const moderate = async (row: Comment, nextStatus: string) => {
    const result = await run('comments.moderate', { id: row._id || row.id, status: nextStatus }, nextStatus === 'active' ? '评论已公开' : '评论已隐藏');
    if (result !== undefined) updateVisible(String(row._id || row.id), { status: nextStatus });
  };
  const saveReply = async () => {
    if (!replyOpen) return;
    if (replyText.trim().length > 100) { message('回复最多 100 字', 'warning'); return; }
    const result = await run('comments.reply', { id: replyOpen._id || replyOpen.id, reply: replyText.trim() }, '商家回复已保存');
    if (result !== undefined) {
      updateVisible(String(replyOpen._id || replyOpen.id), { reply: replyText.trim() });
      setReplyOpen(null); setReplyText('');
    }
  };
  const submitSearch = () => {
    setSearch({ orderNo: query.trim(), status, page: 1 });
    setRefreshKey((key) => key + 1);
  };
  return <div className="orders-page comments-page">
    <div className="toolbar commerce-toolbar orders-toolbar"><Input value={query} onChange={setQuery} onEnter={submitSearch} placeholder="订单号" /><select value={status} aria-label="评价状态" onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="pending_review">待审核</option><option value="active">已展示</option><option value="rejected">已隐藏</option></select><Button onClick={submitSearch}>查询</Button></div>
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!loading && !error && <Panel className={rows.length === 0 ? 'orders-empty-panel' : undefined}>
      <Table minWidth={1200}>
        <colgroup><col /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead><tr><th>订单号</th><th>商品 / 规格</th><th>评价</th><th colSpan={contentExpanded ? 4 : 1}>内容</th>{!contentExpanded && <><th>图片</th><th>状态</th><th>操作</th></>}</tr></thead><tbody>
        {rows.length === 0 && <EmptyTable colSpan={7} description="暂无" />}
        {rows.map((row) => {
          const id = String(row._id || row.id || '');
          const photos = imageIds(row.images);
          const normalized = String(row.status || '').toLowerCase();
          const isActive = normalized === 'active';
          return <tr key={id}>
            <td>{row.orderNo || '—'}</td>
            <td><div className="order-list-item">{row.productTitle || '商品已不可用'}{row.productSpecs && <small>{row.productSpecs}</small>}</div></td>
            <td>{row.rating == null ? '—' : row.rating >= 4 ? '好评' : row.rating <= 2 ? '差评' : '中评'}</td>
            <td className="comments-content" colSpan={contentExpanded ? 4 : 1}><button type="button" className={`comments-content-preview${expandedCommentId === id ? ' is-expanded' : ''}`} aria-expanded={expandedCommentId === id} aria-label={expandedCommentId === id ? '收起评价内容' : '展开完整评价'} title={expandedCommentId === id ? '点击收起并恢复右侧项' : '点击展开完整评价'} onClick={() => setExpandedCommentId((old) => old === id ? null : id)}>{row.content || '（仅图片评价）'}</button></td>
            {!contentExpanded && <>
            <td><div className="commerce-image-row">{photos.map((src, index) => <ResolvedImage key={`${id}-${index}`} fileID={src} alt={`评价图片 ${index + 1}`} className="commerce-thumb" />)}</div>{photos.length === 0 ? '—' : null}</td>
            <td><Tag variant="light">{isActive ? '已展示' : ['rejected', 'inactive'].includes(normalized) ? '已隐藏' : '待审核'}</Tag></td>
            <td className="commerce-actions"><Button variant="text" disabled={busy || isActive} onClick={() => void moderate(row, 'active')}>展示</Button><Button variant="text" disabled={busy || ['rejected', 'inactive'].includes(normalized)} onClick={() => void moderate(row, 'rejected')}>隐藏</Button><Button variant="text" disabled={busy} onClick={() => { setReplyOpen(row); setReplyText(row.reply || ''); }}>回复</Button><Button variant="text" disabled={busy} onClick={() => void deleteComment(row)}>删除</Button></td>
            </>}
          </tr>;
        })}
      </tbody></Table>
    </Panel>}
    {!loading && !error && <Pagination page={search.page} pageSize={PAGE_SIZE} total={total} showTotal={false} onChange={(page) => setSearch((old) => ({ ...old, page }))} />}
    {replyOpen && <Dialog className="shipping-dialog" placement="center" width="min(600px, 92vw)" header={false} visible closeBtn={false} closeOnOverlayClick={false} onClose={() => { if (!busy) setReplyOpen(null); }} onConfirm={() => void saveReply()} confirmBtn={{ content: '确定', loading: busy, disabled: busy || replyText.trim().length > 100 || replyText.trim() === (replyOpen.reply || '') }} cancelBtn={{ content: '取消', disabled: busy }}>
      <div className="comments-reply-original">{replyOpen.content || '（仅图片评价）'}</div>
      <Field label="回复"><div className="comments-reply-editor"><textarea className="comments-reply-input" rows={5} value={replyText} disabled={busy} onChange={(event) => setReplyText(event.target.value)} maxLength={100} aria-describedby="comments-reply-count" /><span id="comments-reply-count" className="comments-reply-count">{replyText.length}/100</span></div></Field>
    </Dialog>}
  </div>;
}

function afterSaleType(value: unknown) {
  return value === 10 ? '退货退款' : value === 20 ? '仅退款' : '—';
}
function afterSaleState(value: unknown) {
  return String(value ?? '');
}
function afterSaleStatusLabel(value: unknown) {
  return ({ pending_review: '待审核', approved: '待寄回', refunding: '待退款', refunded: '已完成', rejected: '已拒绝', withdrawn: '已撤销' } as Record<string, string>)[afterSaleState(value)] || String(value || '—');
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
  const [returnApproval, setReturnApproval] = useState<AfterSale | null>(null);
  const [returnAmount, setReturnAmount] = useState('');
  const returnMaximumAmount = returnApproval ? afterSalePolicy(returnApproval).maximumAmount : 0;
  const returnRefundAmount = parseRefundAmount(returnAmount, returnMaximumAmount);
  const approvalPolicy = approval ? afterSalePolicy(approval) : null;
  const maximumAmount = approvalPolicy?.maximumAmount ?? 0;
  const isCancellation = approvalPolicy?.fullRefundOnly === true;
  const isReturnApproval = (approvalPolicy?.fixedType ?? decisionType) === 10;
  const approvedAmount = isCancellation ? maximumAmount : parseRefundAmount(decisionAmount, maximumAmount);
  const openApproval = (row: AfterSale) => {
    setApproval(row);
    const policy = afterSalePolicy(row);
    setDecisionType(policy.fixedType ?? (Number(row.requestedType ?? row.type) === 10 ? 10 : 20));
    setDecisionAmount((Number(policy.fullRefundOnly ? policy.maximumAmount : row.amount || 0) / 100).toFixed(2));
  };
  const confirm = useConfirm();
  const { data, loading, error, updateVisible } = useResource<unknown>(afterSaleId ? 'afterSales.get' : 'afterSales.list', afterSaleId ? { id: afterSaleId } : { page: search.page, pageSize: PAGE_SIZE, status: search.status || undefined, orderNo: search.orderNo || undefined }, refreshKey);
  useEffect(() => {
    if (afterSaleId && data) setSelected(data as AfterSale);
  }, [afterSaleId, data]);
  const orderAddress = selected?.order ? addressOf(selected.order) : { receiver: '—', phone: '—', address: '—' };
  const orderLogistics = selected?.order?.logistics || {};
  const orderTracking = selected?.order?.tracking || {};
  const orderTrackingNo = String(orderLogistics.trackingNo || orderLogistics.logisticsNo || orderTracking.trackingNo || '').trim();
  const returnRequired = Number(selected?.decidedType ?? selected?.requestedType ?? selected?.type) === 10;
  const returnTrackingNo = String(selected?.trackingNo || selected?.logisticsNo || '').trim();
  const rows = readList<AfterSale>(data).filter((row) => row.status !== 'withdrawn');
  const total = readTotal(data, rows.length);
  const { busy, run } = useAction();
  const updateAfterSale = async (row: AfterSale) => {
    try {
      const updated = await adminApi.call<AfterSale>('afterSales.get', { id: afterSaleIdOf(row) });
      updateVisible(afterSaleIdOf(row), updated as unknown as Record<string, unknown>);
    } catch { message('列表状态更新失败，请点击查询重试', 'warning'); }
  };
  const review = async (row: AfterSale, next: 'approved' | 'rejected', reason = '') => {
    if (next === 'approved' && !isReturnApproval && approvedAmount === null) return;
    const type = afterSalePolicy(row).fixedType ?? decisionType;
    const result = await run('afterSales.review', { id: afterSaleIdOf(row), status: next, ...(next === 'approved' ? { type, ...(type === 20 ? { amount: approvedAmount } : {}) } : {}), ...(reason ? { reason } : {}) }, next === 'approved' ? type === 10 ? '已同意退货申请，等待用户寄回，尚未退款' : '已同意退款申请' : '售后申请已拒绝');
    if (result !== undefined) { await updateAfterSale(row); setApproval(null); setRejection(null); setRejectReason(''); setSelected(null); }
  };
  const deleteAfterSale = async (row: AfterSale) => {
    if (busy || !row.canDeleteAdmin) return;
    if (!await confirm(`确定永久删除订单 ${row.orderNo || '—'} 的售后单？`, { closeBtn: false })) return;
    const result = await run('afterSales.delete', { id: afterSaleIdOf(row) }, '售后单已删除');
    if (result !== undefined) {
      if (rows.length === 1 && search.page > 1) setSearch((old) => ({ ...old, page: old.page - 1 }));
      setRefreshKey((key) => key + 1);
    }
  };
  const openReturnApproval = (row: AfterSale) => {
    if (busy || Number(row.type) !== 10 || afterSaleState(row.status) !== 'refunding' || !String(row.trackingNo || row.logisticsNo || '').trim()) return;
    setReturnApproval(row);
    setReturnAmount((Number(row.amount ?? afterSalePolicy(row).maximumAmount) / 100).toFixed(2));
  };
  const confirmReturn = async () => {
    if (busy || !returnApproval || returnRefundAmount === null) return;
    const result = await run('afterSales.confirmReturn', { afterSaleId: afterSaleIdOf(returnApproval), amount: returnRefundAmount }, '已确认收货并同意退款');
    if (result !== undefined) { await updateAfterSale(returnApproval); setReturnApproval(null); setSelected(null); }
  };
  const submitSearch = () => {
    setSearch({ status, orderNo: query.trim(), page: 1 });
    setRefreshKey((key) => key + 1);
  };
  return <div className="orders-page after-sales-page">
    {!afterSaleId && <div className="toolbar commerce-toolbar orders-toolbar"><Input value={query} onChange={setQuery} placeholder="订单号" /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="pending_review">待审核</option><option value="approved">待寄回</option><option value="refunding">待退款</option><option value="refunded">已完成</option><option value="rejected">已拒绝</option></select><Button onClick={submitSearch}>查询</Button></div>}
    {loading && <LoadingState />}{error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!afterSaleId && !loading && !error && <Panel className={rows.length === 0 ? 'orders-empty-panel' : undefined}><Table minWidth={700}><thead><tr><th>订单号</th><th>类型</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {rows.length === 0 && <EmptyTable colSpan={5} description="暂无" />}
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
      {selected && !loading && !error && Number(selected.type) === 10 && afterSaleState(selected.status) === 'refunding' && <Button theme="primary" disabled={busy || !returnTrackingNo} loading={busy} onClick={() => openReturnApproval(selected)}>同意退款</Button>}
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
            {returnRequired && <><dt>用户寄出状态</dt><dd>{returnTrackingNo ? '已寄出' : '未寄出'}</dd><dt>退货物流单号</dt><dd>{returnTrackingNo || '无'}</dd></>}
          </dl>
        </Panel>
      </div>
      {imageIds(selected.images).length > 0 && <Panel className="after-sales-proof-panel">
        <div className="commerce-image-row">{imageIds(selected.images).map((src, index) => <ResolvedImage key={`${afterSaleIdOf(selected)}-${index}`} fileID={src} alt={`售后凭证 ${index + 1}`} className="commerce-proof-image" />)}</div>
      </Panel>}
      <Panel>
        <Table minWidth={500}><thead><tr><th>规格</th><th>数量</th><th>金额</th></tr></thead><tbody>{listOf<Record<string, unknown>>(selected.items).map((item, index) => <tr key={`${item.skuId || index}`}><td>{afterSaleItemSpecs(item)}</td><td>{String(item.rightsQuantity ?? item.quantity ?? 0)}</td><td>{formatMoney(item.amount ?? item.refundAmount)}</td></tr>)}</tbody></Table>
      </Panel>
    </>}
    {approval && <div className="home-config-dialog-backdrop" role="presentation"><section className="home-config-dialog approval-dialog" role="dialog" aria-modal="true" aria-label="售后处理">
      <p>用户诉求：{afterSaleRequestLabel(approval)}</p>
      {isCancellation ? <div className="approval-cancellation-summary"><div><span>处理方式</span><strong>仅退款</strong></div><div><span>退款金额</span><strong>{formatMoney(maximumAmount)}</strong></div></div> : <>
        <label className="field"><span>处理方式</span><select value={decisionType} onChange={(event) => setDecisionType(Number(event.target.value))}>{approvalPolicy?.allowedTypes.map((type) => <option key={type} value={type}>{afterSaleType(type)}</option>)}</select></label>
        {!isReturnApproval && <label className="field"><span>退款金额（元）</span><input type="number" min="0.01" max={maximumAmount / 100} step="0.01" value={decisionAmount} onChange={(event) => setDecisionAmount(event.target.value)} />{approvedAmount === null && <small>请输入大于 0 且不超过上限的金额</small>}</label>}
      </>}
      <div className="home-config-dialog-actions approval-dialog-actions"><Button theme="primary" disabled={busy || (!isReturnApproval && approvedAmount === null)} loading={busy} onClick={() => void review(approval, 'approved')}>确认</Button><Button variant="outline" disabled={busy} onClick={() => setApproval(null)}>取消</Button></div>
    </section></div>}
    {returnApproval && <div className="home-config-dialog-backdrop" role="presentation"><section className="home-config-dialog approval-dialog" role="dialog" aria-modal="true" aria-label="确认收货并同意退款">
      <label className="field"><span>退款金额（元）</span><input type="number" min="0.01" max={returnMaximumAmount / 100} step="0.01" value={returnAmount} onChange={(event) => setReturnAmount(event.target.value)} />{returnRefundAmount === null && <small>请输入大于 0 且不超过上限的金额</small>}</label>
      <div className="home-config-dialog-actions approval-dialog-actions"><Button theme="primary" disabled={busy || returnRefundAmount === null} loading={busy} onClick={() => void confirmReturn()}>确认</Button><Button variant="outline" disabled={busy} onClick={() => setReturnApproval(null)}>取消</Button></div>
    </section></div>}
    {rejection && <div className="home-config-dialog-backdrop" role="presentation"><section className="home-config-dialog" role="dialog" aria-modal="true" aria-label="拒绝售后申请"><label className="field"><span className="rejection-field-heading"><span>拒绝原因</span><small className="rejection-character-count">{rejectReason.length} / 200</small></span><textarea rows={4} style={{ resize: 'none' }} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={200} /></label><div className="home-config-dialog-actions rejection-dialog-actions"><Button theme="primary" disabled={busy || !rejectReason.trim()} loading={busy} onClick={() => void review(rejection, 'rejected', rejectReason.trim())}>确认</Button><Button variant="outline" disabled={busy} onClick={() => setRejection(null)}>取消</Button></div></section></div>}
  </div>;
}

export function OverviewWorkQueue({ orders, afterSales }: { orders?: number; afterSales?: number }) {
  return <Panel className="commerce-work-queue"><div className="panel-heading"><h3>待处理订单</h3><Link className="text-button" to="/orders">查看全部</Link></div><div className="commerce-work-queue-counts"><Link to="/orders?status=paid"><strong>{orders ?? '—'}</strong><span>待发货</span></Link><Link to="/after-sales?status=pending_review"><strong>{afterSales ?? '—'}</strong><span>待审核售后</span></Link></div></Panel>;
}
