// @ts-nocheck
const crypto = require('crypto');
const { errorFrom } = require('./errors');

function paymentMode(runtime) { return runtime.paymentMode || process.env.WECHAT_PAY_MODE || 'disabled'; }
function config(runtime) {
  const env = process.env;
  const c = runtime.wechatPayConfig || {
    appid: env.WECHAT_PAY_APPID, mchid: env.WECHAT_PAY_MCHID,
    serial: env.WECHAT_PAY_SERIAL_NO, privateKey: env.WECHAT_PAY_PRIVATE_KEY,
    apiV3Key: env.WECHAT_PAY_API_V3_KEY, publicKey: env.WECHAT_PAY_PUBLIC_KEY,
    publicKeyId: env.WECHAT_PAY_PUBLIC_KEY_ID, notifyUrl: env.WECHAT_PAY_NOTIFY_URL,
  };
  if (['appid', 'mchid', 'serial', 'privateKey', 'apiV3Key', 'publicKey', 'publicKeyId', 'notifyUrl'].some((k) => !c[k])
    || Buffer.byteLength(c.apiV3Key) !== 32 || !/^https:\/\//.test(c.notifyUrl)) throw errorFrom('PAYMENT_NOT_CONFIGURED');
  return { ...c, privateKey: c.privateKey.replace(/\\n/g, '\n'), publicKey: c.publicKey.replace(/\\n/g, '\n') };
}
function sign(c, message) { return crypto.sign('RSA-SHA256', Buffer.from(message), c.privateKey).toString('base64'); }
function verify(c, headers, body) {
  const header = (name) => typeof headers.get === 'function' ? headers.get(name)
    : Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  const timestamp = header('Wechatpay-Timestamp'), nonce = header('Wechatpay-Nonce');
  const signature = header('Wechatpay-Signature'), serial = header('Wechatpay-Serial');
  if (!/^\d+$/.test(String(timestamp || '')) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    || !nonce || !signature || serial !== c.publicKeyId
    || !crypto.verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${body}\n`), c.publicKey, Buffer.from(signature, 'base64'))) {
    throw errorFrom('PAYMENT_SIGNATURE_INVALID');
  }
}
async function api(runtime, method, path, payload) {
  const c = config(runtime), body = payload === undefined ? '' : JSON.stringify(payload);
  const nonce = crypto.randomBytes(16).toString('hex'), timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(c, `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
  const response = await (runtime.paymentFetch || fetch)(`https://api.mch.weixin.qq.com${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${c.serial}",signature="${signature}"` },
    ...(body ? { body } : {}),
  });
  const raw = await response.text();
  // Verify success and error responses before using any returned values.
  verify(c, response.headers, raw);
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    // Never expose request bodies, keys, openids, addresses or upstream messages.
    throw errorFrom('PAYMENT_PROVIDER_ERROR', { providerCode: String(data.code || response.status),
      requestId: response.headers.get('Request-ID') || '' });
  }
  return data;
}
function clientPayment(runtime, prepayId) {
  const c = config(runtime), timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex'), pkg = `prepay_id=${prepayId}`;
  return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign: sign(c, `${c.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`) };
}
function decodeNotification(runtime, event) {
  if (event.httpMethod !== 'POST' || typeof event.body !== 'string') throw errorFrom('PAYMENT_SIGNATURE_INVALID');
  const c = config(runtime);
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  verify(c, event.headers || {}, raw);
  const envelope = JSON.parse(raw), resource = envelope.resource;
  if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') throw errorFrom('PAYMENT_SIGNATURE_INVALID');
  const encrypted = Buffer.from(resource.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(c.apiV3Key), Buffer.from(resource.nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data || ''));
  const data = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
  return { type: envelope.event_type, data };
}
function assertReady(runtime) {
  const mode = paymentMode(runtime);
  if (mode === 'simulated' && (runtime.localStorage === true || runtime.allowSimulatedPayments === true)) return mode;
  if (mode !== 'wechat') throw errorFrom('PAYMENT_NOT_CONFIGURED');
  config(runtime);
  // A public admin API cannot be allowed to issue real refunds or alter amounts.
  if (!process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_TOKEN.length < 32) throw errorFrom('PAYMENT_NOT_CONFIGURED');
  return mode;
}
module.exports = { paymentMode, config, api, clientPayment, decodeNotification, verify, assertReady };
