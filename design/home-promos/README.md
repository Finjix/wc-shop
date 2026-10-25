# 首页固定活动图片

插画、背景和花字使用内置 imagegen 生成；原始提示词见 `prompts.json`。
左侧为低饱和淡黄色圆形背景、左边一摞及右边两枚金币、顶部厚圆花字“邀请返现”；右侧为
蜜桃奶油波浪背景、淡紫点缀礼盒和底部手写花字“加客服拿好礼”。两张成品均不透明。
左侧花字使用 `invite-glyphs.png` 四个独立字形，提示词见 `invite-glyphs-prompt.txt`；
四字在固定高度沿水平方向分开、短暂停留、再合拢，不上下移动或缩放。
左侧金色粒子闪烁漂浮，金币表面有星芒和扫光；右侧五角星向左下滑动，花字按
“加→客→服→拿→好→礼”顺序循环呼吸放大，蝴蝶结和带子单独轻摆。
所有可见文字直接包含在动画画面内，页面只提供图片和无障碍标签。

安装 FFmpeg 和 gifsicle 后运行 `node scripts/build-home-promos.cjs`。
也可通过 `FFMPEG`、`GIFSICLE` 指定工具路径；制作脚本使用云函数开发依赖中的 Sharp
裁剪透明花字留白、绘制粒子和在固定画布上生成动画图层，再由 FFmpeg 合成。
逐帧画布尺寸保持一致，避免动态缩放产生横线残影。
构建动画时，FFmpeg/gifsicle 只在系统临时目录使用 GIF 中间文件，完成后自动清除。
动画源以无损 WebP 保存在本目录的 `animations/*-source.webp`：256×256，35 帧，
帧间使用原来的 70/80 毫秒，2.5 秒循环；不进入小程序包。

运行 `npm run build:promo-frames` 将两张动画分别生成 7×5 JPG 图集和静态 JPG 首帧，
并生成组件使用的 CSS 时间轴。图集质量按原 GIF 的字节数自动选择，目标差异不超过 5%；
质量、原始体积和输出体积记录在 `animations/frame-manifest.json`。
小程序包只使用 JPG 图集，加载失败显示静态 JPG，不再包含 GIF 或旧 WebP 图集。
普通图片节点参与 CSS 离散帧动画，随页面一起滚动；不使用屏幕 Canvas。

本目录位于小程序根目录之外，不参与小程序上传。

邀请返现背景改色使用内置 imagegen，仅编辑 `invite-background.png`，以 `gift-background.png` 的柔和饱和度与明度为参考，最终使用低饱和淡柠檬黄。原花字、金币、粒子及动画时间轴通过生成脚本保持；本次背景编辑提示词见 `invite-background-prompt.txt`。
