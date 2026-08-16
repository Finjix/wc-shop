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
  } = params;
  const allGoods = sortGoods(getGoodsList(7), Number(sort), sortType);
  const start = (pageNum - 1) * pageSize;

  return {
    saasId: null,
    storeId: null,
    pageNum,
    pageSize,
    totalCount: allGoods.length,
    spuList: allGoods.slice(start, start + pageSize),
    algId: 0,
  };
}
