// @ts-nocheck
const crypto = require('crypto');
const { errorFrom } = require('./errors');
function tokenMatches(value) {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || expected.length < 32 || typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(runtime) {
  if (runtime.localStorage === true) return;
  if ((process.env.ADMIN_API_TOKEN || require('./wechat-pay').paymentMode(runtime) === 'wechat') && !runtime.adminAuthorized) {
    throw errorFrom('ADMIN_AUTH_REQUIRED');
  }
}
module.exports = { tokenMatches, requireAdmin };
