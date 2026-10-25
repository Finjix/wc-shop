const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../cloudfunctions/node_modules/sharp');

const root = path.resolve(__dirname, '..');
async function main() {
  for (const [source, name, top, height] of [
    ['heart', 'recommend-heart', 24, 394],
    ['star', 'gift-star', 125, 315],
  ]) {
    const sheet = path.join(root, 'design/home-showcase', `${source}-sheet.png`);
    const metadata = await sharp(sheet).metadata();
    const destination = path.join(root, 'miniprogram/assets/home', `${name}.png`);
    // Export one 64px still; all motion is implemented in WXSS.
    await sharp(sheet).extract({ left: 0, top, width: Math.round(metadata.width / 4), height })
      .resize(60, 60, { fit: 'contain', background: '#00000000' })
      .extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#00000000' })
      .png().toFile(destination);
    console.log(`${name}: static 64x64 PNG, ${fs.statSync(destination).size} bytes`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
