const { COLLECTIONS, ADMIN_ROLES, ADMIN_SCOPES } = require('./constants');
const { errorFrom } = require('./errors');
const { getDoc, listData } = require('./db');

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

async function findAdminMember(db, uid) {
  const collection = db.collection(COLLECTIONS.adminMembers);
  const byId = await getDoc(collection, uid, false);
  if (byId) return byId;
  const result = await collection.where({ uid }).limit(1).get();
  return listData(result)[0] || null;
}

async function requireAdmin(db, event, context, scope, runtime) {
  const identity = getIdentity(event, context) || getRuntimeIdentity(runtime);
  if (!identity) throw errorFrom('UNAUTHENTICATED');
  const member = await findAdminMember(db, identity.uid);
  const roles = member && (Array.isArray(member.roles) ? member.roles : [member.role]);
  const active = member && member.status !== 'disabled' && member.enabled !== false;
  const allowed = scope ? (ADMIN_SCOPES[scope] || []) : ADMIN_ROLES;
  if (!member || !active || !roles.some((role) => ADMIN_ROLES.includes(role) && allowed.includes(role))) {
    throw errorFrom('FORBIDDEN');
  }
  return { identity, member, roles: roles.filter(Boolean) };
}

module.exports = { getIdentity, getRuntimeIdentity, requireUser, findAdminMember, requireAdmin };
