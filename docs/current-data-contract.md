# 当前数据契约与旧兼容清理

项目自有代码不迁移旧业务数据。更新部署前应清空旧测试数据或按当前结构重新录入；清理代码本身不删除已有数据库或文件。

## 当前契约

- 商品按文档 `_id` 查找，SKU 通过 `productId` 关联商品，分类使用 `categoryIds`。
- SKU 价格、库存分别使用 `salePrice`、`stockQuantity`；不读取 `priceInfo`、`stockInfo`、`stock` 等旧字段。
- 分页请求/响应使用 `page`、`pageSize`、`items`、`total`。小程序页面内部的 `pageNum`、`pageList` 等由展示适配器转换，不作为云端兼容接口。
- 首页只读取 `home.page-config` 的 `config` 及 `productsById`；不读取旧独立轮播、旧首页图片列表，也不改写历史默认文案。
- 新订单创建时初始化 `refundAmount`、`refundedQuantities`、`pendingRefundAmount`、`pendingRefundQuantities`、`afterSaleIds`。售后和发货直接使用这些字段，不再查询旧售后记录重建统计。
- 订单地址使用 `addressSnapshot`；小程序编辑器字段与云端地址字段之间仅保留当前单向转换。
- 退货地址只使用 `receiver`、`phone`、`detail`；不合并旧省市区，不读取旧字段名。
- 售后业务展示使用订单号；内部 `_id` 用于区分同一订单的多次申请。物流提交使用 `afterSaleId`、`trackingNo`、`logisticsCompanyName`，审核使用 `id`、`status`，确认退货使用 `afterSaleId`。
- 评价使用 `productId`、`content`、`rating`、`images` 及当前状态值，展示字段由小程序适配器生成。
- 本地后端只使用当前用户目录，不复制旧项目数据目录或旧运行目录。

## 已移除的兼容

旧商品别名查询、旧 SKU 商品关联查询、旧分类字段迁移、旧订单哈希 ID 重试解析、退款聚合重建、旧首页配置回退、旧价格/库存字段、嵌套业务响应拆包、旧状态别名字典、后台未使用的接口别名及旧本地数据目录迁移。

## 明确保留（不是旧业务兼容）

- 当前后台实际使用的 `admin.me`、`products.save`、`categories.save`、`homeContent.list/save`、`comments.moderate`、`afterSales.review`。
- 当前页面和组件模型的数字状态、`spuId`、`goodsList`、`rightsItem` 等展示字段；它们由明确的适配器生成，不参与旧文档别名查找。
- 当前支持的订单状态及退款状态机，不将展示层“已完成”误认为独立数据迁移。
- 权限、所有权、参数、金额、库存、并发、事务、幂等及重复退款/重复恢复库存保护。
- SDK 数据响应封装、本地服务/CloudBase 的运行差异和当前平台能力检查。
- 图片上传、格式处理、异步加载竞态、缓存、网络失败提示、引用检查、维护接口及共享文件删除保护。
- 第三方 npm/TDesign/WASM 代码和生成产物不修改。

## 检查范围

后台 `admin/src`、云端 `cloudfunctions/shared`、小程序 `services`/`pages`/`utils`/`components`/`config`、自有分包代码及本地后端脚本。测试中的旧数据样例保留用于验证“不再解析/迁移旧数据”或验证安全拒绝，不是生产兼容逻辑。
