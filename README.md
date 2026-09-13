# wc-shop

微信小程序商城 + CloudBase 真实数据服务 + React/TypeScript 运营后台。

## 目录

- `pages/`、`services/`、`components/`：TypeScript 小程序页面、组件和业务适配层。
- `cloudfunctions/`：`wc-shop-function` 统一 CloudBase 云函数，按 `shop` / `admin` scope 分流。
- `admin/`：React + TypeScript + Vite 静态管理后台，覆盖商品、分类、SKU/库存、订单、用户、评论、售后和首页内容。
- `docs/cloudbase-migration.md`：环境、数据库、权限和部署清单。

## 本地检查

```powershell
npm install
npm --prefix admin install
npm run typecheck
npm run typecheck:cloud
npm run test:cloud
npm run build:admin
```

## 部署包

```powershell
npm run package:deploy
```

输出目录为 `dist/<version>/`：

- `wc-shop-function.zip`：CloudBase 云函数包，Handler 为 `index.main`。
- `wc-shop-admin-static.zip`：静态托管网站包，压缩包根目录直接包含 `index.html`。

## 当前支付边界

小程序会调用真实云函数创建 `pending_payment` 订单，服务端事务负责价格重算、库存预占、幂等和过期回滚；首阶段不伪造微信支付成功，也不接入商户支付、退款或第三方物流回调。

## 环境配置

当前目标 CloudBase 环境为 `cloud1-d9geoogopf6e487d7`；如切换环境，只需在部署前更新 `config/runtime.ts` 和管理后台的 `admin/.env.local`：

```text
VITE_CLOUDBASE_ENV_ID=你的真实环境ID
```
