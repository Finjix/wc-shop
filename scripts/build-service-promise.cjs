const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('../cloudfunctions/node_modules/sharp');

// Compose at 3x for legible lettering, then export the requested 16-pixel strip.
const WIDTH = 375;
const HEIGHT = 16;
const SCALE = 3;
const FPS = 14;
const FRAMES = 168;
const root = path.resolve(__dirname, '..');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const gifsicle = process.env.GIFSICLE || 'gifsicle';
const phrases = ['极速发货', '品质保证', '售后无忧'];
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
}
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-shop-promise-'));
  try {
    const text = await Promise.all(phrases.map(phrase => sharp(Buffer.from(
      `<svg width="150" height="48" xmlns="http://www.w3.org/2000/svg"><text x="0" y="35" fill="#695941" font-family="Microsoft YaHei" font-size="33" font-weight="bold">${phrase}</text></svg>`
    )).png().toBuffer()));
    const sprite = await sharp(path.join(root, 'design/home-promos/sweet-potato.png'))
      .trim().resize(36, 36, { fit: 'contain', background: '#00000000' }).ensureAlpha().raw().toBuffer();
    const steps = [];
    for (let step = 0; step < 14; step++) {
      const phase = step / 14 * Math.PI * 2;
      const pixels = Buffer.alloc(sprite.length);
      // Alternate the two feet while the hands remain against the letters ahead.
      for (let y = 0; y < 36; y++) for (let x = 0; x < 36; x++) {
        const foot = Math.max(0, (y - 26) / 9);
        const shift = Math.round(Math.sin(phase) * 3 * foot * (x < 18 ? 1 : -1));
        const sourceX = x - shift;
        if (sourceX >= 0 && sourceX < 36) sprite.copy(pixels, (y * 36 + x) * 4, (y * 36 + sourceX) * 4, (y * 36 + sourceX) * 4 + 4);
      }
      steps.push(await sharp(pixels, { raw: { width: 36, height: 36, channels: 4 } }).png().toBuffer());
    }
    for (let frame = 0; frame < FRAMES; frame++) {
      const layers = [];
      for (let group = 0; group < 3; group++) {
        const position = (group * 125 - frame / FRAMES * WIDTH + WIDTH) % WIDTH;
        // Two full copies let characters and lettering cross the edge without popping.
        for (const offset of [-WIDTH, 0, WIDTH]) {
          const x = Math.round((position + offset) * SCALE) + WIDTH * SCALE;
          layers.push({ input: text[group], left: x, top: 0 });
          for (let potato = 0; potato < 3; potato++) {
            const step = (frame + potato * 4 + group * 3) % 14;
            const bob = Math.round(Math.sin(step / 14 * Math.PI * 2) * 1.2);
            layers.push({ input: steps[step], left: x + 132 + potato * 33, top: 7 + bob });
          }
        }
      }
      await sharp({ create: { width: WIDTH * SCALE * 3, height: HEIGHT * SCALE, channels: 4, background: '#FCF8EE' } })
        .composite(layers).png().toFile(path.join(temporary, `wide-${String(frame).padStart(3, '0')}.png`));
    }
    const raw = path.join(temporary, 'raw.gif');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1',
      '-framerate', String(FPS), '-i', path.join(temporary, 'wide-%03d.png'),
      '-filter_complex', `crop=${WIDTH * SCALE}:${HEIGHT * SCALE}:${WIDTH * SCALE}:0,scale=${WIDTH}:${HEIGHT}:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:reserve_transparent=0[p];[b][p]paletteuse=dither=none`,
      '-frames:v', String(FRAMES), '-loop', '0', '-final_delay', '7', raw]);
    const compressed = path.join(temporary, 'compressed.gif');
    run(gifsicle, ['--colors', '128', '--lossy=20', '-O3', '-Okeep-empty', raw, '-o', compressed]);
    const destination = path.join(root, 'miniprogram/assets/home/service-promise.gif');
    fs.copyFileSync(compressed, destination);
    console.log(`${destination}: ${fs.statSync(destination).size} bytes; ${WIDTH}x${HEIGHT}, 14 fps, 128 colors, 12-second infinite loop`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
