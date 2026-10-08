// @ts-nocheck

import { request } from '../../../utils/api';
import { resolveOrderImages } from '../../../utils/images';
import { normalizeOrder } from './orderList';

export function fetchOrderDetail(params = {}) {
  const parameter = params.parameter ?? params.orderNo ?? params;
  if (!parameter) {
    const error = new Error('订单编号不能为空');
    error.code = 'ORDER_NO_REQUIRED';
    error.msg = error.message;
    return Promise.reject(error);
  }
  const payload = typeof parameter === 'string' ? { orderNo: parameter } : parameter;
  return request('orders.detail', payload).then(async (response) => {
    const normalized = await resolveOrderImages({ ...normalizeOrder(response), trajectoryVos: [], paymentVO: response.payment });
    return { data: { ...normalized, orderItemVOs: normalized.orderItemVOs.map((goods) => ({ ...goods, goodsPaymentPrice: goods.goodsPaymentPrice ?? goods.actualPrice, itemPaymentAmount: goods.itemPaymentAmount ?? goods.actualPrice * goods.buyQuantity, buttonVOs: Array.isArray(goods.buttonVOs) ? goods.buttonVOs : [] })) } };
  });
}

export function fetchBusinessTime(params = {}) {
  return request('orders.businessTime', params).then((response) => {
    return { data: { ...response, telphone: response.telephone || '' } };
  });
}

export function confirmOrderReceived(params = {}) { return request('orders.confirmReceived', params); }
export function updateOrderAddress(params = {}) {
  return request('orders.updateAddress', {
    orderId: params.orderId || params.orderNo,
    addressId: params.addressId || params.id,
  });
}
// @ts-nocheck
