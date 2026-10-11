// @ts-nocheck

const { errorFrom } = require('./errors');

function getIdentity(event, context) {
  const ctx = context && context.auth;
  const ctxUser = context && context.userInfo;
  const uid = (ctx && (ctx.uid || ctx.openId || ctx.openid || ctx.userId))
    || (ctxUser && (ctxUser.uid || ctxUser.openId || ctxUser.openid || ctxUser.userId));
  return uid ? { uid: String(uid), raw: ctx || ctxUser } : null;
}

function getRuntimeIdentity(runtime) {
  try {
    const auth = runtime && (runtime.auth || (runtime.app && runtime.app.auth && runtime.app.auth()));
    const userInfo = auth && typeof auth.getUserInfo === 'function' ? auth.getUserInfo() : null;
    const uid = userInfo && (userInfo.uid || userInfo.customUserId || userInfo.openId || userInfo.openid);
    return uid ? { uid: String(uid), raw: userInfo } : null;
  } catch (error) {
    return null;
  }
}

function requireUser(event, context, runtime) {
  const identity = getIdentity(event, context) || getRuntimeIdentity(runtime);
  if (!identity) throw errorFrom('UNAUTHENTICATED');
  return identity;
}

module.exports = { getIdentity, getRuntimeIdentity, requireUser };
