# WC Shop

微信商城小程序，配套 React 管理后台和 CloudBase 云函数。目前结算使用模拟支付，收货地址保存在客户端本地。

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
