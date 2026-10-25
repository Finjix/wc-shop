const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('../cloudfunctions/node_modules/sharp');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'miniprogram/assets/home');
const names = ['invite-cashback', 'customer-gift'];
const columns = 7, rows = 5;

async function build() {
  let timing;
  for (const name of names) {
    const input = path.join(root, 'design/home-promos/animations', `${name}.gif`);
    const metadata = await sharp(input, { animated: true }).metadata();
    if (metadata.pages !== columns * rows || metadata.width !== 256 || metadata.pageHeight !== 256) {
      throw new Error(`${name}: unexpected source animation dimensions/frames`);
    }
    if (timing && JSON.stringify(timing) !== JSON.stringify(metadata.delay)) throw new Error('Promo timings differ');
    timing = metadata.delay;
    const output = path.join(assets, `${name}-frames-v261025.webp`);
    const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', input, '-vf', `tile=${columns}x${rows}`, '-frames:v', '1',
      '-c:v', 'libwebp', '-lossless', '0', '-quality', '100', output], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status) throw result.error || new Error(result.stderr);
    console.log(`${name}: ${fs.statSync(output).size} bytes, ${columns * 256}x${rows * 256}`);
  }
  const duration = timing.reduce((sum, delay) => sum + delay, 0);
  let elapsed = 0;
  const frames = timing.map((delay, index) => {
    const rule = `  ${Number((elapsed / duration * 100).toFixed(6))}% { transform: translate3d(${Number((-(index % columns) / columns * 100).toFixed(6))}%, ${Number((-Math.floor(index / columns) / rows * 100).toFixed(6))}%, 0); }`;
    elapsed += delay;
    return rule;
  });
  fs.writeFileSync(path.join(root, 'miniprogram/assets/components/static-image/promo-frames.wxss'),
    `/* Generated from the original GIF frame delays. No JS timer or network request. */\n` +
    `.promo-frame-sheet { position: absolute; left: 0; top: 0; display: block; width: ${columns * 100}%; height: ${rows * 100}%; max-width: none; animation: promo-frames ${duration}ms steps(1, end) infinite; }\n` +
    `@keyframes promo-frames {\n${frames.join('\n')}\n  100% { transform: translate3d(0, 0, 0); }\n}\n`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
