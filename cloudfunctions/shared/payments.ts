// @ts-nocheck
const crypto = require('crypto');
const pay = require('./wechat-pay');
const { getDoc, setDoc, withTransaction } = require('./db');
const { errorFrom } = require('./errors');
const { requireUser } = require('./auth');

const now = () => new Date().toISOString();
const tradeId = (id) => `wc${crypto.createHash('sha256').update(id).digest('hex').slice(0, 30)}`;

async function load(runtime, id, uid) {
  const first = await getDoc(runtime.db.collection('orders'), id, true);
  if (uid && first.userId !== uid) throw errorFrom('FORBIDDEN');
  const root = first.checkoutId || first._id;
  const anchor = root === first._id ? first : await getDoc(runtime.db.collection('orders'), root, true);
  const orders = await Promise.all(anchor.checkoutOrderIds.map((key) => getDoc(runtime.db.collection('orders'), key, true)));
  if (orders.some((o) => o.userId !== first.userId || o.checkoutId !== root)) throw errorFrom('ORDER_STATE_INVALID');
  return { root, first: anchor, orders, total: orders.reduce((sum, o) => sum + o.totalAmount, 0) };
}
async function ensureIntent(runtime, identity, checkout) {
  const id = tradeId(checkout.root), c = pay.config(runtime);
  return withTransaction(runtime.db, async (tx) => {
    const col = tx.collection('payments'), existing = await getDoc(col, id, false);
    if (existing) {
      if (existing.userId !== identity.uid || existing.total !== checkout.total
        || existing.appid !== c.appid || existing.mchid !== c.mchid) throw errorFrom('PAYMENT_MISMATCH');
      return existing;
    }
    const intent = { _id: id, checkoutId: checkout.root, orderIds: checkout.orders.map((o) => o._id),
      userId: identity.uid, openid: checkout.first.payment.openid, appid: c.appid, mchid: c.mchid,
      total: checkout.total, status: 'pending', createdAt: now(),
      expiresAt: checkout.first.payment.expiresAt };
    await setDoc(col, id, intent);
    return intent;
  });
}
async function confirmPaid(runtime, transaction) {
  const c = pay.config(runtime);
  if (transaction.trade_state !== 'SUCCESS' || transaction.appid !== c.appid || transaction.mchid !== c.mchid
    || !transaction.transaction_id) throw errorFrom('PAYMENT_MISMATCH');
  const id = transaction.out_trade_no;
  return withTransaction(runtime.db, async (tx) => {
    const intent = await getDoc(tx.collection('payments'), id, true);
    if (intent.appid !== transaction.appid || intent.mchid !== transaction.mchid
      || transaction.amount?.total !== intent.total || transaction.amount?.currency !== 'CNY'
      || transaction.payer?.openid !== intent.openid) throw errorFrom('PAYMENT_MISMATCH');
    if (intent.status === 'paid') {
      if (intent.transactionId !== transaction.transaction_id) throw errorFrom('PAYMENT_MISMATCH');
      return intent;
    }
    if (intent.status === 'closed') throw errorFrom('PAYMENT_MISMATCH');
    const stamp = now();
    for (const key of intent.orderIds) {
      const order = await getDoc(tx.collection('orders'), key, true);
      if (order.status !== 'pending_payment' || order.userId !== intent.userId) throw errorFrom('ORDER_STATE_INVALID');
      await tx.collection('orders').doc(key).update({ status: 'paid', paymentStatus: 'paid',
        payment: { ...order.payment, status: 'paid', transactionId: transaction.transaction_id,
          tradeNo: id, checkoutTotal: intent.total, paidAt: transaction.success_time || stamp },
        paymentAmount: order.totalAmount, paidAt: transaction.success_time || stamp, updatedAt: stamp });
    }
    await tx.collection('payments').doc(id).update({ status: 'paid', transactionId: transaction.transaction_id, paidAt: stamp,
      shippingPending: true, shippingUpdatedAt: stamp });
    return { ...intent, status: 'paid' };
  });
}
async function releaseClosed(runtime, intent) {
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection('payments'), intent._id, true);
    if (current.status === 'closed') return;
    if (current.status !== 'pending') throw errorFrom('ORDER_STATE_INVALID');
    const stamp = now();
    for (const key of current.orderIds) {
      const order = await getDoc(tx.collection('orders'), key, true);
      if (order.status !== 'pending_payment') throw errorFrom('ORDER_STATE_INVALID');
      if (order.inventoryReserved) {
        for (const item of order.items) {
          const skuId = item.skuSnapshot?._id || item.skuId;
          const sku = await getDoc(tx.collection('skus'), skuId, true);
          await tx.collection('skus').doc(skuId).update({ stockQuantity: sku.stockQuantity + item.quantity,
            soldQuantity: Math.max(0, Number(sku.soldQuantity || 0) - item.quantity), updatedAt: stamp });
        }
      }
      await tx.collection('orders').doc(key).update({ status: 'closed', paymentStatus: 'unpaid',
        inventoryReserved: false, payment: { ...order.payment, status: 'closed' }, updatedAt: stamp });
    }
    await tx.collection('payments').doc(intent._id).update({ status: 'closed', closedAt: stamp });
  });
}
async function sync(runtime, intent) {
  if (intent.status !== 'pending') return intent;
  const c = pay.config(runtime);
  let result;
  try { result = await pay.api(runtime, 'GET', `/v3/pay/transactions/out-trade-no/${intent._id}?mchid=${c.mchid}`); }
  catch (error) {
    if (error.details?.providerCode !== 'ORDER_NOT_EXIST') throw error;
    if (Date.now() >= Date.parse(intent.expiresAt)) {
      // A late prepay uses the same, now expired time_expire and cannot create a payable order.
      await releaseClosed(runtime, intent); return { ...intent, status: 'closed' };
    }
    return intent;
  }
  if (result.trade_state === 'SUCCESS') return confirmPaid(runtime, result);
  if (result.trade_state === 'CLOSED') { await releaseClosed(runtime, intent); return { ...intent, status: 'closed' }; }
  if (Date.now() >= Date.parse(intent.expiresAt) && result.trade_state === 'NOTPAY') {
    await pay.api(runtime, 'POST', `/v3/pay/transactions/out-trade-no/${intent._id}/close`, { mchid: c.mchid });
    await releaseClosed(runtime, intent); return { ...intent, status: 'closed' };
  }
  return intent;
}
async function prepare(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  pay.assertReady(runtime);
  const checkout = await load(runtime, String(data.checkoutId || ''), identity.uid);
  if (checkout.first.payment?.mode !== 'wechat') throw errorFrom('ORDER_STATE_INVALID');
  let intent = await ensureIntent(runtime, identity, checkout);
  if (!Number.isSafeInteger(intent.total) || intent.total < 1) throw errorFrom('PAYMENT_MISMATCH');
  // Query before every retry; a client cancellation is never proof of nonpayment.
  intent = await sync(runtime, intent);
  if (intent.status === 'paid') return { paid: true, checkoutId: checkout.root };
  if (intent.status === 'closed' || Date.now() >= Date.parse(intent.expiresAt)) throw errorFrom('PAYMENT_EXPIRED');
  const c = pay.config(runtime);
  const result = await pay.api(runtime, 'POST', '/v3/pay/transactions/jsapi', {
    appid: c.appid, mchid: c.mchid, out_trade_no: intent._id,
    description: '商城商品订单', notify_url: c.notifyUrl, time_expire: intent.expiresAt,
    amount: { total: intent.total, currency: 'CNY' }, payer: { openid: intent.openid },
  });
  if (!result.prepay_id) throw errorFrom('PAYMENT_PROVIDER_ERROR');
  return { checkoutId: checkout.root, payment: pay.clientPayment(runtime, result.prepay_id) };
}
async function queryCheckout(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const checkout = await load(runtime, String(data.checkoutId || ''), identity.uid);
  if (checkout.first.payment?.mode === 'wechat') {
    const intent = await getDoc(runtime.db.collection('payments'), tradeId(checkout.root), false);
    if (intent) await sync(runtime, intent);
  }
}
async function refund(runtime, claim) {
  const order = await getDoc(runtime.db.collection('orders'), claim.orderId, true);
  const result = await pay.api(runtime, 'POST', '/v3/refund/domestic/refunds', {
    transaction_id: order.payment.transactionId, out_refund_no: claim._id,
    notify_url: pay.config(runtime).notifyUrl,
    amount: { refund: claim.amount, total: order.payment.checkoutTotal, currency: 'CNY' },
  });
  return applyRefund(runtime, result);
}
async function applyRefund(runtime, result) {
  const claim = await getDoc(runtime.db.collection('afterSales'), result.out_refund_no, true);
  const order = await getDoc(runtime.db.collection('orders'), claim.orderId, true);
  if (order.payment?.mode !== 'wechat' || result.transaction_id !== order.payment.transactionId
    || result.amount?.refund !== claim.amount || result.amount?.total !== order.payment.checkoutTotal
    || !result.refund_id) throw errorFrom('PAYMENT_MISMATCH');
  if ((result.status || result.refund_status) !== 'SUCCESS') {
    // Keep the reservation for PROCESSING/ABNORMAL/CLOSED until reviewed; never invent a successful refund.
    await runtime.db.collection('afterSales').doc(claim._id).update({ refundProviderStatus: result.status || result.refund_status,
      refundTransactionId: result.refund_id, updatedAt: now() });
    return { ...claim, refundProviderStatus: result.status || result.refund_status };
  }
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection('afterSales'), claim._id, true);
    const latest = await getDoc(tx.collection('orders'), current.orderId, true);
    return require('./shop').finishRefund(tx, current, latest, now(), { mode: 'wechat', transactionId: result.refund_id });
  });
}
async function notification(runtime, event) {
  try {
    const notice = pay.decodeNotification(runtime, event);
    if (notice.type === 'TRANSACTION.SUCCESS') await confirmPaid(runtime, notice.data);
    else if (['REFUND.SUCCESS', 'REFUND.ABNORMAL', 'REFUND.CLOSED'].includes(notice.type)) {
      if (notice.data.mchid !== pay.config(runtime).mchid) throw errorFrom('PAYMENT_MISMATCH');
      await applyRefund(runtime, notice.data);
    } else throw errorFrom('PAYMENT_MISMATCH');
    return { statusCode: 204, body: '' };
  } catch {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'FAIL', message: '通知校验或处理失败' }) };
  }
}
async function checkConfiguration(runtime) {
  const c = pay.config(runtime);
  const probe = `probe${crypto.randomBytes(12).toString('hex')}`;
  let providerVerified = false;
  try { await pay.api(runtime, 'GET', `/v3/pay/transactions/out-trade-no/${probe}?mchid=${c.mchid}`); }
  catch (error) {
    if (error.code === 'PAYMENT_PROVIDER_ERROR' && error.details?.providerCode === 'ORDER_NOT_EXIST') providerVerified = true;
    else throw error;
  }
  let shippingReady = false;
  try { shippingReady = (await require('./wechat-shipping').companies(runtime)).items.length > 0; }
  catch { /* Report capability readiness without revealing upstream payloads. */ }
  return { mode: pay.paymentMode(runtime), appid: c.appid, mchid: c.mchid, providerVerified, shippingReady,
    apiV3KeyLengthValid: Buffer.byteLength(c.apiV3Key) === 32 };
}
async function reconcile(runtime) {
  const deadline = Date.now() + 35000;
  // Only call from a configured timer, never by accepting event.action from an SDK caller.
  const pending = await runtime.db.collection('payments').where({ status: 'pending' }).orderBy('expiresAt', 'asc').limit(10).get();
  for (const item of require('./db').listData(pending)) {
    if (Date.now() >= deadline) break;
    try { await sync(runtime, item); } catch { /* Provider retries / next sweep. */ }
  }
  const refunds = await runtime.db.collection('afterSales').where({ refundMode: 'wechat', status: 'refunding' }).orderBy('updatedAt', 'asc').limit(10).get();
  for (const claim of require('./db').listData(refunds)) {
    if (Date.now() >= deadline) break;
    try { await applyRefund(runtime, await pay.api(runtime, 'GET', `/v3/refund/domestic/refunds/${encodeURIComponent(claim._id)}`)); }
    catch { /* Keep reservation and retry. */ }
  }
  const shipments = await runtime.db.collection('payments').where({ status: 'paid', shippingPending: true })
    .orderBy('shippingUpdatedAt', 'asc').limit(10).get();
  for (const intent of require('./db').listData(shipments)) {
    if (Date.now() >= deadline) break;
    try { await require('./wechat-shipping').sync(runtime, intent); }
    catch { /* Retain the queue until WeChat confirms the upload. */ }
    await runtime.db.collection('payments').doc(intent._id).update({ shippingUpdatedAt: now() });
  }
}
module.exports = { prepare, queryCheckout, confirmPaid, notification, refund, applyRefund, reconcile, checkConfiguration, load, tradeId, ensureIntent, sync };
