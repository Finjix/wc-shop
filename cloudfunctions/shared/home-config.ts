// @ts-nocheck

const { assert, array, object } = require('./validation');

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
  const recommendations = array(input.recommendations === undefined ? [] : input.recommendations, 'recommendations');
  assert(banners.length <= 4, { field: 'banners', max: 4 });
  assert(recommendations.length <= 4, { field: 'recommendations', max: 4 });
  return {
    searchText: optionalText(input.searchText, 'searchText', 120),
    banners: banners.map((item, index) => imageLink(item, `banners.${index}`)),
    recommendations: recommendations.map((item, index) => imageLink(item, `recommendations.${index}`)),
  };
}

function productIds(config) {
  if (!config || typeof config !== 'object') return [];
  const links = [...(Array.isArray(config.banners) ? config.banners : []),
    ...(Array.isArray(config.recommendations) ? config.recommendations : [])];
  const ids = links.map((item) => item && item.productId);
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id)));
}

module.exports = { HOME_CONFIG_SLOT, DEFAULT_SEARCH_TEXT, validateHomeConfig, productIds };
