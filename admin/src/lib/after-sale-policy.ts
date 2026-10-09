import type { AfterSale } from '../types';

// 新接口返回集中计算的策略；降级只用于旧接口，页面不再直接判断订单状态。
export function afterSalePolicy(row: AfterSale) {
  if (row.reviewPolicy) return row.reviewPolicy;
  const cancellation = row.scenario === 'cancel_order' || (!row.scenario && row.orderStatusAtApply === 'paid');
  return {
    allowedTypes: cancellation ? [20] : [10, 20],
    fixedType: cancellation ? 20 : null,
    fullRefundOnly: cancellation,
    maximumAmount: Number(row.reservedRefundAmount ?? row.refundRequestAmount ?? row.amount ?? 0),
  };
}

export function afterSaleRequestLabel(row: AfterSale) {
  if (row.presentation?.typeLabel) return row.presentation.typeLabel;
  if (afterSalePolicy(row).fullRefundOnly) return '取消订单';
  return Number(row.requestedType ?? row.type) === 10 ? '退货退款' : '仅退款';
}

export function afterSaleReceiptLabel(row: AfterSale) {
  if (row.presentation?.receiptStatusLabel) return row.presentation.receiptStatusLabel;
  if (afterSalePolicy(row).fullRefundOnly) return '未发货';
  return row.receiptStatus === 1 ? '已收到货' : row.receiptStatus === 2 ? '未收到货' : '未记录';
}
