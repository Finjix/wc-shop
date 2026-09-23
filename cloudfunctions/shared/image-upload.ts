// @ts-nocheck

const crypto = require('crypto');
const sharp = require('sharp');
const { errorFrom } = require('./errors');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

async function processImageBuffer(input, filename) {
  if (!IMAGE_EXTENSIONS.test(String(filename || ''))) throw errorFrom('IMAGE_FORMAT');
  if (!Buffer.isBuffer(input) || !input.length) throw errorFrom('IMAGE_FORMAT');
  if (input.length > MAX_IMAGE_BYTES) throw errorFrom('IMAGE_TOO_LARGE');
  let metadata;
  try { metadata = await sharp(input).metadata(); }
  catch { throw errorFrom('IMAGE_FORMAT'); }
  if (!ALLOWED_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) throw errorFrom('IMAGE_FORMAT');
  const extension = String(filename).split('.').pop().toLowerCase();
  if ((extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension) !== metadata.format) throw errorFrom('IMAGE_FORMAT');
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const shortest = Math.min(width, height);
  if (metadata.format === 'webp' && shortest <= 1080) return input;
  const scale = shortest > 1080 ? 1080 / shortest : 1;
  let pipeline = sharp(input).rotate();
  if (scale < 1) pipeline = pipeline.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { fit: 'fill' });
  try { return await pipeline.webp({ quality: 80, effort: 4 }).toBuffer(); }
  catch { throw errorFrom('IMAGE_FORMAT'); }
}

async function processStagedImage(runtime, fileID, allowedFolders) {
  const match = /^cloud:\/\/[^/]+\/pending\/(admin\/products|home|user\/comments|user\/after-sales|user\/avatars)\/([a-zA-Z0-9._-]+\.(?:jpe?g|png|webp))$/i.exec(String(fileID || ''));
  if (!match || !allowedFolders.includes(match[1])) throw errorFrom('FORBIDDEN');
  const folder = match[1];
  const stagedName = match[2];
  try {
    let downloaded;
    try { downloaded = await runtime.app.downloadFile({ fileID }); }
    catch { throw errorFrom('STORAGE_ERROR'); }
    const content = await processImageBuffer(downloaded.fileContent, stagedName);
    const cloudPath = `${folder}/${crypto.randomUUID()}.webp`;
    let uploaded;
    try { uploaded = await runtime.app.uploadFile({ cloudPath, fileContent: content }); }
    catch { throw errorFrom('STORAGE_ERROR'); }
    if (!uploaded || !uploaded.fileID) throw errorFrom('STORAGE_ERROR');
    return { fileID: uploaded.fileID };
  } finally {
    try { await runtime.app.deleteFile({ fileList: [fileID] }); } catch { /* Cleanup must not mask the upload result. */ }
  }
}

module.exports = { MAX_IMAGE_BYTES, processImageBuffer, processStagedImage };
