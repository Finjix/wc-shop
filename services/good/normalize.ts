// @ts-nocheck

// 云端使用当前商品结构；这里仅转换成小程序组件的展示字段。
export function normalizeGoodsItem(item = {}) {
  return { ...item, spuId: item._id, thumb: item.primaryImage || '', title: item.title || '', price: item.minSalePrice || 0 };
}

export function getGoodsItems(result) { return result.items; }
export function normalizeGoodsList(result) { return getGoodsItems(result).map(normalizeGoodsItem); }

export function normalizeSearchResult(source) {
  const spuList = normalizeGoodsList(source);
  return { ...source, pageNum: source.page, pageSize: source.pageSize, totalCount: source.total, spuList };
}

export function normalizeCategoryList(result) {
  const active = result.items.filter((item) => item.status === 'active' || item.status === undefined);
  const sort = (left, right) => (Number(left.sort) || 0) - (Number(right.sort) || 0)
    || String(left.createdAt || left._id).localeCompare(String(right.createdAt || right._id));
  return active.filter((item) => !item.parentId).sort(sort).map((parent) => ({
    ...parent,
    children: active.filter((item) => String(item.parentId) === String(parent._id)).sort(sort),
  }));
}

export function normalizeHomeContent(source) { return source; }

export function toProductListPayload(params = {}) {
  const { pageNum, ...payload } = params;
  const sort = Number(params.sort);
  const sortType = Number(params.sortType);
  return {
    ...payload,
    page: Number(pageNum) || 1,
    pageSize: Number(params.pageSize) || 30,
    orderBy: sort === 1 ? 'price' : undefined,
    direction: sort === 3 || (sort === 1 && sortType === 1) ? 'desc' : 'asc',
  };
}
