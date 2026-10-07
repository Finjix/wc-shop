// @ts-nocheck

const crypto = require('crypto');
const {
  COLLECTIONS, STATUS,
} = require('./constants');
const { errorFrom } = require('./errors');
const { getDoc, setDoc, list, all, count, listData, affected, withTransaction } = require('./db');
const { HOME_CONFIG_SLOT, productIds } = require('./home-config');
const { requireUser } = require('./auth');
const { getTempFileURLs } = require('./storage');
const { processStagedImage } = require('./image-upload');
const {
  assert, string, optionalString, integer, object, array, page, clone,
} = require('./validation');

function now() { return new Date().toISOString(); }

function valueNumber(value, fallback) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function collection(runtime, name) { return runtime.db.collection(name); }

async function findDoc(runtime, name, id, field) {
  const direct = await getDoc(collection(runtime, name), id, false);
  if (direct) return direct;
  if (!field) return null;
  const result = await collection(runtime, name).where({ [field]: id }).limit(1).get();
  return listData(result)[0] || null;
}

function skuPrice(sku) {
  if (sku.salePrice !== undefined) return valueNumber(sku.salePrice, 0);
  if (sku.price !== undefined) return valueNumber(sku.price, 0);
  if (Array.isArray(sku.priceInfo)) {
    const sale = sku.priceInfo.find((item) => item.priceType === 1) || sku.priceInfo[0];
    return valueNumber(sale && sale.price, 0);
  }
  return 0;
}

function skuStock(sku) {
  if (sku.stockQuantity !== undefined) return valueNumber(sku.stockQuantity, -1);
  if (sku.stock !== undefined) return valueNumber(sku.stock, -1);
  if (sku.stockInfo && sku.stockInfo.stockQuantity !== undefined) return valueNumber(sku.stockInfo.stockQuantity, -1);
  return -1;
}

function productIdForSku(sku) { return sku.productId || sku.spuId || sku.productRef; }

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

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
  const product = await findDoc(runtime, COLLECTIONS.products, id, 'spuId');
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
    'minLinePrice', 'maxLinePrice', 'soldQuantity', 'soldNum', 'spuStockQuantity', 'status', 'createdAt',
    'updatedAt', 'desc', 'specList', 'video', 'available', 'isPutOnSale',
  ]);
}

function publicSku(sku) {
  if (!sku) return sku;
  const result = pick(sku, [
    '_id', 'skuId', 'productId', 'spuId', 'specInfo', 'skuImage', 'salePrice', 'linePrice',
    'stockQuantity', 'stockInfo', 'priceInfo', 'weight', 'volume', 'soldQuantity', 'safeStockQuantity',
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
  let keyword;
  if (data.keyword) {
    keyword = string(data.keyword, 'keyword', { max: 80 });
    if (typeof runtime.db.RegExp === 'function') where.title = runtime.db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
  }
  const sort = Number(data.sort);
  const orderField = data.orderBy === 'price' || sort === 1 ? 'minSalePrice' : sort === 2 ? 'soldQuantity' : sort === 3 ? 'createdAt' : 'sort';
  const result = await list(collection(runtime, COLLECTIONS.products), {
    where,
    orderBy: { field: orderField, direction: data.direction === 'asc' ? 'asc' : 'desc' },
    skip: (paging.page - 1) * paging.pageSize,
    limit: paging.pageSize,
  });
  let items = result.items;
  if (keyword && typeof runtime.db.RegExp !== 'function') {
    const normalizedKeyword = keyword.toLowerCase();
    items = items.filter((item) => `${item.title || ''} ${item.etitle || ''}`.toLowerCase().includes(normalizedKeyword));
  }
  return { items: items.map(publicProduct), page: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
}

async function readProductDetail(runtime, data) {
  const id = string(data.productId || data.spuId, 'productId', { max: 128 });
  const product = await getActiveProduct(runtime, id, true);
  const refs = Array.from(new Set([product._id, product.spuId].filter(Boolean).map(String)));
  const batches = [];
  for (const ref of refs) {
    batches.push(await list(collection(runtime, COLLECTIONS.skus), { where: { productId: ref } }));
    batches.push(await list(collection(runtime, COLLECTIONS.skus), { where: { spuId: ref } }));
  }
  const skus = Array.from(new Map(batches.flatMap((batch) => batch.items).map((sku) => [String(sku._id || sku.skuId), sku])).values())
    .filter((sku) => skuBelongsToProduct(product, sku));
  return { product: publicProduct(product), skus: skus.map(publicSku) };
}

async function readSkus(runtime, data) {
  const ref = data.productId || data.spuId;
  if (ref) {
    const id = string(ref, 'productId', { max: 128 });
    const product = await getActiveProduct(runtime, id, false);
    if (!product) return { items: [], total: 0 };
    const byProduct = await list(collection(runtime, COLLECTIONS.skus), { where: { productId: id } });
    const bySpu = await list(collection(runtime, COLLECTIONS.skus), { where: { spuId: id } });
    const items = Array.from(new Map([...byProduct.items, ...bySpu.items].map((sku) => [String(sku._id || sku.skuId), sku])).values())
      .filter((sku) => skuBelongsToProduct(product, sku));
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
  const where = { status: STATUS.active };
  if (data.slot) where.slot = string(data.slot, 'slot', { max: 64 });
  const result = await list(collection(runtime, COLLECTIONS.homeContents), { where, orderBy: { field: 'sort', direction: 'asc' } });
  const items = result.items.map((item) => pick(item, ['_id', 'slot', 'type', 'title', 'subtitle', 'content', 'image', 'link', 'payload', 'sort']));
  const config = items.find((item) => item.slot === HOME_CONFIG_SLOT && item.type === 'pageConfig')?.payload || null;
  const ids = productIds(config);
  const products = await Promise.all(ids.map((id) => getActiveProduct(runtime, id, false)));
  const productsById = Object.fromEntries(ids.flatMap((id, index) => products[index] ? [[id, publicProduct(products[index])]] : []));
  return { items, config, productsById, total: result.total === undefined ? items.length : result.total };
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
  const value = object(data.address || data, 'address');
  const result = {
    receiver: string(value.receiver || value.name, 'receiver', { max: 60 }),
    phone: string(value.phone, 'phone', { max: 32 }),
    province: optionalString(value.province, 'province', { max: 60 }),
    city: optionalString(value.city, 'city', { max: 60 }),
    district: optionalString(value.district, 'district', { max: 60 }),
    detail: string(value.detail || value.address, 'detail', { max: 240 }),
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

function orderInput(data = {}) {
  const parameter = data.parameter;
  if (typeof parameter === 'string') return { ...data, orderNo: parameter };
  if (parameter && typeof parameter === 'object' && !Array.isArray(parameter)) return { ...data, ...parameter };
  return data;
}

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
  const items = normalizeOrderItems(source || input.items || input.goodsRequestList);
  const addressInfo = input.userAddressReq || input.address || {};
  const addressRef = input.addressId || addressInfo.addressId || addressInfo.id || addressInfo._id;
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
  const items = cart ? cart.items : (input.items || input.goodsRequestList);
  const source = cart ? cart.items.filter((item) => item.isSelected).map((item) => ({ skuId: item.skuId, quantity: item.quantity })) : items;
  // Only preview may omit an address; order creation always requires an owned address.
  return orderDraft(runtime, identity, input, source, false);
}

async function orderIdFor(runtime, userId, requestKey) {
  const hash = crypto.createHash('sha256').update(`${userId}:${requestKey}`).digest('hex').slice(0, 32);
  // 保留旧请求的重试兼容，历史订单 ID 不迁移。
  const legacy = await getDoc(collection(runtime, COLLECTIONS.orders), `ord_${hash}`, false);
  if (legacy) return legacy._id || `ord_${hash}`;
  return withTransaction(runtime.db, async (tx) => {
    const requests = tx.collection(COLLECTIONS.orderRequests);
    const existing = await getDoc(requests, hash, false);
    if (existing?.cancelled) throw errorFrom('ORDER_STATE_INVALID');
    if (existing) return existing.orderId;
    let orderId;
    do {
      orderId = `${Date.now()}-${String(crypto.randomInt(0, 10000)).padStart(4, '0')}`;
    } while (await getDoc(requests, `id_${orderId}`, false)
      || await getDoc(tx.collection(COLLECTIONS.orders), orderId, false));
    await setDoc(requests, `id_${orderId}`, { _id: `id_${orderId}`, orderId, userId });
    await setDoc(requests, hash, { _id: hash, userId, requestKey, orderId, createdAt: now() });
    return orderId;
  });
}

async function createOrder(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const requestKey = string(input.requestKey || input.idempotencyKey, 'requestKey', { max: 128 });
  const orderId = await orderIdFor(runtime, identity.uid, requestKey);
  const addressInfo = input.userAddressReq || input.address || {};
  const addressId = String(input.addressId || addressInfo.addressId || addressInfo.id || addressInfo._id || '');
  const requestMode = input.useCart ? 'cart' : 'direct';
  const remark = input.remark || '';
  const explicitItems = Array.isArray(input.items) && input.items.length ? input.items
    : Array.isArray(input.goodsRequestList) && input.goodsRequestList.length ? input.goodsRequestList : null;
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
      if (existing.requestHash && existing.requestHash !== requestHash) throw errorFrom('IDEMPOTENCY_CONFLICT');
    } else if (!matchesCartRetry(existing)) throw errorFrom('IDEMPOTENCY_CONFLICT');
    return existing;
  }
  const cart = input.useCart ? await getCart(runtime, identity) : null;
  const cartItems = cart?.items.filter((item) => item.isSelected).map((item) => ({ skuId: item.skuId, quantity: item.quantity })) || [];
  if (input.useCart && !explicitNormalized && !cartItems.length) {
    const raced = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, false);
    if (raced && matchesCartRetry(raced)) return raced;
    throw errorFrom('INVALID_ARGUMENT', { field: 'items' });
  }
  const source = explicitNormalized || (input.useCart ? cartItems : input.items || input.goodsRequestList);
  const normalizedItems = explicitNormalized || normalizeOrderItems(source);
  const requestHash = hashRequest(normalizedItems);
  const concurrent = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, false);
  if (concurrent) {
    if (concurrent.requestHash && concurrent.requestHash !== requestHash && !matchesCartRetry(concurrent)) throw errorFrom('IDEMPOTENCY_CONFLICT');
    return concurrent;
  }
  const draft = await orderDraft(runtime, identity, input, normalizedItems);
  const result = await withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const race = await getDoc(orders, orderId, false);
    if (race) {
      if (race.requestHash && race.requestHash !== requestHash) throw errorFrom('IDEMPOTENCY_CONFLICT');
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
    const order = {
      _id: orderId,
      orderNo: orderId,
      userId: identity.uid,
      requestKey: requestKey || null,
      requestHash,
      requestMode,
      requestAddressId: addressId,
      requestRemark: remark,
      status: STATUS.paid,
      paymentStatus: 'paid',
      payment: { mode: 'simulated', status: 'paid', amount: subtotal + draft.shippingFee, transactionId: `sim_${orderId}`, paidAt: timestamp },
      paymentAmount: subtotal + draft.shippingFee,
      paidAt: timestamp,
      inventoryReserved: true,
      refundAmount: 0,
      refundedQuantities: {},
      pendingRefundAmount: 0,
      pendingRefundQuantities: {},
      items: confirmedItems,
      addressSnapshot: clone(confirmedAddress),
      subtotal,
      shippingFee: draft.shippingFee,
      totalAmount: subtotal + draft.shippingFee,
      hasPendingComments: true,
      commentedProductIds: [],
      remark: optionalString(input.remark, 'remark', { max: 240 }) || '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await setDoc(orders, orderId, order);
    if (cart) {
      const storedCart = await getDoc(tx.collection(COLLECTIONS.carts), identity.uid, false);
      const orderedSkuIds = new Set(draft.items.map((item) => String(item.skuId)));
      const remaining = (storedCart?.items || []).filter((item) => !item.isSelected || !orderedSkuIds.has(String(item.skuId)));
      await setDoc(tx.collection(COLLECTIONS.carts), identity.uid, { _id: identity.uid, userId: identity.uid, items: remaining, updatedAt: timestamp });
    }
    return order;
  });
  return { ...result, paymentRequired: false };
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
    80: [STATUS.cancelled],
  };
  const where = { userId: identity.uid };
  const statuses = statusGroups[requested] || (requested ? [String(requested)] : null);
  if (statuses?.length === 1 && statuses[0] === STATUS.cancelled) {
    return { items: [], page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: 0 };
  }
  if (!statuses && runtime.db.command?.neq) where.status = runtime.db.command.neq(STATUS.cancelled);
  if (statuses && statuses.length === 1) where.status = statuses[0];
  else if (statuses && runtime.db.command?.in) where.status = runtime.db.command.in(statuses);
  if (runtime.db.command?.neq) where.deletedByUser = runtime.db.command.neq(true);
  if (input.pendingCommentOnly || !runtime.db.command?.neq || (statuses && statuses.length > 1 && !runtime.db.command?.in)) {
    let rows = (await all(collection(runtime, COLLECTIONS.orders), where))
      .filter((order) => !order.deletedByUser && order.status !== STATUS.cancelled && (!statuses || statuses.includes(order.status)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b._id).localeCompare(String(a._id)));
    rows = await Promise.all(rows.map((order) => orderWithComments(runtime, order)));
    if (input.pendingCommentOnly) rows = rows.filter((order) => [STATUS.received, STATUS.completed].includes(order.status) && order.hasPendingComments);
    return { items: rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize), page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: rows.length };
  }
  const result = await list(collection(runtime, COLLECTIONS.orders), {
    where,
    orderBy: { field: 'createdAt', direction: 'desc' },
    skip: (paging.page - 1) * paging.pageSize,
    limit: paging.pageSize,
  });
  let items = result.items.filter((item) => !item.deletedByUser && item.status !== STATUS.cancelled);
  if (statuses && !(runtime.db.command?.in) && statuses.length > 1) items = items.filter((item) => statuses.includes(item.status));
  items = await Promise.all(items.map((order) => orderWithComments(runtime, order)));
  return { items, page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
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

async function orderWithComments(runtime, order, includeAfterSalesList = false) {
  const orderId = order._id || order.orderNo;
  const hasRefundAggregate = order.refundedQuantities && typeof order.refundedQuantities === 'object';
  const hasPendingAggregate = order.pendingRefundQuantities && typeof order.pendingRefundQuantities === 'object';
  const afterSales = includeAfterSalesList || !hasRefundAggregate || !hasPendingAggregate
    ? await all(collection(runtime, COLLECTIONS.afterSales), { orderId }) : [];
  const active = afterSales.filter((item) => [STATUS.pendingReview, STATUS.approved, STATUS.refunding].includes(item.status));
  const refundedQuantities = hasRefundAggregate ? { ...order.refundedQuantities } : {};
  const pendingRefundQuantities = hasPendingAggregate ? { ...order.pendingRefundQuantities } : {};
  for (const item of afterSales) {
    const destination = item.status === STATUS.refunded ? (hasRefundAggregate ? null : refundedQuantities)
      : [STATUS.pendingReview, STATUS.approved, STATUS.refunding].includes(item.status) ? (hasPendingAggregate ? null : pendingRefundQuantities) : null;
    if (!destination) continue;
    for (const claim of item.items || []) destination[claim.skuId] = Number(destination[claim.skuId] || 0) + Number(claim.quantity || 0);
  }
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
    ...(includeAfterSalesList ? { afterSalesList: afterSales } : {}),
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
  if (action === 'orders.cancel') {
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status === STATUS.cancelled) return { ...current, cancelled: true };
      if (current.status !== STATUS.paid || (current.fulfillmentStatus && current.fulfillmentStatus !== STATUS.paid)) throw errorFrom('ORDER_STATE_INVALID');
      const active = await transactionClaims(tx, current);
      if (Number(current.pendingRefundAmount) > 0
        || Object.values(current.pendingRefundQuantities || {}).some((quantity) => Number(quantity) > 0)
        || active.some((claim) => ACTIVE_AFTER_SALE.includes(claim.status))) throw errorFrom('CONFLICT', { field: 'afterSale' });
      if (current.payment?.mode !== 'simulated') throw errorFrom('ORDER_STATE_INVALID');
      if (current.inventoryReserved) {
        for (const item of current.items || []) {
          const quantity = Math.max(0, Number(item.quantity) - Number(current.refundedQuantities?.[item.skuId] || 0));
          if (!quantity) continue;
          const skuId = item.skuSnapshot?._id || item.skuId;
          const skus = tx.collection(COLLECTIONS.skus);
          const sku = await getDoc(skus, skuId, true);
          const result = await skus.doc(skuId).update({
            stockQuantity: skuStock(sku) + quantity,
            soldQuantity: Math.max(0, valueNumber(sku.soldQuantity, 0) - quantity),
            updatedAt: timestamp,
          });
          if (affected(result) !== 1) throw errorFrom('CONFLICT');
        }
      }
      // 保留取消标记，原创建请求重试不能重新下单。
      if (current.requestKey) {
        const hash = crypto.createHash('sha256').update(`${identity.uid}:${current.requestKey}`).digest('hex').slice(0, 32);
        await setDoc(tx.collection(COLLECTIONS.orderRequests), hash, {
          _id: hash, userId: identity.uid, orderId: id, cancelled: true, cancelledAt: timestamp,
        });
      }
      const patch = {
        status: STATUS.cancelled,
        deletedByUser: true,
        fulfillmentStatus: STATUS.cancelled,
        paymentStatus: 'refunded',
        payment: { ...current.payment, status: 'refunded', refundedAt: timestamp },
        refundAmount: current.paymentAmount ?? current.totalAmount,
        refundedQuantities: Object.fromEntries((current.items || []).map((item) => [item.skuId, item.quantity])),
        inventoryReserved: false,
        hasPendingComments: false,
        cancelledAt: timestamp,
        updatedAt: timestamp,
      };
      const result = await tx.collection(COLLECTIONS.orders).doc(id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, cancelled: true };
    });
  }
  if (action === 'orders.updateAddress') {
    const addressId = string(input.addressId || input.userAddressReq?.addressId || input.userAddressReq?.id || input.userAddressReq?._id, 'addressId', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status !== STATUS.paid) throw errorFrom('ORDER_STATE_INVALID');
      const hasPendingAggregate = current.pendingRefundQuantities && typeof current.pendingRefundQuantities === 'object'
        && Number.isSafeInteger(Number(current.pendingRefundAmount));
      const active = hasPendingAggregate ? [] : await transactionClaims(tx, current);
      const hasPending = hasPendingAggregate
        ? Number(current.pendingRefundAmount) > 0 || Object.values(current.pendingRefundQuantities).some((quantity) => Number(quantity) > 0)
        : active.some((item) => ACTIVE_AFTER_SALE.includes(item.status));
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
      if (current.userId !== identity.uid || ![STATUS.cancelled, STATUS.completed].includes(current.status)) throw errorFrom('ORDER_STATE_INVALID');
      const patch = { deletedByUser: true, updatedAt: timestamp };
      const result = await tx.collection(COLLECTIONS.orders).doc(id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch };
    });
  }
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

async function commentsAction(runtime, event, context, data, action) {
  const query = data.queryParameter && typeof data.queryParameter === 'object' ? { ...data, ...data.queryParameter } : data;
  if (action === 'comments.list') {
    const where = { status: STATUS.active };
    let ownedQuery = false;
    if (query.productId || query.spuId) where.productId = string(query.productId || query.spuId, 'productId', { max: 128 });
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
    return { items, page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
  }
  if (action === 'comments.count') {
    const where = { status: STATUS.active };
    if (data.productId || data.spuId) where.productId = string(data.productId || data.spuId, 'productId', { max: 128 });
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
  const candidateProductId = data.productId || data.spuId;
  const matchedItem = (order.items || []).find((item) => item.productId === candidateProductId || item.spuId === candidateProductId || item.productSnapshot?.spuId === candidateProductId || item.productSnapshot?._id === candidateProductId);
  const fallbackProductId = order.items && order.items[0] && order.items[0].productId;
  assert(Boolean(matchedItem || (!candidateProductId && fallbackProductId)), { field: 'productId' });
  const productId = string(matchedItem?.productId || matchedItem?.spuId || fallbackProductId, 'productId', { max: 128 });
  const duplicate = await collection(runtime, COLLECTIONS.comments).where({ userId: identity.uid, orderId: order._id || orderId, productId }).limit(1).get();
  if (listData(duplicate).length) throw errorFrom('CONFLICT', { field: 'comment' });
  const text = optionalString(data.content ?? data.commentContent, 'content', { max: 2000 }) || '';
  const sourceImages = data.images ?? data.commentResources;
  const imageList = sourceImages === undefined ? [] : array(sourceImages, 'images');
  assert(imageList.length <= 3, { field: 'images', max: 3 });
  const images = imageList.map((item) => string(typeof item === 'string' ? item : item && (item.image || item.fileID || item.fileId), 'images[]', { max: 1024 }));
  const timestamp = now();
  const rating = data.rating ?? data.commentScore;
  const comment = { userId: identity.uid, orderId: order._id || orderId, orderNo: order.orderNo || orderId, productId, rating: rating === undefined ? 5 : integer(Number(rating), 'rating', { min: 1, max: 5 }), content: text, images, hasImage: images.length > 0, status: STATUS.pendingReview, createdAt: timestamp, updatedAt: timestamp };
  const id = `comment_${crypto.createHash('sha256').update(JSON.stringify([identity.uid, order._id || orderId, productId])).digest('hex').slice(0, 32)}`;
  const annotated = await orderWithComments(runtime, order);
  return withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const current = await getDoc(orders, order._id || orderId, true);
    if (current.userId !== identity.uid || ![STATUS.received, STATUS.completed].includes(current.status)) throw errorFrom('FORBIDDEN');
    const comments = tx.collection(COLLECTIONS.comments);
    if (await getDoc(comments, id, false)) throw errorFrom('CONFLICT', { field: 'comment' });
    const claims = await transactionClaims(tx, current);
    const refunded = current.refundedQuantities && typeof current.refundedQuantities === 'object'
      ? current.refundedQuantities : quantityMapFromClaims(claims, (claim) => claim.status === STATUS.refunded);
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
  const productRef = data.productId || data.spuId;
  const ordered = order.items || [];
  const source = data.rightsItem !== undefined ? array(data.rightsItem, 'rightsItem')
    : data.skuId ? [{ skuId: data.skuId, rightsQuantity: data.rightsQuantity ?? data.quantity }]
      : ordered.filter((item) => !productRef || [item.productId, item.spuId, item.productSnapshot?._id, item.productSnapshot?.spuId].includes(productRef))
        .map((item) => ({ skuId: item.skuId, rightsQuantity: item.quantity }));
  assert(source.length > 0 && source.length <= 50, { field: 'rightsItem' });
  const seen = new Set();
  return source.map((request) => {
    object(request, 'rightsItem[]');
    const skuId = string(request.skuId, 'rightsItem.skuId', { max: 128 });
    const snapshot = ordered.find((item) => [item.skuId, item.skuSnapshot?._id, item.skuSnapshot?.skuId].includes(skuId));
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
  const mapped = ({ refund: 20, only_refund: 20, return: 10, return_goods: 10, return_refund: 10 })[value] ?? Number(value);
  assert([10, 20].includes(mapped), { field: 'type' });
  return mapped;
}

function cleanReturnAddress(value) {
  if (!value || typeof value !== 'object') return null;
  const receiver = String(value.receiver || value.name || '').trim();
  const phone = String(value.phone || '').trim();
  const detail = String(value.detail || value.address || '').trim();
  if (!receiver || !phone || !detail) return null;
  return {
    receiver, name: receiver, phone,
    province: String(value.province || '').trim(), city: String(value.city || '').trim(),
    district: String(value.district || '').trim(), detail,
  };
}

async function returnAddressFrom(settingsCollection) {
  const global = await getDoc(settingsCollection, 'global', false);
  const value = global?.value || global || {};
  return cleanReturnAddress(value.returnAddress || value.afterSaleReturnAddress);
}

async function transactionClaims(tx, order, additionalIds = []) {
  const ids = Array.from(new Set([...(order.afterSaleIds || []), ...additionalIds].filter(Boolean)));
  const result = [];
  for (const id of ids) {
    const record = await getDoc(tx.collection(COLLECTIONS.afterSales), id, false);
    if (record) result.push(record);
  }
  return result;
}

function quantityMapFromClaims(claims, predicate) {
  const result = {};
  claims.filter(predicate).forEach((claim) => (claim.items || []).forEach((item) => {
    result[item.skuId] = Number(result[item.skuId] || 0) + Number(item.quantity || 0);
  }));
  return result;
}

function amountFromClaims(claims, predicate) {
  return claims.filter(predicate).reduce((sum, claim) => sum + Number(claim.amount || claim.refundRequestAmount || 0), 0);
}

async function pendingAggregate(tx, order, claim, timestamp, persist = true) {
  const hasAggregate = order.pendingRefundQuantities && typeof order.pendingRefundQuantities === 'object'
    && Number.isSafeInteger(Number(order.pendingRefundAmount));
  const claims = hasAggregate ? [] : await transactionClaims(tx, order, [claim._id]);
  const quantities = hasAggregate ? { ...order.pendingRefundQuantities }
    : quantityMapFromClaims(claims, (item) => ACTIVE_AFTER_SALE.includes(item.status));
  const amount = hasAggregate ? Number(order.pendingRefundAmount)
    : amountFromClaims(claims, (item) => ACTIVE_AFTER_SALE.includes(item.status));
  for (const item of claim.items || []) quantities[item.skuId] = Math.max(0, Number(quantities[item.skuId] || 0) - Number(item.quantity || 0));
  const patch = {
    pendingRefundQuantities: quantities,
    pendingRefundAmount: Math.max(0, amount - Number(claim.amount || claim.refundRequestAmount || 0)),
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
  const isReturn = Number(afterSale.type ?? afterSale.rightsType) === 10;
  if ((isReturn && afterSale.status !== STATUS.refunding) || (!isReturn && afterSale.status !== STATUS.pendingReview && afterSale.status !== STATUS.approved)) {
    throw errorFrom('ORDER_STATE_INVALID');
  }
  if (order.payment?.mode !== 'simulated' || order.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
  const paidAmount = Number(order.paymentAmount ?? order.payment?.amount ?? order.totalAmount);
  const amount = Number(afterSale.amount ?? afterSale.refundRequestAmount);
  if (!Number.isSafeInteger(paidAmount) || !Number.isSafeInteger(amount) || amount <= 0) throw errorFrom('INVALID_ARGUMENT', { field: 'refundAmount' });
  const hasRefundAggregate = order.refundedQuantities && typeof order.refundedQuantities === 'object'
    && Number.isSafeInteger(Number(order.refundAmount));
  const claims = hasRefundAggregate ? [] : await transactionClaims(tx, order, [afterSale._id]);
  const refundedClaims = claims.filter((item) => item.status === STATUS.refunded && item._id !== afterSale._id);
  const settledAmount = hasRefundAggregate ? Number(order.refundAmount) : amountFromClaims(refundedClaims, () => true);
  if (settledAmount + amount > paidAmount) throw errorFrom('CONFLICT', { field: 'refundAmount' });
  const refundedQuantities = hasRefundAggregate
    ? { ...order.refundedQuantities }
    : quantityMapFromClaims(refundedClaims, () => true);
  const bought = new Map((order.items || []).map((item) => [item.skuId, Number(item.quantity || 0)]));
  for (const item of afterSale.items || []) {
    const total = Number(refundedQuantities[item.skuId] || 0) + Number(item.quantity || 0);
    if (!bought.has(item.skuId) || total > bought.get(item.skuId)) throw errorFrom('CONFLICT', { field: 'rightsQuantity' });
    refundedQuantities[item.skuId] = total;
  }
  const cumulativeRefund = settledAmount + amount;
  const fullRefund = cumulativeRefund >= paidAmount;
  const previouslyFulfilled = order.fulfillmentStatus || order.status;
  const orderPatch = {
    refundAmount: cumulativeRefund,
    refundedQuantities,
    ...await pendingAggregate(tx, order, afterSale, timestamp, false),
    paymentStatus: fullRefund ? 'refunded' : 'partially_refunded',
    status: fullRefund
      ? (previouslyFulfilled === STATUS.paid ? STATUS.cancelled : STATUS.completed)
      : order.status,
    ...(fullRefund && previouslyFulfilled === STATUS.paid ? { inventoryReserved: false } : {}),
    ...(fullRefund && previouslyFulfilled === STATUS.paid ? { cancelledAt: timestamp } : {}),
    ...(fullRefund && previouslyFulfilled !== STATUS.paid ? { completedAt: timestamp } : {}),
    updatedAt: timestamp,
  };
  if (!fullRefund && !order.fulfillmentStatus && order.status === STATUS.paid) orderPatch.fulfillmentStatus = STATUS.paid;
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
    if (data.status) where.status = String(data.status);
    if (data.type !== undefined && data.type !== '') where.type = afterSaleType(data.type);
    if (data.orderId || data.orderNo) where.orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
    const result = await list(afterSales, { where, orderBy: { field: 'createdAt', direction: 'desc' }, skip: (paging.page - 1) * paging.pageSize, limit: paging.pageSize });
    return { items: result.items, page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? result.items.length : result.total };
  }
  if (action === 'afterSales.reasons') return { items: ['质量问题', '商品错发', '商品少发', '不想要了', '其他'] };
  if (action === 'afterSales.detail') {
    const ref = string(data.afterSaleId || data.rightsNo, 'afterSaleId', { max: 128 });
    const item = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!item) throw errorFrom('NOT_FOUND');
    if (item.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (data.includeDeliveryCompanies) return { ...item, deliveryCompanyList: [] };
    return item;
  }
  if (action === 'afterSales.confirmReceived') {
    return updateOrderState(runtime, event, context, data, 'orders.confirmReceived');
  }
  if (action === 'afterSales.withdraw' || action === 'afterSales.cancel') {
    const ref = string(data.afterSaleId || data.rightsNo, 'afterSaleId', { max: 128 });
    const existing = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!existing) throw errorFrom('NOT_FOUND');
    if (existing.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.afterSales), existing._id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status === STATUS.withdrawn) return current;
      if (current.status !== STATUS.pendingReview) throw errorFrom('ORDER_STATE_INVALID');
      const timestamp = now();
      const order = await getDoc(tx.collection(COLLECTIONS.orders), current.orderId, true);
      await pendingAggregate(tx, order, current, timestamp);
      const patch = { status: STATUS.withdrawn, withdrawnAt: timestamp, updatedAt: timestamp };
      await tx.collection(COLLECTIONS.afterSales).doc(existing._id).update(patch);
      return { ...current, ...patch, _id: existing._id };
    });
  }
  if (action === 'afterSales.submitTracking') {
    const ref = string(data.afterSaleId || data.rightsNo, 'afterSaleId', { max: 128 });
    const item = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!item) throw errorFrom('NOT_FOUND');
    if (item.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (item.status !== STATUS.approved || Number(item.type ?? item.rightsType) !== 10) throw errorFrom('ORDER_STATE_INVALID');
    const trackingNo = string(data.trackingNo || data.logisticsNo, 'trackingNo', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.afterSales), item._id, true);
      if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      if (current.status !== STATUS.approved || Number(current.type ?? current.rightsType) !== 10) throw errorFrom('ORDER_STATE_INVALID');
      const patch = {
        trackingNo,
        logisticsNo: trackingNo,
        logisticsCompanyName: optionalString(data.logisticsCompanyName || data.company || data.companyName, 'logisticsCompanyName', { max: 120 }) || '',
        logisticsCompanyCode: optionalString(data.logisticsCompanyCode || data.companyCode, 'logisticsCompanyCode', { max: 80 }) || '',
        status: STATUS.refunding,
        submittedTrackingAt: now(),
        updatedAt: now(),
      };
      const result = await tx.collection(COLLECTIONS.afterSales).doc(item._id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, _id: item._id };
    });
  }
  const orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
  const order = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, true);
  if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  if (action === 'afterSales.preview') {
    const configuredAddress = await returnAddressFrom(collection(runtime, COLLECTIONS.settings));
    const allowedStatuses = [STATUS.paid, STATUS.shipped, STATUS.received, STATUS.completed];
    const decorated = await orderWithComments(runtime, order);
    const response = { orderId, items: decorated.items, allowed: allowedStatuses.includes(order.status), allowedTypes: order.status === STATUS.paid ? [20] : [10, 20], returnAddressConfigured: Boolean(configuredAddress) };
    if (data.includeReasons) response.rightsReasonList = ['质量问题', '商品错发', '商品少发', '不想要了', '其他'].map((item) => ({ id: item, desc: item }));
    return response;
  }
  if (action !== 'afterSales.create') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  const reason = string(data.reason || data.rightsReasonDesc, 'reason', { max: 120 });
  const description = optionalString(data.description || data.refundMemo, 'description', { max: 1000 }) || '';
  const sourceImages = data.images === undefined ? [] : array(data.images, 'images');
  assert(sourceImages.length <= 3, { field: 'images', max: 3 });
  const images = sourceImages.map((image) => string(image, 'images[]', { max: 1024 }));
  const type = afterSaleType(data.type ?? data.rightsType ?? 20);
  if (![STATUS.paid, STATUS.shipped, STATUS.received, STATUS.completed].includes(order.status)) throw errorFrom('ORDER_STATE_INVALID');
  if (order.status === STATUS.paid && type !== 20) throw errorFrom('ORDER_STATE_INVALID');
  if (type === 10 && !await returnAddressFrom(collection(runtime, COLLECTIONS.settings))) throw errorFrom('RETURN_ADDRESS_REQUIRED');
  if (order.payment?.mode !== 'simulated' || order.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
  const id = `as_${crypto.randomUUID()}`;
  const hasRefundAggregates = order.refundedQuantities && typeof order.refundedQuantities === 'object'
    && order.pendingRefundQuantities && typeof order.pendingRefundQuantities === 'object'
    && Number.isSafeInteger(Number(order.refundAmount)) && Number.isSafeInteger(Number(order.pendingRefundAmount));
  const legacy = hasRefundAggregates ? [] : await all(afterSales, { userId: identity.uid, orderId: order._id || orderId });
  return withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const current = await getDoc(orders, order._id || orderId, true);
    if (current.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (![STATUS.paid, STATUS.shipped, STATUS.received, STATUS.completed].includes(current.status)) throw errorFrom('ORDER_STATE_INVALID');
    if (current.status === STATUS.paid && type !== 20) throw errorFrom('ORDER_STATE_INVALID');
    if (current.payment?.mode !== 'simulated' || current.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
    const returnAddress = type === 10 ? await returnAddressFrom(tx.collection(COLLECTIONS.settings)) : null;
    if (type === 10 && !returnAddress) throw errorFrom('RETURN_ADDRESS_REQUIRED');
    const items = requestedAfterSaleItems(current, data);
    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const txAfterSales = tx.collection(COLLECTIONS.afterSales);
    const priorIds = Array.from(new Set([...legacy.map((item) => item._id), ...(current.afterSaleIds || [])].filter(Boolean)));
    const hasCurrentAggregates = current.refundedQuantities && typeof current.refundedQuantities === 'object'
      && current.pendingRefundQuantities && typeof current.pendingRefundQuantities === 'object'
      && Number.isSafeInteger(Number(current.refundAmount)) && Number.isSafeInteger(Number(current.pendingRefundAmount));
    const priorClaims = hasCurrentAggregates ? [] : await transactionClaims(tx, current, legacy.map((item) => item._id));
    const refundedQuantities = hasCurrentAggregates
      ? { ...current.refundedQuantities }
      : quantityMapFromClaims(priorClaims, (prior) => prior.status === STATUS.refunded);
    const activeQuantities = hasCurrentAggregates
      ? { ...current.pendingRefundQuantities }
      : quantityMapFromClaims(priorClaims, (prior) => ACTIVE_AFTER_SALE.includes(prior.status));
    const activeAmount = hasCurrentAggregates ? Number(current.pendingRefundAmount)
      : amountFromClaims(priorClaims, (prior) => ACTIVE_AFTER_SALE.includes(prior.status));
    const settledAmount = hasCurrentAggregates ? Number(current.refundAmount)
      : amountFromClaims(priorClaims, (prior) => prior.status === STATUS.refunded);
    if (current.paymentStatus === 'refunded') throw errorFrom('ORDER_STATE_INVALID');
    for (const item of items) {
      const bought = (current.items || []).find((snapshot) => snapshot.skuId === item.skuId);
      if (Number(activeQuantities[item.skuId] || 0) > 0) throw errorFrom('CONFLICT', { field: 'afterSale' });
      assert(item.quantity + Number(refundedQuantities[item.skuId] || 0) + Number(activeQuantities[item.skuId] || 0) <= bought.quantity, { field: 'rightsQuantity' });
    }
    const maximum = items.reduce((sum, item) => sum + item.amount, 0);
    assert(Number.isSafeInteger(maximum), { field: 'refundAmount' });
    const amount = integer(data.refundRequestAmount ?? data.rights?.refundRequestAmount ?? maximum, 'refundRequestAmount', { min: 1, max: maximum });
    assert(amount === maximum, { field: 'refundRequestAmount', max: maximum });
    const paidAmount = Number(current.paymentAmount ?? current.payment?.amount ?? current.totalAmount);
    assert(settledAmount + activeAmount + amount <= paidAmount, { field: 'refundRequestAmount', max: Math.max(0, paidAmount - settledAmount - activeAmount) });
    const timestamp = now();
    const item = { _id: id, rightsNo: id, userId: identity.uid, orderId: current._id || orderId, orderNo: current.orderNo || orderId,
      productId: productIds[0], productIds, type, reason, description, images, items,
      amount, refundRequestAmount: amount, status: STATUS.pendingReview,
      ...(returnAddress ? { returnAddressRequestedSnapshot: returnAddress } : {}),
      createdAt: timestamp, updatedAt: timestamp };
    await setDoc(txAfterSales, id, item);
    const pendingRefundQuantities = { ...activeQuantities };
    items.forEach((claim) => { pendingRefundQuantities[claim.skuId] = Number(pendingRefundQuantities[claim.skuId] || 0) + claim.quantity; });
    await orders.doc(current._id || orderId).update({
      afterSaleIds: [...priorIds, id],
      pendingRefundQuantities,
      pendingRefundAmount: activeAmount + amount,
      updatedAt: timestamp,
    });
    return item;
  });
}

async function moderateAfterSale(runtime, data) {
  const id = string(data.afterSaleId || data.id || data.rightsNo, 'afterSaleId', { max: 128 });
  const rawDecision = data.decision || data.status;
  const decision = ({ approve: STATUS.approved, approved: STATUS.approved, reject: STATUS.rejected, rejected: STATUS.rejected })[rawDecision];
  if (![STATUS.approved, STATUS.rejected].includes(decision)) throw errorFrom('INVALID_ARGUMENT', { field: 'status' });
  const existing = await findDoc(runtime, COLLECTIONS.afterSales, id, 'rightsNo');
  if (!existing) throw errorFrom('NOT_FOUND');
  if (existing.status === STATUS.refunded && decision === STATUS.approved) return existing;
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(COLLECTIONS.afterSales), existing._id, true);
    if (current.status === STATUS.refunded && decision === STATUS.approved) return current;
    if (current.status === STATUS.approved && decision === STATUS.approved && Number(current.type ?? current.rightsType) === 10) return current;
    if (current.status !== STATUS.pendingReview) throw errorFrom('ORDER_STATE_INVALID');
    const order = await getDoc(tx.collection(COLLECTIONS.orders), current.orderId, true);
    const timestamp = now();
    if (decision === STATUS.rejected) {
      const reason = optionalString(data.reason || data.reply, 'reason', { max: 1000 }) || '';
      await pendingAggregate(tx, order, current, timestamp);
      const patch = { status: STATUS.rejected, reviewReason: reason, reviewedAt: timestamp, updatedAt: timestamp };
      const result = await tx.collection(COLLECTIONS.afterSales).doc(existing._id).update(patch);
      if (affected(result) !== 1) throw errorFrom('CONFLICT');
      return { ...current, ...patch, _id: existing._id };
    }
    if (Number(current.type ?? current.rightsType) === 20) {
      if (order.payment?.mode !== 'simulated' || order.paymentStatus === 'unpaid') throw errorFrom('PAYMENT_NOT_CONFIGURED');
      return finishSimulatedRefund(tx, { ...current, status: STATUS.approved }, order, timestamp);
    }
    if (Number(current.type ?? current.rightsType) !== 10) throw errorFrom('ORDER_STATE_INVALID');
    const address = current.returnAddressRequestedSnapshot || await returnAddressFrom(tx.collection(COLLECTIONS.settings));
    if (!address) throw errorFrom('RETURN_ADDRESS_REQUIRED');
    const patch = { status: STATUS.approved, returnAddressSnapshot: clone(address), reviewedAt: timestamp, updatedAt: timestamp };
    const result = await tx.collection(COLLECTIONS.afterSales).doc(existing._id).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...current, ...patch, _id: existing._id };
  });
}

async function confirmAfterSaleReturn(runtime, data) {
  const id = string(data.afterSaleId || data.id || data.rightsNo, 'afterSaleId', { max: 128 });
  const existing = await findDoc(runtime, COLLECTIONS.afterSales, id, 'rightsNo');
  if (!existing) throw errorFrom('NOT_FOUND');
  if (existing.status === STATUS.refunded) return existing;
  return withTransaction(runtime.db, async (tx) => {
    const current = await getDoc(tx.collection(COLLECTIONS.afterSales), existing._id, true);
    if (current.status === STATUS.refunded) return current;
    if (current.status !== STATUS.refunding || Number(current.type ?? current.rightsType) !== 10) throw errorFrom('ORDER_STATE_INVALID');
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
  if (action === 'orders.list') return listOrders(runtime, event, context, data);
  if (action === 'orders.count') return orderCount(runtime, event, context);
  if (action === 'orders.businessTime') return { telphone: '', telephone: '', phone: '' };
  if (action === 'orders.detail') return orderDetail(runtime, event, context, data);
  if (action === 'orders.cancel' || action === 'orders.confirmReceived' || action === 'orders.delete' || action === 'orders.updateAddress') return updateOrderState(runtime, event, context, data, action);
  if (action.startsWith('comments.')) return commentsAction(runtime, event, context, data, action);
  if (action.startsWith('afterSales.')) return afterSalesAction(runtime, event, context, data, action);
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

module.exports = { shopEndpoint, normalizeOrderItems, skuPrice, skuStock, moderateAfterSale, confirmAfterSaleReturn };
