// @ts-nocheck

const crypto = require('crypto');
const { COLLECTIONS, STATUS, ORDER_STATUS, AFTER_SALE_STATUS } = require('./constants');
const { errorFrom } = require('./errors');
const { requireAdmin } = require('./auth');
const { getDoc, setDoc, list, all, count, affected, withTransaction } = require('./db');
const { getTempFileURLs } = require('./storage');
const { processStagedImage } = require('./image-upload');
const { imageLifecycleRuntime, referencePage, cleanup, replaceReference } = require('./image-lifecycle');
const { assert, string, optionalString, integer, page, clone } = require('./validation');
const { skuPrice, skuStock, moderateAfterSale, confirmAfterSaleReturn } = require('./shop');
const { HOME_CONFIG_SLOT, validateHomeConfig, productIds: homeProductIds } = require('./home-config');
const { shippingAddressOf, shippingGroupKey } = require('./order-shipping');

async function findProduct(collection, id) {
  return getDoc(collection, id, false);
}

async function clearHomeProductLinks(tx, product, id, timestamp) {
  const home = tx.collection(COLLECTIONS.homeContents);
  const config = await getDoc(home, HOME_CONFIG_SLOT, false);
  if (!config?.payload) return;
  const ids = new Set([id, product._id].filter(Boolean).map(String));
  const payload = clone(config.payload);
  let changed = false;
  for (const item of [...(payload.banners || []), ...(payload.promos || [])]) {
    if (ids.has(String(item.productId || ''))) {
      item.productId = '';
      changed = true;
    }
  }
  for (const section of payload.sections || []) {
    section.productIds = (section.productIds || []).map((productId) => {
      if (!ids.has(String(productId))) return productId;
      changed = true;
      return '';
    });
  }
  if (changed) await home.doc(HOME_CONFIG_SLOT).update({ payload, updatedAt: timestamp });
}

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

function withoutSkuStatus(value) {
  if (!value) return value;
  const { status, ...sku } = value;
  return sku;
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

async function syncProductPrices(runtime, sku) {
  const reference = sku?.productId;
  if (!reference) return;
  const products = col(runtime, COLLECTIONS.products);
  const product = await getDoc(products, String(reference), false);
  if (!product) return;
  const batches = [await allMatching(col(runtime, COLLECTIONS.skus), { productId: product._id })];
  const hasConfiguredSpec = Array.isArray(product.specList);
  const configuredIds = new Set((hasConfiguredSpec ? product.specList : []).flatMap((group) =>
    (Array.isArray(group.specValueList) ? group.specValueList : []).map((value) => String(value.specValueId || ''))));
  const skus = Array.from(new Map(batches.flat().map((item) => [String(item._id || item.skuId), item])).values())
    .filter((item) => !item.deletedByAdmin)
    .filter((item) => !hasConfiguredSpec || [item._id, item.skuId].filter(Boolean).some((id) => configuredIds.has(String(id))));
  const prices = skus.map((item) => skuPrice(item)).filter((value) => Number.isFinite(value) && value > 0);
  const pricePatch = prices.length
    ? { minSalePrice: Math.min(...prices), maxSalePrice: Math.max(...prices) }
    : { minSalePrice: 0, maxSalePrice: 0 };
  await products.doc(product._id || String(reference)).update({ ...pricePatch, updatedAt: now() });
}

async function saveProductWithVariants(runtime, data) {
  assert(Array.isArray(data.variants) && data.variants.length > 0 && data.variants.length <= 100, { field: 'variants' });
  const variants = data.variants.map((item) => {
    assert(item && typeof item === 'object' && !Array.isArray(item), { field: 'variants' });
    assert(item.skuImage === undefined || (typeof item.skuImage === 'string' && item.skuImage.length <= 1024), { field: 'variants.skuImage' });
    return {
      skuId: item.skuId ? string(item.skuId, 'skuId', { max: 128 }) : '',
      name: string(item.name, 'name', { max: 80 }),
      salePrice: integer(item.salePrice, 'salePrice', { min: 1 }),
      skuImage: item.skuImage === undefined ? undefined : item.skuImage.trim(),
      stockQuantity: item.stockQuantity === undefined ? undefined : integer(item.stockQuantity, 'stockQuantity', { min: 0, max: 100000000 }),
      expectedStockQuantity: item.expectedStockQuantity === undefined ? undefined : integer(item.expectedStockQuantity, 'expectedStockQuantity', { min: -1, max: 100000000 }),
    };
  });
  assert(new Set(variants.map((item) => item.name)).size === variants.length, { field: 'variants.name' });
  assert(new Set(variants.filter((item) => item.skuId).map((item) => item.skuId)).size === variants.filter((item) => item.skuId).length, { field: 'variants.skuId' });
  variants.forEach((item) => assert(item.stockQuantity === undefined || !item.skuId || item.expectedStockQuantity !== undefined, { field: 'variants.expectedStockQuantity' }));
  const productId = data.id ? string(data.id, 'id', { max: 128 }) : crypto.randomUUID();
  const products = col(runtime, COLLECTIONS.products);
  const current = data.id ? await getDoc(products, productId, true) : null;
  const existingSkus = current ? await allMatching(col(runtime, COLLECTIONS.skus), { productId: current._id }) : [];
  const existingById = new Map(existingSkus.map((sku) => [String(sku._id || sku.skuId), sku]));
  variants.forEach((variant) => assert(!variant.skuId || existingById.has(variant.skuId), { field: 'variants.skuId' }));
  const timestamp = now();
  const prices = variants.map((item) => item.salePrice);
  const specList = [{ specId: 'spec', title: '规格', specValueList: variants.map((item) => ({ specValueId: item.skuId, specValue: item.name })) }];
  const patch = {
    ...allowedFields(data, ['title', 'subtitle', 'primaryImage', 'images', 'detailImages', 'categoryIds', 'sort', 'tags', 'description']),
    specList,
    minSalePrice: Math.min(...prices),
    maxSalePrice: Math.max(...prices),
    updatedAt: timestamp,
  };
  if (patch.categoryIds !== undefined) patch.categoryIds = await validProductCategoryIds(runtime, patch.categoryIds);
  patch.title = string(patch.title, 'title', { max: 200 });
  patch.primaryImage = string(patch.primaryImage, 'primaryImage', { max: 1024 });
  assert(Array.isArray(patch.detailImages) && patch.detailImages.length >= 1 && patch.detailImages.length <= 3, { field: 'detailImages', min: 1, max: 3 });
  patch.detailImages = patch.detailImages.map((image) => string(image, 'detailImages[]', { max: 1024 }));
  patch.images = [patch.primaryImage];
  const result = await withTransaction(runtime.db, async (tx) => {
    const txProducts = tx.collection(COLLECTIONS.products);
    const txSkus = tx.collection(COLLECTIONS.skus);
    // Allocate inside the transaction so concurrent saves cannot overwrite a SKU.
    let skuTimestamp = Date.now();
    for (const [index, specValue] of specList[0].specValueList.entries()) {
      if (variants[index].skuId) continue;
      let skuId;
      do {
        skuId = `sku-${skuTimestamp++}`;
      } while (await getDoc(txSkus, skuId, false));
      specValue.specValueId = skuId;
    }
    for (const variant of variants) {
      if (!variant.skuId || variant.stockQuantity === undefined) continue;
      const latest = await getDoc(txSkus, variant.skuId, true);
      if (skuStock(latest) !== variant.expectedStockQuantity) throw errorFrom('CONFLICT', { field: 'stockQuantity', skuId: variant.skuId });
    }
    if (current && patch.status === STATUS.inactive) await clearHomeProductLinks(tx, current, productId, timestamp);
    if (current) await txProducts.doc(productId).update(patch);
    else await setDoc(txProducts, productId, { _id: productId, spuId: productId, status: STATUS.active, createdAt: timestamp, ...patch });
    const kept = new Set();
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const old = variant.skuId ? existingById.get(variant.skuId) : null;
      const skuId = old ? String(old._id || old.skuId) : specList[0].specValueList[index].specValueId;
      specList[0].specValueList[index].specValueId = skuId;
      kept.add(skuId);
      const skuPatch = { productId, spuId: current?.spuId || productId, specInfo: [{ specId: 'spec', specValueId: skuId }], salePrice: variant.salePrice, deletedByAdmin: false, updatedAt: timestamp };
      if (variant.skuImage !== undefined) skuPatch.skuImage = variant.skuImage;
      if (old) {
        if (variant.stockQuantity !== undefined) skuPatch.stockQuantity = variant.stockQuantity;
        await txSkus.doc(skuId).update(skuPatch);
      } else await setDoc(txSkus, skuId, { _id: skuId, skuId, stockQuantity: variant.stockQuantity ?? 999, skuImage: variant.skuImage || '', soldQuantity: 0, createdAt: timestamp, ...skuPatch });
    }
    for (const old of existingSkus) {
      const skuId = String(old._id || old.skuId);
      if (!kept.has(skuId) && !old.deletedByAdmin) await txSkus.doc(skuId).update({ deletedByAdmin: true, updatedAt: timestamp });
    }
    return { ...(current || {}), _id: productId, spuId: current?.spuId || productId, ...patch };
  });
  return result;
}

async function allMatching(collection, where) {
  const items = [];
  while (true) {
    const batch = await list(collection, { where, skip: items.length, limit: 100, includeTotal: false });
    items.push(...batch.items);
    if (batch.items.length < 100) return items;
  }
}

async function removeSkuFromProductSpec(runtime, sku) {
  const reference = sku?.productId;
  if (!reference) return;
  const products = col(runtime, COLLECTIONS.products);
  const product = await getDoc(products, String(reference), false);
  if (!product || !Array.isArray(product.specList)) return;
  const skuIds = new Set([sku._id, sku.skuId].filter(Boolean).map(String));
  const specList = product.specList.map((group) => ({
    ...group,
    specValueList: (Array.isArray(group.specValueList) ? group.specValueList : [])
      .filter((value) => !skuIds.has(String(value.specValueId || ''))),
  }));
  await products.doc(String(product._id || reference)).update({ specList, updatedAt: now() });
}

async function firstActiveChildId(runtime, parentId) {
  const children = await allMatching(col(runtime, COLLECTIONS.categories), { parentId, status: STATUS.active });
  children.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a._id || a.id).localeCompare(String(b._id || b.id)));
  return children.length ? String(children[0]._id || children[0].id) : '';
}

async function moveParentProductsToFirstChild(runtime, parentId) {
  const firstChildId = await firstActiveChildId(runtime, parentId);
  if (!firstChildId) return;
  const products = col(runtime, COLLECTIONS.products);
  const matches = await allMatching(products, { categoryIds: parentId });
  for (const product of matches) {
    const currentId = product.categoryIds?.[0];
    if (String(currentId) !== parentId) continue;
    await products.doc(product._id).update({ categoryIds: [firstChildId], updatedAt: now() });
  }
}

async function validProductCategoryIds(runtime, value) {
  assert(Array.isArray(value) && value.length <= 1, { field: 'categoryIds', max: 1 });
  if (!value.length) return [];
  const id = string(value[0], 'categoryIds.0', { max: 128 });
  const categories = col(runtime, COLLECTIONS.categories);
  const category = await getDoc(categories, id, false);
  assert(category?.status === STATUS.active, { field: 'categoryIds.0' });
  if (category.parentId) {
    const parent = await getDoc(categories, String(category.parentId), false);
    assert(parent?.status === STATUS.active && !parent.parentId, { field: 'categoryIds.0' });
  } else {
    const firstChildId = await firstActiveChildId(runtime, id);
    if (firstChildId) return [firstChildId];
  }
  return [id];
}

async function categoryAction(runtime, data, action, collection) {
  if (action === 'categories.reorder') {
    assert(Array.isArray(data.ids) && data.ids.length > 0 && data.ids.length <= 1000, { field: 'ids' });
    const ids = data.ids.map((id) => string(id, 'ids', { max: 128 }));
    assert(new Set(ids).size === ids.length, { field: 'ids' });
    const parentId = data.parentId ? string(data.parentId, 'parentId', { max: 128 }) : null;
    const siblings = await allMatching(collection, { parentId, status: STATUS.active });
    assert(siblings.length === ids.length && siblings.every((item) => ids.includes(String(item._id || item.id))), { field: 'ids' });
    const updatedAt = now();
    for (const [sort, id] of ids.entries()) await collection.doc(id).update({ sort, updatedAt });
    return { ids };
  }
  if (action.endsWith('.create') || action.endsWith('.update')) {
    const existing = action.endsWith('.update')
      ? await getDoc(collection, string(data.id, 'id', { max: 128 }), true)
      : null;
    const parentId = data.parentId === undefined ? existing?.parentId || null : data.parentId ? string(data.parentId, 'parentId', { max: 128 }) : null;
    const parent = parentId ? await getDoc(collection, parentId, false) : null;
    if (parentId) assert(parent?.status === STATUS.active && !parent.parentId && String(parent._id || parent.id) !== String(existing?._id || existing?.id), { field: 'parentId' });
    if (existing) assert(Boolean(existing.parentId) === Boolean(parentId), { field: 'parentId' });
    const name = string(data.name === undefined ? existing?.name : data.name, 'name', { max: 80 });
    const siblings = await allMatching(collection, { parentId, status: STATUS.active });
    assert(!siblings.some((item) => String(item._id || item.id) !== String(existing?._id || '') && item.name === name), { field: 'name' });
    const sort = existing?.sort ?? (siblings.length ? Math.max(...siblings.map((item) => Number(item.sort) || 0)) + 1 : 0);
    const image = data.image === undefined ? existing?.image || '' : data.image ? string(data.image, 'image', { max: 512 }) : '';
    assert(!image || Boolean(parentId), { field: 'image' });
    const patch = { name, parentId, level: parentId ? 2 : 1, sort, image, updatedAt: now() };
    if (existing) {
      await collection.doc(String(existing._id || existing.id)).update(patch);
      if (parentId) await moveParentProductsToFirstChild(runtime, parentId);
      return { ...existing, ...patch };
    }
    const item = { ...patch, status: STATUS.active, createdAt: patch.updatedAt };
    const result = await collection.add(item);
    if (parentId) await moveParentProductsToFirstChild(runtime, parentId);
    return { ...item, _id: result.id || result._id };
  }
  if (!action.endsWith('.delete')) throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const id = string(data.id, 'id', { max: 128 });
  const existing = await getDoc(collection, id, true);
  const descendants = !existing.parentId ? await allMatching(collection, { parentId: id }) : [];
  const ids = [id, ...descendants.map((item) => String(item._id || item.id))];
  const products = col(runtime, COLLECTIONS.products);
  const affectedProducts = new Map();
  for (const categoryId of ids) {
    for (const product of await allMatching(products, { categoryIds: categoryId })) {
      affectedProducts.set(product._id, product);
    }
  }
  for (const [productId, product] of affectedProducts) {
    await products.doc(productId).update({
      categoryIds: (product.categoryIds || []).filter((categoryId) => !ids.includes(String(categoryId))),
      updatedAt: now(),
    });
  }
  for (const categoryId of ids) await collection.doc(categoryId).update({ status: STATUS.inactive, image: '', icon: '', updatedAt: now() });
  return { ...existing, status: STATUS.inactive, image: '', icon: '', _id: id, removedIds: ids };
}

async function catalogAction(runtime, data, action) {
  const name = action.startsWith('categories.') ? COLLECTIONS.categories : action.startsWith('products.') ? COLLECTIONS.products : COLLECTIONS.skus;
  const entity = action.split('.')[0];
  const collection = col(runtime, name);
  if (action.endsWith('.list')) {
    if (entity === 'skus' && data.productId) {
      const ref = string(data.productId, 'productId', { max: 128 });
      const byProduct = await allMatching(collection, { productId: ref });
      const items = byProduct.filter((item) => !item.deletedByAdmin);
      return { items: items.map((item) => ({ ...withoutSkuStatus(item), price: item.salePrice })), page: 1, pageSize: items.length, total: items.length };
    }
    const where = {};
    if (data.status && entity !== 'skus') where.status = string(data.status, 'status', { max: 40 });
    if (data.productId) where.productId = string(data.productId, 'productId', { max: 128 });
    if (data.categoryId) where.categoryIds = string(data.categoryId, 'categoryId', { max: 128 });
    if (entity === 'products' && runtime.db.command?.neq) where.deletedByAdmin = runtime.db.command.neq(true);
    const keyword = data.query ? string(data.query, 'query', { max: 80 }) : '';
    if (keyword && typeof runtime.db.RegExp === 'function') {
      const field = entity === 'skus' ? 'skuId' : entity === 'products' ? 'title' : 'name';
      where[field] = runtime.db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
    }
    const fallbackProductList = entity === 'products' && (data.inactiveFirst === true || !runtime.db.command?.neq);
    let result;
    if (fallbackProductList) {
      const paging = page(data);
      let items = (await allMatching(collection, where)).filter((item) => !item.deletedByAdmin);
      if (keyword && typeof runtime.db.RegExp !== 'function') {
        const lowered = keyword.toLowerCase();
        items = items.filter((item) => `${item.title || ''} ${item.name || ''} ${item.skuId || ''} ${item.spuId || ''}`.toLowerCase().includes(lowered));
      }
      const orderField = data.orderBy || 'updatedAt';
      const direction = data.direction === 'asc' ? 1 : -1;
      items.sort((a, b) => {
        if (data.inactiveFirst === true) {
          const priority = Number(a.status === STATUS.active) - Number(b.status === STATUS.active);
          if (priority) return priority;
        }
        const left = a[orderField];
        const right = b[orderField];
        const comparison = typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
        return comparison * direction;
      });
      result = {
        items: items.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize),
        page: paging.page,
        pageSize: paging.pageSize,
        total: items.length,
      };
    } else {
      result = await listCollection(runtime, name, data, where);
    }
    if (keyword && typeof runtime.db.RegExp !== 'function' && !fallbackProductList) {
      const lowered = keyword.toLowerCase();
      result.items = result.items.filter((item) => `${item.title || ''} ${item.name || ''} ${item.skuId || ''} ${item.spuId || ''}`.toLowerCase().includes(lowered));
      result.total = result.items.length;
    }
    if (entity === 'products') result.items = result.items.map((item) => ({ ...item, isPutOnSale: item.status === STATUS.active }));
    if (entity === 'categories') result.items = result.items.map((item) => ({ ...item, enabled: item.status === STATUS.active }));
    if (entity === 'skus') result.items = result.items.filter((item) => !item.deletedByAdmin).map((item) => ({ ...withoutSkuStatus(item), price: item.salePrice }));
    return result;
  }
  if (action.endsWith('.get')) {
    const id = string(data[`${entity.slice(0, -1)}Id`] || data.id || data.spuId || data.skuId, 'id', { max: 128 });
    const result = entity === 'products' ? await findProduct(collection, id) : await getDoc(collection, id, true);
    if (!result) throw errorFrom('NOT_FOUND');
    return entity === 'skus' ? withoutSkuStatus(result) : result;
  }
  if (entity === 'categories') return categoryAction(runtime, data, action, collection);
  if (action.endsWith('.create')) {
    const timestamp = now();
    let item;
    if (entity === 'categories') item = { ...allowedFields(data, ['name', 'parentId', 'level', 'sort', 'icon', 'description']), status: statusValue(data.status, STATUS.active) };
    else if (entity === 'products') item = { ...allowedFields(data, ['spuId', 'title', 'subtitle', 'primaryImage', 'images', 'detailImages', 'categoryIds', 'sort', 'minSalePrice', 'maxSalePrice', 'minLinePrice', 'maxLinePrice', 'tags', 'description', 'specList']), status: statusValue(data.status, STATUS.active) };
    else item = { ...allowedFields(data, ['skuId', 'productId', 'spuId', 'specInfo', 'skuImage', 'salePrice', 'linePrice', 'stockQuantity', 'weight', 'volume', 'soldQuantity']), stockQuantity: integer(data.stockQuantity === undefined ? 999 : data.stockQuantity, 'stockQuantity', { min: 0 }), soldQuantity: integer(data.soldQuantity === undefined ? 0 : data.soldQuantity, 'soldQuantity', { min: 0 }) };
    item.createdAt = timestamp;
    item.updatedAt = timestamp;
    if (entity === 'products' && item.categoryIds !== undefined) {
      item.categoryIds = await validProductCategoryIds(runtime, item.categoryIds);
    }
    const result = await collection.add(item);
    item._id = result.id || result._id;
    if (entity === 'skus') await syncProductPrices(runtime, item);
    return item;
  }
  const id = string(data[`${entity.slice(0, -1)}Id`] || data.id || data.spuId || data.skuId, 'id', { max: 128 });
  const existing = await getDoc(collection, id, true);
  if (action.endsWith('.delete')) {
    if (entity === 'products') {
      const timestamp = now();
      await withTransaction(runtime.db, async (tx) => {
        const products = tx.collection(COLLECTIONS.products);
        const product = await getDoc(products, id, true);
        await clearHomeProductLinks(tx, product, id, timestamp);
        await products.doc(id).update({ status: STATUS.inactive, deletedByAdmin: true, updatedAt: timestamp });
      });
      return { ...existing, status: STATUS.inactive, deletedByAdmin: true, _id: id };
    }
    if (entity === 'skus') {
      await removeSkuFromProductSpec(runtime, existing);
      await collection.doc(id).update({ deletedByAdmin: true, updatedAt: now() });
      await syncProductPrices(runtime, existing);
      return { ...withoutSkuStatus(existing), deletedByAdmin: true, _id: id };
    }
    await collection.doc(id).update({ status: STATUS.inactive, updatedAt: now() });
    return { ...existing, status: STATUS.inactive, _id: id };
  }
  if (!action.endsWith('.update')) throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const fields = entity === 'categories'
    ? ['name', 'parentId', 'level', 'sort', 'icon', 'description', 'status']
    : entity === 'products'
      ? ['spuId', 'title', 'subtitle', 'primaryImage', 'images', 'detailImages', 'categoryIds', 'sort', 'minSalePrice', 'maxSalePrice', 'minLinePrice', 'maxLinePrice', 'tags', 'description', 'specList', 'status']
      : ['skuId', 'productId', 'spuId', 'specInfo', 'skuImage', 'salePrice', 'linePrice', 'stockQuantity', 'weight', 'volume', 'soldQuantity'];
  const patch = allowedFields(data, fields);
  if (entity === 'products' && patch.categoryIds !== undefined) patch.categoryIds = await validProductCategoryIds(runtime, patch.categoryIds);
  if (patch.status) patch.status = statusValue(patch.status);
  if (entity === 'products' && patch.status && ![STATUS.active, STATUS.inactive].includes(patch.status)) throw errorFrom('INVALID_ARGUMENT', { field: 'status' });
  if (entity === 'skus') {
    if (patch.salePrice !== undefined) patch.salePrice = integer(patch.salePrice, 'salePrice', { min: 0 });
    if (patch.stockQuantity !== undefined) patch.stockQuantity = integer(patch.stockQuantity, 'stockQuantity', { min: 0 });
  }
  patch.updatedAt = now();
  if (entity === 'products' && patch.status === STATUS.inactive) {
    await withTransaction(runtime.db, async (tx) => {
      const products = tx.collection(COLLECTIONS.products);
      const product = await getDoc(products, id, true);
      await clearHomeProductLinks(tx, product, id, patch.updatedAt);
      await products.doc(id).update(patch);
    });
  } else await collection.doc(id).update(patch);
  if (entity === 'skus') await syncProductPrices(runtime, { ...existing, ...patch, _id: id });
  return entity === 'skus' ? { ...withoutSkuStatus(existing), ...patch, _id: id } : { ...existing, ...patch, _id: id };
}

async function inventoryAdjust(runtime, data) {
  const skuId = string(data.skuId, 'skuId', { max: 128 });
  const delta = data.delta === undefined ? undefined : integer(data.delta, 'delta', { min: -1000000, max: 1000000 });
  const target = data.stockQuantity === undefined ? undefined : integer(data.stockQuantity, 'stockQuantity', { min: 0, max: 100000000 });
  const expected = data.expectedStockQuantity === undefined ? undefined : integer(data.expectedStockQuantity, 'expectedStockQuantity', { min: -1, max: 100000000 });
  assert(delta !== undefined || target !== undefined, { field: 'delta|stockQuantity' });
  const resolved = await getDoc(col(runtime, COLLECTIONS.skus), skuId, false);
  if (!resolved) throw errorFrom('NOT_FOUND');
  const documentId = resolved._id || skuId;
  return withTransaction(runtime.db, async (tx) => {
    const sku = await getDoc(tx.collection(COLLECTIONS.skus), documentId, true);
    const current = skuStock(sku);
    if (expected !== undefined && current !== expected) throw errorFrom('CONFLICT', { field: 'stockQuantity', skuId });
    const next = target === undefined ? current + delta : target;
    if (next < 0) throw errorFrom('OUT_OF_STOCK');
    const update = { stockQuantity: next, updatedAt: now() };
    const result = await tx.collection(COLLECTIONS.skus).doc(documentId).update(update);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...withoutSkuStatus(sku), ...update, stockQuantity: next, _id: documentId };
  });
}

async function homeAction(runtime, data, action) {
  const home = col(runtime, COLLECTIONS.homeContents);
  if (action === 'home.list') return listCollection(runtime, COLLECTIONS.homeContents, data, data.status ? { status: string(data.status, 'status', { max: 40 }) } : {});
  const keySource = data.contentId || data.id || data.slot || (action !== 'home.get' ? `home_${Date.now()}` : undefined);
  const key = string(keySource, 'contentId', { max: 128 });
  const existing = await getDoc(home, key, false);
  if (action === 'home.get' || action === 'home.clearUnavailableLinks') {
    if (!existing) throw errorFrom('NOT_FOUND');
    if (key !== HOME_CONFIG_SLOT) return existing;
    return withTransaction(runtime.db, async (tx) => {
      const config = await getDoc(tx.collection(COLLECTIONS.homeContents), key, true);
      for (const id of homeProductIds(config.payload)) {
        const product = await getDoc(tx.collection(COLLECTIONS.products), id, false);
        if (!product || product.deletedByAdmin || product.status !== STATUS.active) {
          await clearHomeProductLinks(tx, product || {}, id, now());
        }
      }
      return await getDoc(tx.collection(COLLECTIONS.homeContents), key, true);
    });
  }
  const patch = { ...allowedFields(data, ['slot', 'type', 'title', 'subtitle', 'content', 'image', 'link', 'payload', 'sort', 'status']), updatedAt: now() };
  if (key === HOME_CONFIG_SLOT || patch.slot === HOME_CONFIG_SLOT) {
    assert(key === HOME_CONFIG_SLOT && patch.slot === HOME_CONFIG_SLOT && patch.type === 'pageConfig', { field: 'slot' });
    patch.payload = validateHomeConfig(patch.payload);
  }
  if (!existing) {
    const item = { _id: key, ...patch, status: statusValue(patch.status, STATUS.active), createdAt: now() };
    await setDoc(home, key, item);
    return item;
  }
  await home.doc(key).update(patch);
  return { ...existing, ...patch, _id: key };
}

function nextOrderStatus(current, next) {
  if (!ORDER_STATUS.includes(next)) throw errorFrom('ORDER_STATE_INVALID');
  const transitions = {
    [STATUS.paid]: [STATUS.shipped],
    [STATUS.shipped]: [STATUS.received],
    [STATUS.received]: [STATUS.completed],
  };
  if (!(transitions[current] || []).includes(next)) throw errorFrom('ORDER_STATE_INVALID');
  return next;
}

function pendingAfterSaleAggregate(order) {
  if (!order.pendingRefundQuantities || typeof order.pendingRefundQuantities !== 'object'
    || !Number.isSafeInteger(Number(order.pendingRefundAmount))) return null;
  return Number(order.pendingRefundAmount) > 0 || Object.values(order.pendingRefundQuantities).some((quantity) => Number(quantity) > 0);
}

async function adminOrderSummary(runtime, order) {
  const hasActiveAfterSale = pendingAfterSaleAggregate(order);
  if (hasActiveAfterSale === null) throw errorFrom('ORDER_STATE_INVALID');
  const { addressSnapshot: _snapshot, address: _address, userAddress: _userAddress, userAddressReq: _request, ...summary } = order;
  return { ...summary, hasActiveAfterSale };
}

async function listAdminOrders(runtime, data) {
  const status = data.status ? string(data.status, 'status', { max: 40 }) : '';
  const where = {
    ...(data.userId ? { userId: string(data.userId, 'userId', { max: 128 }) } : {}),
    ...(data.orderNo ? { orderNo: string(data.orderNo, 'orderNo', { max: 128 }) } : {}),
  };
  const statuses = status === STATUS.completed ? [STATUS.received, STATUS.completed] : null;
  const refunds = status === 'refunded' ? ['refunded', 'partially_refunded', 'partial_refunded', 'partial_refund'] : null;
  if (statuses && runtime.db.command?.in) where.status = runtime.db.command.in(statuses);
  else if (refunds && runtime.db.command?.in) where.paymentStatus = runtime.db.command.in(refunds);
  else if (['partial_refunded', 'partially_refunded'].includes(status)) where.paymentStatus = 'partially_refunded';
  else if (status && !statuses && !refunds) where.status = status;
  const fallback = (statuses || refunds) && !runtime.db.command?.in;
  if (data.groupBy !== 'address' && !fallback) {
    const result = await listCollection(runtime, COLLECTIONS.orders, data, where);
    result.items = await Promise.all(result.items.map((order) => adminOrderSummary(runtime, order)));
    return result;
  }
  const paging = page(data);
  const rows = (await all(col(runtime, COLLECTIONS.orders), where))
    .filter((order) => (!statuses || statuses.includes(order.status)) && (!refunds || refunds.includes(order.paymentStatus)))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b._id).localeCompare(String(a._id)));
  if (data.groupBy !== 'address') {
    return { items: await Promise.all(rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize).map((order) => adminOrderSummary(runtime, order))), ...paging, total: rows.length };
  }
  // Group before paginating, so an address's orders cannot be split across pages.
  const groups = new Map();
  for (const order of rows) {
    const addressKey = shippingGroupKey(order);
    const key = addressKey || `ungrouped_${order._id}`;
    if (!groups.has(key)) groups.set(key, { key, address: shippingAddressOf(order), canCombine: Boolean(addressKey), orders: [] });
    groups.get(key).orders.push(order);
  }
  const selected = [...groups.values()].slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize);
  const items = await Promise.all(selected.map(async (group) => ({
    ...group, orderCount: group.orders.length,
    orders: await Promise.all(group.orders.map((order) => adminOrderSummary(runtime, order))),
  })));
  return { items, ...paging, total: groups.size, totalOrders: rows.length };
}

async function orderShipmentPatch(current, trackingNo, timestamp) {
  if (current.status !== STATUS.paid) throw errorFrom('ORDER_STATE_INVALID');
  const hasActiveAfterSale = pendingAfterSaleAggregate(current);
  if (hasActiveAfterSale === null) throw errorFrom('ORDER_STATE_INVALID');
  if (hasActiveAfterSale) throw errorFrom('CONFLICT', { field: 'afterSale', orderId: current._id });
  const shippedQuantities = {};
  for (const item of current.items || []) {
    const quantity = Number(item.quantity || 0) - Number(current.refundedQuantities?.[item.skuId] || 0);
    if (quantity > 0) shippedQuantities[item.skuId] = quantity;
  }
  if (!Object.keys(shippedQuantities).length) throw errorFrom('ORDER_STATE_INVALID');
  return {
    status: STATUS.shipped, fulfillmentStatus: STATUS.shipped, shippedAt: timestamp,
    tracking: { trackingNo, shippedAt: timestamp }, logistics: { trackingNo, logisticsNo: trackingNo },
    shippedQuantities, updatedAt: timestamp,
  };
}

async function shipOrderBatch(runtime, data) {
  assert(Array.isArray(data.orderIds) && data.orderIds.length > 0, { field: 'orderIds' });
  const ids = data.orderIds.map((id) => string(id, 'orderIds[]', { max: 128 }));
  assert(new Set(ids).size === ids.length, { field: 'orderIds' });
  const groupKey = string(data.groupKey, 'groupKey', { max: 64 });
  const trackingNo = string(data.trackingNo, 'trackingNo', { max: 128 });
  const batchId = crypto.createHash('sha256').update(JSON.stringify([groupKey, [...ids].sort(), trackingNo])).digest('hex');
  return withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const current = await Promise.all(ids.map((id) => getDoc(orders, id, true)));
    if (current.some((order) => shippingGroupKey(order) !== groupKey)) throw errorFrom('CONFLICT', { field: 'address' });
    if (current.every((order) => [STATUS.shipped, STATUS.received, STATUS.completed].includes(order.status)
      && order.shipmentBatchId === batchId && order.tracking?.trackingNo === trackingNo)) {
      return { items: current, total: current.length, shipmentBatchId: batchId, trackingNo };
    }
    const timestamp = now();
    const patches = [];
    for (const [index, order] of current.entries()) {
      patches.push({
        ...await orderShipmentPatch(order, trackingNo, timestamp),
        shipmentBatchId: batchId, shipmentOrderIds: ids,
      });
    }
    for (const [index, id] of ids.entries()) {
      if (affected(await orders.doc(id).update(patches[index])) !== 1) throw errorFrom('CONFLICT');
    }
    return { items: current.map((order, index) => ({ ...order, ...patches[index] })), total: current.length, shipmentBatchId: batchId, trackingNo };
  });
}

async function adminOrderAction(runtime, data, action) {
  const orders = col(runtime, COLLECTIONS.orders);
  if (action === 'orders.list') return listAdminOrders(runtime, data);
  if (action === 'orders.shipBatch') return shipOrderBatch(runtime, data);
  if (action === 'orders.logistics.saveBatch') {
    assert(Array.isArray(data.orderIds) && data.orderIds.length > 0, { field: 'orderIds' });
    const ids = data.orderIds.map((id) => string(id, 'orderIds[]', { max: 128 }));
    assert(new Set(ids).size === ids.length, { field: 'orderIds' });
    const groupKey = string(data.groupKey, 'groupKey', { max: 64 });
    const trackingNo = string(data.trackingNo, 'trackingNo', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      const collection = tx.collection(COLLECTIONS.orders);
      const current = await Promise.all(ids.map((id) => getDoc(collection, id, true)));
      if (current.some((order) => shippingGroupKey(order) !== groupKey)) throw errorFrom('CONFLICT', { field: 'address' });
      if (current.some((order) => order.status !== STATUS.shipped)) throw errorFrom('ORDER_STATE_INVALID');
      const timestamp = now();
      const items = [];
      for (const [index, order] of current.entries()) {
        const patch = {
          tracking: { ...(order.tracking || {}), trackingNo },
          logistics: { ...(order.logistics || {}), trackingNo, logisticsNo: trackingNo },
          updatedAt: timestamp,
        };
        if (affected(await collection.doc(ids[index]).update(patch)) !== 1) throw errorFrom('CONFLICT');
        items.push({ ...order, ...patch });
      }
      return { items, total: items.length, trackingNo };
    });
  }
  const id = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
  const order = await getDoc(orders, id, false);
  if (!order) throw errorFrom('NOT_FOUND');
  const documentId = order._id || id;
  if (action === 'orders.get') {
    const hasActiveAfterSale = pendingAfterSaleAggregate(order);
    if (hasActiveAfterSale === null) throw errorFrom('ORDER_STATE_INVALID');
    return { ...order, hasActiveAfterSale };
  }
  if (action === 'orders.logistics.save' && order.status === STATUS.shipped) {
    const trackingNo = string(data.trackingNo, 'trackingNo', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), documentId, true);
      if (current.status !== STATUS.shipped) throw errorFrom('ORDER_STATE_INVALID');
      const patch = {
        tracking: { ...(current.tracking || {}), trackingNo },
        logistics: { ...(current.logistics || {}), trackingNo, logisticsNo: trackingNo },
        updatedAt: now(),
      };
      const result = await tx.collection(COLLECTIONS.orders).doc(documentId).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, _id: documentId };
    });
  }
  if (action === 'orders.logistics.save') throw errorFrom('ORDER_STATE_INVALID');
  if (action !== 'orders.updateStatus' && action !== 'orders.ship') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const next = string(data.status || (action === 'orders.ship' ? STATUS.shipped : ''), 'status', { max: 40 });
  if (action === 'orders.ship' || next === STATUS.shipped) {
    if (action !== 'orders.ship') throw errorFrom('ORDER_STATE_INVALID');
    const trackingNo = string(data.trackingNo, 'trackingNo', { max: 128 });
    const timestamp = now();
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), documentId, true);
      const patch = await orderShipmentPatch(current, trackingNo, timestamp);
      const result = await tx.collection(COLLECTIONS.orders).doc(documentId).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, _id: documentId };
    });
  }
  if (next === STATUS.paid) throw errorFrom('PAYMENT_NOT_CONFIGURED');
  return withTransaction(runtime.db, async (tx) => {
    const collection = tx.collection(COLLECTIONS.orders);
    const current = await getDoc(collection, documentId, true);
    nextOrderStatus(current.status, next);
    const timestamp = now();
    const patch = { status: next, fulfillmentStatus: next, updatedAt: timestamp };
    if (next === STATUS.received) patch.receivedAt = timestamp;
    if (next === STATUS.completed) patch.completedAt = timestamp;
    if (data.tracking) patch.tracking = allowedFields(data.tracking, ['carrier', 'trackingNo', 'shippedAt']);
    const result = await collection.doc(documentId).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...current, ...patch, _id: documentId };
  });
}

async function dashboardSummary(runtime) {
  const [products, skus] = await Promise.all([
    allMatching(col(runtime, COLLECTIONS.products), {}),
    allMatching(col(runtime, COLLECTIONS.skus), {}),
  ]);
  const productById = new Map();
  products.filter((product) => !product.deletedByAdmin).forEach((product) => {
    productById.set(String(product._id), product);
  });
  const inventoryWarnings = skus.flatMap((sku) => {
    const product = productById.get(String(sku.productId));
    const stock = skuStock(sku);
    if (!product || stock < 0 || stock > 3) return [];
    if (Array.isArray(product.specList)) {
      const ids = product.specList.flatMap((group) => (group.specValueList || []).map((option) => String(option.specValueId)));
      if (![sku._id, sku.skuId].some((id) => id && ids.includes(String(id)))) return [];
    }
    const specName = (sku.specInfo || []).map((spec) => {
      const group = (product.specList || []).find((item) => String(item.specId) === String(spec.specId));
      const option = (group?.specValueList || []).find((item) => String(item.specValueId) === String(spec.specValueId));
      return option?.specValue || spec.specValue || '';
    }).filter(Boolean).join(' / ') || '默认规格';
    return [{ productId: String(product._id || product.spuId), title: product.title, skuId: String(sku._id || sku.skuId), specName, stockQuantity: stock }];
  }).sort((left, right) => left.stockQuantity - right.stockQuantity);
  const [orderCount, commentCount, afterSaleCount, pendingAfterSaleCount, allOrders, allAfterSales] = await Promise.all([
    count(col(runtime, COLLECTIONS.orders)),
    count(col(runtime, COLLECTIONS.comments)),
    count(col(runtime, COLLECTIONS.afterSales)),
    count(col(runtime, COLLECTIONS.afterSales), { status: STATUS.pendingReview }),
    allMatching(col(runtime, COLLECTIONS.orders), { status: STATUS.paid }),
    allMatching(col(runtime, COLLECTIONS.afterSales), { status: runtime.db.command?.in ? runtime.db.command.in([STATUS.pendingReview, STATUS.approved, STATUS.refunding]) : STATUS.pendingReview }),
  ]);
  const activeByOrder = new Map();
  allAfterSales.filter((item) => [STATUS.pendingReview, STATUS.approved, STATUS.refunding].includes(item.status)).forEach((item) => {
    const orderId = String(item.orderId || item.orderNo || '');
    activeByOrder.set(orderId, true);
  });
  const pendingShipmentCount = allOrders.filter((order) => order.status === STATUS.paid
    && !activeByOrder.has(String(order._id || order.orderNo || ''))).length;
  return {
    inventoryWarnings,
    metrics: {
      productCount: products.filter((product) => !product.deletedByAdmin).length,
      orderCount, commentCount, afterSaleCount,
      pendingShipmentCount, pendingAfterSaleCount,
      pendingAfterSalesCount: pendingAfterSaleCount,
    },
  };
}

async function moderationAction(runtime, data, action, name) {
  const collection = col(runtime, name);
  if (action.endsWith('.list')) {
    const where = {};
    if (data.status) where.status = string(data.status, 'status', { max: 40 });
    if (where.status === 'approved' && name === COLLECTIONS.comments) where.status = STATUS.active;
    if (data.productId) where.productId = string(data.productId, 'productId', { max: 128 });
    if (data.userId) where.userId = string(data.userId, 'userId', { max: 128 });
    if (data.orderNo || data.orderId) where.orderNo = string(data.orderNo || data.orderId, 'orderNo', { max: 128 });
    if (name === COLLECTIONS.afterSales && data.type !== undefined && data.type !== '') where.type = Number(data.type);
    const result = await listCollection(runtime, name, data, where);
    return result;
  }
  if (name === COLLECTIONS.afterSales && !action.endsWith('.get')) throw errorFrom('ORDER_STATE_INVALID');
  if (action === 'comments.reply') {
    const id = string(data.commentId || data.id, 'id', { max: 128 });
    const existing = await getDoc(collection, id, true);
    const reply = optionalString(data.reply, 'reply', { max: 2000 }) || '';
    const patch = { reply, repliedAt: now(), updatedAt: now() };
    const result = await collection.doc(id).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...existing, ...patch, _id: id };
  }
  const id = string(data.commentId || data.afterSaleId || data.id, 'id', { max: 128 });
  const existing = await getDoc(collection, id, true);
  if (action.endsWith('.get')) return existing;
  if (action.endsWith('.delete')) {
    await collection.doc(id).update({ status: STATUS.inactive, updatedAt: now() });
    return { ...existing, status: STATUS.inactive, _id: id };
  }
  if (!action.endsWith('.updateStatus')) throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  if (name === COLLECTIONS.afterSales) throw errorFrom('ORDER_STATE_INVALID');
  const allowed = [STATUS.pendingReview, STATUS.active, STATUS.rejected, STATUS.inactive];
  const status = string(data.status, 'status', { max: 40 });
  if (!allowed.includes(status)) throw errorFrom('INVALID_ARGUMENT', { field: 'status' });
  const patch = { status, ...(data.reply !== undefined ? { reply: optionalString(data.reply, 'reply', { max: 2000 }) } : {}), updatedAt: now() };
  await collection.doc(id).update(patch);
  return { ...existing, ...patch, _id: id };
}

async function settingsAction(runtime, data, action) {
  const settings = col(runtime, COLLECTIONS.settings);
  if (action === 'settings.list') return listCollection(runtime, COLLECTIONS.settings, data, {});
  const key = string(data.key, 'key', { max: 128 });
  const existing = await getDoc(settings, key, false);
  if (action === 'settings.get') {
    if (!existing) throw errorFrom('NOT_FOUND');
    return existing;
  }
  if (action !== 'settings.upsert') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  let value = clone(data.value);
  if (key === 'global' && existing?.value && value && typeof value === 'object' && !Array.isArray(value)) {
    value = { ...existing.value, ...value };
  }
  if (key === 'global' && value && Object.prototype.hasOwnProperty.call(value, 'returnAddress')) {
    const raw = value.returnAddress;
    if (raw === null || raw === false || raw === '') value.returnAddress = null;
    else {
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), { field: 'returnAddress' });
      const receiver = string(raw.receiver, 'returnAddress.receiver', { max: 80 });
      const phone = string(raw.phone, 'returnAddress.phone', { max: 32 });
      assert(/^\+?[0-9][0-9\s-]{5,23}$/.test(phone), { field: 'returnAddress.phone' });
      const detail = string(raw.detail, 'returnAddress.detail', { max: 240 });
      value.returnAddress = { receiver, phone, detail };
    }
  }
  const item = { _id: key, key, value: clone(value), description: optionalString(data.description, 'description', { max: 240 }) || '', updatedAt: now() };
  if (existing) await settings.doc(key).update(item);
  else await setDoc(settings, key, { ...item, createdAt: now() });
  return item;
}

function scopeFor(action) {
  if (action.startsWith('storage.maintenance.')) return 'settings';
  if (action === 'storage.cleanup') return 'content';
  if (action.startsWith('products.') || action.startsWith('categories.') || action.startsWith('skus.') || action === 'inventory.adjust') return 'catalog';
  if (action.startsWith('orders.')) return 'orders';
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
    const isUpdate = Boolean(nextData.id);
    nextAction = isUpdate ? 'products.update' : 'products.create';
    if (!isUpdate) nextData = { ...nextData, status: nextData.status ?? STATUS.active };
  }
  if (action === 'categories.save') nextAction = nextData.id ? 'categories.update' : 'categories.create';
  if (action === 'homeContent.list') nextAction = 'home.list';
  if (action === 'homeContent.save') nextAction = 'home.upsert';
  if (action === 'comments.moderate') {
    nextAction = 'comments.updateStatus';
    if (nextData.status === 'approved') nextData.status = STATUS.active;
  }
  if (action === 'afterSales.review') nextAction = 'afterSales.updateStatus';
  return { action: nextAction, data: nextData };
}

async function adminEndpoint(event, context, runtime, action, data) {
  runtime = imageLifecycleRuntime(runtime);
  const result = await executeAdmin(event, context, runtime, action, data);
  return result && typeof result === 'object' && !Array.isArray(result) && runtime.removedImages.size
    ? { ...result, imageCleanup: [...runtime.removedImages] } : result;
}

async function executeAdmin(event, context, runtime, action, data) {
  const isVariantSave = action === 'products.save';
  const normalized = normalizeAdminAction(action, data);
  action = normalized.action;
  data = normalized.data;
  const uploadScope = action === 'storage.cleanup'
    ? (data.fileList || []).every((id) => /\/(?:admin\/products|admin\/categories)\//.test(id)) ? 'catalog' : 'content'
    : action === 'storage.processImage'
    ? /^cloud:\/\/[^/]+\/pending\/home\//.test(String(data.fileID || '')) ? 'content' : 'catalog'
    : scopeFor(action);
  const auth = await requireAdmin(runtime.db, event, context, uploadScope, runtime);
  const raw = { ...runtime, db: runtime.rawDb || runtime.db };
  if (action === 'storage.maintenance.references') return referencePage(raw, data);
  if (action === 'storage.maintenance.cleanup' || action === 'storage.cleanup') return cleanup(raw, data);
  if (action === 'storage.maintenance.replace') return replaceReference(raw, data);
  if (isVariantSave) return saveProductWithVariants(runtime, data);
  if (action === 'dashboard.summary') return dashboardSummary(runtime);
  if (action === 'auth.me') return { uid: auth.identity.uid, roles: auth.roles, member: auth.member };
  if (action === 'storage.tempUrls') return getTempFileURLs(runtime, data.fileList);
  if (action === 'storage.processImage') return processStagedImage(runtime, data.fileID, ['admin/products', 'admin/categories', 'home']);
  if (action.startsWith('categories.') || action.startsWith('products.') || action.startsWith('skus.')) return catalogAction(runtime, data, action);
  if (action === 'inventory.adjust') return inventoryAdjust(runtime, data);
  if (action.startsWith('home.')) return homeAction(runtime, data, action);
  if (action.startsWith('orders.')) return adminOrderAction(runtime, data, action);
  if (action === 'afterSales.updateStatus') return moderateAfterSale(runtime, data);
  if (action === 'afterSales.confirmReturn') return confirmAfterSaleReturn(runtime, data);
  if (action.startsWith('comments.')) return moderationAction(runtime, data, action, COLLECTIONS.comments);
  if (action.startsWith('afterSales.')) return moderationAction(runtime, data, action, COLLECTIONS.afterSales);
  if (action.startsWith('settings.')) return settingsAction(runtime, data, action);
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

module.exports = { adminEndpoint, scopeFor };
