// @ts-nocheck
const crypto = require('crypto');
const { getDoc, withTransaction } = require('./db');
const { errorFrom } = require('./errors');
const { directApi } = require('./wechat-shipping');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function packages(intent, orders) {
  const groups = new Map();
  for (const order of orders) {
    if (order.payment?.mode !== 'wechat' || order.userId !== intent.userId
      || !intent.transactionId || !intent.openid) throw errorFrom('LOGISTICS_UNAVAILABLE');
    const waybill = String(order.logistics?.trackingNo || '').trim();
    const delivery = String(order.logistics?.expressCompany || '').trim();
    const phone = require('./order-shipping').shippingAddressOf(order).phone;
    if (!waybill || !delivery || !phone) throw errorFrom('LOGISTICS_UNAVAILABLE');
    const key = hash([delivery, waybill]);
    const group = groups.get(key) || { key, orderIds: [], body: {
      openid: intent.openid, receiver_phone: phone, waybill_id: waybill, delivery_id: delivery,
      trans_id: intent.transactionId,
      order_detail_path: `pages/order/order-detail/index?orderNo=${encodeURIComponent(order.orderNo || order._id)}`,
      goods_info: { detail_list: [] },
    } };
    group.orderIds.push(order._id);
    for (const item of order.items || []) {
      group.body.goods_info.detail_list.push({ goods_name: item.productSnapshot?.title || item.goodsName || '商品',
        goods_img_url: item.skuSnapshot?.skuImage || item.productSnapshot?.primaryImage || '' });
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, fingerprint: hash(group.body) }));
}

async function payload(runtime, body) {
  const detail = body.goods_info.detail_list;
  if (!detail.length) throw errorFrom('LOGISTICS_UNAVAILABLE');
  const ids = [...new Set(detail.map(item => item.goods_img_url).filter(url => url.startsWith('cloud://')))];
  const urls = new Map();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const files = await require('./storage').getTempFileURLs(runtime, ids.slice(offset, offset + 50));
    for (const file of files) urls.set(file.fileID, file.tempFileURL || file.download_url);
  }
  const items = detail.map(item => ({ ...item, goods_img_url: urls.get(item.goods_img_url) || item.goods_img_url }));
  if (items.some(item => !/^https:\/\//i.test(item.goods_img_url))) throw errorFrom('LOGISTICS_UNAVAILABLE');
  return { ...body, goods_info: { detail_list: items } };
}

async function save(runtime, intentId, key, record) {
  await withTransaction(runtime.db, async tx => {
    const current = await getDoc(tx.collection('payments'), intentId, true);
    const existing = current.logisticsRecords?.[key];
    const merged = existing?.fingerprint === record.fingerprint ? { ...existing, ...record } : record;
    await tx.collection('payments').doc(intentId).update({ logisticsRecords: { ...current.logisticsRecords, [key]: merged } });
  });
}

async function register(runtime, intent, group, messages) {
  let record = intent.logisticsRecords?.[group.key];
  if (record?.fingerprint !== group.fingerprint) record = { fingerprint: group.fingerprint };
  let body;
  let failure;
  // These two endpoints explicitly do not support cloud invocation. Use server AppSecret only.
  if (!record.waybillToken) {
    try {
      body = await payload(runtime, group.body);
      const result = await directApi(runtime, 'traceWaybill', body);
      if (!result.waybill_token) throw errorFrom('LOGISTICS_UNAVAILABLE');
      record = { ...record, waybillToken: result.waybill_token, registeredAt: new Date().toISOString() };
      await save(runtime, intent._id, group.key, record);
    } catch (error) { failure = error; }
  }
  if (messages && !record.messageRegisteredAt) {
    try {
      await directApi(runtime, 'followWaybill', body || await payload(runtime, group.body));
      record = { ...record, messageRegisteredAt: new Date().toISOString() };
      await save(runtime, intent._id, group.key, record);
    } catch (error) { failure = error; }
  }
  if (failure) throw failure;
  return record.waybillToken;
}

async function sync(runtime, intent, orders) {
  // Try other packages even if one package is rejected; retain the queue marker on any failure.
  let failure;
  const deadline = Date.now() + 15000;
  for (const group of packages(intent, orders)) {
    if (Date.now() >= deadline) throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: 'RETRY_REMAINING_PACKAGES' });
    try { await register(runtime, intent, group, true); } catch (error) { failure = error; }
  }
  if (failure) throw failure;
}

async function query(runtime, order) {
  if (order.payment?.mode !== 'wechat'
    || !['shipped', 'received', 'completed'].includes(order.fulfillmentStatus || order.status)) throw errorFrom('LOGISTICS_UNAVAILABLE');
  const intentId = order.payment.tradeNo || require('./payments').tradeId(order.checkoutId);
  const intent = await getDoc(runtime.db.collection('payments'), intentId, true);
  if (intent.status !== 'paid') throw errorFrom('LOGISTICS_UNAVAILABLE');
  if (intent.userId !== order.userId || !intent.orderIds?.includes(order._id)) throw errorFrom('FORBIDDEN');
  const orders = (await Promise.all(intent.orderIds.map(id => getDoc(runtime.db.collection('orders'), id, false))))
    .filter(item => item && ['shipped', 'received', 'completed'].includes(item.fulfillmentStatus || item.status));
  const group = packages(intent, orders).find(item => item.orderIds.includes(order._id));
  if (!group) throw errorFrom('LOGISTICS_UNAVAILABLE');
  try { return { waybillToken: await register(runtime, intent, group, false) }; }
  catch { throw errorFrom('LOGISTICS_UNAVAILABLE'); }
}

module.exports = { sync, query };
