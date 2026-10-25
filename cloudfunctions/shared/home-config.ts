// @ts-nocheck

const { assert, string, array, object } = require('./validation');

const HOME_CONFIG_SLOT = 'home.page-config';
const DEFAULT_SEARCH_TEXT = '欢迎光临番薯鞋店！';

function imageLink(value, field) {
  const item = object(value, field);
  const image = typeof item.image === 'string' ? item.image.trim() : '';
  const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
  assert(image.length <= 1024 && productId.length <= 128, { field });
  return { image, productId };
}

function optionalText(value, field, max) {
  assert(typeof value === 'string', { field });
  const text = value.trim();
  assert(text.length <= max, { field, max });
  return text;
}

function validateHomeConfig(value) {
  const input = object(value, 'payload');
  const banners = array(input.banners, 'banners');
  const sections = array(input.sections, 'sections');
  assert(banners.length <= 6, { field: 'banners', max: 6 });
  assert(sections.length <= 4, { field: 'sections', max: 4 });
  const sectionIds = new Set();
  const normalizedSections = sections.map((value, index) => {
    const section = object(value, `sections.${index}`);
    const id = string(section.id, `sections.${index}.id`, { max: 64 });
    assert(!sectionIds.has(id), { field: `sections.${index}.id` });
    sectionIds.add(id);
    const title = optionalText(section.title, `sections.${index}.title`, 80);
    const productIds = array(section.productIds, `sections.${index}.productIds`);
    assert(productIds.length <= 6, { field: `sections.${index}.productIds`, max: 6 });
    return { id, title, productIds: productIds.map((item, productIndex) => optionalText(item, `sections.${index}.productIds.${productIndex}`, 128)) };
  });
  return {
    searchText: optionalText(input.searchText, 'searchText', 120),
    banners: banners.map((item, index) => imageLink(item, `banners.${index}`)),
    sections: normalizedSections,
  };
}

function productIds(config) {
  if (!config || typeof config !== 'object') return [];
  const links = Array.isArray(config.banners) ? config.banners : [];
  const ids = links.map((item) => item && item.productId);
  for (const section of Array.isArray(config.sections) ? config.sections : []) {
    if (Array.isArray(section.productIds)) ids.push(...section.productIds);
  }
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id)));
}

module.exports = { HOME_CONFIG_SLOT, DEFAULT_SEARCH_TEXT, validateHomeConfig, productIds };
