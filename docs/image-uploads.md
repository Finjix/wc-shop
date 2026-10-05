# 图片选择与上传

后台和小程序只接受静态 JPG/JPEG、PNG 原图，选择时单张限制为 10MB。已有 WebP 图片仍可正常展示，WebP 也是处理后的上传格式。

选图后在前端编码成有损 WebP：后台和售后质量为 100，评价质量为 50，透明通道质量为 100。短边超过 1080px 时等比缩至 1080px，小图不放大。质量 100 不代表无损。

后台商品详情图最多 3 张，小程序售后最多 3 张，评价最多 4 张；商品和售后服务端同步校验 3 张上限。图片处理期间禁止再次选图及提交。点击提交才上传处理后的文件，然后保存文件 ID；上传输出不设置 MB 上限。

小程序编码器放在 `packages/form-ui/image-processor/`，通过异步组件共享给评价、售后页面，未放入主包。WASM 在 `project.config.json` 中明确包含，避免未使用文件过滤将其移除。升级编码器后，在安装后台依赖的情况下执行 `npm run build:image-codec`，生成适配 WXWebAssembly 的胶水代码及编码器文件。

验证：`npm run test:user-images`、`npm run test:admin-upload`、`npm run test:subpackage-dependencies`、`npm run test:cloud`、`npm run check`。前者运行实际 WASM 编码，并模拟微信 Canvas/文件接口及页面回调；真机的 Canvas 解码、WASM 装载和选图交互仍需单独验证。
