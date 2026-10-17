# wc-shop

微信小程序商城 + 本地开发服务（开发默认）/ CloudBase 云函数（线上） + React/TypeScript 运营后台。

## 目录

- `pages/`：四个 tabBar 页面入口；启动、加载重试和必要共享代码留在主包。
- `packages/frontend/`：实际页面、交互、组件、样式和图片；内部保留用户、商品、订单目录。
- `packages/api/`：客户端 API、数据适配、缓存、本地地址簿和结算临时状态。
- `packages/plugins/`：按需加载的图片处理组件及 WebP WASM 编码器。
- `cloudfunctions/`：`wc-shop-function` 统一 CloudBase 云函数，按 `shop` / `admin` scope 分流。
- `admin/`：React + TypeScript + Vite 静态管理后台；商品页管理商品上下架、规格、价格及 SKU 图片，独立 SKU 页管理库存，不单独上下架 SKU；另有分类、订单、评论、售后和首页内容。
- `docs/cloudbase-migration.md`：环境、数据库、权限和部署清单。

## 本地检查

小程序只声明 `frontend`、`api`、`plugins` 三个普通分包，加上主包共四包。
四个 tabBar 页面保留主包入口，界面通过异步组件加载；主包只保留 tabBar 需要的 TDesign 依赖。
前端通过缓存 Promise 的 `require.async` 加载客户端服务，失败后可重试；图片处理组件只在评价、售后等相关功能中使用。
`api` 是客户端服务分包，订单、库存和权限等真正的后端逻辑仍在独立部署的 `cloudfunctions/` 中。
首次准备项目或更新 TDesign 后，先在微信开发者工具执行「工具 → 构建 npm」，再执行
`npm run build:subpackage-ui`。该命令从 npm 构建产物生成前端包所需的 TDesign 组件，以及主包 `main-ui/` 中 tabBar 图标的依赖闭包；生成目录不入库。
原 `miniprogram_npm/` 仅作为生成源，不进入小程序代码包。
更新 WebP 编码器时另执行 `npm run build:image-codec`。
四个 tabBar 路径保持不变；其他页面路径统一为 `/packages/frontend/pages/...`，不兼容旧分享、收藏路径。
本地地址存储键和云函数请求协议保持不变，无需迁移数据。

```powershell
npm install
npm --prefix admin install
npm run typecheck
npm run test:subpackage-dependencies
npm run test:package-loading
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

当前 `config/runtime.ts` 的 `useLocalBackend` 为 `false`，小程序连接线上 CloudBase。本地联调时可暂时改为 `true` 并启动 `npm run dev:local-backend`；管理后台可通过 `VITE_LOCAL_API_URL=http://127.0.0.1:8787` 使用同一服务。后台通过公开 HTTP 接口免登录访问；生产接口在 `VITE_ADMIN_API_URL` 中配置，不再使用 CloudBase Web SDK 或账号会话。发布小程序前确保 `useLocalBackend` 为 `false`；部署打包脚本会禁用管理后台的本地接口地址。

本地数据库和上传图片保存在用户目录的 `.wc-shop/runtime/<项目路径标识>/` 下，分别为 `.local-backend.json` 和 `.local-files/`。运行时写入项目目录会触发微信开发者工具自动热重载，导致加购、删除等操作后重新回到首页，因此默认将数据放在项目目录外。首次启动会复制项目里的 `.local-data/`、`.local-files/` 和旧目录中的数据，保留原文件且不覆盖已迁移的数据。可通过 `LOCAL_BACKEND_DATA_DIR` 指定运行时数据目录，请选择项目目录外的位置。

## 部署包

```powershell
npm run package:deploy
```

输出目录为 `dist/<version>/`：

- `wc-shop-function.zip`：CloudBase 云函数包，Handler 为 `index.main`。
- `wc-shop-admin-static.zip`：静态托管网站包，压缩包根目录直接包含 `index.html`。

## 当前支付边界

本地开发模式和 CloudBase 模式共用订单业务逻辑。v261005 新订单由服务端事务完成模拟支付，进入待发货；支付及退款记录明确标记为模拟，不调用微信商户支付或资金退款。服务端负责价格重算、库存扣减、幂等及退款库存联动。历史待支付订单保持原样，不自动迁移、删除或回滚库存。

运行 `npm run test:commerce-http` 可用临时隔离数据验证支付、退款、发货、收货、评价与退货库存联动，测试结束后清理临时数据，不访问线上订单。

购物车多商品结算按商品项（SKU）拆成独立订单，同一 SKU 的数量仍在一单内；整批订单、库存扣减和购物车清理在一个事务中提交，同一请求重试返回原来的全部订单。结果页展示本次订单数和合计金额，每单独立收货、评价和售后；历史合并订单保持原样。

后台订单按“同一用户 + 收货人 + 电话 + 省市区及详细地址”的下单快照归组，先归组再分页。可勾选同组待发货订单（单批不设业务数量上限），录入一个物流单号合并发货；服务端事务再次校验地址、状态及售后，任一订单不符合条件则整批不发货。售后中的订单不可选，已退款数量不会发出，地址不完整的订单不合并。

后台手动记录物流单号，小程序展示手填物流信息，不生成第三方轨迹。商家同意退货退款前必须在后台配置退货地址；仅退款和退货退款均由后台审核。寄回后可在商家确认收货前修改退货物流单号。客服仍使用现有微信入口。

## 环境配置

当前目标 CloudBase 环境为 `cloud1-d9geoogopf6e487d7`；如切换环境，只需在部署前更新 `config/runtime.ts` 和管理后台的 `admin/.env.local`：

```text
VITE_CLOUDBASE_ENV_ID=你的真实环境ID
```
