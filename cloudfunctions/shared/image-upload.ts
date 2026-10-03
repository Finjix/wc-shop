// @ts-nocheck

const crypto = require('crypto');
const { AppError, errorFrom } = require('./errors');

const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

async function processImageBuffer(input, filename, folder = '') {
  const maxSizeMB = ['comments', 'after-sales', 'user/comments', 'user/after-sales'].includes(folder) ? 3 : 1;
  if (!Buffer.isBuffer(input) || !input.length) throw errorFrom('IMAGE_FORMAT');
  if (input.length > maxSizeMB * MAX_IMAGE_BYTES) throw new AppError('IMAGE_TOO_LARGE', `图片不能超过 ${maxSizeMB}MB`);
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
    const content = await processImageBuffer(downloaded.fileContent, stagedName, folder);
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
