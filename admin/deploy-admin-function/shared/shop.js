const crypto = require('crypto');
const {
  COLLECTIONS, STATUS,
} = require('./constants');
const { errorFrom } = require('./errors');
const { getDoc, list, listData, affected, withTransaction } = require('./db');
const { requireUser } = require('./auth');
const { getTempFileURLs } = require('./storage');
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

function pick(source, fields) {
  return fields.reduce((result, field) => {
    if (source && source[field] !== undefined) result[field] = clone(source[field]);
    return result;
  }, {});
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function getActiveSku(runtime, skuId, required) {
  const sku = await findDoc(runtime, COLLECTIONS.skus, skuId, 'skuId');
  if (!sku) {
    if (required) throw errorFrom('SKU_UNAVAILABLE');
    return null;
  }
  if (sku.status !== STATUS.active) throw errorFrom('SKU_UNAVAILABLE');
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
    'status', 'createdAt', 'updatedAt',
  ]);
  result.price = skuPrice(sku);
  result.stockQuantity = skuStock(sku);
  return result;
}

async function readCategories(runtime, data) {
  const result = await list(collection(runtime, COLLECTIONS.categories), {
    where: { status: STATUS.active },
    orderBy: { field: 'sort', direction: 'asc' },
  });
  const items = result.items.map((item) => pick(item, ['_id', 'id', 'groupId', 'name', 'parentId', 'level', 'sort', 'icon', 'description']));
  return { items, total: result.total === undefined ? items.length : result.total };
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
    batches.push(await list(collection(runtime, COLLECTIONS.skus), { where: { status: STATUS.active, productId: ref } }));
    batches.push(await list(collection(runtime, COLLECTIONS.skus), { where: { status: STATUS.active, spuId: ref } }));
  }
  const skus = Array.from(new Map(batches.flatMap((batch) => batch.items).map((sku) => [String(sku._id || sku.skuId), sku])).values());
  return { product: publicProduct(product), skus: skus.map(publicSku) };
}

async function readSkus(runtime, data) {
  const ref = data.productId || data.spuId;
  if (ref) {
    const id = string(ref, 'productId', { max: 128 });
    const byProduct = await list(collection(runtime, COLLECTIONS.skus), { where: { status: STATUS.active, productId: id } });
    const bySpu = await list(collection(runtime, COLLECTIONS.skus), { where: { status: STATUS.active, spuId: id } });
    const items = Array.from(new Map([...byProduct.items, ...bySpu.items].map((sku) => [String(sku._id || sku.skuId), sku])).values());
    return { items: items.map(publicSku), total: items.length };
  }
  const result = await list(collection(runtime, COLLECTIONS.skus), { where: { status: STATUS.active } });
  return { items: result.items.map(publicSku), total: result.total === undefined ? result.items.length : result.total };
}

async function readHome(runtime, data) {
  const where = { status: STATUS.active };
  if (data.slot) where.slot = string(data.slot, 'slot', { max: 64 });
  const result = await list(collection(runtime, COLLECTIONS.homeContents), { where, orderBy: { field: 'sort', direction: 'asc' } });
  const items = result.items.map((item) => pick(item, ['_id', 'slot', 'type', 'title', 'subtitle', 'content', 'image', 'link', 'payload', 'sort']));
  return { items, total: result.total === undefined ? items.length : result.total };
}

async function getOrCreateUser(runtime, identity, data) {
  const users = collection(runtime, COLLECTIONS.users);
  const existing = await findDoc(runtime, COLLECTIONS.users, identity.uid, 'uid');
  const timestamp = now();
  const patch = {
    uid: identity.uid,
    ...(data && data.nickname !== undefined ? { nickname: optionalString(data.nickname, 'nickname', { max: 40 }) } : {}),
    ...(data && data.avatarUrl !== undefined ? { avatarUrl: optionalString(data.avatarUrl, 'avatarUrl', { max: 1024 }) } : {}),
    updatedAt: timestamp,
  };
  if (existing) {
    await users.doc(existing._id || identity.uid).update(patch);
    return { ...existing, ...patch };
  }
  const user = { _id: identity.uid, ...patch, createdAt: timestamp };
  await users.doc(identity.uid).set(user);
  return user;
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
    await histories.doc(id).set(item);
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
      await addresses.doc(id).set(item);
      return item;
    }
    return withTransaction(runtime.db, async (tx) => {
      for (const address of existingAddresses.items) {
        await tx.collection(COLLECTIONS.addresses).doc(address._id).update({ isDefault: false, updatedAt: timestamp });
      }
      await tx.collection(COLLECTIONS.addresses).doc(id).set(item);
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
    await tx.collection(COLLECTIONS.carts).doc(identity.uid).set(saved);
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
        if (sku && sku.status === STATUS.active && product && product.status === STATUS.active && skuStock(sku) >= quantity) validItems.push(item);
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
    const quantity = integer(data.quantity, 'quantity', { min: 1, max: 999 });
    const sku = await getActiveSku(runtime, newSkuId, true);
    const product = await getActiveProduct(runtime, productIdForSku(sku), true);
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
    return present(await save((items) => [...items.filter((item) => String(item.skuId) !== oldSkuId && String(item.skuId) !== newSkuId), replacement]));
  }
  const skuId = string(data.skuId, 'skuId', { max: 128 });
  const quantity = integer(data.quantity, 'quantity', { min: 1, max: 999 });
  const sku = await getActiveSku(runtime, skuId, true);
  const product = await getActiveProduct(runtime, productIdForSku(sku), true);
  return present(await save((items) => {
    const itemIndex = items.findIndex((item) => String(item.skuId) === skuId);
    const nextQuantity = action === 'cart.update' || action === 'cart.updateQuantity'
      ? quantity
      : quantity + (itemIndex >= 0 ? integer(items[itemIndex].quantity, 'quantity', { min: 1 }) : 0);
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
    const quantity = integer(input.quantity, 'quantity', { min: 1, max: 999 });
    merged.set(skuId, (merged.get(skuId) || 0) + quantity);
  });
  merged.forEach((quantity) => assert(quantity <= 999, { field: 'quantity', max: 999 }));
  return Array.from(merged, ([skuId, quantity]) => ({ skuId, quantity }));
}

function orderInput(data = {}) {
  const parameter = data.parameter;
  if (typeof parameter === 'string') return { ...data, orderNo: parameter };
  if (parameter && typeof parameter === 'object' && !Array.isArray(parameter)) return { ...data, ...parameter };
  return data;
}

async function orderDraft(runtime, identity, data, source) {
  const input = orderInput(data);
  const items = normalizeOrderItems(source || input.items || input.goodsRequestList);
  const addressInfo = input.userAddressReq || input.address || {};
  const addressId = string(input.addressId || addressInfo.addressId || addressInfo.id || addressInfo._id, 'addressId', { max: 128 });
  const address = await getDoc(collection(runtime, COLLECTIONS.addresses), addressId, true);
  if (address.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  const resolved = [];
  for (const input of items) {
    const sku = await getActiveSku(runtime, input.skuId, true);
    const product = await getActiveProduct(runtime, productIdForSku(sku), true);
    const stock = skuStock(sku);
    if (stock < input.quantity) throw errorFrom('OUT_OF_STOCK', { skuId: input.skuId });
    const unitPrice = skuPrice(sku);
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) throw errorFrom('INVALID_ARGUMENT', { field: 'sku.price' });
    const amount = unitPrice * input.quantity;
    if (!Number.isSafeInteger(amount)) throw errorFrom('INVALID_ARGUMENT', { field: 'items.amount' });
    resolved.push({
      skuId: input.skuId,
      productId: product._id || product.spuId,
      quantity: input.quantity,
      unitPrice,
      amount,
      productSnapshot: clone({ _id: product._id, spuId: product.spuId, title: product.title, primaryImage: product.primaryImage, images: product.images }),
      skuSnapshot: clone({ _id: sku._id, skuId: sku.skuId, specInfo: sku.specInfo, skuImage: sku.skuImage }),
    });
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
  return orderDraft(runtime, identity, input, source);
}

function orderIdFor(userId, requestKey) {
  if (!requestKey) return `ord_${crypto.randomUUID()}`;
  const hash = crypto.createHash('sha256').update(`${userId}:${requestKey}`).digest('hex').slice(0, 32);
  return `ord_${hash}`;
}

async function createOrder(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const requestKey = string(input.requestKey || input.idempotencyKey, 'requestKey', { max: 128 });
  const orderId = orderIdFor(identity.uid, requestKey);
  const cart = input.useCart ? await getCart(runtime, identity) : null;
  const source = cart
    ? cart.items.filter((item) => item.isSelected).map((item) => ({ skuId: item.skuId, quantity: item.quantity }))
    : input.items || input.goodsRequestList;
  const normalizedItems = normalizeOrderItems(source);
  const addressInfo = input.userAddressReq || input.address || {};
  const addressId = String(input.addressId || addressInfo.addressId || addressInfo.id || addressInfo._id || '');
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({
    items: [...normalizedItems].sort((a, b) => a.skuId.localeCompare(b.skuId)),
    addressId,
    remark: input.remark || '',
  })).digest('hex');
  const existing = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, false);
  if (existing) {
    if (existing.requestHash && existing.requestHash !== requestHash) throw errorFrom('IDEMPOTENCY_CONFLICT');
    return existing;
  }
  await expirePendingOrders(runtime, identity.uid);
  const pendingRef = collection(runtime, COLLECTIONS.orders).where({ userId: identity.uid, status: STATUS.pendingPayment });
  const pendingResult = typeof pendingRef.count === 'function' ? await pendingRef.count() : await pendingRef.limit(20).get();
  const pendingCount = typeof pendingResult.total === 'number' ? pendingResult.total : listData(pendingResult).length;
  if (pendingCount >= 20) throw errorFrom('CONFLICT', { field: 'pendingOrders', max: 20 });
  const draft = await orderDraft(runtime, identity, input, normalizedItems);
  const result = await withTransaction(runtime.db, async (tx) => {
    const orders = tx.collection(COLLECTIONS.orders);
    const race = await getDoc(orders, orderId, false);
    if (race) {
      if (race.requestHash && race.requestHash !== requestHash) throw errorFrom('IDEMPOTENCY_CONFLICT');
      return race;
    }
    for (const item of draft.items) {
      const skuDocumentId = item.skuSnapshot?._id || item.skuId;
      const sku = await getDoc(tx.collection(COLLECTIONS.skus), skuDocumentId, true);
      if (!sku || sku.status !== STATUS.active) throw errorFrom('SKU_UNAVAILABLE');
      const stock = skuStock(sku);
      if (stock < item.quantity) throw errorFrom('OUT_OF_STOCK', { skuId: item.skuId });
      const payload = {
        stockQuantity: stock - item.quantity,
        soldQuantity: valueNumber(sku.soldQuantity, 0) + item.quantity,
        updatedAt: now(),
      };
      const updateResult = await tx.collection(COLLECTIONS.skus).doc(skuDocumentId).update(payload);
      if (affected(updateResult) !== 1) throw errorFrom('OUT_OF_STOCK', { skuId: item.skuId });
    }
    const timestamp = now();
    const order = {
      _id: orderId,
      orderNo: orderId,
      userId: identity.uid,
      requestKey: requestKey || null,
      requestHash,
      status: STATUS.pendingPayment,
      paymentStatus: 'unpaid',
      payment: null,
      inventoryReserved: true,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      items: draft.items,
      addressSnapshot: draft.addressSnapshot,
      subtotal: draft.subtotal,
      shippingFee: draft.shippingFee,
      totalAmount: draft.totalAmount,
      remark: optionalString(input.remark, 'remark', { max: 240 }) || '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await orders.doc(orderId).set(order);
    if (cart) {
      const storedCart = await getDoc(tx.collection(COLLECTIONS.carts), identity.uid, false);
      const orderedSkuIds = new Set(draft.items.map((item) => String(item.skuId)));
      const remaining = (storedCart?.items || []).filter((item) => !item.isSelected || !orderedSkuIds.has(String(item.skuId)));
      await tx.collection(COLLECTIONS.carts).doc(identity.uid).set({ _id: identity.uid, userId: identity.uid, items: remaining, updatedAt: timestamp });
    }
    return order;
  });
  return { ...result, payment: null, paymentRequired: false };
}

async function listOrders(runtime, event, context, data) {
  const identity = requireUser(event, context, runtime);
  await expirePendingOrders(runtime, identity.uid);
  const input = orderInput(data);
  const paging = page(input);
  const requested = input.orderStatus ?? input.status;
  const statusGroups = {
    5: [STATUS.pendingPayment],
    10: [STATUS.paid],
    40: [STATUS.shipped, STATUS.received],
    50: [STATUS.completed],
    80: [STATUS.cancelled],
  };
  const where = { userId: identity.uid };
  const statuses = statusGroups[requested] || (requested ? [String(requested)] : null);
  if (statuses && statuses.length === 1) where.status = statuses[0];
  else if (statuses && runtime.db.command?.in) where.status = runtime.db.command.in(statuses);
  if (runtime.db.command?.neq) where.deletedByUser = runtime.db.command.neq(true);
  const result = await list(collection(runtime, COLLECTIONS.orders), {
    where,
    orderBy: { field: 'createdAt', direction: 'desc' },
    skip: (paging.page - 1) * paging.pageSize,
    limit: paging.pageSize,
  });
  let items = result.items.filter((item) => !item.deletedByUser);
  if (statuses && !(runtime.db.command?.in) && statuses.length > 1) items = items.filter((item) => statuses.includes(item.status));
  return { items, page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
}

async function orderCount(runtime, event, context) {
  const identity = requireUser(event, context, runtime);
  await expirePendingOrders(runtime, identity.uid);
  const groups = [[5, [STATUS.pendingPayment]], [10, [STATUS.paid]], [40, [STATUS.shipped, STATUS.received]], [50, [STATUS.completed]]];
  const command = runtime.db.command;
  const items = await Promise.all(groups.map(async ([tabType, statuses]) => {
    const where = { userId: identity.uid };
    where.status = statuses.length === 1 ? statuses[0] : command?.in ? command.in(statuses) : statuses[0];
    if (command?.neq) where.deletedByUser = command.neq(true);
    const ref = collection(runtime, COLLECTIONS.orders).where(where);
    if (typeof ref.count === 'function') {
      const result = await ref.count();
      return { tabType, orderNum: Number(result.total) || 0 };
    }
    const result = await ref.limit(100).get();
    const rows = listData(result).filter((item) => statuses.includes(item.status) && !item.deletedByUser);
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
  return order;
}

async function cancelPendingOrder(runtime, id, userId) {
  return withTransaction(runtime.db, async (tx) => {
    const txOrder = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
    if (userId && txOrder.userId !== userId) throw errorFrom('FORBIDDEN');
    if (txOrder.status !== STATUS.pendingPayment) throw errorFrom('ORDER_STATE_INVALID');
    const timestamp = now();
    if (txOrder.inventoryReserved !== false) {
      for (const item of txOrder.items || []) {
        const skuDocumentId = item.skuSnapshot?._id || item.skuId;
        const sku = await getDoc(tx.collection(COLLECTIONS.skus), skuDocumentId, true);
        const updateResult = await tx.collection(COLLECTIONS.skus).doc(skuDocumentId).update({
          stockQuantity: skuStock(sku) + item.quantity,
          soldQuantity: Math.max(0, valueNumber(sku.soldQuantity, 0) - item.quantity),
          updatedAt: timestamp,
        });
        if (affected(updateResult) !== 1) throw errorFrom('CONFLICT');
      }
    }
    const patch = { status: STATUS.cancelled, inventoryReserved: false, cancelledAt: timestamp, updatedAt: timestamp };
    const result = await tx.collection(COLLECTIONS.orders).doc(id).update(patch);
    if (affected(result) !== 1) throw errorFrom('CONFLICT');
    return { ...txOrder, ...patch };
  });
}

async function expirePendingOrders(runtime, userId) {
  const result = await list(collection(runtime, COLLECTIONS.orders), {
    where: { userId, status: STATUS.pendingPayment },
    limit: 100,
    includeTotal: false,
  });
  const currentTime = Date.now();
  for (const order of result.items) {
    if (!order.expiresAt || Date.parse(order.expiresAt) > currentTime) continue;
    try {
      await cancelPendingOrder(runtime, order._id || order.orderNo, userId);
    } catch (error) {
      if (!['ORDER_STATE_INVALID', 'CONFLICT'].includes(error && error.code)) throw error;
    }
  }
}

async function updateOrderState(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const input = orderInput(data);
  const id = string(input.orderId || input.orderNo, 'orderId', { max: 128 });
  const orders = collection(runtime, COLLECTIONS.orders);
  const order = await getDoc(orders, id, true);
  if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  const timestamp = now();
  if (action === 'orders.confirmReceived') {
    return withTransaction(runtime.db, async (tx) => {
      const current = await getDoc(tx.collection(COLLECTIONS.orders), id, true);
      if (current.userId !== identity.uid || current.status !== STATUS.shipped) throw errorFrom('ORDER_STATE_INVALID');
      const patch = { status: STATUS.received, updatedAt: timestamp };
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
  if (action !== 'orders.cancel' || order.status !== STATUS.pendingPayment) throw errorFrom('ORDER_STATE_INVALID');
  return cancelPendingOrder(runtime, id, identity.uid);
}

async function commentsAction(runtime, event, context, data, action) {
  const query = data.queryParameter && typeof data.queryParameter === 'object' ? { ...data, ...data.queryParameter } : data;
  if (action === 'comments.list') {
    const where = { status: STATUS.active };
    if (query.productId || query.spuId) where.productId = string(query.productId || query.spuId, 'productId', { max: 128 });
    if (query.orderNo || query.orderId) {
      const identity = requireUser(event, context, runtime);
      const orderId = string(query.orderNo || query.orderId, 'orderId', { max: 128 });
      const order = await findDoc(runtime, COLLECTIONS.orders, orderId, 'orderNo');
      if (!order || order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
      where.orderId = order._id || order.orderNo;
    }
    if (query.mineOnly) where.userId = requireUser(event, context, runtime).uid;
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
    const items = query.hasImage ? result.items.filter((item) => item.hasImage === true || (Array.isArray(item.images) && item.images.length > 0)) : result.items;
    return { items, page: paging.page, pageNum: paging.page, pageSize: paging.pageSize, total: result.total === undefined ? items.length : result.total };
  }
  if (action === 'comments.count') {
    const where = { status: STATUS.active };
    if (data.productId || data.spuId) where.productId = string(data.productId || data.spuId, 'productId', { max: 128 });
    const comments = collection(runtime, COLLECTIONS.comments);
    const countWhere = async (extra) => {
      const ref = comments.where({ ...where, ...extra });
      if (typeof ref.count === 'function') return Number((await ref.count()).total) || 0;
      return listData(await ref.limit(100).get()).length;
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
  const images = sourceImages === undefined ? [] : array(sourceImages, 'images').slice(0, 9).map((item) => string(typeof item === 'string' ? item : item && (item.image || item.fileID || item.fileId), 'images[]', { max: 1024 }));
  const timestamp = now();
  const rating = data.rating ?? data.commentScore;
  const comment = { userId: identity.uid, orderId: order._id || orderId, orderNo: order.orderNo || orderId, productId, rating: rating === undefined ? 5 : integer(Number(rating), 'rating', { min: 1, max: 5 }), content: text, images, hasImage: images.length > 0, status: STATUS.pendingReview, createdAt: timestamp, updatedAt: timestamp };
  const result = await collection(runtime, COLLECTIONS.comments).add(comment);
  comment._id = result.id || result._id;
  return comment;
}

async function afterSalesAction(runtime, event, context, data, action) {
  const identity = requireUser(event, context, runtime);
  const afterSales = collection(runtime, COLLECTIONS.afterSales);
  if (action === 'afterSales.list') {
    const paging = page(data);
    const where = { userId: identity.uid };
    if (data.status) where.status = String(data.status);
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
    const orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
    const orders = collection(runtime, COLLECTIONS.orders);
    const order = await getDoc(orders, orderId, true);
    if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (order.status !== STATUS.shipped) throw errorFrom('ORDER_STATE_INVALID');
    const patch = { status: STATUS.received, updatedAt: now() };
    await orders.doc(orderId).update(patch);
    return { ...order, ...patch };
  }
  if (action === 'afterSales.submitTracking') {
    const ref = string(data.afterSaleId || data.rightsNo, 'afterSaleId', { max: 128 });
    const item = await findDoc(runtime, COLLECTIONS.afterSales, ref, 'rightsNo');
    if (!item) throw errorFrom('NOT_FOUND');
    if (item.userId !== identity.uid) throw errorFrom('FORBIDDEN');
    if (item.status !== STATUS.approved) throw errorFrom('ORDER_STATE_INVALID');
    const trackingNo = string(data.trackingNo || data.logisticsNo, 'trackingNo', { max: 128 });
    const patch = {
      logisticsNo: trackingNo,
      logisticsCompanyName: optionalString(data.logisticsCompanyName || data.companyName, 'logisticsCompanyName', { max: 120 }) || '',
      logisticsCompanyCode: optionalString(data.logisticsCompanyCode || data.companyCode, 'logisticsCompanyCode', { max: 80 }) || '',
      status: STATUS.refunding,
      updatedAt: now(),
    };
    await afterSales.doc(item._id).update(patch);
    return { ...item, ...patch, _id: item._id };
  }
  const orderId = string(data.orderId || data.orderNo, 'orderId', { max: 128 });
  const order = await getDoc(collection(runtime, COLLECTIONS.orders), orderId, true);
  if (order.userId !== identity.uid) throw errorFrom('FORBIDDEN');
  if (action === 'afterSales.preview') {
    const response = { orderId, items: order.items || [], allowed: [STATUS.shipped, STATUS.received, STATUS.completed].includes(order.status) };
    if (data.includeReasons) response.rightsReasonList = ['质量问题', '商品错发', '商品少发', '不想要了', '其他'].map((item) => ({ id: item, desc: item }));
    return response;
  }
  if (action !== 'afterSales.create') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  if (![STATUS.shipped, STATUS.received, STATUS.completed].includes(order.status)) throw errorFrom('ORDER_STATE_INVALID');
  const timestamp = now();
  const requestedProductId = data.productId || data.spuId;
  const snapshot = (order.items || []).find((orderItem) => !requestedProductId || orderItem.productId === requestedProductId || orderItem.spuId === requestedProductId || orderItem.productSnapshot?.spuId === requestedProductId || orderItem.productSnapshot?._id === requestedProductId);
  assert(Boolean(snapshot), { field: 'productId' });
  const productId = string(snapshot.productId || snapshot.spuId || snapshot.productSnapshot?.spuId || snapshot.productSnapshot?._id, 'productId', { max: 128 });
  const activeStatuses = [STATUS.pendingReview, STATUS.approved, STATUS.refunding];
  const duplicateWhere = { userId: identity.uid, orderId: order._id || orderId, productId };
  if (runtime.db.command?.in) duplicateWhere.status = runtime.db.command.in(activeStatuses);
  const duplicate = await afterSales.where(duplicateWhere).limit(10).get();
  if (listData(duplicate).some((entry) => activeStatuses.includes(entry.status))) throw errorFrom('CONFLICT', { field: 'afterSale' });
  const rawType = data.type ?? data.rightsType ?? 'refund';
  const type = Number.isFinite(Number(rawType)) ? Number(rawType) : String(rawType);
  const item = { userId: identity.uid, rightsNo: `as_${crypto.randomUUID()}`, orderId: order._id || orderId, orderNo: order.orderNo || orderId, productId, type, reason: string(data.reason || data.rightsReasonDesc, 'reason', { max: 120 }), description: optionalString(data.description || data.refundMemo, 'description', { max: 1000 }) || '', images: Array.isArray(data.images) ? data.images.slice(0, 9) : [], items: [clone(snapshot)], status: STATUS.pendingReview, createdAt: timestamp, updatedAt: timestamp };
  const result = await afterSales.add(item);
  item._id = result.id || result._id;
  return item;
}

async function shopEndpoint(event, context, runtime, action, data) {
  if (action === 'categories.list') return readCategories(runtime, data);
  if (action === 'products.list') return readProducts(runtime, data);
  if (action === 'products.detail') return readProductDetail(runtime, data);
  if (action === 'skus.list') return readSkus(runtime, data);
  if (action === 'home.get') return readHome(runtime, data);
  if (action === 'storage.tempUrls') {
    requireUser(event, context, runtime);
    return getTempFileURLs(runtime, data.fileList, { allowedPrefixes: ['admin/products/', 'products/', 'comments/', 'after-sales/', 'home/', 'public/'] });
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
  if (action === 'orders.cancel' || action === 'orders.confirmReceived' || action === 'orders.delete') return updateOrderState(runtime, event, context, data, action);
  if (action.startsWith('comments.')) return commentsAction(runtime, event, context, data, action);
  if (action.startsWith('afterSales.')) return afterSalesAction(runtime, event, context, data, action);
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

module.exports = { shopEndpoint, normalizeOrderItems, skuPrice, skuStock };
