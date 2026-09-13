# CloudBase 控制台实施清单

本清单对应用户提供的 CloudBase 环境 `cloud1-d9geoogopf6e487d7`。截图只作为界面参考，登录状态和控制台结果仍必须以当前控制台为准。

## 1. 环境与认证

1. 打开云开发控制台并确认当前环境为 `cloud1-d9geoogopf6e487d7`。
2. `config/runtime.ts` 已使用该 `envId`；如需本地构建后台，再写入未入库的 `admin/.env.local`：

   ```text
   VITE_CLOUDBASE_ENV_ID=完整环境ID
   ```

3. 在身份认证中启用小程序身份认证，后台另启用“用户名密码”认证。
4. 创建后台管理员账号。密码、验证码和安全确认由账号持有人在控制台手动完成。

## 2. 文档数据库

创建以下空集合，不导入仓库 `data/` 中的历史演示数据：

```text
categories
products
skus
users
addresses
carts
orders
comments
afterSales
homeContents
searchHistories
settings
adminMembers
```

按下面的字段组合创建非唯一索引；空库阶段可以先创建集合，再在有数据后核对索引命中情况：

```text
products: status + sort, status + updatedAt, categoryIds
skus: productId + status, skuId
categories: status + sort
addresses: userId + isDefault, userId + updatedAt
orders: userId + createdAt, userId + status + createdAt, orderNo, requestKey + userId
comments: productId + status + createdAt, orderId + userId
afterSales: userId + createdAt, orderId + createdAt, status + updatedAt
homeContents: status + slot + sort
searchHistories: userId + updatedAt, userId + keyword
adminMembers: uid, status
```

### 首个管理员文档

登录后台管理员账号后，从认证信息读取 UID，在 `adminMembers` 建立一条文档：

```json
{
  "_id": "管理员 UID",
  "uid": "管理员 UID",
  "roles": ["superadmin"],
  "status": "active",
  "enabled": true
}
```

不要把密码写入数据库或仓库。云函数只接受当前 CloudBase 身份上下文，并再次校验该白名单文档。

## 3. 数据库权限

本项目不从小程序直接读写业务集合，所有业务请求均经过 `wc-shop-function`。因此数据库客户端规则采用最小权限：

- `products`、`categories`、`skus`、`homeContents`：读写由云函数完成。
- `users`、`addresses`、`carts`、`orders`、`comments`、`afterSales`、`searchHistories`：读写由云函数完成，并由云函数使用当前 UID 隔离。
- `settings`、`adminMembers`：只允许云函数/管理员服务端访问。

在控制台中选择“仅管理员可读写”或等价的拒绝客户端读写规则；不要用“所有用户可读写”。保存后用小程序和后台分别做一次真实读取验证。

## 4. 云存储

1. 启用云存储。
2. 小程序评论图片写入 `user/comments/`，售后凭证写入 `user/after-sales/`；后台商品图片写入 `admin/products/`。
3. 存储规则只允许已认证用户上传约定前缀，并限制图片类型和大小；读取使用临时 URL，不把 Secret 放到前端。
4. 上传后确认文档中保存的是 `cloud://` fileID，而不是只保存本机临时路径。

## 5. 云函数与静态托管

在仓库根目录执行：

```powershell
npm run test:cloud
npm run package:deploy
```

在控制台：

- 创建/更新云函数 `wc-shop-function`，运行时 Node.js 20.19，Handler `index.main`。
- 上传 `dist/<version>/wc-shop-function.zip`；压缩包根目录必须直接有 `index.js`。
- 启用静态网站托管，上传 `dist/<version>/wc-shop-admin-static.zip`；压缩包根目录必须直接有 `index.html`。

部署完成后，先打开后台验证登录和 `admin.me`，再在后台创建第一条分类、商品和 SKU，最后用小程序验证商品列表、购物车、结算和待支付订单。

## 6. 首阶段验收边界

验收要求是“真实数据链路”而不是“支付成功”：

- 空库时小程序列表为空，不注入演示商品。
- 结算会从数据库重新读取商品/SKU/库存和地址。
- 下单创建 `pending_payment`，服务端事务预占库存并支持幂等；不会返回模拟支付参数或支付成功文案。
- 取消待支付订单会回滚库存。
- 评论/售后图片先上传云存储，再把 fileID 写入文档。

商户支付、退款资金回调、第三方物流回调需要额外资质和密钥，未包含在首阶段部署中。
