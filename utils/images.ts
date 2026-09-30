// @ts-nocheck
import { getTempFileUrl } from './api';

const pending = new Map();

/** Resolve display URLs without changing the storage IDs used when saving data. */
export function resolveImage(value) {
  if (typeof value !== 'string') return Promise.resolve('');
  if (!/^(cloud|local):\/\//i.test(value)) return Promise.resolve(value);
  if (!pending.has(value)) {
    const task = Promise.resolve().then(() => getTempFileUrl(value))
      .then((url) => typeof url === 'string' && !/^(cloud|local):\/\//i.test(url) ? url : '')
      .catch(() => '')
      .finally(() => pending.delete(value));
    pending.set(value, task);
  }
  return pending.get(value);
}

export function resolveImageList(values) {
  return Promise.all((Array.isArray(values) ? values : []).map(resolveImage));
}

export async function resolveOrderImages(order) {
  return {
    ...order,
    storeLogo: await resolveImage(order.storeLogo),
    orderItemVOs: await Promise.all((order.orderItemVOs || []).map(async (item) => ({
      ...item, goodsPictureUrl: await resolveImage(item.goodsPictureUrl),
    }))),
  };
}

export async function resolveRightsImages(record) {
  return {
    ...record,
    rights: { ...record.rights, rightsImageUrls: await resolveImageList(record.rights?.rightsImageUrls || record.rights?.images) },
    rightsItem: await Promise.all((record.rightsItem || []).map(async (item) => ({
      ...item, goodsPictureUrl: await resolveImage(item.goodsPictureUrl || item.thumb),
    }))),
  };
}
