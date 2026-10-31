// @ts-nocheck
const assert = require('assert');
const crypto = require('crypto');
const { makeRuntime, localAddress } = require('./regressions.test');
const { shopEndpoint, moderateAfterSale } = require('../shared/shop');
const { adminEndpoint } = require('../shared/admin');
const pay = require('../shared/wechat-pay');
const payments = require('../shared/payments');

async function run() {
  const shippingModule = require('../shared/wechat-shipping');
  const localCompanies = [{ value: 'SF', label: '顺丰速运' }];
  assert.deepStrictEqual(await shippingModule.companies({ paymentMode: 'simulated', shippingCompanies: localCompanies }), { items: localCompanies });
  assert.deepStrictEqual(shippingModule.carrier({ payment: { mode: 'simulated' } }, 'SF'), { expressCompany: 'SF' });
  assert.deepStrictEqual(shippingModule.carrier({ payment: { mode: 'simulated' } }, ''), {});
  assert.throws(() => shippingModule.carrier({ payment: { mode: 'simulated' } }, 'bad carrier'), e => e.code === 'INVALID_ARGUMENT');
  const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { appid: 'wx-test', mchid: 'merchant-test', serial: 'merchant-serial',
    privateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: platform.publicKey.export({ type: 'spki', format: 'pem' }),
    apiV3Key: 'a'.repeat(32), publicKeyId: 'PUB_KEY_ID_TEST', notifyUrl: 'https://example.test/notify' };
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
    return r;
  }
  const ctx = { auth: { uid: 'user-1' } };
  const create = (r, key = 'payment-test') => shopEndpoint({}, ctx, r, 'orders.create', {
    requestKey: key, address: localAddress, items: [{ skuId: 'sku-new', quantity: 2 }],
  });
  {
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
    assert.strictEqual(Object.keys(r.records.orders).length, 0, 'an unpaid checkout is only a payment draft');
    assert.strictEqual((await adminEndpoint({}, {}, r, 'orders.list', {})).total, 0);
    assert.strictEqual((await shopEndpoint({}, ctx, r, 'orders.list', {})).total, 0);
    await assert.rejects(() => shopEndpoint({}, ctx, r, 'orders.detail', { orderNo: trade }), (e) => e.code === 'NOT_FOUND');
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
    assert.strictEqual((await shopEndpoint({}, ctx, r, 'orders.checkout', { checkoutId: order.checkoutId })).paymentStatus, 'unpaid');
    assert.strictEqual(Object.keys(r.records.orders).length, 0, 'prepay and unpaid queries do not create orders');
    const client = prepared.payment;
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${config.appid}\n${client.timeStamp}\n${client.nonceStr}\n${client.package}\n`), merchant.publicKey, Buffer.from(client.paySign, 'base64')));
    const transaction = { appid: config.appid, mchid: config.mchid, out_trade_no: trade, transaction_id: 'wx-transaction',
      trade_state: 'SUCCESS', amount: { total: 200, currency: 'CNY' }, payer: { openid: 'openid-1' } };
    await assert.rejects(() => payments.confirmPaid(r, { ...transaction, amount: { total: 1, currency: 'CNY' } }), (e) => e.code === 'PAYMENT_MISMATCH');
    assert.strictEqual(Object.keys(r.records.orders).length, 0, 'a mismatched payment cannot materialize orders');
    await payments.confirmPaid(r, transaction);
    await payments.confirmPaid(r, transaction);
    assert.strictEqual(Object.keys(r.records.orders).length, 1, 'repeated provider confirmation creates exactly one order');
    assert.strictEqual((await shopEndpoint({}, ctx, r, 'orders.detail', { orderNo: trade }))._id, order._id);
    assert.strictEqual(r.records.orders[order._id].payment.transactionId, 'wx-transaction');
    assert.strictEqual(r.records.skus['sku-new'].stockQuantity, 8);
    assert.strictEqual((await payments.prepare(r, {}, ctx, { checkoutId: order._id })).paid, true);

    const cartRuntime = runtime();
    cartRuntime.records.carts['user-1'].items = [
      { skuId: 'sku-new', quantity: 3, isSelected: true },
      { skuId: 'sku-old', quantity: 1, isSelected: false },
    ];
    const cartRequest = { requestKey: 'paid-cart-only', address: localAddress, useCart: true,
      items: [{ skuId: 'sku-new', quantity: 2 }] };
    const cartDraft = await shopEndpoint({}, ctx, cartRuntime, 'orders.create', cartRequest);
    assert.strictEqual(cartRuntime.records.carts['user-1'].items[0].quantity, 3, 'cancelled or failed payment leaves the cart intact');
    assert.strictEqual(Object.keys(cartRuntime.records.orders).length, 0);
    await assert.rejects(() => shopEndpoint({}, ctx, cartRuntime, 'orders.create', { ...cartRequest,
      items: [{ skuId: 'sku-new', quantity: 1 }] }), e => e.code === 'IDEMPOTENCY_CONFLICT');
    await assert.rejects(() => payments.queryCheckout(cartRuntime, {}, { auth: { uid: 'other' } }, { checkoutId: cartDraft.checkoutId }), e => e.code === 'FORBIDDEN');
    cartRuntime.paymentFetch = async () => { throw new Error('provider unavailable'); };
    await assert.rejects(() => payments.prepare(cartRuntime, {}, ctx, { checkoutId: cartDraft.checkoutId }));
    assert.strictEqual(Object.keys(cartRuntime.records.orders).length, 0, 'a failed provider call leaves only a draft');
    const repeatedDraft = await shopEndpoint({}, ctx, cartRuntime, 'orders.create', cartRequest);
    assert.strictEqual(repeatedDraft.checkoutId, cartDraft.checkoutId);
    assert.strictEqual(cartRuntime.records.skus['sku-new'].stockQuantity, 8, 'same-key draft retries reserve stock once');
    cartRuntime.records.carts['user-1'].items[0].quantity = 4; // Items added while the cashier is open are retained.
    cartRuntime.records.carts['user-1'].items[0].isSelected = false;
    const cartPaid = { ...transaction, out_trade_no: payments.tradeId(cartDraft.checkoutId), transaction_id: 'wx-cart-paid' };
    await Promise.all([payments.confirmPaid(cartRuntime, cartPaid), payments.confirmPaid(cartRuntime, cartPaid)]);
    assert.strictEqual(Object.keys(cartRuntime.records.orders).length, 1);
    assert.strictEqual(cartRuntime.records.carts['user-1'].items[0].quantity, 2);
    assert.strictEqual(cartRuntime.records.carts['user-1'].items[1].skuId, 'sku-old');
    assert.strictEqual((await shopEndpoint({}, ctx, cartRuntime, 'orders.checkout', { checkoutId: cartDraft.checkoutId })).paymentStatus, 'paid');
    assert.strictEqual((await shopEndpoint({}, ctx, cartRuntime, 'orders.create', cartRequest)).paymentStatus, 'paid');

    const concurrentDrafts = runtime();
    const draftAttempts = await Promise.all([create(concurrentDrafts, 'same-real-request'), create(concurrentDrafts, 'same-real-request')]);
    assert.strictEqual(draftAttempts[0].checkoutId, draftAttempts[1].checkoutId);
    assert.strictEqual(Object.keys(concurrentDrafts.records.payments).length, 1);
    assert.strictEqual(Object.keys(concurrentDrafts.records.orders).length, 0);
    assert.strictEqual(concurrentDrafts.records.skus['sku-new'].stockQuantity, 8);

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
    // Recover an approved refund whose first POST never reached WeChat.
    const recover = runtime(), recoveryOrder = await create(recover, 'refund-recovery');
    await payments.confirmPaid(recover, { ...transaction, out_trade_no: payments.tradeId(recoveryOrder._id), transaction_id: 'wx-recovery' });
    const recoveryClaim = await shopEndpoint({}, ctx, recover, 'afterSales.create', {
      orderId: recoveryOrder._id, reason: '退款重试', type: 20, items: [{ skuId: 'sku-new', quantity: 2 }],
    });
    recover.paymentFetch = async () => { throw new Error('request lost before acceptance'); };
    await assert.rejects(() => moderateAfterSale(recover, { id: recoveryClaim._id, status: 'approved', amount: 200 }));
    assert.strictEqual(recover.records.afterSales[recoveryClaim._id].status, 'refunding');
    const recoveryCalls = [];
    const recoveryResult = { ...refundResult, out_refund_no: recoveryClaim._id, transaction_id: 'wx-recovery', refund_id: 'wx-recovery-refund' };
    recover.paymentFetch = async (url, options) => {
      recoveryCalls.push([options.method, url, options.body]);
      if (options.method === 'GET') return response({ code: 'RESOURCE_NOT_EXISTS' }, 404);
      const request = JSON.parse(options.body);
      assert.strictEqual(request.out_refund_no, recoveryClaim._id);
      assert.deepStrictEqual(request.amount, { refund: 200, total: 200, currency: 'CNY' });
      return response(recoveryResult);
    };
    await payments.reconcile(recover);
    assert.deepStrictEqual(recoveryCalls.map(([method]) => method), ['GET', 'POST']);
    assert.strictEqual(recover.records.orders[recoveryOrder._id].refundAmount, 0);
    assert.strictEqual(recover.records.skus['sku-new'].stockQuantity, 8);
    recoveryCalls.length = 0;
    recover.paymentFetch = async (_url, options) => { recoveryCalls.push([options.method]); return response({ ...recoveryResult, status: 'SUCCESS' }); };
    await payments.syncRefund(recover, recover.records.afterSales[recoveryClaim._id]);
    await payments.syncRefund(recover, recover.records.afterSales[recoveryClaim._id]);
    assert.deepStrictEqual(recoveryCalls.map(([method]) => method), ['GET', 'GET']);
    assert.strictEqual(recover.records.orders[recoveryOrder._id].refundAmount, 200);
    assert.strictEqual(recover.records.skus['sku-new'].stockQuantity, 10);
    let unsafePosts = 0;
    recover.paymentFetch = async (_url, options) => {
      if (options.method === 'POST') unsafePosts += 1;
      return response({ code: 'SYSTEM_ERROR' }, 500);
    };
    await assert.rejects(() => payments.syncRefund(recover, recoveryClaim), (e) => e.code === 'PAYMENT_PROVIDER_ERROR');
    recover.paymentFetch = async () => ({ ...response({ code: 'RESOURCE_NOT_EXISTS' }, 404), headers: new Headers() });
    await assert.rejects(() => payments.syncRefund(recover, recoveryClaim), (e) => e.code === 'PAYMENT_SIGNATURE_INVALID');
    assert.strictEqual(unsafePosts, 0, 'unknown or unverified query responses cannot trigger a refund POST');
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
    assert.strictEqual(Object.keys(expired.records.orders).length, 0, 'expired drafts never create closed formal orders');

    // Already-created pending orders from older deployed versions keep their original lifecycle.
    const legacy = runtime(), legacyDraft = await create(legacy, 'legacy-pending');
    const legacyIntent = legacy.records.payments[payments.tradeId(legacyDraft.checkoutId)];
    for (const draft of legacyIntent.draftOrders) legacy.records.orders[draft._id] = structuredClone(draft);
    delete legacyIntent.draftOrders; delete legacyIntent.cartItems;
    await payments.confirmPaid(legacy, { ...transaction, out_trade_no: legacyIntent._id, transaction_id: 'wx-legacy' });
    assert.strictEqual(legacy.records.orders[legacyDraft._id].paymentStatus, 'paid');
    const legacyClosed = runtime(), legacyOld = await create(legacyClosed, 'legacy-close');
    const legacyCloseIntent = legacyClosed.records.payments[payments.tradeId(legacyOld.checkoutId)];
    for (const draft of legacyCloseIntent.draftOrders) legacyClosed.records.orders[draft._id] = structuredClone(draft);
    delete legacyCloseIntent.draftOrders;
    legacyClosed.paymentFetch = async () => response({ trade_state: 'CLOSED' });
    await payments.sync(legacyClosed, legacyCloseIntent);
    assert.strictEqual(legacyClosed.records.orders[legacyOld._id].status, 'closed');
    assert.strictEqual(legacyClosed.records.skus['sku-new'].stockQuantity, 10);

    // A fixed oldest-ten window must not hide later payments when callbacks are lost.
    const queued = runtime(); queued.records.skus['sku-new'].stockQuantity = 100;
    for (let index = 0; index < 11; index += 1) await create(queued, `queued-${index}`);
    const queuedIds = Object.keys(queued.records.payments).sort();
    const queuedCalls = [];
    queued.paymentFetch = async url => {
      const id = url.split('/out-trade-no/')[1].split('?')[0];
      queuedCalls.push(id);
      if (id !== queuedIds[10]) return response({ code: 'SYSTEM_ERROR' }, 500);
      return response({ ...transaction, out_trade_no: id, transaction_id: 'wx-later-payment' });
    };
    await payments.reconcile(queued);
    assert.strictEqual(queuedCalls.length, 10);
    assert.ok(!queuedCalls.includes(queuedIds[10]));
    await payments.reconcile(queued);
    assert.ok(queuedCalls.includes(queuedIds[10]), 'the next sweep reaches beyond ten failing old records');
    assert.strictEqual(queued.records.payments[queuedIds[10]].status, 'paid');
    assert.strictEqual(queued.records.settings.__payment_reconcile_schedule.nextQueue, 2);

    const split = runtime();
    split.records.skus['sku-second'] = { ...split.records.skus['sku-new'], _id: 'sku-second', skuId: 'sku-second', salePrice: 300 };
    const multiple = await shopEndpoint({}, ctx, split, 'orders.create', { requestKey: 'split-real', address: localAddress,
      items: [{ skuId: 'sku-new', quantity: 1 }, { skuId: 'sku-second', quantity: 1 }] });
    assert.strictEqual(multiple.orderCount, 2);
    assert.strictEqual(Object.keys(split.records.orders).length, 0, 'all SKU drafts stay out of formal orders before payment');
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
    assert.strictEqual(uploads[0].shipping_list[0].contact.receiver_contact, '*******0000');
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

    // CloudBase allows only one active request in a transaction, including batch fulfillment.
    const batch = runtime();
    const runTransaction = batch.db.runTransaction.bind(batch.db);
    batch.db.runTransaction = worker => runTransaction(tx => {
      let active = false;
      return worker({ ...tx, collection(name) {
        const ref = tx.collection(name);
        return { ...ref, doc(id) {
          const doc = ref.doc(id);
          return Object.fromEntries(Object.entries(doc).map(([method, operation]) => [method, async (...args) => {
            assert.strictEqual(active, false, 'transaction requests must be sequential');
            active = true;
            try { await new Promise(resolve => setImmediate(resolve)); return await operation(...args); }
            finally { active = false; }
          }]));
        } };
      } });
    });
    batch.records.skus['sku-second'] = { ...batch.records.skus['sku-new'], _id: 'sku-second', skuId: 'sku-second', salePrice: 300 };
    const batchOrders = await shopEndpoint({}, ctx, batch, 'orders.create', { requestKey: 'serial-batch', address: localAddress,
      items: [{ skuId: 'sku-new', quantity: 1 }, { skuId: 'sku-second', quantity: 1 }] });
    await payments.confirmPaid(batch, { ...transaction, out_trade_no: payments.tradeId(batchOrders.checkoutId),
      transaction_id: 'wx-batch', amount: { total: 400, currency: 'CNY' } });
    const batchUploads = [];
    batch.app.callWxOpenApi = async ({ requestData }) => { batchUploads.push(requestData); return { result: { errcode: 0 } }; };
    const batchInput = { orderIds: batchOrders.orderIds, groupKey: require('../shared/order-shipping').shippingGroupKey(batchOrders.orders[0]),
      trackingNo: 'SF-BATCH-1', expressCompany: 'SF' };
    assert.strictEqual((await adminEndpoint({}, {}, batch, 'orders.shipBatch', batchInput)).shippingSyncPending, false);
    assert.strictEqual(batchUploads[0].shipping_list.length, 1);
    assert.strictEqual(batchUploads[0].is_all_delivered, true);
    assert.strictEqual((await adminEndpoint({}, {}, batch, 'orders.logistics.saveBatch', { ...batchInput, trackingNo: 'SF-BATCH-2' })).shippingSyncPending, false);
    assert.strictEqual(batchUploads[1].shipping_list[0].tracking_no, 'SF-BATCH-2');

    const atomic = runtime();
    atomic.records.skus['sku-second'] = { ...atomic.records.skus['sku-new'], _id: 'sku-second', skuId: 'sku-second', salePrice: 300 };
    const atomicDraft = await shopEndpoint({}, ctx, atomic, 'orders.create', { requestKey: 'atomic-materialization', address: localAddress,
      items: [{ skuId: 'sku-new', quantity: 1 }, { skuId: 'sku-second', quantity: 1 }] });
    const originalTransaction = atomic.db.runTransaction.bind(atomic.db);
    atomic.db.runTransaction = worker => originalTransaction(tx => worker({ ...tx, collection(name) {
      const ref = tx.collection(name);
      return name === 'orders' ? { ...ref, doc(id) {
        const doc = ref.doc(id);
        return id === atomicDraft.orderIds[1] ? { ...doc, async set() { throw new Error('second order write failed'); } } : doc;
      } } : ref;
    } }));
    const atomicPaid = { ...transaction, out_trade_no: payments.tradeId(atomicDraft.checkoutId), transaction_id: 'wx-atomic',
      amount: { total: 400, currency: 'CNY' } };
    await assert.rejects(() => payments.confirmPaid(atomic, atomicPaid), /second order write failed/);
    assert.strictEqual(Object.keys(atomic.records.orders).length, 0, 'a failed second write rolls back the first formal order');
    assert.strictEqual(atomic.records.payments[atomicPaid.out_trade_no].status, 'pending');
    atomic.db.runTransaction = originalTransaction;
    await Promise.all([payments.confirmPaid(atomic, atomicPaid), payments.confirmPaid(atomic, atomicPaid)]);
    assert.strictEqual(Object.keys(atomic.records.orders).length, 2);
    assert.strictEqual(atomic.records.skus['sku-new'].stockQuantity, 9);

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

    console.log('PASS WeChat APIv3 signatures, trusted payer, pending orders, idempotency, paid verification, encrypted notifications, real refunds and stock release');
  }
}
module.exports = { run };
