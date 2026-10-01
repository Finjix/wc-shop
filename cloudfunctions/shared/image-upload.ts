// @ts-nocheck

const crypto = require('crypto');
const { errorFrom } = require('./errors');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

async function processImageBuffer(input, filename) {
  if (!Buffer.isBuffer(input) || !input.length) throw errorFrom('IMAGE_FORMAT');
  if (input.length > MAX_IMAGE_BYTES) throw errorFrom('IMAGE_TOO_LARGE');
  // Preserve the original bytes, dimensions, metadata and animation.
  return input;
}

async function processStagedImage(runtime, fileID, allowedFolders) {
  const match = /^cloud:\/\/[^/]+\/pending\/(admin\/products|admin\/categories|home|user\/comments|user\/after-sales|user\/avatars)\/([a-zA-Z0-9._-]+)$/i.exec(String(fileID || ''));
  if (!match || !allowedFolders.includes(match[1])) throw errorFrom('FORBIDDEN');
  const folder = match[1];
  const stagedName = match[2];
  try {
    let downloaded;
    try { downloaded = await runtime.app.downloadFile({ fileID }); }
    catch { throw errorFrom('STORAGE_ERROR'); }
    const content = await processImageBuffer(downloaded.fileContent, stagedName);
    const cloudPath = `${folder}/${crypto.randomUUID()}-${stagedName}`;
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
