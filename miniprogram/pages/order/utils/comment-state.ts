// @ts-nocheck
import { OrderButtonTypes } from '../../_shared/frontend/order/config';

/** Apply a successful review without removing the card from its current filter. */
export function applyCommentToOrder(order, productId) {
  const commentedProductIds = [...new Set([...(order.commentedProductIds || []), productId].filter(Boolean))];
  const eligibleGoods = (order.goodsList || []).filter((goods) => Number(
    goods.fulfillableQuantity ?? goods.remainingQuantity ?? goods.num ?? 0,
  ) > 0 && !commentedProductIds.includes(goods.spuId));
  const originalButtons = order.buttons || [];
  const commentTypes = [OrderButtonTypes.COMMENT, OrderButtonTypes.VIEW_COMMENT];
  const actionIndex = originalButtons.findIndex((button) => commentTypes.includes(Number(button.type)));
  const buttons = originalButtons.filter((button) => !commentTypes.includes(Number(button.type)));
  buttons.splice(actionIndex < 0 ? buttons.length : actionIndex, 0, eligibleGoods.length
    ? { type: OrderButtonTypes.COMMENT, name: '评价', primary: true }
    : { type: OrderButtonTypes.VIEW_COMMENT, name: '查看评价', primary: true });
  return {
    ...order, commentedProductIds, hasPendingComments: eligibleGoods.length > 0,
    commentableProductId: eligibleGoods[0]?.spuId, buttons,
  };
}
