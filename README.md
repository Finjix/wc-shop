# WC Shop

微信商城小程序，配套 React 管理后台和 CloudBase 云函数。支持微信支付 APIv3 下单、查单、通知验签解密及退款；本地开发保留模拟支付。收货地址保存在客户端本地。真实支付上线前须完成下方配置与验收。

## 本地开发

安装依赖：

```sh
npm ci
npm --prefix admin ci
npm --prefix cloudfunctions ci
```

1. 在微信开发者工具中导入项目，执行「工具 → 构建 npm」，再运行 `npm run build:subpackage-ui`。
2. 将 `config/runtime.ts` 中的 `useLocalBackend` 设为 `true`。
3. 按 `admin/.env.example` 配置 `admin/.env.local`。
4. Windows 下运行 `start-local.cmd`，启动本地后端（8787）和管理后台（5173）。

也可分别启动：

```sh
npm run dev:local-backend
npm --prefix admin run dev -- --host 127.0.0.1 --port 5173
```

本地数据库、上传图片和缓存统一保存在项目同级的 `../.wc-shop-local/`，本机路径为 `D:\project\.wc-shop-local`。其中 `migrations/` 存放旧数据迁移备份，请勿随意删除。不要提交真实数据或密钥。

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `pages/`、`custom-tab-bar/` | 小程序主包入口和底部导航 |
| `packages/frontend/` | 商城页面、组件和样式 |
| `packages/api/` | 接口服务与共享状态 |
| `packages/plugins/` | 图片处理与 WebP 编解码 |
| `common/`、`config/` | 公共逻辑、类型声明和运行配置 |
| `admin/` | React 管理后台 |
| `cloudfunctions/` | 云函数业务和服务端测试 |
| `scripts/` | 启动、构建、部署和回归测试 |

全局主题位于 `app.wxss`。`main-ui/`、`packages/frontend/tdesign/` 为生成的 UI 文件，请通过构建脚本更新；主包、分包、后台和云函数保留独立构建边界。

## 检查与发布

```sh
npm run check                         # lint、类型检查、后台构建
npm run test:cloud                    # 服务端回归
npm run test:commerce-http            # 本地 HTTP 验收
npm run test:subpackage-dependencies  # 分包依赖检查
npm run test:package-loading          # 分包加载回归
```

其他测试见 `package.json` 的 `test:*`。

发布前将 `useLocalBackend` 改为 `false`，确认云环境和后台接口配置后执行 `npm run package:deploy`，部署包输出到 `dist/`。

## 微信支付配置与上线

当前代码默认关闭线上下单，不会因为缺少凭证而退回模拟支付。`scripts/local-backend.js` 和测试显式启用模拟支付；历史模拟订单仍只做模拟退款。

1. 在商户平台「账户中心 → API安全」准备 APIv3 密钥、商户 API 证书序列号、`apiclient_key.pem` 私钥、微信支付公钥及公钥 ID。已有业务在用的密钥不能随意重置。
2. 在 CloudBase 的 `wc-shop-function → 函数配置 → 编辑 → 环境变量` 中按 [cloudfunctions/.env.example](cloudfunctions/.env.example) 配置。PEM 可用完整文本或将换行写为字面 `\n`。后台无需访问口令，管理接口不进行登录鉴权；可访问接口的人能够修改商品、查看订单和审核真实退款。商户凭证仍只保存在云函数环境中，不放进 `VITE_*` 或客户端代码。
3. 当前已存在指向本函数的 HTTPS `/admin-api` 路由，模板使用此地址作为 `WECHAT_PAY_NOTIFY_URL`，无需另开公开路由。新代码根据 `Wechatpay-Signature` 请求头分流通知。平台必须向函数透传原始请求体及 `Wechatpay-*` 头；禁止代理层解析再序列化请求体。支付和退款通知共用此地址，仅通过 RSA 验签及 AES-GCM 解密的数据能改变账务状态。HTTP 管理请求使用 `scope: admin`，无需 Authorization 请求头。
4. 在文档型数据库中新建 `payments` 集合，设置为仅服务端可读写；确认 `orders`、`orderRequests`、`skus`、`afterSales` 等业务集合也禁止客户端直接写入。支付表保存支付单与多个业务订单的关联，金额为人民币分。
5. 函数执行超时调为 **60 秒**。创建每分钟执行的定时触发器，名称 `payment-reconcile`，检查实际投递事件包含 `Type: Timer`、`TriggerName: payment-reconcile`。定时任务查单、关闭已过期未付款交易、查询已批准退款并重试发货信息上报，不发起支付扣款。退款查询只有在验签通过且返回 `RESOURCE_NOT_EXISTS` 时，才使用原退款单号和原金额重新提交。各队列每批最多 10 条，游标和轮换优先级保存在 `settings` 的 `__payment_reconcile_*` 文档中，失败记录不会一直占住队首。还可通过后台 API `payments.reconcile` 手动补偿；此操作可能重试已批准的退款。`payments.checkConfiguration` 使用随机的不存在订单号进行只读验签检查，并检查物流公司查询权限，不创建支付或退款。
6. 部署云函数和配套管理后台；在所有凭证有效、通知地址可达后把 `WECHAT_PAY_MODE` 改为 `wechat`。不要仅替换前端或仅设置模式。后台网页及标准定时器触发时没有小程序云调用凭证，必须在服务端配置 `WECHAT_APP_SECRET`，通过 `stable_token` 获取并缓存 access_token，使用普通刷新（`force_refresh: false`），不使其他业务已有令牌失效。密钥和令牌均不返回前端或写入日志。`config.json` 同时声明发货和物流列表的云调用权限，供小程序调用路径使用。真实支付订单发货时选择快递公司，由云函数上报微信订单发货管理；同一次支付的不同子订单以拆分发货方式上报。失败保留支付单上的补偿标记，由定时器重试。上线前必须确认实际接口可调用、微信后台可看到发货信息。
7. 真机验收：真实支付前仅在 `payments` 保存内部结算草稿并预留库存，不写入 `orders`，也不移除购物车商品。取消或失败可在当前结算页重试；只有微信签名查单或验签解密的回调确认支付成功，才在同一事务中生成全部正式子订单并扣除对应购物车数量。超时草稿关单并只释放一次库存，不生成“已关闭”正式订单。历史已创建的待付款/已关闭订单保留并兼容旧流程。还需验证同一结算多个 SKU 只支付一次、重复通知只建单一次、审核退款仅在微信确认成功后更新金额与库存。由商户本人完成实际付款，退款先使用明确批准的测试订单验证。

公众平台「支付与交易 → 订单管理 → 订单信息录入」的商品订单详情 path 填写 `packages/frontend/pages/order/order-detail/index?orderNo=${商品订单号}`。当前平台提示必须先开发订单详情页并提交小程序审核，再配置 path。占位符保持原样，微信会替换成预下单的 `out_trade_no`。云函数通过 `payments` 记录核验当前用户并映射到结算的首个业务订单；其他人的支付单号不能访问。该页面和对应代码需要包含在已发布的小程序版本中，后台配置不能替代小程序版本发布。

2026-10-17 云端验证：环境已升级个人版，函数超时已调为 60 秒；凭证已配置且真实模式已启用；商户只读查单响应验签通过，服务端物流公司列表读取成功；新版管理后台已部署，口令校验已移除，匿名概览读取通过；`payments`、`orders`、`orderRequests`、`skus`、`afterSales` 为仅服务端访问；每分钟 `payment-reconcile` 触发器已保存，手动补偿调用通过；伪造支付通知返回 HTTP 400。凭证不包含在仓库或部署压缩包内。

仍需真机验收：真实付款和通知解密、退款到账、实际发货上报，以及定时器自动投递。当前商户只读验签成功不代表 APIv3 密钥已通过真实通知解密验证。实际付款由商户本人完成；退款需明确批准具体测试订单与金额。

官方参考：[小程序下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791856)、[支付通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791902)、[申请退款](https://pay.wechatpay.cn/doc/v3/merchant/4012791862)、[HTTP 访问云函数](https://docs.cloudbase.net/service/access-cloud-function)。

### v261017 支付专项审阅（2026-10-17）

范围：服务端定价与付款人身份、预下单与取消后重试、回调验签解密、合并支付与子订单退款、库存释放、微信发货同步、补偿任务和订单详情跳转。

本次修复：批量发货和批量修改物流的事务改为顺序读取；补齐未被微信受理的退款重试；补偿队列增加持久游标并轮换优先级；发货上报附带收货地址快照中的掩码电话，只保留最后四位。退款重试依据[微信支付退款最佳实践](https://pay.wechatpay.cn/doc/v3/merchant/4014959631)，查询失败或签名不通过时不重新提交。

本地通过：云函数回归、微信支付前端回归、结算回归、售后和确认收货回归，以及 lint、类型检查和后台构建。回归覆盖原退款单号/金额重试、重复退款通知只结算一次、失败队列不阻塞第 11 条支付单，以及多订单发货/物流修改的串行事务。

审阅保留的高风险项：管理接口按使用者要求取消了登录鉴权，匿名调用者能够审核真实退款。该设置没有在本次审阅中恢复；正式开放收款前建议恢复管理端鉴权。代码和自动测试通过不代表真实资金链路验收通过，仍需商户本人完成 0.01 元付款、真实回调解密、退款到账、实际发货上报与真机订单跳转验收。本次审阅新增的云函数修复需要部署后才生效；Git 提交、推送和小程序提审均不能替代云函数部署。
