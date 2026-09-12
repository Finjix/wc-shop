const TEST_IMAGE = '/assets/home-test-image.jpg';

const commentTemplates = [
  {
    userName: '小明',
    commentScore: 5,
    commentContent: '商品很好，和描述一致。',
    sellerReply: '感谢您的支持！',
  },
  {
    userName: '小红',
    commentScore: 4,
    commentContent: '发货很快，整体使用体验不错。',
  },
  {
    userName: '小王',
    commentScore: 5,
    commentContent: '包装完整，值得推荐。',
    commentResources: [TEST_IMAGE],
  },
];

export const mockComments = Array.from({ length: 16 }, (_, productIndex) =>
  commentTemplates.map((template, commentIndex) => ({
    ...template,
    commentId: `test-${productIndex + 1}-comment-${commentIndex + 1}`,
    productId: `test-${productIndex + 1}`,
    spuId: `test-${productIndex + 1}`,
    commentTime: 1750000000000 - (productIndex * 3 + commentIndex) * 86400000,
    goodsDetailInfo: '默认',
    isAnonymity: false,
    isAutoComment: false,
  })),
).flat();

mockComments.push({
  commentId: 'mock-comment-order-1008',
  orderId: 'MOCK202506110008',
  orderNo: 'MOCK202506110008',
  productId: 'test-10',
  spuId: 'test-10',
  skuId: 'test-10-sku-1',
  commentScore: 5,
  commentContent: '商品已收到，使用体验很好。',
  commentResources: [],
  commentTime: 1750000000000,
  status: 'active',
  commentStatus: 'active',
  goodsDetailInfo: '默认',
  isAnonymity: false,
  isAutoComment: false,
});

function resourcePath(resource) {
  if (typeof resource === 'string') return resource;
  return resource?.image || resource?.fileID || resource?.fileId || resource?.url || resource?.src || '';
}

export function createMockComment(payload = {}) {
  const productId = payload.productId || payload.spuId || '';
  const resources = (payload.commentResources || payload.resources || [])
    .map(resourcePath)
    .filter(Boolean)
    .map((image) => ({ type: 'image', image, fileID: image }));
  const comment = {
    commentId: `mock-comment-${Date.now()}`,
    orderId: payload.orderId || payload.orderNo || '',
    orderNo: payload.orderNo || payload.orderId || '',
    productId,
    spuId: payload.spuId || productId,
    skuId: payload.skuId || '',
    commentScore: Number(payload.commentScore ?? payload.rating) || 0,
    commentContent: payload.commentContent || payload.content || '',
    commentResources: resources,
    commentTime: Date.now(),
    status: 'active',
    commentStatus: 'active',
    goodsDetailInfo: '默认',
    isAnonymity: false,
    isAutoComment: false,
  };
  mockComments.unshift(comment);
  return JSON.parse(JSON.stringify(comment));
}
