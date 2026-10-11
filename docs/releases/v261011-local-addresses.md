# v261011 本地地址簿

## 行为

- 地址簿使用 `wx.getStorageSync` / `wx.setStorageSync`，键为 `wc-shop.addresses.v1`；新增、编辑、默认地址切换和删除均在设备本地执行。
- 写入串行化，保持唯一默认地址；本地存储失败时不会报告保存成功；损坏或未知版本的数据不会被静默覆盖；已删除地址不能被旧编辑页重新保存。
- 清理小程序存储会清空地址簿，换设备需要重新添加。旧云端地址不迁移到本地。
- 下单提交所选地址的规范化收货快照，云端只在订单内保存快照供履约，不创建或读取地址簿。订单重试哈希包含地址内容，防止本地地址修改后误复用旧订单。
- 删除云端地址 CRUD、集合注册和本地后端地址种子。历史订单快照保留。

## 验证

- `npm run test:local-addresses`：跨模块重启持久化、并发写入、默认切换、编辑字段转换、删除、存储失败恢复、批量清空和零云端请求通过。
- `npm run test:cloud`：旧地址接口拒绝、下单不访问 addresses 集合、快照字段白名单和地址变更重试冲突通过；既有回归通过。
- `npm run test:checkout`、`npm run test:commerce-http`、`npm run test:subpackage-dependencies`、`npm run check`、`git diff --check` 通过。
- 微信开发者工具模拟器：首次打开地址列表没有读取旧云端地址；新增“本地持久化验收”地址后重新编译，地址仍然保留；代码质量扫描未发现代码质量问题。

## 发布记录

- 环境：`cloud1-d9geoogopf6e487d7`。
- Edge 扩展上传 `dist/v261011/wc-shop-function.zip`；生产函数 `wc-shop-function` 正常，更新时间 `2026-10-12 00:13:24`。
- 云函数包 SHA256：`5A3F9B5DBC301DA19EB9932CFF5ACAC88ABEDC36B3C4A7AC4C6967484867094D`。
- 生产控制台运行只读测试 `{scope:"shop",action:"addresses.list",data:{}}`，返回 `INVALID_ARGUMENT` 且 `details.field=action`，验证旧地址接口已移除；函数请求 ID `b5a64e88-c590-11f1-9cbc-525400694506`。
- 微信开发者工具上传版本号 `261011`，界面确认“代码上传成功”，覆盖原体验版；未提交微信审核或发布正式版。
- 管理后台代码没有变化，静态包已重新构建，线上静态资源仍为 `index-DnHknGN0.js`。
- 旧 `addresses` 集合核对为 1 条文档。私有备份及截图位于被 Git 忽略的 `dist/v261011/local-address-evidence/`；不提交私人地址数据。
- 集合永久删除与模拟器测试地址清理待执行时确认，尚未执行；关机仅在所有清理和验证完成后执行。
