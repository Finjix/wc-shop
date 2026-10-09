// @ts-nocheck

import { request, uploadCloudFile } from '../../../utils/api';
import { resolveImage } from '../../../utils/images';
import { normalizeOrderItem } from '../after-service-detail/contract';

export function fetchRightsPreview(params = {}) {
  return request('afterSales.preview', { orderId: params.orderNo, includeReasons: params.includeReasons }).then(async (source) => {
    const items = params.skuId ? source.items.filter((item) => item.skuId === params.skuId) : source.items;
    const goodsList = await Promise.all(items.map(async (item) => {
      const normalized = normalizeOrderItem(item);
      const quantity = item.availableRefundQuantity;
      return {
        ...normalized,
        numOfSku: quantity,
        numOfSkuAvailable: quantity,
        boughtQuantity: quantity,
        paidAmountEach: item.unitPrice,
        refundableAmount: item.unitPrice * quantity,
        goodsInfo: { goodsName: normalized.goodsName, skuImage: await resolveImage(normalized.goodsPictureUrl), specInfo: normalized.specInfo },
      };
    }));
    const quantity = goodsList.reduce((sum, item) => sum + item.boughtQuantity, 0);
    return { data: {
      ...source, goodsList,
      refundableAmount: goodsList.reduce((sum, item) => sum + item.refundableAmount, 0),
      shippingFeeIncluded: 0,
      numOfSku: quantity,
      numOfSkuAvailable: quantity,
    } };
  });
}
export function fetchApplyReasonList(params = {}) {
  return request('afterSales.reasons', params).then((data) => ({ data: { rightsReasonList: data.items.map((reason) => ({ id: reason, desc: reason })) } }));
}
export function dispatchConfirmReceived(params = {}) {
  return request('afterSales.confirmReceived', params.parameter).then((data) => ({ data }));
}
async function uploadAfterSaleImage(image) {
  // 上传组件提供本地路径；已上传文件仍可直接提交。
  const path = typeof image === 'string' ? image : image.url || image.tempFilePath || image.path;
  const isLocalPath = path && (path.startsWith(wx.env.USER_DATA_PATH)
    || /^(wxfile:|https?:\/\/(?:tmp|usr)\/)/i.test(path));
  if (!path || (!isLocalPath && /^(cloud:|local:|data:|https?:\/\/)/i.test(path))) return path;
  return uploadCloudFile(path, 'after-sales');
}
export async function dispatchApplyService(params = {}) {
  const rights = params.rights;
  const images = (await Promise.all(rights.rightsImageUrls.map(uploadAfterSaleImage))).filter(Boolean);
  const action = rights.reapplyId ? 'afterSales.reapply' : 'afterSales.create';
  const target = rights.reapplyId ? { afterSaleId: rights.reapplyId } : { orderId: rights.orderNo };
  return request(action, {
    ...target,
    type: rights.rightsType,
    receiptStatus: rights.receiptStatus,
    reason: rights.rightsReasonDesc,
    description: params.refundMemo,
    images,
    rightsItem: params.rightsItem.map((item) => ({ skuId: item.skuId, rightsQuantity: item.rightsQuantity })),
  }).then((data) => ({ data }));
}
