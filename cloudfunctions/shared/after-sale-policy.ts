// @ts-nocheck

const SCENARIOS = Object.freeze({ CANCEL_ORDER: 'cancel_order', AFTER_SALE: 'after_sale' });
const POLICIES = Object.freeze({
  [SCENARIOS.CANCEL_ORDER]: { allowedTypes: [20], fixedType: 20, fullRefundOnly: true, defaultReason: '取消订单', receiptStatus: 2 },
  [SCENARIOS.AFTER_SALE]: { allowedTypes: [10, 20], fixedType: null, fullRefundOnly: false, defaultReason: '', receiptStatus: null },
});

function scenarioForOrder(order) {
  return order.status === 'paid' ? SCENARIOS.CANCEL_ORDER : SCENARIOS.AFTER_SALE;
}

// 已有快照可确定场景；没有快照的旧记录不按“未收到货”猜测，避免把已发货退款误判为取消订单。
function scenarioOf(record) {
  if (Object.values(SCENARIOS).includes(record.scenario)) return record.scenario;
  return record.orderStatusAtApply === 'paid' ? SCENARIOS.CANCEL_ORDER : SCENARIOS.AFTER_SALE;
}

function policyForScenario(scenario) {
  return POLICIES[scenario] || POLICIES[SCENARIOS.AFTER_SALE];
}

function presentAfterSale(record) {
  const scenario = scenarioOf(record);
  const policy = policyForScenario(scenario);
  const maximumAmount = Number(record.reservedRefundAmount ?? record.refundRequestAmount ?? record.amount ?? 0);
  return {
    ...record,
    scenario,
    presentation: {
      typeLabel: scenario === SCENARIOS.CANCEL_ORDER ? '取消订单' : Number(record.requestedType ?? record.type) === 10 ? '退货退款' : '仅退款',
      receiptStatusLabel: scenario === SCENARIOS.CANCEL_ORDER ? '未发货' : Number(record.receiptStatus) === 1 ? '已收到货' : Number(record.receiptStatus) === 2 ? '未收到货' : '未记录',
    },
    reviewPolicy: { allowedTypes: [...policy.allowedTypes], fixedType: policy.fixedType, fullRefundOnly: policy.fullRefundOnly, maximumAmount },
    actions: {
      withdraw: record.status === 'pending_review',
      reapply: record.status === 'rejected',
      countInBadge: ['pending_review', 'approved', 'refunding'].includes(record.status),
    },
  };
}

module.exports = { SCENARIOS, scenarioForOrder, scenarioOf, policyForScenario, presentAfterSale };
