import { mockComments } from '../data/mockComments';
import { mockCategories } from '../data/mockCategories';
import { mockProducts } from '../data/mockProducts';

const DEFAULT_API_ERROR = '当前仅保留前端界面，数据服务未配置';

function getMockProductList(params = {}) {
  const keyword = String(params.keyword || '').trim();
  let products = keyword
    ? mockProducts.filter((product) => product.title.includes(keyword))
    : mockProducts;
  const shouldSortByPrice = params.orderBy === 'price' || Number(params.sort) === 1;
  if (shouldSortByPrice) {
    const direction = params.direction === 'desc' || Number(params.sortType) === 1 ? -1 : 1;
    products = products.slice().sort((left, right) => direction * (left.price - right.price));
  }
  const page = Math.max(1, Number(params.page || params.pageNum) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || products.length);
  const start = (page - 1) * pageSize;

  return {
    pageNum: page,
    pageSize,
    totalCount: products.length,
    spuList: products.slice(start, start + pageSize),
  };
}

function getProductComments(params = {}) {
  const productId = String(params.productId || params.spuId || '');
  let comments = productId
    ? mockComments.filter((comment) => comment.productId === productId)
    : mockComments;
  if (params.hasImage) {
    comments = comments.filter((comment) => Array.isArray(comment.commentResources) && comment.commentResources.length);
  }
  if (params.commentLevel) {
    comments = comments.filter((comment) => Number(comment.commentScore) === Number(params.commentLevel));
  }
  return comments;
}

function getMockCommentList(params = {}) {
  const comments = getProductComments(params);
  const pageNum = Math.max(1, Number(params.pageNum || params.page) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || comments.length);
  const start = (pageNum - 1) * pageSize;
  return {
    pageNum,
    pageSize,
    totalCount: comments.length,
    pageList: comments.slice(start, start + pageSize),
  };
}

function getMockCommentCount(params = {}) {
  const comments = getProductComments(params);
  return {
    badCount: comments.filter((comment) => comment.commentScore <= 2).length,
    commentCount: comments.length,
    goodCount: comments.filter((comment) => comment.commentScore >= 4).length,
    hasImageCount: comments.filter((comment) => comment.commentResources?.length).length,
    middleCount: comments.filter((comment) => comment.commentScore === 3).length,
    uidCount: 0,
  };
}

function createApiError(message) {
  const error = new Error(message || DEFAULT_API_ERROR);
  error.code = 'API_UNAVAILABLE';
  return error;
}

/** 前端版提供商品、分类与评价展示所需的本地测试数据。 */
export function request(action, params = {}) {
  if (action === 'products.list') {
    return Promise.resolve(getMockProductList(params));
  }
  if (action === 'products.detail') {
    const product = mockProducts.find((item) => item.spuId === String(params.spuId || ''));
    return product ? Promise.resolve(product) : Promise.reject(createApiError('商品不存在或已下架'));
  }
  if (action === 'comments.count') {
    return Promise.resolve(getMockCommentCount(params));
  }
  if (action === 'comments.list') {
    return Promise.resolve(getMockCommentList(params));
  }
  if (action === 'categories.list') {
    return Promise.resolve(mockCategories);
  }
  return Promise.reject(createApiError());
}

export function getApiErrorMessage(error, fallback = DEFAULT_API_ERROR) {
  if (!error) return fallback;
  return error.userMessage || error.message || error.errMsg || fallback;
}
