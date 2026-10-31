// @ts-nocheck
const crypto = require('crypto');
const { getDoc, withTransaction } = require('./db');
const { errorFrom } = require('./errors');
const tokenCache = new Map();
const paths = {
  'express.delivery.openMsg.getDeliveryList': '/cgi-bin/express/delivery/open_msg/get_delivery_list',
  'order.uploadShippingInfo': '/wxa/sec/order/upload_shipping_info',
};

async function directApi(runtime, name, data) {
  const appid = runtime.wechatAppConfig?.appid || process.env.WECHAT_PAY_APPID;
  const secret = runtime.wechatAppConfig?.secret || process.env.WECHAT_APP_SECRET;
  const key = crypto.createHash('sha256').update(`${appid}:${secret}`).digest('hex');
  const request = async (path, body) => {
    try {
      const response = await (runtime.wechatFetch || fetch)(`https://api.weixin.qq.com${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: String(response.status) });
      return await response.json();
    } catch (error) {
      if (error.code === 'SHIPPING_SYNC_FAILED') throw error;
      // Fetch errors can contain URLs with the access token. Never surface or log them.
      throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: 'NETWORK_ERROR' });
    }
  };
  if (!paths[name]) throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: 'UNSUPPORTED_API' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let cached = tokenCache.get(key);
    if (!cached || cached.expires <= Date.now()) {
      const result = await request('/cgi-bin/stable_token', { grant_type: 'client_credential', appid, secret, force_refresh: false });
      if (!result.access_token || Number(result.errcode || 0)) {
        throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: String(result.errcode || 'NO_TOKEN') });
      }
      cached = { token: result.access_token, expires: Date.now() + Math.max(0, Number(result.expires_in || 0) - 120) * 1000 };
      if (tokenCache.size > 8) tokenCache.clear();
      tokenCache.set(key, cached);
    }
    const result = await request(`${paths[name]}?access_token=${encodeURIComponent(cached.token)}`, data);
    if ([40001, 40014, 42001].includes(Number(result.errcode)) && attempt === 0) { tokenCache.delete(key); continue; }
    if (Number(result.errcode || 0)) throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: String(result.errcode) });
    return result;
  }
}

async function openApi(runtime, name, data) {
  // HTTP admin calls and timers have no Mini Program invocation token.
  if (runtime.wechatAppConfig?.secret || process.env.WECHAT_APP_SECRET) return directApi(runtime, name, data);
  let response;
  try {
    // Match wx-server-sdk's current callOpenAPI transport for newer WeChat APIs.
    response = await runtime.app.callWxOpenApi({ apiName: name, cgiName: 'commrpcv2', requestData: data });
  } catch (error) {
    throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: String(error.code || error.errCode || error.name || 'UPSTREAM_ERROR').slice(0, 100) });
  }
  const result = response.result;
  if (response.code || !result || Number(result.errcode || 0) !== 0) {
    throw errorFrom('SHIPPING_SYNC_FAILED', { providerCode: String(response.code || result?.errcode || 'NO_RESULT') });
  }
  return result;
}
async function companies(runtime) {
  if (runtime.paymentMode === 'simulated' && Array.isArray(runtime.shippingCompanies)) {
    return { items: runtime.shippingCompanies };
  }
  const result = await openApi(runtime, 'express.delivery.openMsg.getDeliveryList', {});
  return { items: (result.delivery_list || []).map((item) => ({ value: item.delivery_id, label: item.delivery_name })) };
}
async function dirty(tx, order) {
  if (order.payment?.mode !== 'wechat') return;
  const id = order.payment.tradeNo || require('./payments').tradeId(order.checkoutId);
  await tx.collection('payments').doc(id).update({ shippingPending: true, shippingRevision: crypto.randomUUID(), shippingUpdatedAt: new Date().toISOString() });
}
function carrier(order, input) {
  const value = String(input || order.logistics?.expressCompany || '').trim();
  if (!value && order.payment?.mode !== 'wechat') return {};
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw errorFrom('INVALID_ARGUMENT', { field: 'expressCompany' });
  return { expressCompany: value };
}
async function sync(runtime, intent) {
  const orders = (await Promise.all(intent.orderIds.map((id) => getDoc(runtime.db.collection('orders'), id, false)))).filter(Boolean);
  const shipped = orders.filter((o) => ['shipped', 'received', 'completed'].includes(o.fulfillmentStatus || o.status));
  if (!shipped.length) {
    if (orders.length && orders.every((o) => o.status === 'refunded')) {
      await runtime.db.collection('payments').doc(intent._id).update({ shippingPending: false, shippingStatus: 'not_required' });
    }
    return { pending: true };
  }
  const packages = new Map();
  for (const order of shipped) {
    const tracking = order.logistics?.trackingNo || order.tracking?.trackingNo;
    const company = order.logistics?.expressCompany;
    if (!tracking || !company) throw errorFrom('SHIPPING_SYNC_FAILED');
    const key = `${company}:${tracking}`;
    const item = packages.get(key) || { tracking_no: tracking, express_company: company, item_desc: '' };
    const phone = require('./order-shipping').shippingAddressOf(order).phone.replace(/\D/g, '');
    if (phone.length >= 7) {
      item.contact = { receiver_contact: `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` };
    }
    item.item_desc = [item.item_desc, ...(order.items || []).map((i) => i.productSnapshot?.title || i.goodsName || '商品')].filter(Boolean).join('、').slice(0, 120);
    packages.set(key, item);
  }
  const complete = orders.every((o) => ['shipped', 'received', 'completed', 'refunded'].includes(o.status));
  const list = [...packages.values()];
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ list, complete })).digest('hex');
  const revision = intent.shippingRevision || '';
  if (fingerprint !== intent.shippingFingerprint) {
    await openApi(runtime, 'order.uploadShippingInfo', {
      order_key: { order_number_type: 2, transaction_id: intent.transactionId },
      logistics_type: 1, delivery_mode: 2, is_all_delivered: complete,
      shipping_list: list, upload_time: new Date().toISOString(), payer: { openid: intent.openid },
    });
  }
  await withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection('payments'), intent._id, true);
    if ((current.shippingRevision || '') !== revision) return;
    await tx.collection('payments').doc(intent._id).update({ shippingPending: !complete,
      shippingStatus: complete ? 'synced' : 'partial', shippingFingerprint: fingerprint,
      shippingSyncedAt: new Date().toISOString() });
  });
  return { pending: !complete };
}
async function syncResult(runtime, result) {
  const orders = result.payment ? [result] : result.items || [];
  const roots = [...new Set(orders.filter((o) => o.payment?.mode === 'wechat').map((o) => o.payment.tradeNo || require('./payments').tradeId(o.checkoutId)))];
  const pending = [];
  for (const id of roots) {
    try {
      const intent = await getDoc(runtime.db.collection('payments'), id, true);
      if ((await sync(runtime, intent)).pending) pending.push(id);
    } catch { pending.push(id); }
  }
  return roots.length ? { ...result, shippingSyncPending: pending.length > 0 } : result;
}
module.exports = { companies, dirty, carrier, sync, syncResult };
