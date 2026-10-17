// @ts-nocheck
const assert = require('assert');
const crypto = require('crypto');
const { makeRuntime, localAddress } = require('./regressions.test');
const { shopEndpoint, moderateAfterSale } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const pay = require('../shared/wechat-pay');
const payments = require('../shared/payments');

async function run() {
  const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { appid: 'wx-test', mchid: 'merchant-test', serial: 'merchant-serial',
    privateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: platform.publicKey.export({ type: 'spki', format: 'pem' }),
    apiV3Key: 'a'.repeat(32), publicKeyId: 'PUB_KEY_ID_TEST', notifyUrl: 'https://example.test/notify' };
  const oldToken = process.env.ADMIN_API_TOKEN;
  process.env.ADMIN_API_TOKEN = crypto.randomBytes(24).toString('hex');
  const signed = (body, opts = {}) => {
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'platform-nonce';
    return { 'Wechatpay-Timestamp': timestamp, 'Wechatpay-Nonce': nonce, 'Wechatpay-Serial': config.publicKeyId,
      'Wechatpay-Signature': crypto.sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), platform.privateKey).toString('base64'), ...opts };
  };
  const response = (data, status = 200) => {
    const body = data === undefined ? '' : JSON.stringify(data);
    return { ok: status < 300, status, text: async () => body, headers: new Headers(signed(body)) };
  };
  function runtime() {
    const r = makeRuntime();
    r.paymentMode = 'wechat'; r.allowSimulatedPayments = false; r.wechatPayConfig = config;
    r.app = { auth: () => ({ getUserInfo: () => ({ uid: 'user-1', openId: 'openid-1', appId: config.appid }) }) };
    r.adminAuthorized = true;
    return r;
  }
  const ctx = { auth: { uid: 'user-1' } };
  const create = (r, key = 'payment-test') => shopEndpoint({}, ctx, r, 'orders.create', {
    requestKey: key, address: localAddress, items: [{ skuId: 'sku-new', quantity: 2 }],
  });
  try {
    const disabled = runtime(); disabled.paymentMode = 'disabled';
    await assert.rejects(() => create(disabled), (e) => e.code === 'PAYMENT_NOT_CONFIGURED');
    assert.strictEqual(disabled.records.skus['sku-new'].stockQuantity, 10);
    const r = runtime();
    const order = await create(r);
    assert.strictEqual(order.status, 'pending_payment');
    assert.strictEqual(order.paymentStatus, 'unpaid');
    assert.ok(!order.paidAt && order.paymentRequired);
    assert.strictEqual(r.records.skus['sku-new'].stockQuantity, 8);
    const trade = payments.tradeId(order.checkoutId);
    assert.strictEqual(r.records.payments[trade].total, 200);
    assert.strictEqual((await shopEndpoint({}, ctx, r, 'orders.detail', { orderNo: trade }))._id, order._id);
    await assert.rejects(() => shopEndpoint({}, { auth: { uid: 'other' } }, r, 'orders.detail', { orderNo: trade }), (e) => e.code === 'FORBIDDEN');
    await assert.rejects(() => shopEndpoint({}, ctx, r, 'orders.detail', { orderNo: 'wc' + '0'.repeat(30) }), (e) => e.code === 'NOT_FOUND');
    assert.strictEqual((await create(r))._id, order._id);
    assert.strictEqual(r.records.skus['sku-new'].stockQuantity, 8);
    await assert.rejects(() => payments.prepare(r, {}, { auth: { uid: 'other' } }, { checkoutId: order._id }), (e) => e.code === 'FORBIDDEN');
    const calls = [];
    r.paymentFetch = async (url, options) => {
      calls.push([url, options]);
      const auth = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const path = url.replace('https://api.mch.weixin.qq.com', '');
      assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${options.method}\n${path}\n${auth.timestamp}\n${auth.nonce_str}\n${options.body || ''}\n`), merchant.publicKey, Buffer.from(auth.signature, 'base64')));
      if (options.method === 'GET') return response({ code: 'ORDER_NOT_EXIST' }, 404);
      const body = JSON.parse(options.body);
      assert.strictEqual(body.amount.total, 200);
      assert.strictEqual(body.payer.openid, 'openid-1');
      assert.ok(!body.sign && !body.privateKey);
      return response({ prepay_id: 'prepay-test' });
    };
    const prepared = await payments.prepare(r, {}, ctx, { checkoutId: order._id, amount: 1, openid: 'forged' });
    const client = prepared.payment;
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${config.appid}\n${client.timeStamp}\n${client.nonceStr}\n${client.package}\n`), merchant.publicKey, Buffer.from(client.paySign, 'base64')));
    const transaction = { appid: config.appid, mchid: config.mchid, out_trade_no: trade, transaction_id: 'wx-transaction',
      trade_state: 'SUCCESS', amount: { total: 200, currency: 'CNY' }, payer: { openid: 'openid-1' } };
    await assert.rejects(() => payments.confirmPaid(r, { ...transaction, amount: { total: 1, currency: 'CNY' } }), (e) => e.code === 'PAYMENT_MISMATCH');
    assert.strictEqual(r.records.orders[order._id].paymentStatus, 'unpaid');
    await payments.confirmPaid(r, transaction);
    await payments.confirmPaid(r, transaction);
    assert.strictEqual(r.records.orders[order._id].payment.transactionId, 'wx-transaction');
    assert.strictEqual(r.records.skus['sku-new'].stockQuantity, 8);
    assert.strictEqual((await payments.prepare(r, {}, ctx, { checkoutId: order._id })).paid, true);

    // Encrypt an authentic provider notification and verify both signature and GCM authentication.
    const encode = (data, type) => {
      const nonce = '0123456789ab', aad = 'transaction';
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(config.apiV3Key), Buffer.from(nonce));
      cipher.setAAD(Buffer.from(aad));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]);
      const body = JSON.stringify({ event_type: type, resource: { algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: aad, ciphertext: bytes.toString('base64') } });
      return { httpMethod: 'POST', body, headers: signed(body) };
    };
    const notice = encode(transaction, 'TRANSACTION.SUCCESS');
    assert.strictEqual((await payments.notification(r, notice)).statusCode, 204);
    assert.strictEqual((await payments.notification(r, { ...notice, body: notice.body + ' ' })).statusCode, 400);
    assert.strictEqual((await payments.notification(r, { ...notice, headers: { ...notice.headers, 'Wechatpay-Serial': 'OTHER' } })).statusCode, 400);
    assert.strictEqual((await payments.notification(r, { ...notice, body: Buffer.from(notice.body).toString('base64'), isBase64Encoded: true })).statusCode, 204);
    assert.throws(() => pay.verify(config, { ...notice.headers, 'Wechatpay-Timestamp': '1' }, notice.body));

    const claim = await shopEndpoint({}, ctx, r, 'afterSales.create', { orderId: order._id, reason: '不需要了', type: 20,
      items: [{ skuId: 'sku-new', quantity: 2 }] });
    const refundResult = { out_refund_no: claim._id, transaction_id: transaction.transaction_id,
      refund_id: 'wx-refund-1', amount: { refund: 200, total: 200 }, status: 'PROCESSING' };
    r.paymentFetch = async () => response(refundResult);
    const approved = await moderateAfterSale(r, { id: claim._id, status: 'approved', amount: 200 });
    assert.strictEqual(approved.status, 'refunding');
    assert.strictEqual(r.records.skus['sku-new'].stockQuantity, 8);
    await assert.rejects(() => payments.applyRefund(r, { ...refundResult, amount: { refund: 1, total: 200 }, status: 'SUCCESS' }), (e) => e.code === 'PAYMENT_MISMATCH');
    const refundNotice = encode({ ...refundResult, status: undefined, refund_status: 'SUCCESS', mchid: config.mchid }, 'REFUND.SUCCESS');
    assert.strictEqual((await payments.notification(r, refundNotice)).statusCode, 204);
    assert.strictEqual((await payments.notification(r, refundNotice)).statusCode, 204);
    assert.strictEqual(r.records.orders[order._id].refundAmount, 200);
    assert.strictEqual(r.records.afterSales[claim._id].refundTransactionId, refundResult.refund_id);
    assert.strictEqual(r.records.skus['sku-new'].stockQuantity, 10);

    // An expired remote order is closed first; a second close cannot release stock twice.
    const expired = runtime(); const old = await create(expired);
    const intent = expired.records.payments[payments.tradeId(old._id)];
    intent.expiresAt = new Date(Date.now() - 1000).toISOString();
    let closed = false;
    expired.paymentFetch = async (url, options) => {
      if (options.method === 'POST') { closed = true; return response(undefined, 204); }
      return response({ trade_state: 'NOTPAY' });
    };
    await payments.sync(expired, intent); await payments.sync(expired, expired.records.payments[intent._id]);
    assert.ok(closed); assert.strictEqual(expired.records.skus['sku-new'].stockQuantity, 10);
    assert.strictEqual(expired.records.orders[old._id].status, 'closed');

    const split = runtime();
    split.records.skus['sku-second'] = { ...split.records.skus['sku-new'], _id: 'sku-second', skuId: 'sku-second', salePrice: 300 };
    const multiple = await shopEndpoint({}, ctx, split, 'orders.create', { requestKey: 'split-real', address: localAddress,
      items: [{ skuId: 'sku-new', quantity: 1 }, { skuId: 'sku-second', quantity: 1 }] });
    assert.strictEqual(multiple.orderCount, 2);
    const splitTrade = payments.tradeId(multiple.checkoutId);
    assert.strictEqual(split.records.payments[splitTrade].total, 400);
    await payments.confirmPaid(split, { ...transaction, out_trade_no: splitTrade, transaction_id: 'wx-split', amount: { total: 400, currency: 'CNY' } });
    assert.ok(multiple.orders.every((o) => split.records.orders[o._id].payment.checkoutTotal === 400));
    assert.ok(multiple.orders.every((o) => split.records.orders[o._id].payment.transactionId === 'wx-split'));
    const small = multiple.orders.find((o) => o.totalAmount === 100);
    const partial = await shopEndpoint({}, ctx, split, 'afterSales.create', { orderId: small._id, reason: '不需要了', type: 20,
      items: [{ skuId: 'sku-new', quantity: 1 }] });
    split.paymentFetch = async (url, opts) => {
      const data = JSON.parse(opts.body);
      assert.strictEqual(data.amount.refund, 100); assert.strictEqual(data.amount.total, 400);
      return response({ out_refund_no: partial._id, transaction_id: 'wx-split', refund_id: 'wx-split-refund',
        status: 'SUCCESS', amount: { refund: 100, total: 400 } });
    };
    await moderateAfterSale(split, { id: partial._id, status: 'approved', amount: 100 });
    assert.strictEqual(split.records.orders[small._id].paymentStatus, 'refunded');
    assert.strictEqual(split.records.orders[multiple.orders.find((o) => o._id !== small._id)._id].paymentStatus, 'paid');

    const big = multiple.orders.find((o) => o._id !== small._id);
    const uploads = [];
    split.app.callWxOpenApi = async ({ apiName, requestData }) => {
      if (apiName === 'express.delivery.openMsg.getDeliveryList') return { result: { errcode: 0, delivery_list: [{ delivery_id: 'SF', delivery_name: '顺丰速运' }] } };
      uploads.push(requestData);
      return { result: { errcode: 0 } };
    };
    const companies = await adminEndpoint({}, {}, split, 'shipping.companies', {});
    assert.deepStrictEqual(companies.items, [{ value: 'SF', label: '顺丰速运' }]);
    await assert.rejects(() => adminEndpoint({}, {}, split, 'orders.ship', { orderId: big._id, trackingNo: 'SF123' }), (e) => e.code === 'INVALID_ARGUMENT');
    assert.strictEqual(split.records.orders[big._id].status, 'paid');
    const shipment = await adminEndpoint({}, {}, split, 'orders.ship', { orderId: big._id, trackingNo: 'SF123', expressCompany: 'SF' });
    assert.strictEqual(shipment.shippingSyncPending, false);
    assert.strictEqual(uploads[0].order_key.transaction_id, 'wx-split');
    assert.strictEqual(uploads[0].payer.openid, 'openid-1');
    assert.strictEqual(uploads[0].is_all_delivered, true);
    assert.strictEqual(uploads[0].shipping_list[0].express_company, 'SF');
    const shipping = require('../shared/wechat-shipping');
    await shipping.sync(split, split.records.payments[splitTrade]);
    assert.strictEqual(uploads.length, 1);
    split.app.callWxOpenApi = async () => { throw new Error('upstream unavailable'); };
    const changed = await adminEndpoint({}, {}, split, 'orders.logistics.save', { orderId: big._id, trackingNo: 'SF456', expressCompany: 'SF' });
    assert.strictEqual(changed.shippingSyncPending, true);
    assert.strictEqual(split.records.payments[splitTrade].shippingPending, true);
    split.app.callWxOpenApi = async ({ requestData }) => { uploads.push(requestData); return { result: { errcode: 0 } }; };
    await shipping.sync(split, split.records.payments[splitTrade]);
    assert.strictEqual(uploads[1].shipping_list[0].tracking_no, 'SF456');
    assert.strictEqual(split.records.payments[splitTrade].shippingPending, false);

    // HTTP admin/timer delivery calls use a cached stable token, never a caller-supplied identity.
    const serverShipping = runtime();
    serverShipping.wechatAppConfig = { appid: config.appid, secret: crypto.randomBytes(16).toString('hex') };
    let tokenCalls = 0, deliveryCalls = 0;
    serverShipping.wechatFetch = async (url, options) => {
      assert.strictEqual(options.redirect, 'error');
      if (url.endsWith('/cgi-bin/stable_token')) {
        tokenCalls += 1;
        assert.strictEqual(JSON.parse(options.body).force_refresh, false);
        return { ok: true, json: async () => ({ access_token: `token-${tokenCalls}`, expires_in: 7200 }) };
      }
      assert.ok(url.startsWith('https://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/get_delivery_list?'));
      deliveryCalls += 1;
      if (deliveryCalls === 1) return { ok: true, json: async () => ({ errcode: 42001 }) };
      return { ok: true, json: async () => ({ delivery_list: [{ delivery_id: 'SF', delivery_name: '顺丰速运' }] }) };
    };
    assert.strictEqual((await shipping.companies(serverShipping)).items[0].value, 'SF');
    await shipping.companies(serverShipping);
    assert.strictEqual(tokenCalls, 2);
    serverShipping.wechatFetch = async () => { throw new Error('URL contains a secret token'); };
    await assert.rejects(() => shipping.companies(serverShipping), (e) => e.code === 'SHIPPING_SYNC_FAILED'
      && e.details.providerCode === 'NETWORK_ERROR' && !e.message.includes('secret token'));

    // Real-mode admin access cannot be supplied through event/data flags.
    const denied = runtime(); denied.adminAuthorized = false;
    await assert.rejects(() => adminEndpoint({ adminAuthorized: true }, {}, denied, 'dashboard.summary', { adminAuthorized: true }), (e) => e.code === 'ADMIN_AUTH_REQUIRED');
    assert.ok(require('../shared/admin-access').tokenMatches(process.env.ADMIN_API_TOKEN));
    assert.ok(!require('../shared/admin-access').tokenMatches('forged'));
    console.log('PASS WeChat APIv3 signatures, trusted payer, pending orders, idempotency, paid verification, encrypted notifications, real refunds, stock release and admin authorization');
  } finally {
    if (oldToken === undefined) delete process.env.ADMIN_API_TOKEN; else process.env.ADMIN_API_TOKEN = oldToken;
  }
}
module.exports = { run };
