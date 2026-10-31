// @ts-nocheck

import { resolveImage } from '../utils/images';

export function resolveGoodsListImages(items = []) {
  return Promise.all((Array.isArray(items) ? items : []).map(async (item) => {
    const [thumb, primaryImage] = await Promise.all([
      resolveImage(item.thumb),
      resolveImage(item.primaryImage),
    ]);
    return {
      ...item,
      thumb: thumb || primaryImage || '',
      primaryImage: primaryImage || thumb || '',
    };
  }));
}

export function resolveCategoryListImages(list = []) {
  return Promise.all(list.map(async (category) => ({
    ...category,
    image: await resolveImage(category.image),
    children: await resolveCategoryListImages(category.children || []),
  })));
}

export async function resolveProductDetailImages(product = {}) {
  const [primaryImage, secondaryImage, images, detailImages, skuList] = await Promise.all([
    resolveImage(product.primaryImage),
    resolveImage(product.secondaryImage),
    Promise.all((Array.isArray(product.images) ? product.images : []).map(resolveImage)),
    Promise.all((Array.isArray(product.detailImages) ? product.detailImages : []).map(resolveImage)),
    Promise.all((Array.isArray(product.skuList) ? product.skuList : []).map(async (sku) => ({
      ...sku,
      skuImage: await resolveImage(sku.skuImage),
    }))),
  ]);
  return {
    ...product,
    primaryImage: primaryImage || images[0] || '',
    secondaryImage,
    coverImages: Array.from(new Set([primaryImage || images[0], secondaryImage].filter(Boolean))),
    images,
    detailImages,
    skuList,
  };
}

export async function resolveHomeContentImages(result = {}) {
  const config = result.config && typeof result.config === 'object'
    ? {
      searchText: result.config.searchText,
      promoImages: await Promise.all((result.config.promoImages || ['', '']).map(resolveImage)),
      recommendations: await Promise.all((result.config.recommendations || []).map(async (item) => ({ ...item, image: await resolveImage(item.image) }))),
      banners: await Promise.all((result.config.banners || []).map(async (item) => ({ ...item, image: await resolveImage(item.image) }))),
    }
    : null;
  const productEntries = await Promise.all(Object.entries(result.productsById || {}).map(async ([id, product]) => {
    const [resolved] = await resolveGoodsListImages([product]);
    return [id, resolved];
  }));
  return { config, productsById: Object.fromEntries(productEntries) };
}
