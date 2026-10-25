// @ts-nocheck
const SHOP_TITLE = '番薯小店';
const HOME_PATH = '/pages/home/home';

export function enablePageSharing() {
  wx.showShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] });
}

function queryString(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
}

function productShare(page) {
  const id = page.data.spuId;
  const details = page.data.details || {};
  const selected = String(page.data.selectedAttrStr || '');
  const subtitle = selected.includes('件') ? selected.slice(selected.indexOf('件') + 1) : '';
  const title = details.title ? `${details.title}${subtitle}` : SHOP_TITLE;
  // Share thumbnails accept PNG/JPG. Other formats/storage IDs use WeChat's fallback.
  const imageUrl = /^https:\/\/.+\.(?:png|jpe?g)(?:[?#]|$)/i.test(details.primaryImage || '') ? details.primaryImage : undefined;
  return { title, ...(imageUrl ? { imageUrl } : {}), query: queryString({ spuId: id }) };
}

function catalogShare(page) {
  return {
    title: page.data.searchTitle || page.data.categoryName || SHOP_TITLE,
    query: queryString({ searchValue: page.data.keywords, categoryId: page.data.categoryId,
      categoryName: page.data.categoryName || page.data.searchTitle }),
  };
}

export const shopShareHandlers = {
  onShareAppMessage() { return { title: SHOP_TITLE, path: HOME_PATH }; },
  onShareTimeline() { return { title: SHOP_TITLE, query: '' }; },
};

export const catalogShareHandlers = {
  onShareAppMessage() {
    const { title, query } = catalogShare(this);
    return { title, path: `/goods/result/index${query ? `?${query}` : ''}` };
  },
  onShareTimeline() { return catalogShare(this); },
};

export const productShareHandlers = {
  onShareAppMessage() {
    const { query, ...content } = productShare(this);
    return { ...content, path: query ? `/goods/details/index?${query}` : HOME_PATH };
  },
  onShareTimeline() { return productShare(this); },
};
