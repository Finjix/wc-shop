import { request } from '../../../utils/api';
import { normalizeOrderItem, normalizeServiceType } from '../after-service-detail/contract';

function unwrapData(result) {
  const data = result && result.data !== undefined ? result.data : result;
  if (data && data.data && !Array.isArray(data.data)) return data.data;
  return data || {};
}

function normalizePreview(data) {
  const source = data || {};
  const rawItems = source.goodsList || source.items || source.products || [];
  const goodsList = Array.isArray(rawItems)
    ? rawItems.map((item) => ({
      ...normalizeOrderItem(item),
      spuId: item.spuId || item.productId,
      skuId: item.skuId || item.sku,
      numOfSku: item.numOfSku ?? item.quantity ?? item.buyQuantity ?? 0,
      numOfSkuAvailable: item.numOfSkuAvailable ?? item.availableQuantity ?? item.quantity ?? item.buyQuantity ?? 0,
      refundableAmount: item.refundableAmount ?? item.itemRefundAmount ?? item.itemPaymentAmount ?? item.amount ?? 0,
      paidAmountEach: item.paidAmountEach ?? item.price ?? item.goodsPaymentPrice ?? 0,
      boughtQuantity: item.boughtQuantity ?? item.quantity ?? item.buyQuantity ?? 0,
      goodsInfo: item.goodsInfo || {
        goodsName: item.goodsName || item.title,
        skuImage: item.skuImage || item.goodsPictureUrl || item.image,
        specInfo: item.specInfo || item.specifications || [],
      },
    }))
    : [];
  const itemAmount = goodsList.reduce((sum, item) => sum + Number(item.refundableAmount || 0), 0);
  const itemQuantity = goodsList.reduce((sum, item) => sum + Number(item.boughtQuantity || item.numOfSku || 0), 0);
  return {
    ...source,
    refundableAmount: source.refundableAmount ?? source.refundAmount ?? itemAmount,
    shippingFeeIncluded: source.shippingFeeIncluded ?? source.shippingFee ?? 0,
    numOfSku: source.numOfSku ?? itemQuantity,
    numOfSkuAvailable: source.numOfSkuAvailable ?? itemQuantity,
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
  }).then((result) => ({
    data: normalizePreview(unwrapData(result)),
  }));
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

function uploadAfterSaleImage(image) {
  return imagePath(image);
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
    rightsItem,
  }).then((result) => ({
    data: unwrapData(result),
  }));
}
