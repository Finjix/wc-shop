# CloudBase 真实数据迁移

当前项目已经把小程序数据访问统一到 `shop` 云函数，并新增了独立的 `admin/` React/Vite 管理后台。首阶段不导入原有演示数据，也不生成支付结果；订单创建后保持 `pending_payment`，库存扣减和取消回滚由服务端处理。

## 本地配置

1. 在微信开发者工具的云开发环境中启用身份认证、文档数据库、云存储和静态网站托管。
2. 当前目标环境 ID 是 `cloud1-d9geoogopf6e487d7`，已填入 `config/runtime.ts` 的 `cloudEnvId`。后台使用 `admin/.env.local`：

   ```text
   VITE_CLOUDBASE_ENV_ID=你的真实环境ID
   ```

完成 CloudBase 环境和云函数部署后，重新编译小程序即可使用云端数据。

3. 创建集合：`categories`、`products`、`skus`、`users`、`addresses`、`carts`、`orders`、`comments`、`afterSales`、`homeContents`、`searchHistories`、`settings`、`adminMembers`，并按 `cloudfunctions/README.md` 创建索引。
4. 数据库客户端规则默认设为“仅管理员/云函数可读写”，用户数据也通过 `wc-shop-function` 以服务端 UID 隔离；不要把管理员角色或订单状态写权限暴露给小程序客户端。
5. 在 `adminMembers` 中写入首个管理员文档，`_id` 或 `uid` 使用 CloudBase 登录用户 UID，设置 `roles: ["superadmin"]`、`status: "active"`、`enabled: true`。账号创建和密码输入由管理员本人在控制台完成。

## 部署

仓库根目录的 `cloudbaserc.json` 已配置 `cloudfunctions/` 为函数根目录，当前只部署统一函数 `wc-shop-function`。部署前在终端设置仓库外环境变量 `CLOUDBASE_ENV_ID`（或配置 `admin/.env.local`），运行 `npm run package:deploy` 生成函数包和 React 静态包；随后在控制台分别部署云函数并上传 `wc-shop-admin-static.zip` 到静态托管。后台执行 `npm --prefix admin install`、配置 `admin/.env.local` 并运行 `npm --prefix admin run build`。

## 已接入的真实 action

- 商品、分类、SKU、首页内容：`products.*`、`categories.*`、`skus.*`、`home.*`
- 用户、地址、购物车：`user.*`、`addresses.*`、`cart.*`
- 订单、评论、售后：`orders.*`、`comments.*`、`afterSales.*`
- 管理后台：商品/分类/SKU/库存、首页内容、订单、用户、评论、售后、设置和存储临时 URL

真实支付、退款渠道回调和第三方物流回调仍需在腾讯云控制台完成资质与密钥配置后再接入；首阶段订单会真实写入 `pending_payment`，前端不会伪造支付成功。
