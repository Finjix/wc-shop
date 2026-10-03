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

不要把 `cloudfunctions/wc-shop-function` 文件夹直接压成 ZIP 后上传；控制台包必须使用脚本生成的 ZIP，使根目录直接包含 `index.js`。包中还包含 `vendor/` 依赖适配器和 `config.json`。控制台部署后核对 `expire-pending-orders` 定时触发器已启用，周期为每 5 分钟，Cron 为 `0 */5 * * * * *`；仅上传代码不会保证触发器已创建。CLI 配置位于 `cloudbaserc.json`。

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
- `orders.preview/create/list/count/businessTime/detail/cancel/confirmReceived/delete`
- `comments.list/count/create`
- `afterSales.reasons/preview/list/detail/create/confirmReceived/submitTracking`
- `storage.tempUrls`、`storage.processImage`

`scope: 'admin'`：

- `auth.me`
- `categories.*`、`products.*`、`skus.*`（list/get/create/update/delete；delete 为下架）
- `inventory.adjust`
- `home.list/get/upsert`
- `orders.list/get/updateStatus/ship/cancel`
- `comments.list/get/updateStatus/delete`
- `afterSales.list/get/updateStatus`
- `settings.list/get/upsert`
- `storage.tempUrls`、`storage.processImage`

商品图片、SKU 图片、首页轮播图和评论图片字段保存 CloudBase `fileId`。后台仅接受静态 PNG、JPG/JPEG、WebP（扩展名不区分大小写），校验真实格式并拒绝动态 PNG/WebP；原文件不超过 10MB（10,485,760 字节）。浏览器 Worker 使用本地 WASM 将 PNG/JPEG 无损编码为 WebP，所有静态图片短边超过 1080px 时等比例缩小后无损编码；短边不超过 1080px 的 WebP 原样上传。无损指处理后像素的编码无损，不保证保留原文件元数据或输出更小；处理结果不设业务大小限制。处理完成后直接上传正式目录，不调用图片转换云函数。用户评价和售后仍原样上传，不超过 3MB（3,145,728 字节）；所有用户统一使用 `/assets/user-avatar.jpg` 固定头像，不能更改；头像上传和头像临时链接解析入口已关闭。本地 `/upload` 按目录使用相同规则并原样保存，后台通过 `x-upload-folder` 指明目录以接收可能超过 14MB 的处理结果。`storage.processImage` 为旧客户端保留原样转存行为，服务端不压缩、缩放、旋转或转换格式。已有图片保持不变。

## 订单和库存边界

后台“图片资源”的分批盘点、浏览器压缩替换、集合及索引配置、权限、跨域检查和验证范围见 [图片资源管理说明](../docs/image-resources.md)。

- 金额单位统一为整数“分”，订单服务端重新读取 SKU 价格，绝不信任客户端传来的金额或商品快照。
- `orders.create` 只接受 `{ skuId, quantity }`，校验 SKU 仍属于商品规格、关联商品 `status === "active"` 和库存后才创建订单；上下架由商品状态控制。
- 创建订单使用文档数据库事务；事务内只通过已解析的 SKU 文档 `_id` 重新读取和更新库存，不使用事务不支持的 `where` 查询，库存不足或写冲突会回滚整个订单。
- 订单保存 `productSnapshot`、`skuSnapshot`、`addressSnapshot`；首阶段状态固定为 `pending_payment`，`payment` 固定为 `null`，不返回模拟支付结果。
- `requestKey`/`idempotencyKey` 是创建订单的必填字段；同一用户和 key 使用不同参数会返回 `IDEMPOTENCY_CONFLICT`。
- 待支付订单记录 30 分钟 `expiresAt`，订单列表、详情和创建订单均会清理过期订单；定时触发器每次全局处理最多 100 条，后续触发继续清理，事务重读状态和截止时间，避免重复恢复库存。定时任务只信任 CloudBase 上下文的 `TRIGGER_SRC`。
- 已收货、已完成订单映射前端状态 50；待评价查询只包含尚有商品未评价的订单。评价通过确定性文档 ID 和订单事务阻止重复提交，用户可查看自己尚未审核的评价，公开评价不返回用户及订单标识。
- 售后按实际购买的 SKU 和申请数量计算金额上限，事务校验同商品的在途申请及累计已退款数量；首阶段仍不执行真实退款。
- 取消仅允许待支付订单，并在同一事务中恢复库存及回退预占销量；发货和收货只能按状态机改变状态，支付、退款和物流第三方回调暂未实现。

## 集合结构与建议索引

核心集合：`categories`、`products`、`skus`、`addresses`、`carts`、`orders`、`comments`、`afterSales`、`homeContents`、`searchHistories`、`settings`、`adminMembers`；不建立用户档案集合。

建议在 CloudBase 数据库中建立以下索引（均为非唯一，除非控制台明确支持并确认现有数据无重复）：

- `products`: `status + sort`、`status + updatedAt`、`categoryIds`
- `skus`: `productId`、`skuId`
- `categories`: `status + sort`
- `addresses`: `userId + isDefault`、`userId + updatedAt`
- `orders`: `userId + createdAt`、`userId + status + createdAt`、`status + expiresAt`、`orderNo`、`requestKey + userId`
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
- 订单：`pending_payment`, `paid`, `shipped`, `received`, `completed`, `cancelled`
- 售后/审核：`pending_review`, `approved`, `rejected`, `refunding`, `refunded`
- 支付：`unpaid`；支付字段保留但首阶段不生成支付参数

## 安全边界

- 所有用户写操作只使用服务端从 CloudBase 请求上下文解析的 UID；`userId`、金额、库存、订单状态和管理员角色不信任客户端。
- `scope: 'admin'` 的请求必须同时通过 CloudBase UID 身份校验、`adminMembers` 存在性、启用状态和角色 scope 校验；`scope` 只负责路由，不能替代权限校验。
- 服务端 SDK 具备管理员数据库权限，因此数据库客户端规则仍应配置为最小权限：客户端不直接写商品、库存、订单状态、管理员、设置或评论审核字段。
- `user.me` / `user.update` 只返回当前请求身份所需的临时资料，头像固定为 `/assets/user-avatar.jpg`，忽略客户端传入的头像；不建立或更新用户档案；订单仍保留履约所需的 `userId` 和收货地址快照。
- `fileId` 必须是应用约定的 CloudBase 存储路径；生产环境应在云存储规则或后台函数中继续限制前缀、文件类型和大小。
- 函数没有硬编码环境 ID、账号、SecretId、SecretKey、密码或支付密钥。

## 本地检查

本地可以运行 `npm run test:cloud`，它测试编译后的云函数契约、校验和入口静态约定。真实数据库事务、身份上下文、索引、云存储临时 URL 和 CloudBase CLI 部署必须在目标环境中验证。
