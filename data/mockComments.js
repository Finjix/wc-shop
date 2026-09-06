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
