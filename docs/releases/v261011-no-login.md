# v261011 后台免登录变更

## 实现

- 移除后台登录页、AuthProvider、持久会话、退出按钮、管理员类型和 CloudBase Web SDK 依赖。
- 后台所有读写改为 HTTP POST，`credentials: omit`，不携带账号、会话或身份请求头。旧 `#/login` 路径进入概览。
- 移除云函数管理员成员、角色、scope 权限校验和 `auth.me` / `admin.me`；业务集合注册表不再包含管理员集合。本地数据库启动时移除旧管理员集合，本地登录接口返回 404。
- HTTP 网关入口只接受后台请求；小程序继续通过 SDK 调用，用户身份、归属、业务参数和事务校验保留。
- 图片先登记 24 小时上传租约，再通过单文件上传元数据以原始 PUT 直传云存储。失败和取消仍执行引用检查清理，概览访问触发持久队列重试。
- 数据库与云存储客户端规则继续限制直接访问，公开管理操作由云函数完成。

## 验证

已通过 `npm run check`、`test:cloud`、`test:admin-public`、`test:commerce-http`、`test:admin-upload`、`test:admin-draft-images`、`test:admin-confirm`、`test:temp-file-urls`、`test:cloud-dependencies` 和 `git diff --check`。

Edge 扩展实际访问隔离本地后台：直接进入概览，分类改名保存后刷新仍存在，取消删除后分类保留，旧登录地址进入概览。验收数据与线上业务数据分离。

## 构建及上线操作

已重新构建 `dist/v261011/wc-shop-function.zip` 和 `wc-shop-admin-static.zip`。SHA256 及接口地址记录在本地 `dist/v261011/release-manifest.json`。

目标接口：`https://cloud1-d9geoogopf6e487d7-1483934229.ap-shanghai.app.tcloudbase.com/admin-api`。

已新增 `/admin-api` 路由关联 `wc-shop-function`，关闭该路由身份认证，部署两个新包，并关闭后台使用的用户名密码登录方式。任何可访问此接口的人都能够执行后台读写操作，包括订单、评价、售后和设置。

旧管理员集合只有一条文档，已按 Edge 控制台可见字段备份至本地 `dist/v261011/no-login-evidence/adminMembers-backup.json`。经用户执行时确认，已永久删除 `adminMembers` 集合及其中 `_id: 2097718395383214081` 的文档。小程序登录方式保留。

CloudBase 认证用户 `administrator` 是平台内置超级管理员（同一 UID），控制台的删除与冻结按钮均禁用；应用不再依赖该账户。此平台账户的物理删除无法通过当前控制台完成。

## 生产验收（2026-10-11，北京时间）

- 云函数 `wc-shop-function` 首次更新于 23:27:31，上传签名修复于 23:45:29 重新部署；`/admin-api` 路由创建于 23:28:34，身份认证关闭。
- 静态部署 `wc-shop-admin-022` 于 23:31:09 成功；上传签名修复后，`wc-shop-admin-023` 于 23:47:00 成功，最终入口资源为 `index-DnHknGN0.js`。
- Edge 扩展实际打开线上后台：概览、商品列表、商品编辑中的既有图片、售后列表和地址设置正常读取。旧 `#/login` 地址自动进入概览；未出现登录或退出控件。
- 线上新建商品草稿选择 2×2 PNG，实际图片处理和本地预览正常；取消后回到商品列表。网络观察确认该操作只加载图片处理 worker 和 blob 预览，没有上传请求或新建业务记录。
- 完整线上上传验收发现 POST 表单与当前 Node SDK 的 PUT 签名不匹配（COS 403 / `SignatureDoesNotMatch`），已按已安装 SDK 的实际上传实现改用原始 PUT 与签名请求头，并加入传输回归测试。
- 重新部署后，Edge 在生产页面实际上传两张 2×2 测试图片，PUT 均返回 200。随后服务器因商品名称超过 200 字拒绝 `products.save`，错误为 `INVALID_ARGUMENT`，未进入商品与 SKU 写入事务。生产搜索验收名称返回 0 个商品。
- 经用户执行时确认，取消上述失败草稿，真实 `storage.cleanup` 响应为删除 2 个、保留 0 个、待重试 0 个。文件为 `admin/products/b0005224-8ebb-430d-9e8b-3c6f3284b548.webp` 和 `admin/products/56009d00-1686-4972-af1f-f86ffcfc9ab1.webp`。请求结果记录在本地 `upload-acceptance.json`，没有遗留测试图片或测试业务记录。
- 用户名密码登录卡片已显示“未启用”，微信小程序登录保持启用；生产页面控制台未发现错误。

当前上线状态：免登录后台已经上线，旧管理员业务集合已清理，上传签名修复已经重新部署并通过真实上传与取消清理验收。初次免登录代码提交 `63c8c29` 已推送；后续修复与本记录随同提交。生产截图保存在本地 `dist/v261011/no-login-evidence/`。
