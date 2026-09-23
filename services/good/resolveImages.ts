// @ts-nocheck

import { getTempFileUrl } from '../../utils/api';

function resolveImage(value) {
  if (typeof value !== 'string' || !/^(cloud|local):\/\//i.test(value)) return Promise.resolve(value || '');
  return getTempFileUrl(value).catch(() => value);
}

export function resolveGoodsListImages(items = []) {
  return Promise.all((Array.isArray(items) ? items : []).map(async (item) => {
    const [thumb, primaryImage] = await Promise.all([
      resolveImage(item.thumb),
      resolveImage(item.primaryImage),
    ]);
    return {
      ...item,
      thumb: thumb || primaryImage || item.thumb || item.primaryImage || '',
      primaryImage: primaryImage || thumb || item.primaryImage || item.thumb || '',
    };
  }));
}

export async function resolveProductDetailImages(product = {}) {
  const [primaryImage, images, detailImages, desc, skuList] = await Promise.all([
    resolveImage(product.primaryImage),
    Promise.all((Array.isArray(product.images) ? product.images : []).map(resolveImage)),
    Promise.all((Array.isArray(product.detailImages) ? product.detailImages : []).map(resolveImage)),
    Promise.all((Array.isArray(product.desc) ? product.desc : []).map(resolveImage)),
    Promise.all((Array.isArray(product.skuList) ? product.skuList : []).map(async (sku) => ({
      ...sku,
      skuImage: await resolveImage(sku.skuImage),
    }))),
  ]);
  return {
    ...product,
    primaryImage: primaryImage || images[0] || product.primaryImage || '',
    images,
    detailImages,
    desc,
    skuList,
  };
}

export async function resolveHomeContentImages(result = {}) {
  const items = Array.isArray(result.items)
    ? await Promise.all(result.items.map(async (item) => ({
      ...item,
      image: await resolveImage(item.image),
      content: item.type === 'banner' ? await resolveImage(item.content) : item.content,
    })))
    : result.items;
  const config = result.config && typeof result.config === 'object'
    ? {
      ...result.config,
      banners: await Promise.all((result.config.banners || []).map(async (item) => ({ ...item, image: await resolveImage(item.image) }))),
      promos: await Promise.all((result.config.promos || []).map(async (item) => ({ ...item, image: await resolveImage(item.image) }))),
    }
    : null;
  const productEntries = await Promise.all(Object.entries(result.productsById || {}).map(async ([id, product]) => {
    const [resolved] = await resolveGoodsListImages([product]);
    return [id, resolved];
  }));
  return { ...result, items, config, productsById: Object.fromEntries(productEntries) };
}
