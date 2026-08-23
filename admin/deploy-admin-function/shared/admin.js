const { COLLECTIONS, STATUS, ORDER_STATUS, AFTER_SALE_STATUS } = require('./constants');
const { errorFrom } = require('./errors');
const { requireAdmin } = require('./auth');
const { getDoc, list, affected, withTransaction } = require('./db');
const { getTempFileURLs } = require('./storage');
const { assert, string, optionalString, integer, page, clone } = require('./validation');
const { skuStock } = require('./shop');

function now() { return new Date().toISOString(); }
function col(runtime, name) { return runtime.db.collection(name); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function allowedFields(source, fields) {
  const input = source || {};
  return fields.reduce((out, field) => {
    if (input[field] !== undefined) out[field] = clone(input[field]);
    return out;
  }, {});
}

function listOptions(data, baseWhere) {
  const paging = page(data);
  return {
    where: baseWhere,
    orderBy: { field: data.orderBy || 'updatedAt', direction: data.direction === 'asc' ? 'asc' : 'desc' },
    skip: (paging.page - 1) * paging.pageSize,
    limit: paging.pageSize,
    paging,
  };
}

async function listCollection(runtime, name, data, where) {
  const options = listOptions(data, where);
  const result = await list(col(runtime, name), options);
  return { items: result.items, page: options.paging.page, pageSize: options.paging.pageSize, total: result.total === undefined ? result.items.length : result.total };
}

function statusValue(value, fallback) {
  return value === undefined ? fallback : string(value, 'status', { max: 40 });
}

async function catalogAction(runtime, data, action) {
  const name = action.startsWith('categories.') ? COLLECTIONS.categories : action.startsWith('products.') ? COLLECTIONS.products : COLLECTIONS.skus;
  const entity = action.split('.')[0];
  const collection = col(runtime, name);
  if (action.endsWith('.list')) {
    const where = {};
    if (data.status) where.status = string(data.status, 'status', { max: 40 });
    if (data.productId || data.spuId) where.productId = string(data.productId || data.spuId, 'productId', { max: 128 });
    if (data.categoryId) where.categoryIds = string(data.categoryId, 'categoryId', { max: 128 });
    const keyword = data.query ? string(data.query, 'query', { max: 80 }) : '';
    if (keyword && typeof runtime.db.RegExp === 'function') {
      const field = entity === 'skus' ? 'skuId' : entity === 'products' ? 'title' : 'name';
      where[field] = runtime.db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
    }
    const result = await listCollection(runtime, name, data, where);
    if (keyword && typeof runtime.db.RegExp !== 'function') {
      const lowered = keyword.toLowerCase();
      result.items = result.items.filter((item) => `${item.title || ''} ${item.name || ''} ${item.skuId || ''} ${item.spuId || ''}`.toLowerCase().includes(lowered));
      result.total = result.items.length;
    }
    if (entity === 'products') result.items = result.items.map((item) => ({ ...item, isPutOnSale: item.status === STATUS.active }));
    if (entity === 'categories') result.items = result.items.map((item) => ({ ...item, enabled: item.status === STATUS.active }));
    if (entity === 'skus') result.items = result.items.map((item) => ({ ...item, price: item.price ?? item.salePrice }));
    return result;
  }
  if (action.endsWith('.get')) {
    const id = string(data[`${entity.slice(0, -1)}Id`] || data.id || data.spuId || data.skuId, 'id', { max: 128 });
    return getDoc(collection, id, true);
  }
  if (action.endsWith('.create')) {
    const timestamp = now();
    let item;
    if (entity === 'categories') item = { ...allowedFields(data, ['name', 'parentId', 'level', 'sort', 'icon', 'description']), status: statusValue(data.status, STATUS.active) };
    else if (entity === 'products') item = { ...allowedFields(data, ['spuId', 'title', 'subtitle', 'primaryImage', 'images', 'detailImages', 'categoryIds', 'sort', 'minSalePrice', 'maxSalePrice', 'minLinePrice', 'maxLinePrice', 'tags', 'description']), status: statusValue(data.status, STATUS.active) };
    else item = { ...allowedFields(data, ['skuId', 'productId', 'spuId', 'specInfo', 'skuImage', 'salePrice', 'linePrice', 'stockQuantity', 'weight', 'volume', 'soldQuantity']), status: statusValue(data.status, STATUS.active), stockQuantity: integer(data.stockQuantity === undefined ? 0 : data.stockQuantity, 'stockQuantity', { min: 0 }), soldQuantity: integer(data.soldQuantity === undefined ? 0 : data.soldQuantity, 'soldQuantity', { min: 0 }) };
    item.createdAt = timestamp;
    item.updatedAt = timestamp;
    const result = await collection.add(item);
    item._id = result.id || result._id;
    return item;
  }
  const id = string(data[`${entity.slice(0, -1)}Id`] || data.id || data.spuId || data.skuId, 'id', { max: 128 });
  const existing = await getDoc(collection, id, true);
  if (action.endsWith('.delete')) {
    await collection.doc(id).update({ status: STATUS.inactive, updatedAt: now() });
    return { ...existing, status: STATUS.inactive, _id: id };
  }
  if (!action.endsWith('.update')) throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const fields = entity === 'categories'
    ? ['name', 'parentId', 'level', 'sort', 'icon', 'description', 'status']
    : entity === 'products'
      ? ['spuId', 'title', 'subtitle', 'primaryImage', 'images', 'detailImages', 'categoryIds', 'sort', 'minSalePrice', 'maxSalePrice', 'minLinePrice', 'maxLinePrice', 'tags', 'description', 'status']
      : ['skuId', 'productId', 'spuId', 'specInfo', 'skuImage', 'salePrice', 'linePrice', 'stockQuantity', 'weight', 'volume', 'soldQuantity', 'status'];
  const patch = allowedFields(data, fields);
  if (patch.status) patch.status = statusValue(patch.status);
  if (entity === 'skus' && patch.stockQuantity !== undefined) patch.stockQuantity = integer(patch.stockQuantity, 'stockQuantity', { min: 0 });
  patch.updatedAt = now();
  await collection.doc(id).update(patch);
  return { ...existing, ...patch, _id: id };
}

async function inventoryAdjust(runtime, data) {
  const skuId = string(data.skuId, 'skuId', { max: 128 });
  const delta = data.delta === undefined ? undefined : integer(data.delta, 'delta', { min: -1000000, max: 1000000 });
  const target = data.stockQuantity === undefined ? undefined : integer(data.stockQuantity, 'stockQuantity', { min: 0, max: 100000000 });
  assert(delta !== undefined || target !== undefined, { field: 'delta|stockQuantity' });
  const direct = await getDoc(col(runtime, COLLECTIONS.skus), skuId, false);
  const fallback = direct ? null : await col(runtime, COLLECTIONS.skus).where({ skuId }).limit(1).get();
  const resolved = direct || fallback?.data?.[0];
  if (!resolved) throw errorFrom('NOT_FOUND');
  const documentId = resolved._id || skuId;
  return withTransaction(runtime.db, async (tx) => {
    const sku = await getDoc(tx.collection(COLLECTIONS.skus), documentId, true);
    const current = skuStock(sku);
    const next = target === undefined ? current + delta : target;
    if (next < 0) throw errorFrom('OUT_OF_STOCK');
    const update = { stockQuantity: next, updatedAt: now() };
    const result = await tx.collection(COLLECTIONS.skus).doc(documentId).update(update);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...sku, ...update, stockQuantity: next, _id: documentId };
  });
}

async function homeAction(runtime, data, action) {
  const home = col(runtime, COLLECTIONS.homeContents);
  if (action === 'home.list') return listCollection(runtime, COLLECTIONS.homeContents, data, data.status ? { status: string(data.status, 'status', { max: 40 }) } : {});
  const keySource = data.contentId || data.id || data.slot || (action !== 'home.get' ? `home_${Date.now()}` : undefined);
  const key = string(keySource, 'contentId', { max: 128 });
  const existing = await getDoc(home, key, false);
  if (action === 'home.get') return existing || (() => { throw errorFrom('NOT_FOUND'); })();
  const patch = { ...allowedFields(data, ['slot', 'type', 'title', 'subtitle', 'content', 'image', 'link', 'payload', 'sort', 'status']), updatedAt: now() };
  if (!existing) {
    const item = { _id: key, ...patch, status: statusValue(patch.status, STATUS.active), createdAt: now() };
    await home.doc(key).set(item);
    return item;
  }
  await home.doc(key).update(patch);
  return { ...existing, ...patch, _id: key };
}

function nextOrderStatus(current, next) {
  if (!ORDER_STATUS.includes(next)) throw errorFrom('ORDER_STATE_INVALID');
  const transitions = {
    [STATUS.pendingPayment]: [STATUS.paid, STATUS.cancelled],
    [STATUS.paid]: [STATUS.shipped],
    [STATUS.shipped]: [STATUS.received],
    [STATUS.received]: [STATUS.completed],
  };
  if (!(transitions[current] || []).includes(next)) throw errorFrom('ORDER_STATE_INVALID');
  return next;
}

async function adminOrderAction(runtime, data, action) {
  const orders = col(runtime, COLLECTIONS.orders);
  if (action === 'orders.list') {
    const where = data.status ? { status: string(data.status, 'status', { max: 40 }) } : {};
    if (data.userId) where.userId = string(data.userId, 'userId', { max: 128 });
    if (data.orderNo) where.orderNo = string(data.orderNo, 'orderNo', { max: 128 });
    return listCollection(runtime, COLLECTIONS.orders, data, where);
  }
  const id = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
  const direct = await getDoc(orders, id, false);
  const fallback = direct ? null : await orders.where({ orderNo: id }).limit(1).get();
  const order = direct || fallback?.data?.[0];
  if (!order) throw errorFrom('NOT_FOUND');
  const documentId = order._id || id;
  if (action === 'orders.get') return order;
  if (action === 'orders.logistics.save') {
    const logistics = {
      ...allowedFields(data, ['logisticsCompanyName', 'logisticsCompanyCode', 'logisticsNo', 'remark']),
      companyName: data.logisticsCompanyName || '',
      trackingNo: data.logisticsNo || '',
    };
    const patch = {
      logistics,
      tracking: {
        carrier: logistics.logisticsCompanyName || '',
        trackingNo: logistics.logisticsNo || '',
        shippedAt: order.tracking?.shippedAt || now(),
      },
      updatedAt: now(),
    };
    await orders.doc(documentId).update(patch);
    return { ...order, ...patch, _id: documentId };
  }
  if (action !== 'orders.updateStatus' && action !== 'orders.ship' && action !== 'orders.cancel') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const next = action === 'orders.ship' ? STATUS.shipped : action === 'orders.cancel' ? STATUS.cancelled : string(data.status, 'status', { max: 40 });
  nextOrderStatus(order.status, next);
  if (next !== STATUS.cancelled) {
    const patch = { status: next, updatedAt: now() };
    if (next === STATUS.paid) {
      patch.paymentStatus = 'paid';
      patch.paidAt = now();
    }
    if (next === STATUS.shipped) patch.shippedAt = now();
    if (next === STATUS.received) patch.receivedAt = now();
    if (next === STATUS.completed) patch.completedAt = now();
    if (data.tracking) patch.tracking = allowedFields(data.tracking, ['carrier', 'trackingNo', 'shippedAt']);
    const result = await orders.doc(documentId).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...order, ...patch, _id: documentId };
  }
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(COLLECTIONS.orders), documentId, true);
    nextOrderStatus(current.status, STATUS.cancelled);
    for (const item of current.items || []) {
      const skuDocumentId = item.skuSnapshot?._id || item.skuId;
      const sku = await getDoc(tx.collection(COLLECTIONS.skus), skuDocumentId, true);
      const result = await tx.collection(COLLECTIONS.skus).doc(skuDocumentId).update({
        stockQuantity: skuStock(sku) + item.quantity,
        soldQuantity: Math.max(0, Number(sku.soldQuantity || 0) - Number(item.quantity || 0)),
        updatedAt: now(),
      });
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
    }
    const patch = { status: STATUS.cancelled, inventoryReserved: false, cancelledAt: now(), updatedAt: now() };
    const result = await tx.collection(COLLECTIONS.orders).doc(documentId).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...current, ...patch, _id: documentId };
  });
}

async function usersAction(runtime, data, action) {
  const users = col(runtime, COLLECTIONS.users);
  if (action === 'users.list') {
    const where = data.uid ? { uid: string(data.uid, 'uid', { max: 128 }) } : {};
    return listCollection(runtime, COLLECTIONS.users, data, where);
  }
  const id = string(data.uid || data.userId, 'uid', { max: 128 });
  const existing = await getDoc(users, id, true);
  if (action === 'users.get') return existing;
  if (action !== 'users.update') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const patch = { ...allowedFields(data, ['nickname', 'avatarUrl', 'status', 'note']), updatedAt: now() };
  await users.doc(existing._id || id).update(patch);
  return { ...existing, ...patch, _id: existing._id || id };
}

async function addressesAction(runtime, data) {
  const where = data.userId ? { userId: string(data.userId, 'userId', { max: 128 }) } : {};
  const result = await listCollection(runtime, COLLECTIONS.addresses, data, where);
  result.items = result.items.map((item) => ({
    ...item,
    uid: item.uid || item.userId,
    name: item.name || item.receiver,
    detail: item.detail || item.address,
  }));
  return result;
}

async function dashboardSummary(runtime) {
  const names = [COLLECTIONS.products, COLLECTIONS.orders, COLLECTIONS.users, COLLECTIONS.comments, COLLECTIONS.afterSales];
  const entries = await Promise.all(names.map((name) => list(col(runtime, name), {})));
  const [products, orders, users, comments, afterSales] = entries.map((entry) => entry.items);
  return {
    metrics: {
      productCount: products.length,
      orderCount: orders.length,
      userCount: users.length,
      commentCount: comments.length,
      afterSaleCount: afterSales.length,
      pendingOrderCount: orders.filter((order) => order.status === STATUS.pendingPayment).length,
    },
  };
}

async function moderationAction(runtime, data, action, name) {
  const collection = col(runtime, name);
  if (action.endsWith('.list')) {
    const where = {};
    if (data.status) where.status = string(data.status, 'status', { max: 40 });
    if (data.productId) where.productId = string(data.productId, 'productId', { max: 128 });
    if (data.userId) where.userId = string(data.userId, 'userId', { max: 128 });
    const result = await listCollection(runtime, name, data, where);
    if (name === COLLECTIONS.comments) result.items = result.items.map((item) => ({ ...item, score: item.score ?? item.rating, commentScore: item.commentScore ?? item.rating, commentContent: item.commentContent ?? item.content, orderNo: item.orderNo || item.orderId }));
    if (name === COLLECTIONS.afterSales) result.items = result.items.map((item) => ({ ...item, afterSaleNo: item.afterSaleNo || item.rightsNo || item._id, orderNo: item.orderNo || item.orderId }));
    return result;
  }
  const id = string(data.commentId || data.afterSaleId || data.id, 'id', { max: 128 });
  const existing = await getDoc(collection, id, true);
  if (action.endsWith('.get')) return existing;
  if (action.endsWith('.delete')) {
    await collection.doc(id).update({ status: STATUS.inactive, updatedAt: now() });
    return { ...existing, status: STATUS.inactive, _id: id };
  }
  if (!action.endsWith('.updateStatus')) throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const allowed = name === COLLECTIONS.comments ? [STATUS.pendingReview, STATUS.active, STATUS.rejected, STATUS.inactive] : AFTER_SALE_STATUS;
  const status = string(data.status, 'status', { max: 40 });
  if (!allowed.includes(status)) throw errorFrom('INVALID_ARGUMENT', { field: 'status' });
  const patch = { status, ...(data.reply !== undefined ? { reply: optionalString(data.reply, 'reply', { max: 2000 }) } : {}), updatedAt: now() };
  await collection.doc(id).update(patch);
  return { ...existing, ...patch, _id: id };
}

async function settingsAction(runtime, data, action) {
  const settings = col(runtime, COLLECTIONS.settings);
  if (action === 'settings.list') return listCollection(runtime, COLLECTIONS.settings, data, {});
  if (action === 'settings.get' && !data.key) {
    const result = await list(settings, {});
    const global = result.items.find((item) => item.key === 'global' || item._id === 'global');
    return global ? (global.value || {}) : {};
  }
  const key = string(data.key, 'key', { max: 128 });
  const existing = await getDoc(settings, key, false);
  if (action === 'settings.get') {
    if (!existing) throw errorFrom('NOT_FOUND');
    return existing;
  }
  if (action !== 'settings.upsert') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const item = { _id: key, key, value: clone(data.value), description: optionalString(data.description, 'description', { max: 240 }) || '', updatedAt: now() };
  if (existing) await settings.doc(key).update(item);
  else await settings.doc(key).set({ ...item, createdAt: now() });
  return item;
}

function scopeFor(action) {
  if (action.startsWith('products.') || action.startsWith('categories.') || action.startsWith('skus.') || action === 'inventory.adjust') return 'catalog';
  if (action.startsWith('orders.')) return 'orders';
  if (action.startsWith('users.')) return 'users';
  if (action.startsWith('home.')) return 'content';
  if (action.startsWith('settings.')) return 'settings';
  if (action.startsWith('comments.') || action.startsWith('afterSales.')) return 'orders';
  return 'read';
}

function normalizeAdminAction(action, data) {
  let nextAction = action;
  let nextData = { ...(data || {}) };
  if (action === 'admin.me') nextAction = 'auth.me';
  if (action === 'dashboard.summary') return { action: 'dashboard.summary', data: nextData };
  if (action === 'products.save') {
    nextAction = nextData.id || nextData.productId || nextData.spuId ? 'products.update' : 'products.create';
    nextData = { ...nextData, status: nextData.status || (nextData.isPutOnSale === false ? STATUS.inactive : STATUS.active) };
    if (nextData.categoryIds === undefined && nextData.categoryId) nextData.categoryIds = [String(nextData.categoryId)];
  }
  if (action === 'categories.save') nextAction = nextData.id || nextData.categoryId ? 'categories.update' : 'categories.create';
  if (action === 'inventory.update') nextAction = 'inventory.adjust';
  if (action === 'orders.detail') nextAction = 'orders.get';
  if (action === 'homeContent.list') nextAction = 'home.list';
  if (action === 'homeContent.save') nextAction = 'home.upsert';
  if (action === 'comments.moderate') {
    nextAction = 'comments.updateStatus';
    if (nextData.status === 'approved') nextData.status = STATUS.active;
  }
  if (action === 'afterSales.review') nextAction = 'afterSales.updateStatus';
  if (action === 'settings.save') {
    nextAction = 'settings.upsert';
    nextData = { key: nextData.key || 'global', value: nextData.settings ?? nextData.value ?? {} };
  }
  return { action: nextAction, data: nextData };
}

async function adminEndpoint(event, context, runtime, action, data) {
  const normalized = normalizeAdminAction(action, data);
  action = normalized.action;
  data = normalized.data;
  const auth = await requireAdmin(runtime.db, event, context, scopeFor(action), runtime);
  if (action === 'dashboard.summary') return dashboardSummary(runtime);
  if (action === 'auth.me') return { uid: auth.identity.uid, roles: auth.roles, member: auth.member };
  if (action === 'storage.tempUrls') return getTempFileURLs(runtime, data.fileList);
  if (action.startsWith('categories.') || action.startsWith('products.') || action.startsWith('skus.')) return catalogAction(runtime, data, action);
  if (action === 'inventory.adjust') return inventoryAdjust(runtime, data);
  if (action.startsWith('home.')) return homeAction(runtime, data, action);
  if (action.startsWith('orders.')) return adminOrderAction(runtime, data, action);
  if (action.startsWith('users.')) return usersAction(runtime, data, action);
  if (action === 'addresses.list') return addressesAction(runtime, data);
  if (action.startsWith('comments.')) return moderationAction(runtime, data, action, COLLECTIONS.comments);
  if (action.startsWith('afterSales.')) return moderationAction(runtime, data, action, COLLECTIONS.afterSales);
  if (action.startsWith('settings.')) return settingsAction(runtime, data, action);
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

module.exports = { adminEndpoint, scopeFor };
