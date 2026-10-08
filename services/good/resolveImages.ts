// @ts-nocheck

import { resolveImage } from '../../utils/images';

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
  return Promise.all(list.map(async (parent) => ({
    ...parent,
    image: await resolveImage(parent.image),
    children: await Promise.all((parent.children || []).map(async (child) => ({
      ...child,
      image: await resolveImage(child.image),
    }))),
  })));
}

export async function resolveProductDetailImages(product = {}) {
  const [primaryImage, images, detailImages, skuList] = await Promise.all([
    resolveImage(product.primaryImage),
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
    images,
    detailImages,
    skuList,
  };
}

export async function resolveHomeContentImages(result = {}) {
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
  return { config, productsById: Object.fromEntries(productEntries) };
}
