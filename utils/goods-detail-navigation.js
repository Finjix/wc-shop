// 商品详情页暂时关闭，恢复时将开关改为 true。
export const GOODS_DETAIL_NAVIGATION_ENABLED = true;

export function navigateToGoodsDetail(url) {
  if (!GOODS_DETAIL_NAVIGATION_ENABLED) return;

  wx.navigateTo({ url });
}
