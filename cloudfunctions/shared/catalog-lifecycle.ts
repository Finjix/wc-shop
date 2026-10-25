// @ts-nocheck
const { all, list, getDoc, setDoc, withTransaction } = require('./db');
const { imageLifecycleRuntime, cleanupQueue, compactDeletedStates } = require('./image-lifecycle');
const { errorFrom } = require('./errors');
const CONTROL = '__image_cleanup_control';

function references(value, skuIds, productIds) {
  if (Array.isArray(value)) { value.forEach((entry) => references(entry, skuIds, productIds)); return; }
  if (!value || typeof value !== 'object') return;
  if (value.skuId) skuIds.add(String(value.skuId));
  if (value.skuSnapshot?._id) skuIds.add(String(value.skuSnapshot._id));
  if (value.productId) productIds.add(String(value.productId));
  Object.values(value).forEach((entry) => { if (entry && typeof entry === 'object') references(entry, skuIds, productIds); });
}

// Deleted catalog rows are durable work items. Preserve inventory rows as long
// as an order or a live payment can still need a refund/release; snapshots alone
// are sufficient for display but cannot replace the inventory ledger.
async function purgeDeletedCatalog(input, deadline = Date.now() + 10000) {
  const runtime = imageLifecycleRuntime(input), db = runtime.db;
  const [products, skus] = await Promise.all(['products', 'skus'].map(async (source) => {
    const key = `__image_catalog_${source}`, settings = db.collection('settings');
    const read = (cursor) => list(db.collection(source), {
      where: { deletedByAdmin: true, ...(cursor && db.command?.gt ? { _id: db.command.gt(cursor) } : {}) },
      limit: 25, orderBy: { field: '_id', direction: 'asc' }, includeTotal: false,
    });
    const firstPage = await read();
    const paginated = firstPage.items.length === 25;
    const state = paginated ? await getDoc(settings, key, false) : null;
    let rows = state?.cursor ? await read(state.cursor) : firstPage;
    if (!rows.items.length) rows = firstPage;
    if (paginated && rows.items.length && rows.items.at(-1)._id !== state?.cursor) {
      await setDoc(settings, key, { cursor: rows.items.at(-1)._id });
    }
    return rows;
  }));
  if (!products.items.length && !skus.items.length) return { products: 0, skus: 0, retained: 0 };
  const carts = await all(db.collection('carts'));
  const removedSkus = new Set(skus.items.flatMap((sku) => [sku._id, sku.skuId].filter(Boolean).map(String)));
  const removedProducts = new Set(products.items.flatMap((product) => [product._id, product.spuId].filter(Boolean).map(String)));
  for (const cart of carts) {
    if (Date.now() >= deadline) return { pending: true };
    if (!(cart.items || []).some((item) => removedSkus.has(String(item.skuId)) || removedProducts.has(String(item.productId)))) continue;
    await withTransaction(db, async (tx) => {
      const ref = tx.collection('carts'), current = await getDoc(ref, cart._id, false);
      if (!current) return;
      const items = (current.items || []).filter((item) => !removedSkus.has(String(item.skuId)) && !removedProducts.has(String(item.productId)));
      if (!items.length) await ref.doc(cart._id).remove();
      else await setDoc(ref, cart._id, { ...current, items, updatedAt: new Date().toISOString() });
    });
  }
  // A payment callback can materialize orders while its payment disappears
  // from the pending query. Fence both scans and each purge against that race,
  // including orders that only contain external or empty image references.
  let version = (await getDoc(db.collection('settings'), CONTROL, false))?.version || 0;
  const [orders, payments] = await Promise.all([
    all(db.collection('orders')), all(db.collection('payments'), { status: 'pending' }),
  ]);
  const requiredSkus = new Set(), requiredProducts = new Set();
  orders.forEach((order) => references(order.items, requiredSkus, requiredProducts));
  payments.forEach((payment) => references(payment.draftOrders, requiredSkus, requiredProducts));
  const checkFence = async (tx) => {
    if (((await getDoc(tx.collection('settings'), CONTROL, false))?.version || 0) !== version) throw errorFrom('CONFLICT');
  };
  await checkFence(db);
  const result = { products: 0, skus: 0, retained: 0 };
  for (const sku of skus.items) {
    if (Date.now() >= deadline) return { ...result, pending: true };
    if (requiredSkus.has(String(sku._id)) || requiredSkus.has(String(sku.skuId))) {
      result.retained++;
      continue;
    }
    const purged = await withTransaction(db, async (tx) => {
      await checkFence(tx);
      const current = await getDoc(tx.collection('skus'), sku._id, false);
      if (current?.deletedByAdmin) await tx.collection('skus').doc(sku._id).remove();
      return { removed: Boolean(current?.deletedByAdmin), version: (await getDoc(tx.collection('settings'), CONTROL, false))?.version || 0 };
    });
    version = purged.version;
    if (purged.removed) result.skus++;
  }
  for (const product of products.items) {
    if (Date.now() >= deadline) return { ...result, pending: true };
    const remaining = await list(db.collection('skus'), { where: { productId: product._id }, limit: 1, includeTotal: false });
    if (remaining.items.length || requiredProducts.has(String(product._id))) { result.retained++; continue; }
    const purged = await withTransaction(db, async (tx) => {
      await checkFence(tx);
      const current = await getDoc(tx.collection('products'), product._id, false);
      if (current?.deletedByAdmin) await tx.collection('products').doc(product._id).remove();
      return { removed: Boolean(current?.deletedByAdmin), version: (await getDoc(tx.collection('settings'), CONTROL, false))?.version || 0 };
    });
    version = purged.version;
    if (purged.removed) result.products++;
  }
  return result;
}

async function sweep(input) {
  const runtime = imageLifecycleRuntime(input), deadline = Date.now() + 45000;
  const catalog = await purgeDeletedCatalog(runtime, Date.now() + 10000);
  const result = { catalog, deleted: 0, retained: 0, pending: 0 };
  for (let batch = 0; batch < 25 && Date.now() + 22000 < deadline; batch++) {
    const response = await cleanupQueue(runtime);
    result.deleted += response.deleted.length;
    result.retained += response.retained.length;
    result.pending += response.pending?.length || 0;
    if (!response.deleted.length && !response.retained.length) break;
  }
  return { ...result, compacted: Date.now() + 5000 < deadline ? await compactDeletedStates(runtime) : 0 };
}

module.exports = { purgeDeletedCatalog, sweep };
