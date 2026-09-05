# wc-shop CloudBase functions

这是小程序商城的真实后端契约。现在由一个 TypeScript 云函数 `wc-shop-function` 承载两类接口：`shop` 面向已登录用户，`admin` 面向 `adminMembers` 白名单中的运营人员。请求通过顶层 `scope` 字段分流，入口源码为 `cloudfunctions/wc-shop-function/index.ts`，部署时使用编译后的 `index.js`。

## 部署前置条件

1. 在 CloudBase 环境中启用微信/小程序身份认证、文档数据库和云存储。
2. 在仓库外设置当前环境变量 `CLOUDBASE_ENV_ID`，它只用于解析 `cloudbaserc.json`，不要把实际环境 ID 写入仓库。
3. 在数据库中创建首个 `adminMembers` 文档，推荐把文档 `_id` 设为 CloudBase 用户 UID，并设置 `status: "active"`、`roles: ["superadmin"]`。函数不会创建或绕过管理员。
4. 使用 CloudBase CLI 在仓库根目录部署；配置已打开云端安装依赖，运行环境为 Node.js 20.19。先运行 `npm run package:deploy` 完成编译，再使用 `tcb fn deploy wc-shop-function`，实际环境 ID 由 CLI/环境变量提供。

## 控制台 ZIP 部署

控制台上传 ZIP 时，平台要求压缩包根目录直接存在 `index.js`。运行仓库根目录的 `npm run package:deploy`，两个包会重新构建到 `dist/0830a/`：

- `dist/0830a/wc-shop-function.zip`：函数 Handler 填 `index.main`
- `dist/0830a/wc-shop-admin-static.zip`：静态托管包，根目录直接包含 `index.html`

不要把 `cloudfunctions/wc-shop-function` 文件夹直接压成 ZIP 后上传；控制台包必须使用脚本生成的 ZIP，使根目录直接包含 `index.js`。

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
- `storage.tempUrls`

`scope: 'admin'`：

- `auth.me`
- `categories.*`、`products.*`、`skus.*`（list/get/create/update/delete；delete 为下架）
- `inventory.adjust`
- `home.list/get/upsert`
- `orders.list/get/updateStatus/ship/cancel`
- `users.list/get/update`
- `comments.list/get/updateStatus/delete`
- `afterSales.list/get/updateStatus`
- `settings.list/get/upsert`
- `storage.tempUrls`

商品图片、评论图片和后台图片字段保存 CloudBase `fileId` 或经过 CloudBase SDK 生成的临时 URL。函数只负责解析临时 URL；实际文件上传应由已认证的小程序/Web SDK 直接上传到云存储，不能把 Secret 放进前端。

## 订单和库存边界

- 金额单位统一为整数“分”，订单服务端重新读取 SKU 价格，绝不信任客户端传来的金额或商品快照。
- `orders.create` 只接受 `{ skuId, quantity }`，校验 SKU `status === "active"`、关联商品 `status === "active"` 和库存后才创建订单。
- 创建订单使用文档数据库事务；事务内只通过已解析的 SKU 文档 `_id` 重新读取和更新库存，不使用事务不支持的 `where` 查询，库存不足或写冲突会回滚整个订单。
- 订单保存 `productSnapshot`、`skuSnapshot`、`addressSnapshot`；首阶段状态固定为 `pending_payment`，`payment` 固定为 `null`，不返回模拟支付结果。
- `requestKey`/`idempotencyKey` 是创建订单的必填字段；同一用户和 key 使用不同参数会返回 `IDEMPOTENCY_CONFLICT`。
- 待支付订单记录 30 分钟 `expiresAt`，用户再次访问订单或创建订单时会清理已过期订单并恢复库存；生产环境仍建议配置定时触发器兜底。
- 取消仅允许待支付订单，并在同一事务中恢复库存及回退预占销量；发货和收货只能按状态机改变状态，支付、退款和物流第三方回调暂未实现。

## 集合结构与建议索引

核心集合：`categories`、`products`、`skus`、`users`、`addresses`、`carts`、`orders`、`comments`、`afterSales`、`homeContents`、`searchHistories`、`settings`、`adminMembers`。

建议在 CloudBase 数据库中建立以下索引（均为非唯一，除非控制台明确支持并确认现有数据无重复）：

- `products`: `status + sort`、`status + updatedAt`、`categoryIds`
- `skus`: `productId + status`、`skuId`
- `categories`: `status + sort`
- `addresses`: `userId + isDefault`、`userId + updatedAt`
- `orders`: `userId + createdAt`、`userId + status + createdAt`、`orderNo`、`requestKey + userId`
- `comments`: `productId + status + createdAt`、`orderId + userId`
- `afterSales`: `userId + createdAt`、`orderId + createdAt`、`status + updatedAt`
- `homeContents`: `status + slot + sort`
- `searchHistories`: `userId + updatedAt`、`userId + keyword`
- `adminMembers`: `uid`、`status`

主要字段：

- `products`: `title`, `primaryImage`, `images`, `categoryIds`, `status`, `sort`, `minSalePrice`, `maxSalePrice`
- `skus`: `productId`, `skuId`, `specInfo`, `salePrice`, `status`, `stockQuantity`, `soldQuantity`
- `users/addresses/carts`: 均带 `userId`；购物车文档 `_id` 推荐直接使用 UID
- `orders`: `userId`, `status`, `paymentStatus`, `items`, `addressSnapshot`, `subtotal`, `shippingFee`, `totalAmount`, `requestHash`
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
- `fileId` 必须是应用约定的 CloudBase 存储路径；生产环境应在云存储规则或后台函数中继续限制前缀、文件类型和大小。
- 函数没有硬编码环境 ID、账号、SecretId、SecretKey、密码或支付密钥。

## 本地检查

不安装云端 SDK 也可以运行 `node cloudfunctions/tests/run.js`，它只测试纯契约、校验和入口静态约定。真实数据库事务、身份上下文、索引、云存储临时 URL 和 CloudBase CLI 部署必须在目标环境中验证。
