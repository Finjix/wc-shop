// @ts-nocheck

import { request } from '../../../utils/api';
import { uploadCloudFile } from '../../../utils/api';
import { resolveImage } from '../../../utils/images';
import { normalizeOrderItem, normalizeServiceType } from '../after-service-detail/contract';

function unwrapData(result) {
  const data = result && result.data !== undefined ? result.data : result;
  if (data && data.data && !Array.isArray(data.data)) return data.data;
  return data || {};
}

function normalizePreview(data, params = {}) {
  const source = data || {};
  const allItems = source.goodsList || source.items || source.products || [];
  const rawItems = params.skuId && Array.isArray(allItems)
    ? allItems.filter((item) => String(normalizeOrderItem(item).skuId) === String(params.skuId)) : allItems;
  const hasItemizedAvailability = Array.isArray(rawItems);
  const goodsList = Array.isArray(rawItems) ? rawItems.map((item) => {
    const normalized = normalizeOrderItem(item);
    const availableQuantity = Math.max(0, Number(
      item.availableRefundQuantity
        ?? item.numOfSkuAvailable
        ?? item.availableQuantity
        ?? item.remainingQuantity
        ?? item.fulfillableQuantity
        ?? item.boughtQuantity
        ?? item.numOfSku
        ?? item.quantity
        ?? item.buyQuantity
        ?? 0,
    ) || 0);
    const paidAmountEach = Number(
      item.paidAmountEach ?? item.unitPrice ?? item.price ?? item.goodsPaymentPrice ?? item.actualPrice ?? 0,
    ) || 0;
    return {
      ...normalized,
      numOfSku: availableQuantity,
      numOfSkuAvailable: availableQuantity,
      refundableAmount: item.refundableAmount ?? paidAmountEach * availableQuantity,
      paidAmountEach,
      boughtQuantity: availableQuantity,
      goodsInfo: item.goodsInfo || {
        goodsName: normalized.goodsName,
        skuImage: normalized.goodsPictureUrl,
        specInfo: normalized.specInfo,
      },
    };
  }) : [];
  const itemAmount = goodsList.reduce((sum, item) => sum + Number(item.refundableAmount || 0), 0);
  const itemQuantity = goodsList.reduce((sum, item) => sum + Number(item.boughtQuantity || item.numOfSku || 0), 0);
  return {
    ...source,
    returnAddressConfigured: source.returnAddressConfigured ?? source.hasReturnAddress,
    refundableAmount: hasItemizedAvailability ? itemAmount : source.refundableAmount ?? source.refundAmount ?? 0,
    shippingFeeIncluded: source.shippingFeeIncluded ?? source.shippingFee ?? 0,
    numOfSku: hasItemizedAvailability ? itemQuantity : Number(source.numOfSku) || 0,
    numOfSkuAvailable: hasItemizedAvailability ? itemQuantity : Number(source.numOfSkuAvailable ?? source.numOfSku) || 0,
    goodsList,
  };
}

function normalizeReasons(data) {
  const reasons = data.rightsReasonList || data.reasonList || data.reasons || data.items || [];
  return Array.isArray(reasons)
    ? reasons.map((reason) => {
      if (typeof reason === 'string') return { id: reason, desc: reason };
      return {
        id: reason.id ?? reason.type,
        desc: reason.desc || reason.name || reason.label || '',
      };
    }).filter((reason) => reason.id !== undefined && reason.desc)
    : [];
}

export function fetchRightsPreview(params = {}) {
  return request('afterSales.preview', {
    ...params,
    orderId: params.orderId || params.orderNo,
    productId: params.productId || params.spuId,
  }).then(async (result) => {
    const data = normalizePreview(unwrapData(result), params);
    data.goodsList = await Promise.all(data.goodsList.map(async (item) => ({ ...item,
      goodsInfo: { ...item.goodsInfo, skuImage: await resolveImage(item.goodsInfo.skuImage) },
    })));
    return { data };
  });
}

export function fetchApplyReasonList(params = {}) {
  return request('afterSales.reasons', params).then((result) => ({
    data: { rightsReasonList: normalizeReasons(unwrapData(result)) },
  }));
}

export function dispatchConfirmReceived(params = {}) {
  const payload = params.parameter || params;
  return request('afterSales.confirmReceived', payload).then((result) => ({
    data: unwrapData(result),
  }));
}

function imagePath(image) {
  if (typeof image === 'string') return image;
  return image && (image.fileID || image.fileId || image.tempFilePath || image.path || image.url || image.image) || '';
}

async function uploadAfterSaleImage(image) {
  const path = imagePath(image);
  if (!path || /^(cloud:|local:|data:|https?:\/\/(?!tmp\/))/i.test(path)) return path;
  return uploadCloudFile(path, 'after-sales');
}

export async function dispatchApplyService(params = {}) {
  const rights = params.rights || {};
  const rawItems = Array.isArray(params.rightsItem) ? params.rightsItem : [];
  const rightsItem = rawItems.map(normalizeOrderItem);
  const firstItem = rightsItem[0] || {};
  const images = (await Promise.all((rights.rightsImageUrls || []).map(uploadAfterSaleImage))).filter(Boolean);
  return request('afterSales.create', {
    ...params,
    orderId: rights.orderId || rights.orderNo,
    orderNo: rights.orderNo || rights.orderId,
    productId: rights.productId || firstItem.productId || firstItem.spuId,
    spuId: rights.spuId || firstItem.spuId || firstItem.productId,
    skuId: rights.skuId || firstItem.skuId,
    type: normalizeServiceType(rights.type ?? rights.rightsType, 20),
    rightsType: normalizeServiceType(rights.rightsType ?? rights.type, 20),
    reason: rights.reason || rights.rightsReasonDesc,
    description: params.description || params.refundMemo,
    images,
    refundRequestAmount: rights.refundRequestAmount,
    rightsItem,
  }).then((result) => ({
    data: unwrapData(result),
  }));
}
// @ts-nocheck
