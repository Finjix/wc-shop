# CloudBase 真实数据迁移

当前项目已经把小程序数据访问统一到 `shop` 云函数，并新增了独立的 `admin/` React/Vite 管理后台。首阶段不导入原有演示数据，也不生成支付结果；订单创建后保持 `pending_payment`，库存扣减和取消回滚由服务端处理。

## 本地配置

1. 在微信开发者工具的云开发环境中启用身份认证、文档数据库和云存储。
2. 将真实环境 ID 填入 `config/runtime.js` 的 `cloudEnvId`，或通过开发者工具当前云环境提供默认环境。后台使用 `admin/.env.local`：

   ```text
   VITE_CLOUDBASE_ENV_ID=你的真实环境ID
   ```

开发者工具默认启用历史 mock 数据，开关位于 `config/runtime.js`：

```js
useMock: true  // 使用 model/ 下的本地演示数据
useMock: false // 调用 CloudBase 云函数
```

切换后重新编译小程序即可；切换为 `false` 前请先完成 CloudBase 环境和云函数部署。

3. 创建集合：`categories`、`products`、`skus`、`users`、`addresses`、`carts`、`orders`、`comments`、`afterSales`、`homeContents`、`settings`、`adminMembers`。
4. 在 `adminMembers` 中写入首个管理员文档，`_id` 或 `uid` 使用 CloudBase 登录用户 UID，设置 `roles: ["superadmin"]`、`status: "active"`、`enabled: true`。
5. 数据库客户端规则只允许用户读取自己的用户、地址、购物车、订单、评论和售后数据；商品读取可按业务开放，商品/库存/订单状态/审核字段由云函数写入。

## 部署

仓库根目录的 `cloudbaserc.json` 已配置 `cloudfunctions/` 为函数根目录。部署前在终端设置仓库外环境变量 `CLOUDBASE_ENV_ID`，然后部署 `shop` 和 `admin` 两个云函数。部署后在开发者工具重新编译小程序，在后台执行 `npm install`、配置 `admin/.env.local` 并运行 `npm run dev` 或 `npm run build`。

## 已接入的真实 action

- 商品、分类、SKU、首页内容：`products.*`、`categories.*`、`skus.*`、`home.*`
- 用户、地址、购物车：`user.*`、`addresses.*`、`cart.*`
- 订单、评论、售后：`orders.*`、`comments.*`、`afterSales.*`
- 管理后台：商品/分类/SKU/库存、首页内容、订单、用户、评论、售后、设置和存储临时 URL

真实支付、退款渠道回调和第三方物流回调仍需在腾讯云控制台完成资质与密钥配置后再接入；前端不会伪造支付成功。
