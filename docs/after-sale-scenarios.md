# 售后申请场景

## 场景与类型

售后记录的 `scenario` 表达业务场景，`type` 仍表达退款处理方式，二者不混用：

- `cancel_order`：未发货时申请取消；只允许仅退款（20），审核时必须退还该申请预留的全部金额。
- `after_sale`：已发货后的普通售后；允许仅退款（20）或退货退款（10），商家可在上限内决定退款金额。

场景由后端根据事务内订单状态计算，不信任前端传入的场景。金额、数量、身份、库存和模拟退款依旧使用共用校验及事务逻辑，不另建取消订单存储或退款流程。

## 集中策略

`cloudfunctions/shared/after-sale-policy.ts` 是场景规则的入口。读取列表/详情时返回：

- `scenario`：规范化后的场景。
- `presentation`：用户诉求及收货状态的展示文案。
- `reviewPolicy`：允许的处理方式、固定处理方式、是否只允许全额退款、退款上限（分）。
- `actions`：是否可撤销、是否可再次申请、是否计入用户售后角标。

`afterSales.preview` 返回 `applicationPolicy`，用于表单默认原因和处理方式约束。前端使用返回策略；后台旧接口降级集中在 `admin/src/lib/after-sale-policy.ts`。

## 创建与再次申请

- `afterSales.create`：以 `orderId` 创建新记录，不接受重提标识。
- `afterSales.reapply`：以 `afterSaleId` 重提被驳回的原记录，不创建新单；不需要客户端指定订单。

二者共用 `submitAfterSale`。再次申请在事务内重新检查记录所有权及被驳回状态、当前订单状态、金额/数量可用额度；重写原记录，清除旧审核结果并重新预留额度。并发重提最多成功一次，索引不重复。订单已经发货时，重提场景按当前状态改为普通售后。

## 历史兼容与部署

- 已有 `scenario` 优先使用。
- 没有场景但存在 `orderStatusAtApply` 时，集中推导场景。
- 两者都缺失时按普通售后处理，不能仅凭“未收到货”推断为取消订单。需要纠正这类历史记录时，应核对真实申请及发货时间后再迁移；读取不会自动写库。
- 更新小程序和后台前，先部署包含新策略模块和 `afterSales.reapply` 的云函数；旧的 `create + reapplyId` 调用不再支持。

## 后台永久删除

- `orders.delete`（admin scope）：支持所有状态订单。事务内永久删除订单及全部关联售后单（包含处理中记录），兼容缺少关联索引的历史订单。未发货且仍占用库存的订单会释放尚未退款/发货的数量；已发货库存不回补，已退款数量不重复回补。删除不会发起退款。
- `afterSales.delete`（admin scope）：仅结束状态售后可删除。永久删除记录并清理订单的售后索引，不再次执行退款或库存回补。
- 删除不是隐藏，两端查询均无法再获取记录；前端需刷新页面读取最新结果。确认框明确提示不可恢复。
- 旧版 `deletedByAdmin` 隐藏记录重新显示在后台列表，需明确点击删除后才永久清除；不会在读取接口中自动执行破坏性迁移。

测试：`npm run test:cloud`、`npm run test:order-after-sales`、`npm run typecheck`、`npm --prefix admin run build`。
