import { callShop } from '../../utils/cloud';
import { fetchGood } from '../good/fetchGood';

const skuStockCache = new Map();

function dataOf(response) {
  const value = response?.data ?? response;
  return value?.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function getSkuSnapshot(goods = {}) {
  return goods.skuSnapshot && typeof goods.skuSnapshot === 'object'
    ? goods.skuSnapshot
    : (goods.sku && typeof goods.sku === 'object' ? goods.sku : {});
}

function getStockInfo(goods = {}, liveSku) {
  const liveStock = liveSku?.stockQuantity ?? liveSku?.stock ?? liveSku?.stockInfo?.stockQuantity;
  const storedStock = goods.stockKnown === false
    ? undefined
    : firstDefined(goods.stockQuantity, goods.stock, goods.stockInfo?.stockQuantity);
  const snapshotStock = goods.stockKnown === false
    ? undefined
    : firstDefined(goods.skuSnapshot?.stockQuantity, goods.skuSnapshot?.stock, goods.skuSnapshot?.stockInfo?.stockQuantity);
  const rawStock = firstDefined(liveStock, storedStock, snapshotStock);
  if (rawStock === undefined) return { stockQuantity: 0, stockKnown: false };
  const stockQuantity = Number(rawStock);
  return Number.isFinite(stockQuantity)
    ? { stockQuantity: Math.max(0, stockQuantity), stockKnown: true }
    : { stockQuantity: 0, stockKnown: false };
}

function getSkuPrice(goods = {}, snapshot = {}, liveSku) {
  return firstDefined(
    goods.unitPrice,
    goods.price,
    goods.settlePrice,
    goods.actualPrice,
    goods.tagPrice,
    liveSku?.salePrice,
    liveSku?.price,
    liveSku?.priceInfo?.find((item) => item.priceType === 1)?.price,
    snapshot.price,
    0,
  );
}

function normalizeGoods(goods = {}, store = {}, liveSku) {
  const snapshot = getSkuSnapshot(goods);
  const stock = getStockInfo({ ...goods, skuSnapshot: snapshot }, liveSku);
  const skuId = firstDefined(goods.skuId, goods.skuID, snapshot.skuId, liveSku?.skuId, liveSku?._id);
  const spuId = firstDefined(goods.spuId, goods.spuID, goods.productId, liveSku?.productId, liveSku?.spuId);
  const specInfo = firstDefined(goods.specInfo, goods.specifications, snapshot.specInfo, liveSku?.specInfo, []);
  const price = getSkuPrice(goods, snapshot, liveSku);
  return {
    ...goods,
    storeId: goods.storeId ?? store.storeId,
    storeName: goods.storeName ?? store.storeName,
    spuId,
    skuId,
    title: goods.title || goods.goodsName || '',
    thumb: goods.thumb || goods.primaryImage || goods.goodsPictureUrl || goods.image || snapshot.skuImage || liveSku?.skuImage || '',
    primaryImage: goods.primaryImage || goods.thumb || goods.goodsPictureUrl || goods.image || snapshot.skuImage || liveSku?.skuImage || '',
    price,
    unitPrice: goods.unitPrice ?? price,
    quantity: Math.max(1, Number(goods.quantity ?? goods.buyQuantity ?? goods.num) || 1),
    stockQuantity: stock.stockQuantity,
    stockKnown: stock.stockKnown,
    skuSnapshot: { ...snapshot, ...(liveSku ? { stockQuantity: stock.stockQuantity } : {}) },
    isSelected: goods.isSelected === true || goods.isSelected === 1 || goods.selected === true ? 1 : 0,
    specInfo: Array.isArray(specInfo) ? specInfo.map((spec) => ({
      ...spec,
      specTitle: spec.specTitle || spec.title || '',
      specValue: spec.specValue || spec.value || '',
    }))
      : [],
    titlePrefixTags: goods.titlePrefixTags || (goods.tagText ? [{ text: goods.tagText }] : []),
  };
}

function normalizeCart(response) {
  const raw = dataOf(response) || {};
  const source = raw.cartGroupData || raw.cart || raw;
  let stores = Array.isArray(source.storeGoods) ? source.storeGoods : [];
  const items = source.items || source.cartItems || source.list;
  if (!stores.length && Array.isArray(items)) {
    const byStore = new Map();
    items.forEach((item) => {
      const storeId = item.storeId ?? 0;
      if (!byStore.has(String(storeId))) byStore.set(String(storeId), { storeId, storeName: item.storeName || '', promotionGoodsList: [{ goodsPromotionList: [] }], shortageGoodsList: [] });
      const store = byStore.get(String(storeId));
      const goods = normalizeGoods(item, store);
      if (goods.stockKnown !== true || goods.stockQuantity > 0) store.promotionGoodsList[0].goodsPromotionList.push(goods);
      else store.shortageGoodsList.push(goods);
    });
    stores = Array.from(byStore.values());
  }
  const storeGoods = stores.map((store) => ({
    ...store,
    promotionGoodsList: (Array.isArray(store.promotionGoodsList) ? store.promotionGoodsList : []).map((promotion) => ({
      ...promotion,
      goodsPromotionList: (Array.isArray(promotion.goodsPromotionList) ? promotion.goodsPromotionList : []).map((goods) => normalizeGoods(goods, store)),
    })),
    shortageGoodsList: (Array.isArray(store.shortageGoodsList) ? store.shortageGoodsList : []).map((goods) => normalizeGoods(goods, store)),
  }));
  const invalidGoodItems = (source.invalidGoodItems || source.invalidItems || []).map((goods) => normalizeGoods(goods));
  const hasStoreItems = storeGoods.some((store) => (
    (store.promotionGoodsList || []).some((promotion) => (promotion.goodsPromotionList || []).length > 0)
    || (store.shortageGoodsList || []).length > 0
  ));
  return { ...source, storeGoods, invalidGoodItems, isNotEmpty: Boolean(hasStoreItems || invalidGoodItems.length), totalAmount: source.totalAmount ?? source.selectedAmount ?? '0' };
}

function getStoreGoodsEntries(store) {
  const entries = [];
  (store.promotionGoodsList || []).forEach((promotion, promotionIndex) => {
    (promotion.goodsPromotionList || []).forEach((goods) => entries.push({ goods, promotionIndex }));
  });
  (store.shortageGoodsList || []).forEach((goods) => entries.push({ goods, promotionIndex: 0 }));
  return entries;
}

function loadSkuForGoods(goods) {
  if (goods.stockKnown === true || goods.spuId === undefined || goods.spuId === null || goods.spuId === '') {
    return Promise.resolve(null);
  }
  const key = String(goods.spuId);
  const cached = skuStockCache.get(key);
  const detailsPromise = cached && cached.expiresAt > Date.now()
    ? cached.promise
    : fetchGood(key).catch(() => null);
  if (!cached || cached.expiresAt <= Date.now()) skuStockCache.set(key, { expiresAt: Date.now() + 30000, promise: detailsPromise });
  return detailsPromise.then((details) => (details?.skuList || [])
    .find((sku) => String(sku.skuId ?? sku._id) === String(goods.skuId)) || null);
}

async function hydrateCartStock(cart) {
  const references = [];
  (cart.storeGoods || []).forEach((store) => getStoreGoodsEntries(store).forEach(({ goods }) => references.push({ store, goods })));
  const uniqueGoods = Array.from(new Map(references.map(({ goods }) => [`${goods.spuId}:${goods.skuId}`, goods])).values());
  const resolved = await Promise.all(uniqueGoods.map(async (goods) => [
    `${goods.spuId}:${goods.skuId}`,
    await loadSkuForGoods(goods),
  ]));
  const skuByItem = new Map(resolved);
  const storeGoods = (cart.storeGoods || []).map((store) => {
    const promotions = (store.promotionGoodsList || []).map((promotion) => ({
      ...promotion,
      goodsPromotionList: [],
    }));
    const shortageGoodsList = [];
    getStoreGoodsEntries(store).forEach(({ goods, promotionIndex }) => {
      const liveSku = skuByItem.get(`${goods.spuId}:${goods.skuId}`);
      const normalized = normalizeGoods(goods, store, liveSku);
      if (normalized.stockKnown === true && normalized.stockQuantity <= 0) {
        shortageGoodsList.push(normalized);
        return;
      }
      const targetIndex = Math.min(promotionIndex, Math.max(promotions.length - 1, 0));
      if (!promotions[targetIndex]) promotions.push({ goodsPromotionList: [] });
      promotions[targetIndex].goodsPromotionList.push(normalized);
    });
    return {
      ...store,
      promotionGoodsList: promotions.filter((promotion) => promotion.goodsPromotionList.length > 0),
      shortageGoodsList,
    };
  });
  return { ...cart, storeGoods };
}

function action(name, payload = {}) {
  return callShop(name, payload).then((response) => ({ data: dataOf(response) }));
}

export function fetchCartGroupData(params = {}) {
  return action('cart.get', params)
    .then((response) => normalizeCart(response))
    .then(hydrateCartStock)
    .then((data) => ({ data }));
}

export function addGoodsToCart(goods) {
  if (!goods || goods.spuId === undefined || goods.skuId === undefined) {
    const error = new Error('购物车商品信息不完整');
    error.code = 'CART_ITEM_INVALID';
    error.msg = error.message;
    return Promise.reject(error);
  }
  return action('cart.add', { ...goods, skuId: String(goods.skuId), quantity: Math.max(1, Number(goods.quantity) || 1) });
}

export function updateCartItemSelection({ spuId, skuId, isSelected }) { return action('cart.updateSelection', { spuId, skuId: String(skuId), isSelected: Boolean(isSelected) }); }
export function updateCartStoreSelection({ storeId, isSelected }) { return action('cart.updateStoreSelection', { storeId, isSelected: Boolean(isSelected) }); }
export function updateAllCartSelection({ isSelected }) { return action('cart.updateAllSelection', { isSelected: Boolean(isSelected) }); }
export function updateCartItemQuantity({ spuId, skuId, quantity }) { return action('cart.updateQuantity', { spuId, skuId: String(skuId), quantity: Math.max(1, Number(quantity) || 1) }); }

export function replaceCartItemSku({ oldGoods, goods }) {
  if (!oldGoods || !goods || oldGoods.skuId === undefined || goods.skuId === undefined) {
    const error = new Error('购物车规格信息不完整');
    error.code = 'CART_ITEM_INVALID';
    error.msg = error.message;
    return Promise.reject(error);
  }
  const newSkuId = String(goods.skuId);
  return action('cart.replaceSku', {
    // The backend validates data.skuId before entering the replace branch.
    skuId: newSkuId,
    oldSpuId: oldGoods.spuId,
    oldSkuId: String(oldGoods.skuId),
    newSpuId: goods.spuId,
    newSkuId,
    quantity: Math.max(1, Number(goods.quantity) || 1),
  });
}

export function deleteCartItem({ spuId, skuId }) { return action('cart.remove', { spuId, skuId: String(skuId) }); }
export function clearInvalidCartItems() { return action('cart.clearInvalid'); }
