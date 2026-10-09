// @ts-nocheck

const crypto = require('crypto');
const {
  COLLECTIONS, STATUS,
} = require('./constants');
const { errorFrom } = require('./errors');
const { getDoc, setDoc, list, all, count, listData, affected, withTransaction } = require('./db');
const { HOME_CONFIG_SLOT, productIds } = require('./home-config');
const { searchTerms, matchesProductSearch } = require('./product-search');
const { requireUser } = require('./auth');
const { getTempFileURLs } = require('./storage');
const { processStagedImage } = require('./image-upload');
const { scenarioForOrder, scenarioOf, policyForScenario, presentAfterSale } = require('./after-sale-policy');
const {
  assert, string, optionalString, integer, object, array, page, clone,
} = require('./validation');

function now() { return new Date().toISOString(); }

function valueNumber(value, fallback) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function collection(runtime, name) { return runtime.db.collection(name); }

async function findDoc(runtime, name, id) { return getDoc(collection(runtime, name), id, false); }

function skuPrice(sku) { return valueNumber(sku.salePrice, 0); }

function skuStock(sku) { return valueNumber(sku.stockQuantity, -1); }

function productIdForSku(sku) { return sku.productId; }

function productSkuIds(product) {
  if (!Array.isArray(product?.specList)) return null;
  return new Set(product.specList.flatMap((group) =>
    (Array.isArray(group.specValueList) ? group.specValueList : []).map((value) => String(value.specValueId || ''))));
}

function skuBelongsToProduct(product, sku) {
  if (sku.deletedByAdmin) return false;
  const configuredIds = productSkuIds(product);
  if (configuredIds === null) return true;
  return [sku._id, sku.skuId].filter(Boolean).some((id) => configuredIds.has(String(id)));
}

function pick(source, fields) {
  return fields.reduce((result, field) => {
    if (source && source[field] !== undefined) result[field] = clone(source[field]);
    return result;
  }, {});
}

async function getSku(runtime, skuId, required) {
  const sku = await findDoc(runtime, COLLECTIONS.skus, skuId, 'skuId');
  if (!sku) {
    if (required) throw errorFrom('SKU_UNAVAILABLE');
    return null;
  }
  if (!sku._id && !sku.skuId) throw errorFrom('SKU_UNAVAILABLE');
  return sku;
}

async function getActiveProduct(runtime, id, required) {
  const product = await getDoc(collection(runtime, COLLECTIONS.products), id, false);
  if (!product) {
    if (required) throw errorFrom('NOT_FOUND');
    return null;
  }
  if (product.status !== STATUS.active) {
    if (required) throw errorFrom('NOT_FOUND');
    return null;
  }
  return product;
}

function publicProduct(product) {
  if (!product) return product;
  return pick(product, [
    '_id', 'spuId', 'title', 'subtitle', 'description', 'primaryImage', 'images', 'detailImages',
    'categoryIds', 'tags', 'brand', 'storeId', 'storeName', 'sort', 'minSalePrice', 'maxSalePrice',
    'minLinePrice', 'maxLinePrice', 'soldQuantity', 'status', 'createdAt',
    'updatedAt', 'specList', 'video',
  ]);
}

function publicSku(sku) {
  if (!sku) return sku;
  const result = pick(sku, [
    '_id', 'skuId', 'productId', 'spuId', 'specInfo', 'skuImage', 'salePrice', 'linePrice',
    'stockQuantity', 'weight', 'volume', 'soldQuantity', 'safeStockQuantity',
    'createdAt', 'updatedAt',
  ]);
  result.price = skuPrice(sku);
  result.stockQuantity = skuStock(sku);
  return result;
}

async function readCategories(runtime, data) {
  const rows = [];
  while (true) {
    const result = await list(collection(runtime, COLLECTIONS.categories), {
      where: { status: STATUS.active }, skip: rows.length, limit: 100,
      orderBy: { field: '_id', direction: 'asc' }, includeTotal: false,
    });
    rows.push(...result.items);
    if (result.items.length < 100) break;
  }
  const items = rows.map((item) => pick(item, ['_id', 'id', 'groupId', 'name', 'parentId', 'level', 'sort', 'image', 'icon', 'description', 'createdAt']));
  return { items, total: items.length };
}

async function readProducts(runtime, data) {
  const paging = page(data);
  const where = { status: STATUS.active };
  if (data.categoryId) where.categoryIds = string(data.categoryId, 'categoryId', { max: 128 });
  const minPrice = data.minPrice === undefined || data.minPrice === '' ? undefined : Number(data.minPrice);
  const maxPrice = data.maxPrice === undefined || data.maxPrice === '' ? undefined : Number(data.maxPrice);
  const command = runtime.db.command;
  if (Number.isFinite(minPrice) && Number.isFinite(maxPrice) && command && command.and && command.gte && command.lte) {
    where.minSalePrice = command.and(command.gte(minPrice), command.lte(maxPrice));
  } else if (Number.isFinite(minPrice) && command && command.gte) where.minSalePrice = command.gte(minPrice);
  else if (Number.isFinite(maxPrice) && command && command.lte) where.minSalePrice = command.lte(maxPrice);
  const keyword = data.keyword ? string(data.keyword, 'keyword', { max: 80 }) : '';
  const sort = Number(data.sort);
  if (keyword || sort === 3) {
    // Cross-field search and SKU ordering must run before pagination.
    let products = await all(collection(runtime, COLLECTIONS.products), where);
    products = products.filter((item) => (!Number.isFinite(minPrice) || Number(item.minSalePrice) >= minPrice)
      && (!Number.isFinite(maxPrice) || Number(item.minSalePrice) <= maxPrice));
    const byRef = new Map();
    products.forEach((product) => {
      byRef.set(String(product._id), product);
    });
    const newestSku = new Map();
    const productSkus = new Map();
    for (const sku of await all(collection(runtime, COLLECTIONS.skus))) {
      const product = byRef.get(String(productIdForSku(sku)));
      if (!product || !skuBelongsToProduct(product, sku)) continue;
      if (!productSkus.has(product._id)) productSkus.set(product._id, []);
      productSkus.get(product._id).push(sku);
      const match = /^sku-(\d+)$/.exec(String(sku.skuId || sku._id || ''));
      const timestamp = match ? Number(match[1]) : 0;
      if (Number.isSafeInteger(timestamp)) newestSku.set(product._id, Math.max(newestSku.get(product._id) || 0, timestamp));
    }
    if (keyword) {
      const categories = new Map((await all(collection(runtime, COLLECTIONS.categories))).map((category) => [String(category._id), category]));
      const terms = searchTerms(keyword);
      products = products.filter((product) => matchesProductSearch(product, productSkus.get(product._id) || [], categories, terms));
    }
    const direction = data.direction === 'asc' ? 1 : -1;
    const nameOrder = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
      || String(a._id).localeCompare(String(b._id));
    products.sort((a, b) => {
      if (sort === 3) return (newestSku.get(b._id) || 0) - (newestSku.get(a._id) || 0) || nameOrder(a, b);
      if (sort === 1 || data.orderBy === 'price') return (Number(a.minSalePrice || 0) - Number(b.minSalePrice || 0)) * direction || nameOrder(a, b);
      if (sort === 2) return (Number(a.soldQuantity || 0) - Number(b.soldQuantity || 0)) * direction || nameOrder(a, b);
      return nameOrder(a, b);
    });
    return {
      items: products.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize).map(publicProduct),
      page: paging.page, pageSize: paging.pageSize, total: products.length,
    };
  }
  const orderField = data.orderBy === 'price' || sort === 1 ? 'minSalePrice' : sort === 2 ? 'soldQuantity' : 'title';
  const result = await list(collection(runtime, COLLECTIONS.products), {
    where,
    orderBy: { field: orderField, direction: orderField === 'title' ? 'asc' : data.direction === 'asc' ? 'asc' : 'desc' },
    skip: (paging.page - 1) * paging.pageSize,
    limit: paging.pageSize,
  });
  return { items: result.items.map(publicProduct), page: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? result.items.length : result.total };
}

async function readProductDetail(runtime, data) {
  const id = string(data.productId, 'productId', { max: 128 });
  const product = await getActiveProduct(runtime, id, true);
  const result = await list(collection(runtime, COLLECTIONS.skus), { where: { productId: product._id } });
  const skus = result.items.filter((sku) => skuBelongsToProduct(product, sku));
  return { product: publicProduct(product), skus: skus.map(publicSku) };
}

async function readSkus(runtime, data) {
  const ref = data.productId;
  if (ref) {
    const id = string(ref, 'productId', { max: 128 });
    const product = await getActiveProduct(runtime, id, false);
    if (!product) return { items: [], total: 0 };
    const byProduct = await list(collection(runtime, COLLECTIONS.skus), { where: { productId: id } });
    const items = byProduct.items.filter((sku) => skuBelongsToProduct(product, sku));
    return { items: items.map(publicSku), total: items.length };
  }
  const result = await list(collection(runtime, COLLECTIONS.skus), {});
  const activeProducts = new Map();
  const resolved = await Promise.all(result.items.map(async (sku) => {
    const productId = productIdForSku(sku);
    if (!productId) return null;
    if (!activeProducts.has(productId)) activeProducts.set(productId, getActiveProduct(runtime, productId, false));
    const product = await activeProducts.get(productId);
    return product && skuBelongsToProduct(product, sku) ? sku : null;
  }));
  const visible = resolved.filter(Boolean);
  return { items: visible.map(publicSku), total: visible.length };
}

async function readHome(runtime, data) {
  const record = await getDoc(collection(runtime, COLLECTIONS.homeContents), HOME_CONFIG_SLOT, false);
  const config = record?.status === STATUS.active && record.type === 'pageConfig' ? record.payload : null;
  const ids = productIds(config);
  const products = await Promise.all(ids.map((id) => getActiveProduct(runtime, id, false)));
  const productsById = Object.fromEntries(ids.flatMap((id, index) => products[index] ? [[id, publicProduct(products[index])]] : []));
  return { config, productsById };
}

async function getOrCreateUser(runtime, identity, data) {
  return {
    uid: identity.uid,
    ...(data && data.nickname !== undefined ? { nickname: optionalString(data.nickname, 'nickname', { max: 40 }) } : {}),
    avatarUrl: '/assets/user-avatar.jpg',
  };
}

async function searchHistoryAction(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const histories = collection(runtime, COLLECTIONS.searchHistories);
  if (action === 'searchHistory.list') {
    const result = await list(histories, {
      where: { userId: identity.uid },
      orderBy: { field: 'updatedAt', direction: 'desc' },
      limit: 20,
    });
    return { historyWords: result.items.map((item) => item.keyword).filter(Boolean), items: result.items };
  }
  if (action === 'searchHistory.clear') {
    await histories.where({ userId: identity.uid }).remove();
    return { cleared: true };
  }
  const keyword = string(data.keyword, 'keyword', { max: 80 });
  if (action === 'searchHistory.add') {
    const id = `search_${crypto.createHash('sha256').update(`${identity.uid}:${keyword.toLowerCase()}`).digest('hex').slice(0, 32)}`;
    const item = { _id: id, userId: identity.uid, keyword, updatedAt: now() };
    await setDoc(histories, id, item);
    return item;
  }
  if (action === 'searchHistory.remove') {
    await histories.where({ userId: identity.uid, keyword }).remove();
    return { keyword };
  }
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

function addressInput(data) {
  const value = object(data, 'address');
  const result = {
    receiver: string(value.receiver, 'receiver', { max: 60 }),
    phone: string(value.phone, 'phone', { max: 32 }),
    province: optionalString(value.province, 'province', { max: 60 }),
    city: optionalString(value.city, 'city', { max: 60 }),
    district: optionalString(value.district, 'district', { max: 60 }),
    detail: string(value.detail, 'detail', { max: 240 }),
    postalCode: optionalString(value.postalCode, 'postalCode', { max: 16 }),
  };
  ['provinceCode', 'cityCode', 'districtCode', 'label', 'tag'].forEach((field) => {
    if (value[field] !== undefined) result[field] = optionalString(String(value[field]), field, { max: 80 });
  });
  ['latitude', 'longitude'].forEach((field) => {
    if (value[field] !== undefined && value[field] !== null && value[field] !== '') {
      const coordinate = Number(value[field]);
      assert(Number.isFinite(coordinate), { field });
      result[field] = coordinate;
    }
  });
  return result;
}

async function listAddresses(runtime, identity) {
  const result = await list(collection(runtime, COLLECTIONS.addresses), { where: { userId: identity.uid }, orderBy: { field: 'isDefault', direction: 'desc' } });
  return { items: result.items, total: result.items.length };
}

async function addressAction(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const addresses = collection(runtime, COLLECTIONS.addresses);
  if (action === 'addresses.list') return listAddresses(runtime, identity);
  if (action === 'addresses.get') {
    const item = await getDoc(addresses, string(data.addressId, 'addressId'), true);
    if (item.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    return item;
  }
  if (action === 'addresses.create') {
    const timestamp = now();
    const id = `addr_${crypto.randomUUID()}`;
    const existingAddresses = await list(addresses, { where: { userId: identity.uid }, limit: 100, includeTotal: false });
    const item = { _id: id, ...addressInput(data), userId: identity.uid, isDefault: Boolean(data.isDefault) || existingAddresses.items.length === 0, createdAt: timestamp, updatedAt: timestamp };
    if (!item.isDefault) {
      await setDoc(addresses, id, item);
      return item;
    }
    return withTransaction(runtime.db, async (tx) => {
      for (const address of existingAddresses.items) {
        await tx.collection(COLLECTIONS.addresses).doc(address._id).update({ isDefault: false, updatedAt: timestamp });
      }
      await setDoc(tx.collection(COLLECTIONS.addresses), id, item);
      return item;
    });
  }
  const id = string(data.addressId, 'addressId');
  const existing = await getDoc(addresses, id, true);
  if (existing.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  if (action === 'addresses.update') {
    const patch = { ...addressInput(data), updatedAt: now() };
    if (data.isDefault !== undefined) patch.isDefault = Boolean(data.isDefault);
    if (patch.isDefault) {
      const existingAddresses = await list(addresses, { where: { userId: identity.uid }, limit: 100, includeTotal: false });
      await withTransaction(runtime.db, async (tx) => {
        for (const address of existingAddresses.items) {
          await tx.collection(COLLECTIONS.addresses).doc(address._id).update({ isDefault: address._id === id, updatedAt: patch.updatedAt });
        }
        await tx.collection(COLLECTIONS.addresses).doc(id).update({ ...patch, isDefault: true });
      });
    } else {
      const result = await addresses.doc(id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
    }
    return { ...existing, ...patch, _id: id };
  }
  if (action === 'addresses.setDefault') {
    const timestamp = now();
    const existingAddresses = await list(addresses, { where: { userId: identity.uid }, limit: 100, includeTotal: false });
    await withTransaction(runtime.db, async (tx) => {
      for (const address of existingAddresses.items) {
        await tx.collection(COLLECTIONS.addresses).doc(address._id).update({ isDefault: address._id === id, updatedAt: timestamp });
      }
    });
    return { ...existing, isDefault: true, _id: id };
  }
  if (action === 'addresses.remove') {
    const existingAddresses = await list(addresses, { where: { userId: identity.uid }, limit: 100, includeTotal: false });
    const replacement = existing.isDefault ? existingAddresses.items.find((item) => item._id !== id) : null;
    await withTransaction(runtime.db, async (tx) => {
      const result = await tx.collection(COLLECTIONS.addresses).doc(id).remove();
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      if (replacement) await tx.collection(COLLECTIONS.addresses).doc(replacement._id).update({ isDefault: true, updatedAt: now() });
    });
    return { addressId: id };
  }
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

async function getCart(runtime, identity) {
  const cart = await getDoc(collection(runtime, COLLECTIONS.carts), identity.uid, false);
  const sourceItems = cart && Array.isArray(cart.items) ? cart.items : [];
  const items = await Promise.all(sourceItems.map(async (item) => {
    const sku = await findDoc(runtime, COLLECTIONS.skus, item.skuId, 'skuId');
    const price = sku ? skuPrice(sku) : valueNumber(item.unitPrice ?? item.price, 0);
    const stockQuantity = sku ? skuStock(sku) : valueNumber(item.stockQuantity, 0);
    const specInfo = sku?.specInfo || item.specInfo || item.skuSnapshot?.specInfo || [];
    const image = sku?.skuImage || item.image || item.primaryImage || item.skuSnapshot?.skuImage || '';
    return { ...item, unitPrice: price, price, stockQuantity, specInfo: clone(specInfo), image };
  }));
  return { _id: identity.uid, userId: identity.uid, items, updatedAt: cart && cart.updatedAt };
}

async function cartAction(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const existing = await getCart(runtime, identity);
  const allowedActions = new Set([
    'cart.get', 'cart.clear', 'cart.clearInvalid', 'cart.updateAllSelection', 'cart.updateStoreSelection',
    'cart.remove', 'cart.updateSelection', 'cart.replaceSku', 'cart.add', 'cart.update', 'cart.updateQuantity',
  ]);
  if (!allowedActions.has(action)) throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const save = async (transform) => withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(COLLECTIONS.carts), identity.uid, false);
    const currentItems = current && Array.isArray(current.items) ? current.items.map((item) => ({ ...item })) : [];
    const items = await transform(currentItems);
    const saved = { _id: identity.uid, userId: identity.uid, items, updatedAt: now() };
    await setDoc(tx.collection(COLLECTIONS.carts), identity.uid, saved);
    return saved;
  });
  const present = async (cart) => {
    const items = await Promise.all(cart.items.map(async (item) => {
      const sku = await findDoc(runtime, COLLECTIONS.skus, item.skuId, 'skuId');
      return {
        ...item,
        price: sku ? skuPrice(sku) : valueNumber(item.unitPrice ?? item.price, 0),
        stockQuantity: sku ? skuStock(sku) : valueNumber(item.stockQuantity, 0),
        specInfo: clone(sku?.specInfo || item.specInfo || item.skuSnapshot?.specInfo || []),
        image: sku?.skuImage || item.image || item.primaryImage || item.skuSnapshot?.skuImage || '',
      };
    }));
    return { ...cart, items };
  };
  if (action === 'cart.get') return existing;
  if (action === 'cart.clear') {
    return present(await save(() => []));
  }
  if (action === 'cart.clearInvalid') {
    const saved = await save(async (currentItems) => {
      const validItems = [];
      for (const item of currentItems) {
        const sku = await findDoc(runtime, COLLECTIONS.skus, item.skuId, 'skuId');
        const product = sku && await findDoc(runtime, COLLECTIONS.products, productIdForSku(sku), 'spuId');
        const quantity = valueNumber(item.quantity, 0);
        if (sku && product && product.status === STATUS.active && skuBelongsToProduct(product, sku) && skuStock(sku) >= quantity) validItems.push(item);
      }
      return validItems;
    });
    return present(saved);
  }
  if (action === 'cart.updateAllSelection') return present(await save((items) => items.map((item) => ({ ...item, isSelected: Boolean(data.isSelected) }))));
  if (action === 'cart.updateStoreSelection') {
    const storeId = data.storeId === undefined || data.storeId === null ? '' : String(data.storeId);
    return present(await save((items) => items.map((item) => (
      String(item.storeId ?? '') === storeId ? { ...item, isSelected: Boolean(data.isSelected) } : item
    ))));
  }
  if (action === 'cart.remove') {
    const skuId = string(data.skuId, 'skuId', { max: 128 });
    return present(await save((items) => items.filter((item) => String(item.skuId) !== skuId)));
  }
  if (action === 'cart.updateSelection') {
    const skuId = string(data.skuId, 'skuId', { max: 128 });
    return present(await save((items) => {
      const itemIndex = items.findIndex((item) => String(item.skuId) === skuId);
      if (itemIndex < 0) throw errorFrom('NOT_FOUND');
      items[itemIndex].isSelected = Boolean(data.isSelected);
      return items;
    }));
  }
  if (action === 'cart.replaceSku') {
    const oldSkuId = string(data.oldSkuId, 'oldSkuId', { max: 128 });
    const newSkuId = string(data.newSkuId, 'newSkuId', { max: 128 });
    const quantity = integer(data.quantity, 'quantity', { min: 1, max: 99 });
    const sku = await getSku(runtime, newSkuId, true);
    const product = await getActiveProduct(runtime, productIdForSku(sku), true);
    if (!skuBelongsToProduct(product, sku)) throw errorFrom('SKU_UNAVAILABLE');
    if (skuStock(sku) >= 0 && quantity > skuStock(sku)) throw errorFrom('OUT_OF_STOCK');
    const replacement = {
      skuId: newSkuId,
      spuId: product.spuId || product._id,
      productId: product._id || product.spuId,
      storeId: product.storeId,
      storeName: product.storeName || '',
      quantity,
      isSelected: true,
      title: product.title,
      primaryImage: product.primaryImage || (Array.isArray(product.images) ? product.images[0] : undefined),
      skuSnapshot: clone({ specInfo: sku.specInfo, skuImage: sku.skuImage }),
      unitPrice: skuPrice(sku),
      price: skuPrice(sku),
      stockQuantity: skuStock(sku),
      specInfo: clone(sku.specInfo || []),
      image: sku.skuImage || product.primaryImage || '',
      updatedAt: now(),
    };
    return present(await save((items) => {
      if (!items.some((item) => String(item.skuId) === oldSkuId)) throw errorFrom('NOT_FOUND');
      return items.flatMap((item) => {
        if (String(item.skuId) === oldSkuId) return [replacement];
        if (String(item.skuId) === newSkuId) return [];
        return [item];
      });
    }));
  }
  const skuId = string(data.skuId, 'skuId', { max: 128 });
  const quantity = integer(data.quantity, 'quantity', { min: 1, max: 99 });
  const sku = await getSku(runtime, skuId, true);
  const product = await getActiveProduct(runtime, productIdForSku(sku), true);
  if (!skuBelongsToProduct(product, sku)) throw errorFrom('SKU_UNAVAILABLE');
  return present(await save((items) => {
    const itemIndex = items.findIndex((item) => String(item.skuId) === skuId);
    const nextQuantity = action === 'cart.update' || action === 'cart.updateQuantity'
      ? quantity
      : quantity + (itemIndex >= 0 ? integer(items[itemIndex].quantity, 'quantity', { min: 1 }) : 0);
    assert(nextQuantity <= 99, { field: 'quantity', max: 99 });
    if (skuStock(sku) < nextQuantity) throw errorFrom('OUT_OF_STOCK');
    const previous = itemIndex >= 0 ? items[itemIndex] : null;
    const cartItem = {
      skuId,
      spuId: product.spuId || product._id,
      productId: product._id || product.spuId,
      storeId: product.storeId,
      storeName: product.storeName || '',
      quantity: nextQuantity,
      isSelected: previous ? Boolean(previous.isSelected) : true,
      title: product.title,
      primaryImage: product.primaryImage || (Array.isArray(product.images) ? product.images[0] : undefined),
      skuSnapshot: clone({ specInfo: sku.specInfo, skuImage: sku.skuImage }),
      unitPrice: skuPrice(sku),
      price: skuPrice(sku),
      stockQuantity: skuStock(sku),
      specInfo: clone(sku.specInfo || []),
      image: sku.skuImage || product.primaryImage || '',
      updatedAt: now(),
    };
    if (itemIndex >= 0) items[itemIndex] = cartItem;
    else items.push(cartItem);
    return items;
  }));
}

function normalizeOrderItems(value) {
  array(value, 'items');
  assert(value.length > 0 && value.length <= 50, { field: 'items' });
  const merged = new Map();
  value.forEach((item) => {
    const input = object(item, 'items[]');
    const skuId = string(input.skuId, 'skuId', { max: 128 });
    const quantity = integer(input.quantity, 'quantity', { min: 1, max: 99 });
    merged.set(skuId, (merged.get(skuId) || 0) + quantity);
  });
  merged.forEach((quantity) => assert(quantity <= 99, { field: 'quantity', max: 99 }));
  return Array.from(merged, ([skuId, quantity]) => ({ skuId, quantity }));
}

function orderInput(data = {}) { return data; }

function pricedOrderItem(product, sku, skuId, quantity) {
  const unitPrice = skuPrice(sku);
  const amount = unitPrice * quantity;
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0 || !Number.isSafeInteger(amount)) {
    throw errorFrom('INVALID_ARGUMENT', { field: 'sku.price' });
  }
  return {
    skuId, productId: product._id || product.spuId, quantity, unitPrice, amount,
    productSnapshot: clone({ _id: product._id, spuId: product.spuId, title: product.title, primaryImage: product.primaryImage, images: product.images }),
    skuSnapshot: clone({
      _id: sku._id, skuId: sku.skuId, skuImage: sku.skuImage,
      specInfo: (sku.specInfo || []).map((spec) => {
        const group = (product.specList || []).find((item) => String(item.specId) === String(spec.specId));
        const value = (group?.specValueList || []).find((item) => String(item.specValueId) === String(spec.specValueId));
        return { ...spec, specTitle: spec.specTitle || group?.title || '', specValue: spec.specValue || value?.specValue || '' };
      }),
    }),
  };
}

async function orderDraft(runtime, identity, data, source, requireAddress = true) {
  const input = orderInput(data);
  const items = normalizeOrderItems(source || input.items);
  const addressRef = input.addressId;
  let address = null;
  if (addressRef !== undefined && addressRef !== null && addressRef !== '') {
    const addressId = string(addressRef, 'addressId', { max: 128 });
    address = await getDoc(collection(runtime, COLLECTIONS.addresses), addressId, true);
    if (address.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  } else if (requireAddress) {
    throw errorFrom('ADDRESS_REQUIRED');
  }
  const resolved = [];
  for (const input of items) {
    const sku = await getSku(runtime, input.skuId, true);
    const product = await getActiveProduct(runtime, productIdForSku(sku), true);
    if (!skuBelongsToProduct(product, sku)) throw errorFrom('SKU_UNAVAILABLE');
    const stock = skuStock(sku);
    if (stock < input.quantity) throw errorFrom('OUT_OF_STOCK', { skuId: input.skuId });
    resolved.push(pricedOrderItem(product, sku, input.skuId, input.quantity));
  }
  const subtotal = resolved.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(subtotal)) throw errorFrom('INVALID_ARGUMENT', { field: 'totalAmount' });
  return { items: resolved, addressSnapshot: clone(address), subtotal, totalAmount: subtotal, shippingFee: 0 };
}

async function previewOrder(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const cart = input.useCart ? await getCart(runtime, identity) : null;
  const items = cart ? cart.items : input.items;
  const source = cart ? cart.items.filter((item) => item.isSelected).map((item) => ({ skuId: item.skuId, quantity: item.quantity })) : items;
  // Only preview may omit an address; order creation always requires an owned address.
  return orderDraft(runtime, identity, input, source, false);
}

async function reserveOrderId(tx, userId) {
  const requests = tx.collection(COLLECTIONS.orderRequests);
  let orderId;
  do {
    orderId = `${Date.now()}${crypto.randomInt(10, 100)}`;
  } while (await getDoc(requests, `id_${orderId}`, false)
    || await getDoc(tx.collection(COLLECTIONS.orders), orderId, false));
  await setDoc(requests, `id_${orderId}`, { _id: `id_${orderId}`, orderId, userId });
  return orderId;
}

async function createdOrderResult(runtime, first) {
  const ids = first.checkoutOrderIds;
  if (!Array.isArray(ids) || !ids.length) throw errorFrom('ORDER_STATE_INVALID');
  if (ids.length === 1) return { ...first, paymentRequired: false };
  const orders = await Promise.all(ids.map((id) => getDoc(collection(runtime, COLLECTIONS.orders), id, true)));
  return {
    ...first, orders, orderIds: ids, orderNos: orders.map((order) => order.orderNo),
    orderCount: orders.length,
    checkoutTotalAmount: orders.reduce((sum, order) => sum + order.totalAmount, 0),
    paymentRequired: false,
  };
}

async function orderIdFor(runtime, userId, requestKey) {
  const hash = crypto.createHash('sha256').update(`${userId}:${requestKey}`).digest('hex').slice(0, 32);
  return withTransaction(runtime.db, async (tx) => {
    const requests = tx.collection(COLLECTIONS.orderRequests);
    const existing = await getDoc(requests, hash, false);
    if (existing) return existing.orderId;
    const orderId = await reserveOrderId(tx, userId);
    await setDoc(requests, hash, { _id: hash, userId, requestKey, orderId, createdAt: now() });
    return orderId;
  });
}

async function createOrder(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const requestKey = string(input.requestKey, 'requestKey', { max: 128 });
  const orderId = await orderIdFor(runtime, identity.uid, requestKey);
  const addressId = String(input.addressId || '');
  const requestMode = input.useCart ? 'cart' : 'direct';
  const remark = input.remark || '';
  const explicitItems = Array.isArray(input.items) && input.items.length ? input.items : null;
  const explicitNormalized = explicitItems ? normalizeOrderItems(explicitItems) : null;
  const hashRequest = (items) => crypto.createHash('sha256').update(JSON.stringify({
    items: [...items].sort((a, b) => a.skuId.localeCompare(b.skuId)), addressId, remark,
  })).digest('hex');
  const matchesCartRetry = (existing) => input.useCart && existing.requestMode === 'cart'
    && String(existing.requestAddressId || '') === addressId && String(existing.requestRemark || '') === remark;
  const existing = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, false);
  if (existing) {
    if (explicitNormalized) {
      const requestHash = hashRequest(explicitNormalized);
      if (existing.requestHash !== requestHash) throw errorFrom('IDEMPOTENCY_CONFLICT');
    } else if (!matchesCartRetry(existing)) throw errorFrom('IDEMPOTENCY_CONFLICT');
    return createdOrderResult(runtime, existing);
  }
  const cart = input.useCart ? await getCart(runtime, identity) : null;
  const cartItems = cart?.items.filter((item) => item.isSelected).map((item) => ({ skuId: item.skuId, quantity: item.quantity })) || [];
  if (input.useCart && !explicitNormalized && !cartItems.length) {
    const raced = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, false);
    if (raced && matchesCartRetry(raced)) return createdOrderResult(runtime, raced);
    throw errorFrom('INVALID_ARGUMENT', { field: 'items' });
  }
  const source = explicitNormalized || (input.useCart ? cartItems : input.items);
  const normalizedItems = explicitNormalized || normalizeOrderItems(source);
  const requestHash = hashRequest(normalizedItems);
  const concurrent = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, false);
  if (concurrent) {
    if (concurrent.requestHash !== requestHash
      && (explicitNormalized || !matchesCartRetry(concurrent))) throw errorFrom('IDEMPOTENCY_CONFLICT');
    return createdOrderResult(runtime, concurrent);
  }
  const draft = await orderDraft(runtime, identity, input, normalizedItems);
  const result = await withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const race = await getDoc(orders, orderId, false);
    if (race) {
      if (race.requestHash !== requestHash
        && (explicitNormalized || !matchesCartRetry(race))) throw errorFrom('IDEMPOTENCY_CONFLICT');
      return race;
    }
    const confirmedItems = [];
    const confirmedAddress = await getDoc(tx.collection(COLLECTIONS.addresses), addressId, true);
    if (confirmedAddress.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    for (const item of draft.items) {
      const product = await getDoc(tx.collection(COLLECTIONS.products), item.productId, true);
      if (product.status !== STATUS.active) throw errorFrom('SKU_UNAVAILABLE');
      const skuDocumentId = item.skuSnapshot?._id || item.skuId;
      const sku = await getDoc(tx.collection(COLLECTIONS.skus), skuDocumentId, true);
      if (!sku || !skuBelongsToProduct(product, sku)) throw errorFrom('SKU_UNAVAILABLE');
      const stock = skuStock(sku);
      if (stock < item.quantity) throw errorFrom('OUT_OF_STOCK', { skuId: item.skuId });
      confirmedItems.push(pricedOrderItem(product, sku, item.skuId, item.quantity));
      const payload = {
        stockQuantity: stock - item.quantity,
        soldQuantity: valueNumber(sku.soldQuantity, 0) + item.quantity,
        updatedAt: now(),
      };
      const updateResult = await tx.collection(COLLECTIONS.skus).doc(skuDocumentId).update(payload);
      if (affected(updateResult) !== 1) throw errorFrom('OUT_OF_STOCK', { skuId: item.skuId });
    }
    const subtotal = confirmedItems.reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isSafeInteger(subtotal)) throw errorFrom('INVALID_ARGUMENT', { field: 'totalAmount' });
    const timestamp = now();
    const checkoutOrderIds = [orderId];
    for (let index = 1; index < confirmedItems.length; index += 1) {
      checkoutOrderIds.push(await reserveOrderId(tx, identity.uid));
    }
    // One SKU (including its full quantity) per order. All orders, stock changes
    // and cart removal commit together; the first order anchors checkout retries.
    const created = [];
    for (const [index, item] of confirmedItems.entries()) {
      const id = checkoutOrderIds[index];
      const shippingFee = index === 0 ? draft.shippingFee : 0;
      const totalAmount = item.amount + shippingFee;
      const order = {
        _id: id,
        orderNo: id,
        checkoutId: orderId,
        checkoutOrderIds,
        userId: identity.uid,
        requestKey,
        requestHash,
        requestMode,
        requestAddressId: addressId,
        requestRemark: remark,
        status: STATUS.paid,
        paymentStatus: 'paid',
        payment: { mode: 'simulated', status: 'paid', amount: totalAmount, transactionId: `sim_${id}`, paidAt: timestamp },
        paymentAmount: totalAmount,
        paidAt: timestamp,
        inventoryReserved: true,
        refundAmount: 0,
        refundedQuantities: {},
        pendingRefundAmount: 0,
        pendingRefundQuantities: {},
        afterSaleIds: [],
        items: [item],
        addressSnapshot: clone(confirmedAddress),
        subtotal: item.amount,
        shippingFee,
        totalAmount,
        hasPendingComments: true,
        commentedProductIds: [],
        remark: optionalString(input.remark, 'remark', { max: 240 }) || '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await setDoc(orders, id, order);
      created.push(order);
    }
    const requestId = crypto.createHash('sha256').update(`${identity.uid}:${requestKey}`).digest('hex').slice(0, 32);
    const requests = tx.collection(COLLECTIONS.orderRequests);
    const reservation = await getDoc(requests, requestId, true);
    await setDoc(requests, requestId, { ...reservation, orderIds: checkoutOrderIds, requestHash, totalAmount: subtotal + draft.shippingFee });
    if (cart) {
      const storedCart = await getDoc(tx.collection(COLLECTIONS.carts), identity.uid, false);
      const orderedSkuIds = new Set(draft.items.map((item) => String(item.skuId)));
      const remaining = (storedCart?.items || []).filter((item) => !item.isSelected || !orderedSkuIds.has(String(item.skuId)));
      await setDoc(tx.collection(COLLECTIONS.carts), identity.uid, { _id: identity.uid, userId: identity.uid, items: remaining, updatedAt: timestamp });
    }
    return created[0];
  });
  return createdOrderResult(runtime, result);
}

async function listOrders(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const paging = page(input);
  const requested = input.orderStatus ?? input.status;
  const statusGroups = {
    10: [STATUS.paid],
    40: [STATUS.shipped],
    50: [STATUS.received, STATUS.completed],
    60: [STATUS.refunded],
  };
  const where = { userId: identity.uid };
  const statuses = statusGroups[requested] || (requested ? [String(requested)] : null);
  if (statuses && statuses.length === 1) where.status = statuses[0];
  else if (statuses && runtime.db.command?.in) where.status = runtime.db.command.in(statuses);
  if (runtime.db.command?.neq) where.deletedByUser = runtime.db.command.neq(true);
  if (input.pendingCommentOnly || !runtime.db.command?.neq || (statuses && statuses.length > 1 && !runtime.db.command?.in)) {
    let rows = (await all(collection(runtime, COLLECTIONS.orders), where))
      .filter((order) => !order.deletedByUser && (!statuses || statuses.includes(order.status)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b._id).localeCompare(String(a._id)));
    rows = await Promise.all(rows.map((order) => orderWithComments(runtime, order, true)));
    if (input.pendingCommentOnly) rows = rows.filter((order) => [STATUS.received, STATUS.completed].includes(order.status) && order.hasPendingComments);
    return { items: rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize), page: paging.page, pageSize: paging.pageSize, total: rows.length };
  }
  const result = await list(collection(runtime, COLLECTIONS.orders), {
    where,
    orderBy: { field: 'createdAt', direction: 'desc' },
    skip: (paging.page - 1) * paging.pageSize,
    limit: paging.pageSize,
  });
  let items = result.items.filter((item) => !item.deletedByUser);
  if (statuses && !(runtime.db.command?.in) && statuses.length > 1) items = items.filter((item) => statuses.includes(item.status));
  items = await Promise.all(items.map((order) => orderWithComments(runtime, order, true)));
  return { items, page: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
}

async function orderCount(runtime, event, context) {
  const identity = requireUser(event, context, runtime);
  const groups = [[10, [STATUS.paid]], [40, [STATUS.shipped]], [50, [STATUS.received, STATUS.completed]]];
  const command = runtime.db.command;
  const items = await Promise.all(groups.map(async ([tabType, statuses]) => {
    const where = { userId: identity.uid };
    if (statuses.length === 1) where.status = statuses[0];
    else if (command?.in) where.status = command.in(statuses);
    if (command?.neq) where.deletedByUser = command.neq(true);
    const ref = collection(runtime, COLLECTIONS.orders).where(where);
    if (typeof ref.count === 'function' && (statuses.length === 1 || command?.in) && tabType !== 50) {
      const result = await ref.count();
      return { tabType, orderNum: Number(result.total) || 0 };
    }
    const rows = (await all(collection(runtime, COLLECTIONS.orders), where)).filter((item) => statuses.includes(item.status) && !item.deletedByUser);
    if (tabType === 50) {
      const orders = await Promise.all(rows.map((order) => orderWithComments(runtime, order)));
      return { tabType, orderNum: orders.filter((order) => order.hasPendingComments).length };
    }
    return { tabType, orderNum: rows.length };
  }));
  return { items, counts: items };
}

async function orderDetail(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const ref = string(input.orderId || input.orderNo, 'orderId', { max: 128 });
  const order = await findDoc(runtime, COLLECTIONS.orders, ref, 'orderNo');
  if (!order) throw errorFrom('NOT_FOUND');
  if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  return orderWithComments(runtime, order, true);
}

async function checkoutDetail(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const id = string(data.checkoutId, 'checkoutId', { max: 128 });
  const first = await getDoc(collection(runtime, COLLECTIONS.orders), id, true);
  if (first.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  return createdOrderResult(runtime, first);
}

async function orderWithComments(runtime, order, includeAfterSalesList = false) {
  const orderId = order._id || order.orderNo;
  const hasRefundAggregate = order.refundedQuantities && typeof order.refundedQuantities === 'object';
  const hasPendingAggregate = order.pendingRefundQuantities && typeof order.pendingRefundQuantities === 'object';
  if (!hasRefundAggregate || !hasPendingAggregate) throw errorFrom('ORDER_STATE_INVALID');
  const afterSales = includeAfterSalesList ? await all(collection(runtime, COLLECTIONS.afterSales), { orderId }) : [];
  const active = afterSales.filter((item) => ACTIVE_AFTER_SALE.includes(item.status));
  const refundedQuantities = { ...order.refundedQuantities };
  const pendingRefundQuantities = { ...order.pendingRefundQuantities };
  const items = (order.items || []).map((item) => {
    const refundedQuantity = Math.min(Number(item.quantity || 0), Number(refundedQuantities[item.skuId] || 0));
    const remainingQuantity = Math.max(0, Number(item.quantity || 0) - refundedQuantity);
    const pendingRefundQuantity = Math.min(remainingQuantity, Number(pendingRefundQuantities[item.skuId] || 0));
    const availableRefundQuantity = Math.max(0, remainingQuantity - pendingRefundQuantity);
    const shippedQuantity = Number(order.shippedQuantities?.[item.skuId]
      ?? ([STATUS.shipped, STATUS.received, STATUS.completed].includes(order.status) ? item.quantity : 0));
    const fulfillableQuantity = order.status === STATUS.paid
      ? availableRefundQuantity : Math.min(shippedQuantity, remainingQuantity);
    return { ...item, refundedQuantity, remainingQuantity, pendingRefundQuantity, availableRefundQuantity, fulfillableQuantity };
  });
  let commentedProductIds = Array.from(new Set((order.commentedProductIds || []).filter(Boolean)));
  let hasPendingComments = false;
  if ([STATUS.received, STATUS.completed].includes(order.status)) {
    const comments = await all(collection(runtime, COLLECTIONS.comments), { userId: order.userId, orderId });
    commentedProductIds = Array.from(new Set([...commentedProductIds, ...comments.map((comment) => comment.productId)].filter(Boolean)));
    hasPendingComments = items.some((item) => item.remainingQuantity > 0 && !commentedProductIds.includes(item.productId));
  }
  return {
    ...order, items, refundedQuantities,
    ...(includeAfterSalesList ? { afterSalesList: afterSales.map(presentAfterSale) } : {}),
    activeAfterSaleCount: active.length || (Number(order.pendingRefundAmount || 0) > 0 ? 1 : 0),
    activeAfterSaleStatus: active[0]?.status || (Number(order.pendingRefundAmount || 0) > 0 ? 'processing' : ''),
    commentedProductIds, hasPendingComments,
  };
}

async function updateOrderState(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const id = string(input.orderId || input.orderNo, 'orderId', { max: 128 });
  const orders = collection(runtime, COLLECTIONS.orders);
  const order = await getDoc(orders, id, true);
  if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  const timestamp = now();
  if (action === 'orders.updateAddress') {
    const addressId = string(input.addressId, 'addressId', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status !== STATUS.paid) throw errorFrom('ORDER_STATE_INVALID');
      const hasPendingAggregate = current.pendingRefundQuantities && typeof current.pendingRefundQuantities === 'object'
        && Number.isSafeInteger(Number(current.pendingRefundAmount));
      if (!hasPendingAggregate) throw errorFrom('ORDER_STATE_INVALID');
      const hasPending = Number(current.pendingRefundAmount) > 0 || Object.values(current.pendingRefundQuantities).some((quantity) => Number(quantity) > 0);
      if (hasPending) throw errorFrom('CONFLICT', { field: 'afterSale' });
      const address = await getDoc(tx.collection(COLLECTIONS.addresses), addressId, true);
      if (address.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      const patch = { addressSnapshot: clone(address), updatedAt: timestamp };
      const result = await tx.collection(COLLECTIONS.orders).doc(id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch };
    });
  }
  if (action === 'orders.confirmReceived') {
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
      if (current.userId !== identity.uid || current.status !== STATUS.shipped) throw errorFrom('ORDER_STATE_INVALID');
      const patch = { status: STATUS.received, fulfillmentStatus: STATUS.received, receivedAt: timestamp, updatedAt: timestamp };
      const result = await tx.collection(COLLECTIONS.orders).doc(id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch };
    });
  }
  if (action === 'orders.delete') {
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (![STATUS.refunded, STATUS.completed].includes(current.status)
        || Number(current.pendingRefundAmount || 0) > 0) throw errorFrom('ORDER_STATE_INVALID');
      const patch = { deletedByUser: true, updatedAt: timestamp };
      const result = await tx.collection(COLLECTIONS.orders).doc(id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch };
    });
  }
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

async function commentsAction(runtime, event, context, data, action) {
  const query = data;
  if (action === 'comments.list') {
    const where = { status: STATUS.active };
    let ownedQuery = false;
    if (query.productId) where.productId = string(query.productId, 'productId', { max: 128 });
    if (query.orderNo || query.orderId) {
      const identity = requireUser(event, context, runtime);
      const orderId = string(query.orderNo || query.orderId, 'orderId', { max: 128 });
      const order = await findDoc(runtime, COLLECTIONS.orders, orderId, 'orderNo');
      if (!order || order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      where.orderId = order._id || order.orderNo;
      where.userId = identity.uid;
      ownedQuery = true;
    }
    if (query.mineOnly) {
      where.userId = requireUser(event, context, runtime).uid;
      ownedQuery = true;
    }
    if (ownedQuery) delete where.status;
    if (query.hasImage) where.hasImage = true;
    if (query.commentLevel !== undefined && query.commentLevel !== '') {
      const level = Number(query.commentLevel);
      const command = runtime.db.command;
      if (level === 1 && command?.gte) where.rating = command.gte(4);
      else if (level === 2) where.rating = 3;
      else if (command?.lte) where.rating = command.lte(2);
    }
    const paging = page(query);
    const result = await list(collection(runtime, COLLECTIONS.comments), {
      where,
      orderBy: { field: 'createdAt', direction: 'desc' },
      skip: (paging.page - 1) * paging.pageSize,
      limit: paging.pageSize,
    });
    const items = ownedQuery ? result.items : result.items.map((item) => pick(item, [
      '_id', 'productId', 'rating', 'content', 'images', 'hasImage', 'status', 'createdAt', 'updatedAt', 'reply',
    ]));
    return { items, page: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
  }
  if (action === 'comments.count') {
    const where = { status: STATUS.active };
    if (data.productId) where.productId = string(data.productId, 'productId', { max: 128 });
    const comments = collection(runtime, COLLECTIONS.comments);
    const countWhere = async (extra) => {
      const ref = comments.where({ ...where, ...extra });
      if (typeof ref.count === 'function') return Number((await ref.count()).total) || 0;
      return count(comments, { ...where, ...extra });
    };
    const command = runtime.db.command;
    const [commentCount, goodCount, middleCount, badCount, hasImageCount] = await Promise.all([
      countWhere({}),
      countWhere(command?.gte ? { rating: command.gte(4) } : {}),
      countWhere({ rating: 3 }),
      countWhere(command?.lte ? { rating: command.lte(2) } : {}),
      countWhere({ hasImage: true }),
    ]);
    return {
      commentCount,
      goodCount,
      middleCount,
      badCount,
      hasImageCount,
      uidCount: commentCount,
    };
  }
  if (action !== 'comments.create') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const identity = requireUser(event, context, runtime);
  const orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
  const order = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, true);
  if (order.userId !== identity.uid || ![STATUS.received, STATUS.completed].includes(order.status)) throw errorFrom('FORBIDDEN');
  const productId = string(data.productId, 'productId', { max: 128 });
  const matchedItem = order.items.find((item) => item.productId === productId);
  assert(Boolean(matchedItem), { field: 'productId' });
  const duplicate = await collection(runtime, COLLECTIONS.comments).where({ userId: identity.uid, orderId: order._id || orderId, productId }).limit(1).get();
  if (listData(duplicate).length) throw errorFrom('CONFLICT', { field: 'comment' });
  const text = optionalString(data.content, 'content', { max: 2000 }) || '';
  const sourceImages = data.images;
  const imageList = sourceImages === undefined ? [] : array(sourceImages, 'images');
  assert(imageList.length <= 3, { field: 'images', max: 3 });
  const images = imageList.map((item) => string(typeof item === 'string' ? item : item && (item.image || item.fileID || item.fileId), 'images[]', { max: 1024 }));
  const timestamp = now();
  const rating = data.rating;
  const comment = { userId: identity.uid, orderId: order._id || orderId, orderNo: order.orderNo || orderId, productId, rating: rating === undefined ? 5 : integer(Number(rating), 'rating', { min: 1, max: 5 }), content: text, images, hasImage: images.length > 0, status: STATUS.pendingReview, createdAt: timestamp, updatedAt: timestamp };
  const id = `comment_${crypto.createHash('sha256').update(JSON.stringify([identity.uid, order._id || orderId, productId])).digest('hex').slice(0, 32)}`;
  const annotated = await orderWithComments(runtime, order);
  return withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const current = await getDoc(orders, order._id || orderId, true);
    if (current.userId !== identity.uid || ![STATUS.received, STATUS.completed].includes(current.status)) throw errorFrom('FORBIDDEN');
    const comments = tx.collection(COLLECTIONS.comments);
    if (await getDoc(comments, id, false)) throw errorFrom('CONFLICT', { field: 'comment' });
    if (!current.refundedQuantities || typeof current.refundedQuantities !== 'object') throw errorFrom('ORDER_STATE_INVALID');
    const refunded = current.refundedQuantities;
    const eligibleItems = (current.items || []).filter((item) => {
      const product = item.productId || item.spuId || item.productSnapshot?.spuId || item.productSnapshot?._id;
      return String(product) === String(productId) && Number(item.quantity || 0) > Number(refunded[item.skuId] || 0);
    });
    if (!eligibleItems.length) throw errorFrom('ORDER_STATE_INVALID');
    const commentedProductIds = Array.from(new Set([...(annotated.commentedProductIds || []), ...(current.commentedProductIds || [])]));
    if (commentedProductIds.includes(productId)) throw errorFrom('CONFLICT', { field: 'comment' });
    commentedProductIds.push(productId);
    const saved = { ...comment, _id: id };
    await setDoc(comments, id, saved);
    await orders.doc(current._id || orderId).update({
      commentedProductIds,
      hasPendingComments: (current.items || []).some((item) => Number(item.quantity || 0) > Number(refunded[item.skuId] || 0) && !commentedProductIds.includes(item.productId)),
      updatedAt: timestamp,
    });
    return saved;
  });
}

function requestedAfterSaleItems(order, data) {
  const productRef = data.productId;
  const ordered = order.items;
  const source = data.rightsItem !== undefined ? array(data.rightsItem, 'rightsItem')
    : data.skuId ? [{ skuId: data.skuId, rightsQuantity: data.rightsQuantity ?? data.quantity }]
      : ordered.filter((item) => !productRef || item.productId === productRef)
        .map((item) => ({ skuId: item.skuId, rightsQuantity: item.quantity }));
  assert(source.length > 0 && source.length <= 50, { field: 'rightsItem' });
  const seen = new Set();
  return source.map((request) => {
    object(request, 'rightsItem[]');
    const skuId = string(request.skuId, 'rightsItem.skuId', { max: 128 });
    const snapshot = ordered.find((item) => item.skuId === skuId);
    assert(Boolean(snapshot), { field: 'rightsItem.skuId' });
    assert(!seen.has(snapshot.skuId), { field: 'rightsItem.skuId' });
    seen.add(snapshot.skuId);
    const quantity = integer(request.rightsQuantity ?? request.quantity ?? snapshot.quantity, 'rightsQuantity', { min: 1, max: snapshot.quantity });
    const amount = snapshot.unitPrice * quantity;
    assert(Number.isSafeInteger(amount) && amount > 0, { field: 'refundAmount' });
    return { ...clone(snapshot), quantity, rightsQuantity: quantity, amount };
  });
}

const ACTIVE_AFTER_SALE = [STATUS.pendingReview, STATUS.approved, STATUS.refunding];

function afterSaleType(value) {
  const mapped = Number(value);
  assert([10, 20].includes(mapped), { field: 'type' });
  return mapped;
}

function cleanReturnAddress(value) {
  if (!value || typeof value !== 'object') return null;
  const receiver = String(value.receiver || '').trim();
  const phone = String(value.phone || '').trim();
  const detail = String(value.detail || '').trim();
  if (!receiver || !phone || !detail) return null;
  return { receiver, phone, detail };
}

async function returnAddressFrom(settingsCollection) {
  const global = await getDoc(settingsCollection, 'global', false);
  const value = global?.value || {};
  return cleanReturnAddress(value.returnAddress);
}

async function pendingAggregate(tx, order, claim, timestamp, persist = true) {
  const hasAggregate = order.pendingRefundQuantities && typeof order.pendingRefundQuantities === 'object'
    && Number.isSafeInteger(Number(order.pendingRefundAmount));
  if (!hasAggregate) throw errorFrom('ORDER_STATE_INVALID');
  const quantities = { ...order.pendingRefundQuantities };
  const amount = Number(order.pendingRefundAmount);
  for (const item of claim.items || []) quantities[item.skuId] = Math.max(0, Number(quantities[item.skuId] || 0) - Number(item.quantity || 0));
  const patch = {
    pendingRefundQuantities: quantities,
    // 审核可能降低退款金额，释放的仍是申请时占用的上限。
    pendingRefundAmount: Math.max(0, amount - Number(claim.reservedRefundAmount ?? claim.refundRequestAmount ?? claim.amount ?? 0)),
    updatedAt: timestamp,
  };
  if (persist) {
    const result = await tx.collection(COLLECTIONS.orders).doc(order._id || order.orderNo).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
  }
  return patch;
}

async function finishSimulatedRefund(tx, afterSale, order, timestamp) {
  if (afterSale.status === STATUS.refunded) return { ...afterSale, _id: afterSale._id };
  const isReturn = Number(afterSale.type) === 10;
  if ((isReturn && afterSale.status !== STATUS.refunding) || (!isReturn && afterSale.status !== STATUS.pendingReview && afterSale.status !== STATUS.approved)) {
    throw errorFrom('ORDER_STATE_INVALID');
  }
  if (order.payment?.mode !== 'simulated' || order.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
  const paidAmount = Number(order.paymentAmount ?? order.payment?.amount ?? order.totalAmount);
  const amount = Number(afterSale.amount ?? afterSale.refundRequestAmount);
  if (!Number.isSafeInteger(paidAmount) || !Number.isSafeInteger(amount) || amount <= 0) throw errorFrom('INVALID_ARGUMENT', { field: 'refundAmount' });
  const hasRefundAggregate = order.refundedQuantities && typeof order.refundedQuantities === 'object'
    && Number.isSafeInteger(Number(order.refundAmount));
  if (!hasRefundAggregate) throw errorFrom('ORDER_STATE_INVALID');
  const settledAmount = Number(order.refundAmount);
  if (settledAmount + amount > paidAmount) throw errorFrom('CONFLICT', { field: 'refundAmount' });
  const refundedQuantities = { ...order.refundedQuantities };
  const bought = new Map((order.items || []).map((item) => [item.skuId, Number(item.quantity || 0)]));
  for (const item of afterSale.items || []) {
    const total = Number(refundedQuantities[item.skuId] || 0) + Number(item.quantity || 0);
    if (!bought.has(item.skuId) || total > bought.get(item.skuId)) throw errorFrom('CONFLICT', { field: 'rightsQuantity' });
    refundedQuantities[item.skuId] = total;
  }
  const cumulativeRefund = settledAmount + amount;
  const fullRefund = cumulativeRefund >= paidAmount;
  const allItemsRefunded = (order.items || []).every((item) => Number(refundedQuantities[item.skuId] || 0) >= Number(item.quantity));
  const refundClosed = fullRefund || allItemsRefunded;
  const previouslyFulfilled = order.fulfillmentStatus || order.status;
  const orderPatch = {
    refundAmount: cumulativeRefund,
    refundedQuantities,
    ...await pendingAggregate(tx, order, afterSale, timestamp, false),
    paymentStatus: fullRefund ? 'refunded' : 'partially_refunded',
    status: refundClosed ? STATUS.refunded : order.status,
    fulfillmentStatus: previouslyFulfilled,
    ...(refundClosed ? { closureScenario: previouslyFulfilled === STATUS.paid ? 'cancel_order' : 'after_sale' } : {}),
    ...(refundClosed && previouslyFulfilled === STATUS.paid ? { inventoryReserved: false } : {}),
    ...(refundClosed ? { refundedAt: timestamp } : {}),
    updatedAt: timestamp,
  };
  const restoreInventory = (previouslyFulfilled === STATUS.paid && !isReturn) || isReturn;
  if (restoreInventory) {
    for (const item of afterSale.items || []) {
      const skuId = item.skuSnapshot?._id || item.skuId;
      const sku = await getDoc(tx.collection(COLLECTIONS.skus), skuId, true);
      const quantity = Number(item.quantity || 0);
      const result = await tx.collection(COLLECTIONS.skus).doc(skuId).update({
        stockQuantity: skuStock(sku) + quantity,
        soldQuantity: Math.max(0, valueNumber(sku.soldQuantity, 0) - quantity),
        updatedAt: timestamp,
      });
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
    }
  }
  const orderResult = await tx.collection(COLLECTIONS.orders).doc(order._id || order.orderNo).update(orderPatch);
  if (affected(orderResult) !== 1) throw errorFrom('CONFLICT');
  const refundPatch = {
    scenario: scenarioOf(afterSale),
    amount,
    type: afterSale.type,
    requestedType: afterSale.requestedType ?? afterSale.type,
    decidedType: afterSale.decidedType ?? afterSale.type,
    reviewedAt: afterSale.reviewedAt ?? timestamp,
    status: STATUS.refunded,
    refundMode: 'simulated',
    refundedAt: timestamp,
    refundTransactionId: `sim_refund_${afterSale._id}`,
    updatedAt: timestamp,
  };
  const afterSaleResult = await tx.collection(COLLECTIONS.afterSales).doc(afterSale._id).update(refundPatch);
  if (affected(afterSaleResult) !== 1) throw errorFrom('CONFLICT');
  return { ...afterSale, ...refundPatch, order: { ...order, ...orderPatch }, _id: afterSale._id };
}

async function afterSalesAction(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const afterSales = collection(runtime, COLLECTIONS.afterSales);
  if (action === 'afterSales.list') {
    const paging = page(data);
    const where = { userId: identity.uid };
    const statuses = data.status === 'closed' ? [STATUS.rejected, STATUS.withdrawn] : null;
    if (statuses && runtime.db.command?.in) where.status = runtime.db.command.in(statuses);
    else if (data.status && !statuses) where.status = String(data.status);
    if (data.type !== undefined && data.type !== '') where.type = afterSaleType(data.type);
    if (data.orderId || data.orderNo) where.orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
    if (statuses && !runtime.db.command?.in) {
      const rows = (await all(afterSales, where)).filter((item) => statuses.includes(item.status))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b._id).localeCompare(String(a._id)));
      return { items: rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize).map(presentAfterSale), ...paging, total: rows.length };
    }
    const result = await list(afterSales, { where, orderBy: { field: 'createdAt', direction: 'desc' }, skip: (paging.page - 1) * paging.pageSize, limit: paging.pageSize });
    return { items: result.items.map(presentAfterSale), page: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? result.items.length : result.total };
  }
  if (action === 'afterSales.reasons') return { items: ['质量问题', '商品错发', '商品少发', '不想要了', '其他'] };
  if (action === 'afterSales.detail') {
    const ref = string(data.afterSaleId, 'afterSaleId', { max: 128 });
    const item = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!item) throw errorFrom('NOT_FOUND');
    if (item.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    const response = presentAfterSale(item);
    if (data.includeDeliveryCompanies) return { ...response, deliveryCompanyList: [] };
    return response;
  }
  if (action === 'afterSales.confirmReceived') {
    return updateOrderState(runtime, event, context, data, 'orders.confirmReceived');
  }
  if (action === 'afterSales.withdraw') {
    const ref = string(data.afterSaleId, 'afterSaleId', { max: 128 });
    const existing = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!existing) throw errorFrom('NOT_FOUND');
    if (existing.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.afterSales), existing._id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status !== STATUS.pendingReview && current.status !== STATUS.withdrawn) throw errorFrom('ORDER_STATE_INVALID');
      const timestamp = now();
      const order = await getDoc(tx.collection(COLLECTIONS.orders), current.orderId, true);
      if (current.status === STATUS.pendingReview) await pendingAggregate(tx, order, current, timestamp);
      await tx.collection(COLLECTIONS.orders).doc(current.orderId).update({
        afterSaleIds: (order.afterSaleIds || []).filter((id) => id !== existing._id),
        updatedAt: timestamp,
      });
      await tx.collection(COLLECTIONS.afterSales).doc(existing._id).remove();
      return { _id: existing._id, deleted: true };
    });
  }
  if (action === 'afterSales.submitTracking') {
    const ref = string(data.afterSaleId, 'afterSaleId', { max: 128 });
    const item = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!item) throw errorFrom('NOT_FOUND');
    if (item.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (item.status !== STATUS.approved || Number(item.type) !== 10) throw errorFrom('ORDER_STATE_INVALID');
    const trackingNo = string(data.trackingNo, 'trackingNo', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.afterSales), item._id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status !== STATUS.approved || Number(current.type) !== 10) throw errorFrom('ORDER_STATE_INVALID');
      const patch = {
        trackingNo,
        logisticsNo: trackingNo,
        logisticsCompanyName: optionalString(data.logisticsCompanyName, 'logisticsCompanyName', { max: 120 }) || '',
        logisticsCompanyCode: optionalString(data.logisticsCompanyCode, 'logisticsCompanyCode', { max: 80 }) || '',
        status: STATUS.refunding,
        submittedTrackingAt: now(),
        updatedAt: now(),
      };
      const result = await tx.collection(COLLECTIONS.afterSales).doc(item._id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, _id: item._id };
    });
  }
  if (action === 'afterSales.reapply') {
    const id = string(data.afterSaleId, 'afterSaleId', { max: 128 });
    const previous = await getDoc(afterSales, id, true);
    if (previous.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (previous.status !== STATUS.rejected) throw errorFrom('ORDER_STATE_INVALID');
    const order = await getDoc(collection(runtime, COLLECTIONS.orders), previous.orderId, true);
    if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    return submitAfterSale(runtime, identity, order, data, id);
  }
  const orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
  const order = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, true);
  if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  if (action === 'afterSales.preview') {
    const configuredAddress = await returnAddressFrom(collection(runtime, COLLECTIONS.settings));
    const allowedStatuses = [STATUS.paid, STATUS.shipped, STATUS.received, STATUS.completed];
    const decorated = await orderWithComments(runtime, order);
    const scenario = scenarioForOrder(order);
    const policy = policyForScenario(scenario);
    const response = { orderId, scenario, applicationPolicy: policy, items: decorated.items, allowed: allowedStatuses.includes(order.status), allowedTypes: policy.allowedTypes, returnAddressConfigured: Boolean(configuredAddress) };
    if (data.includeReasons) response.rightsReasonList = ['质量问题', '商品错发', '商品少发', '不想要了', '其他'].map((item) => ({ id: item, desc: item }));
    return response;
  }
  if (action !== 'afterSales.create') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  if (data.reapplyId || data.afterSaleId) throw errorFrom('INVALID_ARGUMENT', { field: 'reapplyId', action: 'afterSales.reapply' });
  return submitAfterSale(runtime, identity, order, data);
}

// 创建与重提入口分离；占用金额/数量、权限和写入由同一事务流程保障。
async function submitAfterSale(runtime, identity, order, data, reapplyId = '') {
  const orderId = order._id || order.orderNo;
  const afterSales = collection(runtime, COLLECTIONS.afterSales);
  const reason = string(data.reason, 'reason', { max: 200 });
  const description = optionalString(data.description, 'description', { max: 1000 }) || '';
  const sourceImages = data.images === undefined ? [] : array(data.images, 'images');
  assert(sourceImages.length <= 3, { field: 'images', max: 3 });
  const images = sourceImages.map((image) => string(image, 'images[]', { max: 1024 }));
  const type = afterSaleType(data.type);
  if (![STATUS.paid, STATUS.shipped, STATUS.received, STATUS.completed].includes(order.status)) throw errorFrom('ORDER_STATE_INVALID');
  if (!policyForScenario(scenarioForOrder(order)).allowedTypes.includes(type)) throw errorFrom('ORDER_STATE_INVALID');
  if (order.payment?.mode !== 'simulated' || order.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
  const id = reapplyId || `as_${crypto.randomUUID()}`;
  // 旧订单可能未保存售后索引；索引不参与金额/数量校验，只在本次写入时补齐。
  // 查询放在事务外；事务内优先使用最新索引，保留并发申请已写入的记录。
  const legacyAfterSaleIds = order.afterSaleIds === undefined
    ? (await all(afterSales, { orderId: order._id || orderId })).map((record) => record._id)
    : [];
  return withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const current = await getDoc(orders, order._id || orderId, true);
    if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (![STATUS.paid, STATUS.shipped, STATUS.received, STATUS.completed].includes(current.status)) throw errorFrom('ORDER_STATE_INVALID');
    const scenario = scenarioForOrder(current);
    const policy = policyForScenario(scenario);
    if (!policy.allowedTypes.includes(type)) throw errorFrom('ORDER_STATE_INVALID');
    if (current.payment?.mode !== 'simulated' || current.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
    const receiptStatus = data.receiptStatus === undefined
      ? (policy.receiptStatus ?? 1)
      : integer(data.receiptStatus, 'receiptStatus', { min: 1, max: 2 });
    if (policy.receiptStatus !== null) assert(receiptStatus === policy.receiptStatus, { field: 'receiptStatus' });
    if ([STATUS.received, STATUS.completed].includes(current.status)) assert(receiptStatus === 1, { field: 'receiptStatus' });
    const items = requestedAfterSaleItems(current, data);
    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const txAfterSales = tx.collection(COLLECTIONS.afterSales);
    if (reapplyId) {
      const previous = await getDoc(txAfterSales, reapplyId, true);
      if (previous.userId !== identity.uid || previous.orderId !== (current._id || orderId)) throw errorFrom('FORBIDDEN');
      if (previous.status !== STATUS.rejected) throw errorFrom('ORDER_STATE_INVALID');
    }
    const priorIds = current.afterSaleIds === undefined ? legacyAfterSaleIds : current.afterSaleIds;
    const hasCurrentAggregates = current.refundedQuantities && typeof current.refundedQuantities === 'object'
      && current.pendingRefundQuantities && typeof current.pendingRefundQuantities === 'object'
      && Number.isSafeInteger(Number(current.refundAmount)) && Number.isSafeInteger(Number(current.pendingRefundAmount));
    if (!hasCurrentAggregates || !Array.isArray(priorIds)) throw errorFrom('ORDER_STATE_INVALID');
    const refundedQuantities = { ...current.refundedQuantities };
    const activeQuantities = { ...current.pendingRefundQuantities };
    const activeAmount = Number(current.pendingRefundAmount);
    const settledAmount = Number(current.refundAmount);
    if (current.paymentStatus === 'refunded') throw errorFrom('ORDER_STATE_INVALID');
    for (const item of items) {
      const bought = (current.items || []).find((snapshot) => snapshot.skuId === item.skuId);
      if (Number(activeQuantities[item.skuId] || 0) > 0) throw errorFrom('CONFLICT', { field: 'afterSale' });
      assert(item.quantity + Number(refundedQuantities[item.skuId] || 0) + Number(activeQuantities[item.skuId] || 0) <= bought.quantity, { field: 'rightsQuantity' });
    }
    const maximum = items.reduce((sum, item) => sum + item.amount, 0);
    assert(Number.isSafeInteger(maximum), { field: 'refundAmount' });
    const amount = integer(data.refundRequestAmount ?? maximum, 'refundRequestAmount', { min: 1, max: maximum });
    assert(amount === maximum, { field: 'refundRequestAmount', max: maximum });
    const paidAmount = Number(current.paymentAmount ?? current.payment?.amount ?? current.totalAmount);
    assert(settledAmount + activeAmount + amount <= paidAmount, { field: 'refundRequestAmount', max: Math.max(0, paidAmount - settledAmount - activeAmount) });
    const timestamp = now();
    const item = { _id: id, userId: identity.uid, orderId: current._id || orderId, orderNo: current.orderNo || orderId,
      productId: productIds[0], productIds, type, requestedType: type, reason, description, images, items,
      scenario, orderStatusAtApply: current.status,
      receiptStatus, amount, refundRequestAmount: amount, reservedRefundAmount: amount, status: STATUS.pendingReview,
      createdAt: timestamp, updatedAt: timestamp };
    await setDoc(txAfterSales, id, item);
    const pendingRefundQuantities = { ...activeQuantities };
    items.forEach((claim) => { pendingRefundQuantities[claim.skuId] = Number(pendingRefundQuantities[claim.skuId] || 0) + claim.quantity; });
    await orders.doc(current._id || orderId).update({
      afterSaleIds: Array.from(new Set([...priorIds, id])),
      pendingRefundQuantities,
      pendingRefundAmount: activeAmount + amount,
      updatedAt: timestamp,
    });
    return presentAfterSale(item);
  });
}

async function moderateAfterSale(runtime, data) {
  const id = string(data.id, 'afterSaleId', { max: 128 });
  const rawDecision = data.status;
  const decision = [STATUS.approved, STATUS.rejected].includes(rawDecision) ? rawDecision : undefined;
  if (![STATUS.approved, STATUS.rejected].includes(decision)) throw errorFrom('INVALID_ARGUMENT', { field: 'status' });
  const existing = await findDoc(runtime, COLLECTIONS.afterSales, id, 'rightsNo');
  if (!existing) throw errorFrom('NOT_FOUND');
  if (existing.status === STATUS.refunded && decision === STATUS.approved) return existing;
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(COLLECTIONS.afterSales), existing._id, true);
    if (current.status === STATUS.refunded && decision === STATUS.approved) return current;
    if (current.status === STATUS.approved && decision === STATUS.approved && Number(current.type) === 10) return current;
    if (current.status !== STATUS.pendingReview) throw errorFrom('ORDER_STATE_INVALID');
    const order = await getDoc(tx.collection(COLLECTIONS.orders), current.orderId, true);
    const timestamp = now();
    if (decision === STATUS.rejected) {
      const reason = optionalString(data.reason || data.reply, 'reason', { max: 1000 }) || '';
      await pendingAggregate(tx, order, current, timestamp);
      const patch = { scenario: scenarioOf(current), status: STATUS.rejected, reviewReason: reason, reviewedAt: timestamp, updatedAt: timestamp };
      const result = await tx.collection(COLLECTIONS.afterSales).doc(existing._id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, _id: existing._id };
    }
    const scenario = scenarioOf(current);
    const policy = policyForScenario(scenario);
    const type = afterSaleType(data.type ?? policy.fixedType ?? current.type);
    if (!policy.allowedTypes.includes(type)) throw errorFrom('ORDER_STATE_INVALID');
    if ((order.fulfillmentStatus || order.status) === STATUS.paid && type !== 20) throw errorFrom('ORDER_STATE_INVALID');
    const maximum = (current.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const paidAmount = Number(order.paymentAmount ?? order.payment?.amount ?? order.totalAmount);
    const reservedAmount = Number(current.reservedRefundAmount ?? current.refundRequestAmount ?? current.amount);
    const otherPendingAmount = Math.max(0, Number(order.pendingRefundAmount) - reservedAmount);
    const limit = Math.min(maximum, reservedAmount, paidAmount - Number(order.refundAmount) - otherPendingAmount);
    assert(Number.isSafeInteger(limit) && limit >= 1, { field: 'amount' });
    const amount = integer(data.amount ?? (policy.fullRefundOnly ? reservedAmount : current.amount), 'amount', { min: 1, max: limit });
    if (policy.fullRefundOnly) assert(amount === reservedAmount, { field: 'amount', expected: reservedAmount });
    const decisionPatch = { scenario, amount, type, requestedType: current.requestedType ?? current.type, decidedType: type, reviewedAt: timestamp };
    if (type === 20) {
      if (order.payment?.mode !== 'simulated' || order.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
      return finishSimulatedRefund(tx, { ...current, ...decisionPatch, status: STATUS.approved }, order, timestamp);
    }
    const address = await returnAddressFrom(tx.collection(COLLECTIONS.settings));
    if (!address) throw errorFrom('RETURN_ADDRESS_REQUIRED');
    const patch = { ...decisionPatch, status: STATUS.approved, returnAddressSnapshot: clone(address), updatedAt: timestamp };
    const result = await tx.collection(COLLECTIONS.afterSales).doc(existing._id).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...current, ...patch, _id: existing._id };
  });
}

async function confirmAfterSaleReturn(runtime, data) {
  const id = string(data.afterSaleId, 'afterSaleId', { max: 128 });
  const existing = await findDoc(runtime, COLLECTIONS.afterSales, id, 'rightsNo');
  if (!existing) throw errorFrom('NOT_FOUND');
  if (existing.status === STATUS.refunded) return existing;
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(COLLECTIONS.afterSales), existing._id, true);
    if (current.status === STATUS.refunded) return current;
    if (current.status !== STATUS.refunding || Number(current.type) !== 10) throw errorFrom('ORDER_STATE_INVALID');
    const order = await getDoc(tx.collection(COLLECTIONS.orders), current.orderId, true);
    return finishSimulatedRefund(tx, current, order, now());
  });
}

async function shopEndpoint(event, context, runtime, action, data) {
  runtime = require('./image-lifecycle').imageLifecycleRuntime(runtime);
  if (action === 'categories.list') return readCategories(runtime, data);
  if (action === 'products.list') return readProducts(runtime, data);
  if (action === 'products.detail') return readProductDetail(runtime, data);
  if (action === 'skus.list') return readSkus(runtime, data);
  if (action === 'home.get') return readHome(runtime, data);
  if (action === 'storage.tempUrls') {
    requireUser(event, context, runtime);
    return getTempFileURLs(runtime, data.fileList, { allowedPrefixes: ['admin/products/', 'products/', 'admin/categories/', 'categories/', 'comments/', 'after-sales/', 'user/comments/', 'user/after-sales/', 'home/', 'public/'] });
  }
  if (action === 'storage.processImage') {
    requireUser(event, context, runtime);
    return processStagedImage(runtime, data.fileID, ['user/comments', 'user/after-sales']);
  }
  if (action === 'user.me' || action === 'user.update') return getOrCreateUser(runtime, requireUser(event, context, runtime), data);
  if (action.startsWith('searchHistory.')) return searchHistoryAction(runtime, event, context, data, action);
  if (action.startsWith('addresses.')) return addressAction(runtime, event, context, data, action);
  if (action.startsWith('cart.')) return cartAction(runtime, event, context, data, action);
  if (action === 'orders.preview') return previewOrder(runtime, event, context, data);
  if (action === 'orders.create') return createOrder(runtime, event, context, data);
  if (action === 'orders.checkout') return checkoutDetail(runtime, event, context, data);
  if (action === 'orders.list') return listOrders(runtime, event, context, data);
  if (action === 'orders.count') return orderCount(runtime, event, context);
  if (action === 'orders.businessTime') return { telephone: '' };
  if (action === 'orders.detail') return orderDetail(runtime, event, context, data);
  if (action === 'orders.confirmReceived' || action === 'orders.delete' || action === 'orders.updateAddress') return updateOrderState(runtime, event, context, data, action);
  if (action.startsWith('comments.')) return commentsAction(runtime, event, context, data, action);
  if (action.startsWith('afterSales.')) return afterSalesAction(runtime, event, context, data, action);
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

module.exports = { shopEndpoint, normalizeOrderItems, skuPrice, skuStock, moderateAfterSale, confirmAfterSaleReturn };
