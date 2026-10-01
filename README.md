# wc-shop

微信小程序商城 + 本地开发服务（开发默认）/ CloudBase 云函数（线上） + React/TypeScript 运营后台。

## 目录

- `pages/`、`services/`、`components/`：TypeScript 小程序页面、组件和业务适配层。
- `cloudfunctions/`：`wc-shop-function` 统一 CloudBase 云函数，按 `shop` / `admin` scope 分流。
- `admin/`：React + TypeScript + Vite 静态管理后台；商品页管理商品上下架、规格、价格及 SKU 图片，独立 SKU 页管理库存，不单独上下架 SKU；另有分类、订单、评论、售后和首页内容。
- `docs/cloudbase-migration.md`：环境、数据库、权限和部署清单。

## 本地检查

```powershell
npm install
npm --prefix admin install
npm run typecheck
npm run typecheck:cloud
npm run test:cloud
npm run test:checkout
npm run test:loading
npm run test:cloud-dependencies
npm run build:admin
```

## 本地联调

小程序本地调试和管理后台可以共用一个本地开发服务。先在终端启动本地数据服务：

```powershell
npm run dev:local-backend
```

再开另一个终端启动 React 管理后台：

```powershell
npm --prefix admin run dev -- --host 127.0.0.1 --port 5173
```

当前 `config/runtime.ts` 的 `useLocalBackend` 为 `false`，小程序默认连接真实 CloudBase 服务端。本地调试时可临时改为 `true` 并启动本地服务；管理后台可通过 `admin/.env.local` 中的 `VITE_LOCAL_API_URL` 使用本地服务。本地后台默认管理员账号为 `admin`，密码为 `admin`，仅用于本地调试。发布小程序前确保 `useLocalBackend` 为 `false`；部署打包脚本会禁用管理后台的本地接口地址。

本地数据库和上传图片保存在用户目录的 `.wc-shop/runtime/<项目路径标识>/` 下，分别为 `.local-backend.json` 和 `.local-files/`。运行时写入项目目录会触发微信开发者工具自动热重载，导致加购、删除等操作后重新回到首页，因此默认将数据放在项目目录外。首次启动会复制项目里的 `.local-data/`、`.local-files/` 和旧目录中的数据，保留原文件且不覆盖已迁移的数据。可通过 `LOCAL_BACKEND_DATA_DIR` 指定运行时数据目录，请选择项目目录外的位置。

## 部署包

```powershell
npm run package:deploy
```

输出目录为 `dist/<version>/`：

- `wc-shop-function.zip`：CloudBase 云函数包，Handler 为 `index.main`。
- `wc-shop-admin-static.zip`：静态托管网站包，压缩包根目录直接包含 `index.html`。

## 当前支付边界

本地开发模式和 CloudBase 模式共用订单业务逻辑：开发时由本地服务处理，线上由真实云函数处理。下单创建 `pending_payment` 订单，服务端事务负责价格重算、库存预占、幂等和过期回滚；首阶段不伪造微信支付成功，也不接入商户支付、退款或第三方物流回调。

## 环境配置

当前目标 CloudBase 环境为 `cloud1-d9geoogopf6e487d7`；如切换环境，只需在部署前更新 `config/runtime.ts` 和管理后台的 `admin/.env.local`：

```text
VITE_CLOUDBASE_ENV_ID=你的真实环境ID
```
