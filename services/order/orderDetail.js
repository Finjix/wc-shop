import { callShop } from '../../utils/cloud';
import { normalizeOrder } from './orderList';

function dataOf(response) {
  const value = response?.data ?? response;
  return value?.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value;
}

export function fetchOrderDetail(params = {}) {
  const parameter = params.parameter ?? params.orderNo ?? params;
  if (!parameter) {
    const error = new Error('订单编号不能为空');
    error.code = 'ORDER_NO_REQUIRED';
    error.msg = error.message;
    return Promise.reject(error);
  }
  const payload = typeof parameter === 'string' ? { orderNo: parameter } : parameter;
  return callShop('orders.detail', payload).then((response) => {
    const data = dataOf(response) || {};
    const order = data.order && typeof data.order === 'object' ? data.order : data;
    const normalized = normalizeOrder({
      ...order,
      goodsAmountApp: order.goodsAmountApp ?? order.goodsAmount ?? order.totalAmount ?? 0,
      trajectoryVos: Array.isArray(order.trajectoryVos) ? order.trajectoryVos : order.trajectories || [],
      paymentVO: order.paymentVO || order.payment || {},
    });
    return { data: { ...normalized, orderItemVOs: normalized.orderItemVOs.map((goods) => ({ ...goods, goodsPaymentPrice: goods.goodsPaymentPrice ?? goods.actualPrice, itemPaymentAmount: goods.itemPaymentAmount ?? goods.actualPrice * goods.buyQuantity, buttonVOs: Array.isArray(goods.buttonVOs) ? goods.buttonVOs : [] })) } };
  });
}

export function fetchBusinessTime(params = {}) {
  return callShop('orders.businessTime', params).then((response) => {
    const data = dataOf(response) || {};
    return { data: { ...data, telphone: data.telphone || data.telephone || data.phone || '' } };
  });
}

export function cancelOrder(orderNo) { return callShop('orders.cancel', { orderNo }); }
export function confirmOrderReceived(params = {}) { return callShop('orders.confirmReceived', params); }
export function deleteOrder(orderNo) { return callShop('orders.delete', { orderNo }); }
