// @ts-nocheck

const { assert, string, array, object } = require('./validation');

const HOME_CONFIG_SLOT = 'home.page-config';
const DEFAULT_SEARCH_TEXT = '欢迎光临番薯鞋店！';
const DEFAULT_BANNER_TEXT = '急速发货 | 品质保证 | 退货无忧';

function imageLink(value, field) {
  const item = object(value, field);
  const image = typeof item.image === 'string' ? item.image.trim() : '';
  const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
  assert(!productId || image, { field });
  assert(image.length <= 1024 && productId.length <= 128, { field });
  return { image, productId };
}

function validateHomeConfig(value) {
  const input = object(value, 'payload');
  const banners = array(input.banners, 'banners');
  const promos = array(input.promos, 'promos');
  const sections = array(input.sections, 'sections');
  assert(banners.length >= 1 && banners.length <= 6, { field: 'banners', min: 1, max: 6 });
  assert(promos.length === 2, { field: 'promos', max: 2 });
  assert(sections.length >= 1 && sections.length <= 6, { field: 'sections', min: 1, max: 6 });
  const sectionIds = new Set();
  const normalizedSections = sections.map((value, index) => {
    const section = object(value, `sections.${index}`);
    const id = string(section.id, `sections.${index}.id`, { max: 64 });
    assert(!sectionIds.has(id), { field: `sections.${index}.id` });
    sectionIds.add(id);
    const title = string(section.title, `sections.${index}.title`, { max: 80 });
    const productIds = array(section.productIds, `sections.${index}.productIds`);
    assert(productIds.length === 6, { field: `sections.${index}.productIds`, count: 6 });
    return { id, title, productIds: productIds.map((item, productIndex) => string(item, `sections.${index}.productIds.${productIndex}`, { max: 128 })) };
  });
  return {
    searchText: typeof input.searchText === 'string' && !input.searchText.trim() ? '' : string(input.searchText, 'searchText', { max: 120 }),
    bannerText: typeof input.bannerText === 'string' && !input.bannerText.trim() ? '' : string(input.bannerText, 'bannerText', { max: 160 }),
    banners: banners.map((item, index) => imageLink(item, `banners.${index}`)),
    promos: promos.map((item, index) => imageLink(item, `promos.${index}`)),
    sections: normalizedSections,
  };
}

function productIds(config) {
  if (!config || typeof config !== 'object') return [];
  const links = [...(Array.isArray(config.banners) ? config.banners : []), ...(Array.isArray(config.promos) ? config.promos : [])];
  const ids = links.map((item) => item && item.productId);
  for (const section of Array.isArray(config.sections) ? config.sections : []) {
    if (Array.isArray(section.productIds)) ids.push(...section.productIds);
  }
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id)));
}

module.exports = { HOME_CONFIG_SLOT, DEFAULT_SEARCH_TEXT, DEFAULT_BANNER_TEXT, validateHomeConfig, productIds };
