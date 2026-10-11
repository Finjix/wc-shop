# v261011 后台免登录变更

## 实现

- 移除后台登录页、AuthProvider、持久会话、退出按钮、管理员类型和 CloudBase Web SDK 依赖。
- 后台所有读写改为 HTTP POST，`credentials: omit`，不携带账号、会话或身份请求头。旧 `#/login` 路径进入概览。
- 移除云函数管理员成员、角色、scope 权限校验和 `auth.me` / `admin.me`；业务集合注册表不再包含管理员集合。本地数据库启动时移除旧管理员集合，本地登录接口返回 404。
- HTTP 网关入口只接受后台请求；小程序继续通过 SDK 调用，用户身份、归属、业务参数和事务校验保留。
- 图片先登记 24 小时上传租约，再通过单文件上传元数据直传云存储。失败和取消仍执行引用检查清理，概览访问触发持久队列重试。
- 数据库与云存储客户端规则继续限制直接访问，公开管理操作由云函数完成。

## 验证

已通过 `npm run check`、`test:cloud`、`test:admin-public`、`test:commerce-http`、`test:admin-upload`、`test:admin-draft-images`、`test:admin-confirm`、`test:temp-file-urls`、`test:cloud-dependencies` 和 `git diff --check`。

Edge 扩展实际访问隔离本地后台：直接进入概览，分类改名保存后刷新仍存在，取消删除后分类保留，旧登录地址进入概览。验收数据与线上业务数据分离。

## 构建及上线操作

已重新构建 `dist/v261011/wc-shop-function.zip` 和 `wc-shop-admin-static.zip`。SHA256 及接口地址记录在本地 `dist/v261011/release-manifest.json`。

目标接口：`https://cloud1-d9geoogopf6e487d7-1483934229.ap-shanghai.app.tcloudbase.com/admin-api`。

上线需要新增 `/admin-api` 路由关联 `wc-shop-function`，关闭该路由身份认证，部署两个新包，并关闭后台使用的用户名密码登录方式。任何可访问此接口的人都能够执行后台读写操作，包括订单、评价、售后和设置。

旧管理员集合只有一条文档，已按 Edge 控制台可见字段备份至本地 `dist/v261011/no-login-evidence/adminMembers-backup.json`。永久删除目标为 `adminMembers` 集合及其中 `_id: 2097718395383214081` 的文档。小程序登录方式保留。

CloudBase 认证用户 `administrator` 是平台内置超级管理员（同一 UID），控制台的删除与冻结按钮均禁用；应用不再依赖该账户。此平台账户的物理删除无法通过当前控制台完成。

当前上线状态：代码、测试和构建已完成，生产访问扩大与永久删除操作等待用户在执行时确认。
