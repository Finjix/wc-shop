// 商品详情页跳转保持开启。
export const GOODS_DETAIL_NAVIGATION_ENABLED = true;

export function navigateToGoodsDetail(url) {
  if (!GOODS_DETAIL_NAVIGATION_ENABLED) return;

  wx.navigateTo({ url });
}
