# wc-shop CloudBase functions

这是小程序商城的真实后端契约。现在由一个 TypeScript 云函数 `wc-shop-function` 承载两类接口：`shop` 面向已登录用户，`admin` 面向 `adminMembers` 白名单中的运营人员。请求通过顶层 `scope` 字段分流，入口源码为 `cloudfunctions/wc-shop-function/index.ts`，部署时使用编译后的 `index.js`。

## 部署前置条件

1. 在 CloudBase 环境中启用微信/小程序身份认证、文档数据库和云存储。
2. 在仓库外设置当前环境变量 `CLOUDBASE_ENV_ID`，它只用于解析 `cloudbaserc.json`；小程序运行时环境 ID 维护在 `config/runtime.ts`，部署前需与控制台 `cloud1` 环境核对。
3. 在数据库中创建首个 `adminMembers` 文档，推荐把文档 `_id` 设为 CloudBase 用户 UID，并设置 `status: "active"`、`roles: ["superadmin"]`。函数不会创建或绕过管理员。
4. 使用 CloudBase CLI 在仓库根目录部署；配置已打开云端安装依赖，运行环境为 Node.js 20.19。先运行 `npm run package:deploy` 完成编译，再使用 `tcb fn deploy wc-shop-function`，实际环境 ID 由 CLI/环境变量提供。

## 控制台 ZIP 部署

控制台上传 ZIP 时，平台要求压缩包根目录直接存在 `index.js`。运行仓库根目录的 `npm run package:deploy`，两个包会重新构建到 `dist/0830a/`：

- `dist/0830a/wc-shop-function.zip`：函数 Handler 填 `index.main`
- `dist/0830a/wc-shop-admin-static.zip`：静态托管包，根目录直接包含 `index.html`

不要把 `cloudfunctions/wc-shop-function` 文件夹直接压成 ZIP 后上传；控制台包必须使用脚本生成的 ZIP，使根目录直接包含 `index.js`。包中还包含 `vendor/` 依赖适配器和 `config.json`。订单不依赖定时触发器，`config.json` 中的空 `triggers` 配置用于移除历史函数触发器；CLI 配置位于 `cloudbaserc.json`。

依赖要求 Node.js >= 20.9。SDK 的旧版 Axios 通过 overrides 更新；其数据库依赖使用的 lodash.set/unset 通过本地适配器调用已更新的 lodash，并保留 callable/default 两种导出约定。升级 SDK 时应重新核对这些覆盖和依赖审计。

函数内使用 `@cloudbase/node-sdk` 的 `cloudbase.init({})`。CloudBase 云函数运行时提供服务端身份，不读取 `SecretId`、`SecretKey`、API Key 或任何仓库外密钥。

## 调用契约

客户端调用示例：

```js
wx.cloud.callFunction({
  name: 'wc-shop-function',
  data: { scope: 'shop', action: 'products.list', data: { page: 1, pageSize: 20 } },
});
```

所有成功响应均为 `{ ok: true, data, requestId }`；失败响应仍保持 `{ ok: false, data: null, requestId }`，并附带稳定的 `error.code` 与用户可读 `error.message`。服务端日志使用 `requestId` 关联，不把内部异常回传客户端。

## Action 总览

`scope: 'shop'`：

- `categories.list`、`products.list`、`products.detail`、`skus.list`、`home.get`
- `user.me`、`user.update`
- `searchHistory.list/add/remove/clear`
- `addresses.list/get/create/update/remove/setDefault`
- `cart.get/add/update/remove/clear`
- `orders.preview/create/list/count/businessTime/detail/confirmReceived/updateAddress/delete`
- `comments.list/count/create`
- `afterSales.reasons/preview/list/detail/create/withdraw/cancel/confirmReceived/submitTracking`
- `storage.tempUrls`、`storage.processImage`

`scope: 'admin'`：

- `auth.me`
- `categories.*`、`products.*`、`skus.*`（list/get/create/update/delete；delete 为下架）
- `inventory.adjust`
- `home.list/get/upsert`
- `orders.list/get/updateStatus/ship`
- `comments.list/get/updateStatus/reply/delete`
- `afterSales.list/get/review/confirmReturn`
- `settings.list/get/upsert`
- `storage.tempUrls`、`storage.processImage`

商品图片、SKU 图片、首页轮播图和评论图片字段保存 CloudBase `fileId`。后台仅接受静态 PNG、JPG/JPEG、WebP（扩展名不区分大小写），校验真实格式并拒绝动态 PNG/WebP；原文件不超过 10MB（10,485,760 字节）。浏览器 Worker 使用本地 WASM 将 PNG/JPEG 有损编码为 WebP，质量设为 100，透明通道质量设为 100；所有静态图片短边超过 1080px 时等比例缩小后使用相同参数编码；短边不超过 1080px 的 WebP 原样上传。质量 100 仍为有损编码，不保证保留原文件像素、元数据或输出更小；处理结果不设业务大小限制。处理完成后直接上传正式目录，不调用图片转换云函数。用户评价和售后仍原样上传，不超过 3MB（3,145,728 字节）；所有用户统一使用 `/assets/user-avatar.jpg` 固定头像，不能更改；头像上传和头像临时链接解析入口已关闭。本地 `/upload` 按目录使用相同规则并原样保存，后台通过 `x-upload-folder` 指明目录以接收可能超过 14MB 的处理结果。`storage.processImage` 为旧客户端保留原样转存行为，服务端不压缩、缩放、旋转或转换格式。已有图片保持不变。

## 订单和库存边界


- 金额单位统一为整数“分”，订单服务端重新读取 SKU 价格，绝不信任客户端传来的金额或商品快照。
- `orders.create` 只接受 `{ skuId, quantity }`，校验 SKU 仍属于商品规格、关联商品 `status === "active"` 和库存后才创建订单；上下架由商品状态控制。
- 创建订单使用文档数据库事务；事务内只通过已解析的 SKU 文档 `_id` 重新读取和更新库存，不使用事务不支持的 `where` 查询，库存不足或写冲突会回滚整个订单。
- 订单保存 `productSnapshot`、`skuSnapshot`、`addressSnapshot`；下单事务内直接记为 `paid`，并保存 `payment.mode: simulated`、`paymentAmount`、`paidAt`。服务端决定模拟支付成功，不返回也不接受真实支付参数。
- `requestKey`/`idempotencyKey` 是创建订单的必填字段；同一用户和 key 使用不同参数会返回 `IDEMPOTENCY_CONFLICT`。
- 不自动迁移或删除历史数据：旧的待支付记录保持原字段和状态，服务端读取不会将其改成已付款或取消，也不会自动回滚其库存。
- 已收货、已完成订单映射前端状态 50；全额退款的商品不再进入待评价，待评价查询只包含尚有未退款商品未评价的订单。评价通过确定性文档 ID 和订单事务阻止重复提交，用户可查看自己尚未审核的评价，公开评价不返回用户及订单标识。
- 售后按实际购买的 SKU 和数量计算退款金额。仅本人可撤销待审核申请；管理员只能将待审核申请审核通过或拒绝。模拟退款只处理标记为 `payment.mode: simulated` 的新订单，不为历史订单补造支付记录；纯退款审核通过即完成模拟退款，退货退款审核后保存商家退货地址快照、录入寄回单号并由管理员确认收货后退款。
- 已付款且未发货仅可申请仅退款；发货后可申请仅退款或退货退款。申请、审核、退款、发货、收货地址变更和库存更新使用事务约束状态、金额和数量。未发货仅退款恢复库存和销量；已发货仅退款不恢复库存；退货退款在收货确认后恢复库存和销量。全部退款后未发货订单关闭为 `cancelled`，已发货订单关闭为 `completed`；部分退款通过 `paymentStatus: partially_refunded` 与 `refundAmount/refundedQuantities` 表示，不中断仍需履约的剩余商品。
- `settings` 的 `global` 记录可包含 `returnAddress: { receiver, phone, province, city, district, detail }`；服务端校验手机号和完整地址，未配置时拒绝退货退款申请。
- 订单不提供通用取消入口；未发货订单完成全额退款后关闭为 `cancelled`。模拟下单与模拟退款不调用支付或物流第三方接口。

## 集合结构与建议索引

核心集合：`categories`、`products`、`skus`、`addresses`、`carts`、`orders`、`comments`、`afterSales`、`homeContents`、`searchHistories`、`settings`、`adminMembers`；不建立用户档案集合。

建议在 CloudBase 数据库中建立以下索引（均为非唯一，除非控制台明确支持并确认现有数据无重复）：

- `products`: `status + sort`、`status + updatedAt`、`categoryIds`
- `skus`: `productId`、`skuId`
- `categories`: `status + sort`
- `addresses`: `userId + isDefault`、`userId + updatedAt`
- `orders`: `userId + createdAt`、`userId + status + createdAt`、`orderNo`、`requestKey + userId`
- `comments`: `productId + status + createdAt`、`productId + status + hasImage + createdAt`、`orderId + userId`
- `afterSales`: `userId + createdAt`、`orderId + createdAt`、`status + updatedAt`
- `homeContents`: `status + slot + sort`
- `searchHistories`: `userId + updatedAt`、`userId + keyword`
- `adminMembers`: `uid`、`status`

主要字段：

- `products`: `title`, `primaryImage`, `images`, `categoryIds`, `status`, `sort`, `minSalePrice`, `maxSalePrice`
- `skus`: `productId`, `skuId`, `specInfo`, `salePrice`, `stockQuantity`, `soldQuantity`
- `addresses/carts`: 均带 `userId`；购物车文档 `_id` 推荐直接使用 UID
- `orders`: `userId`, `status`, `paymentStatus`, `items`, `addressSnapshot`, `subtotal`, `shippingFee`, `totalAmount`, `requestHash`, `commentedProductIds`, `hasPendingComments`, `afterSaleIds`
- `adminMembers`: `_id`/`uid`, `roles`, `status`, `enabled`

## 状态枚举

- 通用：`active`, `inactive`
- 订单履约状态：`paid`, `shipped`, `received`, `completed`, `cancelled`；其中 `cancelled` 用于未发货订单全额退款关闭
- 售后/审核：`pending_review`, `approved`, `rejected`, `refunding`, `refunded`, `withdrawn`
- 支付状态：`paid`, `partially_refunded`, `refunded`；新订单支付方式为 `simulated`

## 安全边界

- 所有用户写操作只使用服务端从 CloudBase 请求上下文解析的 UID；`userId`、金额、库存、订单状态和管理员角色不信任客户端。
- `scope: 'admin'` 的请求必须同时通过 CloudBase UID 身份校验、`adminMembers` 存在性、启用状态和角色 scope 校验；`scope` 只负责路由，不能替代权限校验。
- 服务端 SDK 具备管理员数据库权限，因此数据库客户端规则仍应配置为最小权限：客户端不直接写商品、库存、订单状态、管理员、设置或评论审核字段。
- `user.me` / `user.update` 只返回当前请求身份所需的临时资料，头像固定为 `/assets/user-avatar.jpg`，忽略客户端传入的头像；不建立或更新用户档案；订单仍保留履约所需的 `userId` 和收货地址快照。
- `fileId` 必须是应用约定的 CloudBase 存储路径；生产环境应在云存储规则或后台函数中继续限制前缀、文件类型和大小。
- 函数没有硬编码环境 ID、账号、SecretId、SecretKey、密码或支付密钥。

## 本地检查

本地可以运行 `npm run test:cloud`，它测试编译后的云函数契约、校验和入口静态约定。真实数据库事务、身份上下文、索引、云存储临时 URL 和 CloudBase CLI 部署必须在目标环境中验证。
