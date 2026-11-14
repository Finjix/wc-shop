// @ts-nocheck
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { makeRuntime, localAddress } = require('./regressions.test');
const { shopEndpoint } = require('../shared/shop');
const shipping = require('../shared/wechat-shipping');
const logistics = require('../shared/wechat-logistics');

async function run() {
  const r = makeRuntime();
  const ctx = { auth: { uid: 'user-1' } };
  const created = await shopEndpoint({}, ctx, r, 'orders.create', {
    requestKey: 'official-logistics', address: localAddress, items: [{ skuId: 'sku-new', quantity: 1 }],
  });
  const order = r.records.orders[created._id];
  const trade = 'logistics-payment';
  Object.assign(order, { status: 'shipped', fulfillmentStatus: 'shipped',
    logistics: { trackingNo: 'SF123', expressCompany: 'SF' },
    payment: { mode: 'wechat', tradeNo: trade, transactionId: '420000-real-trade' } });
  order.items[0].productSnapshot.primaryImage = 'cloud://env/products/cover.webp';
  r.records.payments = { [trade]: { _id: trade, userId: order.userId, status: 'paid', openid: 'buyer-openid',
    transactionId: '420000-real-trade', orderIds: [order._id], shippingPending: true, shippingRevision: 'first' } };
  r.wechatAppConfig = { appid: 'wx-test', secret: crypto.randomBytes(16).toString('hex') };
  const calls = [];
  let failFollow = true, failTrace = false;
  r.app = { getTempFileURL: async ({ fileList }) => ({ fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://images.example.test/cover.webp' })) }),
    callWxOpenApi: () => { throw new Error('new logistics APIs must never use cloud invocation'); } };
  r.wechatFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const name = new URL(url).pathname.split('/').pop();
    if (name === 'stable_token') return { ok: true, json: async () => ({ access_token: 'server-only-token', expires_in: 7200 }) };
    calls.push({ name, body });
    let result = { errcode: 0 };
    if ((name === 'follow_waybill' && failFollow) || (name === 'trace_waybill' && failTrace)) result = { errcode: 9300513 };
    else if (name === 'trace_waybill') result.waybill_token = `query-token-${calls.length}`;
    return { ok: true, json: async () => result };
  };
  const current = () => r.records.payments[trade];
  const count = name => calls.filter(call => call.name === name).length;
  await assert.rejects(() => shipping.sync(r, current()), error => error.code === 'SHIPPING_SYNC_FAILED');
  assert.equal(current().shippingPending, true);
  assert.ok(current().shippingFingerprint, 'a successful shipping upload survives a message failure');
  assert.equal(count('trace_waybill'), 1);
  const trace = calls.find(call => call.name === 'trace_waybill').body;
  assert.equal(trace.openid, 'buyer-openid');
  assert.equal(trace.trans_id, '420000-real-trade');
  assert.equal(trace.receiver_phone, localAddress.phone);
  assert.equal(trace.delivery_id, 'SF');
  assert.equal(trace.goods_info.detail_list[0].goods_img_url, 'https://images.example.test/cover.webp');
  assert.equal(trace.order_detail_path, `pages/order/order-detail/index?orderNo=${order.orderNo}`);
  failFollow = false;
  await shipping.sync(r, current());
  assert.equal(count('upload_shipping_info'), 1, 'message retry must not repeat the shipping upload');
  assert.equal(count('trace_waybill'), 1, 'message retry must not repeat query registration');
  assert.equal(count('follow_waybill'), 2);
  assert.equal(current().shippingPending, false);
  await shipping.sync(r, current());
  assert.equal(count('follow_waybill'), 2, 'successful registration is persisted');
  const result = await shopEndpoint({}, ctx, r, 'orders.logistics', { orderId: order._id,
    waybill_id: 'FORGED', receiver_phone: 'forged', openid: 'forged' });
  assert.deepEqual(Object.keys(result), ['waybillToken']);
  assert.ok(result.waybillToken.startsWith('query-token-'));
  assert.deepEqual(await logistics.diagnose(r, order), { queryReady: true });
  const before = calls.length;
  await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'another-buyer' } }, r, 'orders.logistics', { orderId: order._id }), e => e.code === 'FORBIDDEN');
  await assert.rejects(() => shopEndpoint({}, {}, r, 'orders.logistics', { orderId: order._id }), e => e.code === 'UNAUTHENTICATED');
  assert.equal(calls.length, before);

  // Changing the waybill invalidates both registrations. Messages can succeed independently of query permission.
  order.logistics.trackingNo = 'SF456';
  Object.assign(current(), { shippingPending: true, shippingRevision: 'second' });
  failTrace = true;
  await assert.rejects(() => shipping.sync(r, current()));
  assert.equal(calls.at(-1).name, 'follow_waybill');
  assert.equal(calls.at(-1).body.waybill_id, 'SF456');
  assert.deepEqual(await logistics.diagnose(r, order), { queryReady: false, code: 'LOGISTICS_UNAVAILABLE', providerCode: '9300513' });
  const followCount = count('follow_waybill');
  failTrace = false;
  await shipping.sync(r, current());
  assert.equal(count('follow_waybill'), followCount);
  assert.equal(current().shippingPending, false);
  const token = (await logistics.query(r, order)).waybillToken;
  assert.notEqual(token, result.waybillToken);
  assert.equal(order.logistics.waybillToken, undefined, 'query tokens stay out of public order payloads');

  const copy = { ...order, _id: 'second-order', items: order.items };
  r.records.orders[copy._id] = copy;
  current().orderIds.push(copy._id);
  await shipping.sync(r, current());
  const grouped = calls.filter(call => call.name === 'trace_waybill').at(-1).body;
  assert.equal(grouped.goods_info.detail_list.length, 2, 'one package includes all its business orders');
  assert.equal((await logistics.query(r, copy)).waybillToken, (await logistics.query(r, order)).waybillToken);

  await assert.rejects(() => logistics.query(r, { ...order, payment: { mode: 'simulated' } }), e => e.code === 'LOGISTICS_UNAVAILABLE');
  await assert.rejects(() => logistics.query(r, { ...order, status: 'paid', fulfillmentStatus: 'paid' }), e => e.code === 'LOGISTICS_UNAVAILABLE');
  console.log('PASS official logistics payloads, cloud image URLs, owner checks, private tokens, package grouping and independent durable retries');
}
module.exports = { run };
