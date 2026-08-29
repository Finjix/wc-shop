import { getGoodsList } from './goods';

/**
 * @param {number} sort
 * @param {number} pageNum
 * @param {number} pageSize
 * @param {number} minPrice
 * @param {number} maxPrice
 * @param {string} keyword
 */

export function getSearchHistory() {
  return {
    historyWords: [
      '鸡',
      '电脑',
      'iPhone12',
      '车载手机支架',
      '自然堂',
      '小米10',
      '原浆古井贡酒',
      '欧米伽',
      '华为',
      '针织半身裙',
      '氢跑鞋',
      '三盒处理器',
    ],
  };
}

function toNumber(value) {
  return Number(value) || 0;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getGoodsSearchText(goods) {
  const tags = (goods.spuTagList || []).map((tag) => tag.title);
  const specs = (goods.specList || []).reduce(
    (values, spec) => values.concat([
      spec.title,
      ...(spec.specValueList || []).map((value) => value.specValue),
    ]),
    [],
  );
  return normalizeText([goods.title, goods.etitle, ...tags, ...specs].join(' '));
}

function categoryMatches(goods, categoryName, categoryId) {
  const name = normalizeText(categoryName);
  const id = normalizeText(categoryId);
  if (!name && !id) return true;

  const categoryIds = [...(goods.categoryIds || []), ...(goods.groupIdList || [])].map(normalizeText);
  if (id && categoryIds.includes(id)) return true;

  const categoryKeywords = {
    服装: ['衣', '裙', '裤', '鞋', '服', '装'],
    女装: ['裙', '女', '毛衣', '外套', '棉衣', '连衣'],
    男装: ['男', 't恤', '卫衣', '裤', '西装'],
    儿童装: ['童', '儿童', '小孩'],
    美妆: ['妆', '唇', '眼影', '粉底', '口红'],
  };
  const keywords = categoryKeywords[categoryName] || [name];
  const text = getGoodsSearchText(goods);
  return keywords.some((keyword) => text.includes(normalizeText(keyword)));
}

function filterGoods(goods, params) {
  const keyword = normalizeText(params.keyword);
  const categoryName = params.categoryName || '';
  const categoryId = params.categoryId || '';
  const minPrice = toNumber(params.minPrice);
  const maxPrice = params.maxPrice === undefined || params.maxPrice === '' ? null : toNumber(params.maxPrice);

  return goods.filter((item) => {
    const text = getGoodsSearchText(item);
    const price = toNumber(item.minSalePrice);
    return (
      (!keyword || text.includes(keyword)) &&
      categoryMatches(item, categoryName, categoryId) &&
      price >= minPrice &&
      (maxPrice === null || price <= maxPrice)
    );
  });
}

function sortGoods(goods, sort, sortType) {
  const sortedGoods = [...goods];

  if (sort === 1) {
    const direction = Number(sortType) === 1 ? -1 : 1;
    sortedGoods.sort((a, b) => {
      return (toNumber(a.minSalePrice) - toNumber(b.minSalePrice)) * direction;
    });
  } else if (sort === 2) {
    sortedGoods.sort((a, b) => toNumber(b.soldNum) - toNumber(a.soldNum));
  } else if (sort === 3) {
    sortedGoods.sort((a, b) => toNumber(b.spuId) - toNumber(a.spuId));
  }

  return sortedGoods;
}

export function getSearchResult(params = {}) {
  const {
    pageNum = 1,
    pageSize = 30,
    sort = 0,
    sortType = 0,
    keyword = '',
    categoryName = '',
    categoryId = '',
    minPrice = 0,
    maxPrice,
  } = params;
  const filteredGoods = filterGoods(getGoodsList(7), {
    keyword,
    categoryName,
    categoryId,
    minPrice,
    maxPrice,
  });
  const allGoods = sortGoods(filteredGoods, Number(sort), sortType);
  const normalizedPageNum = Math.max(1, Number(pageNum) || 1);
  const normalizedPageSize = Math.max(1, Number(pageSize) || 30);
  const start = (normalizedPageNum - 1) * normalizedPageSize;

  return {
    saasId: null,
    storeId: null,
    pageNum: normalizedPageNum,
    pageSize: normalizedPageSize,
    totalCount: allGoods.length,
    spuList: allGoods.slice(start, start + normalizedPageSize),
    algId: 0,
  };
}

