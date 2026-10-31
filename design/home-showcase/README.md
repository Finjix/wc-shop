# 首页标题图标

原画使用内置 imagegen 工具生成，透明 PNG。当前仅取各原画的第一张图，导出为单张静态 PNG；爱心、星星和花字均由小程序 WXSS 驱动动画。下列提示词保留原画生成记录。

- `heart-sheet.png`：蜜桃粉爱心，奶油白边、笑脸、腮红和小手。心跳缩放，5/6 帧眨眼，两颗小爱心浮起。
- `star-sheet.png`：明黄五星，雾蓝闪光、笑脸、腮红和小手。左右摇摆，5/6 帧眨眼，蓝黄闪光交替。

生成提示词（各原画一次独立调用）：

## Heart

Create a production cartoon mascot sprite sheet for a WeChat mini-program boutique gift/shoe shop. Transparent background. A cute chubby peach-pink heart character with creamy ivory edge, soft peach shading, tiny chocolate dot eyes with friendly eyelids, a small smile, rosy cheeks, two tiny short mitten arms. Clean polished kawaii sticker illustration, no text, no watermark, no ground shadow. Exactly 4 columns and 3 rows of equal square cells, total 12 cells, each with the SAME centered heart at the SAME size and matching pose, generous transparent margin. Across cells left to right top to bottom, animate a smooth heart beat expansion and contraction, eyes gently blink in frames 5 and 6, two tiny pink floating hearts slowly rise and fade around the head. All art including particles contained in each cell, no borders or gridlines. This will be sliced into 12 animation frames and reduced to 64 by 64 pixels, so keep simple thick silhouettes, clear facial expressions and NO very fine details. Square overall sheet, 1024x1024 if possible. Each cell subject occupies 75 percent of its width and height. Palette peach pink #F29DAA, cream #FFF3DA, rose #D86D87, warm brown #764252.

## Star

Create a transparent-background cartoon sprite sheet for a WeChat boutique gift shop section icon. Exactly 4 columns and 3 rows of equal square cells, total 12 cells on a 1024x1024 square sheet, NO gridlines. The same cute chubby five-point golden-yellow star character in every cell, pale butter yellow face, golden rounded edge, two tiny navy dot eyes, small smile, pink cheeks, tiny short arms. Polished kawaii sticker illustration with soft simple shading, mist-blue accent sparkles around the star. SAME size and SAME centered placement in every cell with generous transparent margins; each subject occupies 70 percent of its cell. Twelve successive frames left to right top to bottom describe one seamless loop: gentle alternating left-right wobble, eye blink in frames 5 and 6, 2 or 3 blue and yellow sparkles around the character twinkling. No letters, no words, no numbers, no border, no watermark, no ground shadow, no background. Simple thick silhouette and large facial features that remain legible at 64x64 px. Palette #FFD66D #E8AC40 #FFF4BF #89AFC9 #425B76, clearly differentiated from a peach-pink heart mascot.

## 当前实现

以上原画仅保留为历史设计参考，不参与小程序打包。首页爱心、星星现在由 `miniprogram/components/section-symbol/` 使用原生 view 和 WXSS 绘制；图片导出脚本及对应 PNG 已移除。
