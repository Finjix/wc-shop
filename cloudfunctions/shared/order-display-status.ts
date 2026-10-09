// @ts-nocheck

// 取消订单也会完成退款；展示状态不改变退款账务状态。
function orderDisplayStatus(order) {
  if (order.status === 'refunded' && (order.closureScenario === 'cancel_order' || order.fulfillmentStatus === 'paid')) return 'cancelled';
  return order.status === 'received' ? 'completed' : order.status;
}

module.exports = { orderDisplayStatus };
