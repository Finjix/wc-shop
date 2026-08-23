function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function normalizeGoodsItem(item = {}) {
  const tags = item.tags || item.spuTagList || item.tagList || [];
  return {
    ...item,
    spuId: firstValue(item.spuId, item.id, item._id, ''),
    thumb: firstValue(item.thumb, item.primaryImage, item.image, ''),
    title: firstValue(item.title, item.name, ''),
    price: firstValue(item.price, item.minSalePrice, 0),
    originPrice: firstValue(item.originPrice, item.maxLinePrice, item.minLinePrice, 0),
    tags: Array.isArray(tags) ? tags.map((tag) => (typeof tag === 'string' ? tag : tag.title)).filter(Boolean) : [],
  };
}

export function getGoodsItems(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  return result.goodsList || result.spuList || result.items || result.list || result.products || [];
}

export function normalizeGoodsList(result) {
  return getGoodsItems(result).map(normalizeGoodsItem);
}

export function normalizeSearchResult(result) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const spuList = normalizeGoodsList(result);
  return {
    ...source,
    pageNum: Number(source.pageNum || source.page) || 1,
    pageSize: Number(source.pageSize) || spuList.length,
    totalCount: Number(firstValue(source.totalCount, source.total, source.count, spuList.length)) || 0,
    spuList,
  };
}

export function normalizeCategoryList(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  return result.list || result.items || result.categories || result.categoryList || [];
}

export function normalizeHomeContent(result) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const items = Array.isArray(source.items) ? source.items : [];
  const homeGoods = items.flatMap((item) => item.goodsList || item.products || (item.product ? [item.product] : []));
  const goodsList = normalizeGoodsList({ items: source.productItems || homeGoods });
  const explicitImages = [source.imgSrcs, source.swiperImages, source.bannerImages].find((value) => Array.isArray(value) && value.length > 0);
  const imgSrcs = explicitImages || items.map((item) => item.image || item.imageUrl || item.cover || (item.type === 'banner' ? item.content : '')).filter(Boolean);
  return { ...source, goodsList, imgSrcs: Array.isArray(imgSrcs) ? imgSrcs : [] };
}

export function toProductListPayload(params = {}) {
  const sort = Number(params.sort);
  const sortType = Number(params.sortType);
  return {
    ...params,
    page: Number(params.page || params.pageNum) || 1,
    pageSize: Number(params.pageSize) || 30,
    orderBy: sort === 1 ? 'price' : undefined,
    direction: sort === 1 && sortType === 1 ? 'desc' : 'asc',
  };
}

export function normalizeUserInfo(userInfo = {}) {
  return {
    ...userInfo,
    nickName: firstValue(userInfo.nickName, userInfo.nickname, ''),
    phoneNumber: firstValue(userInfo.phoneNumber, userInfo.phone, ''),
  };
}
