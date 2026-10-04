// @ts-nocheck

const { errorFrom } = require('./errors');
const { array, string } = require('./validation');

function pathOf(fileId) {
  if (!fileId.startsWith('cloud://')) return fileId;
  const slash = fileId.indexOf('/', 'cloud://'.length);
  return slash < 0 ? '' : fileId.slice(slash + 1);
}

async function getTempFileURLs(runtime, fileList, options) {
  array(fileList, 'fileList');
  if (!fileList.length || fileList.length > 50) throw errorFrom('INVALID_ARGUMENT', { field: 'fileList' });
  const method = runtime.app && (runtime.app.getTempFileURL || runtime.app.getTempFileUrl);
  if (typeof method !== 'function') throw errorFrom('STORAGE_ERROR');
  const normalized = fileList.map((file) => string(file, 'fileId', { max: 512 }));
  const allowedPrefixes = options && options.allowedPrefixes;
  if (Array.isArray(allowedPrefixes)) {
    normalized.forEach((fileId) => {
      const path = pathOf(fileId);
      if (!allowedPrefixes.some((prefix) => path.startsWith(prefix))) throw errorFrom('FORBIDDEN');
    });
  }
  try {
    const { getDoc } = require('./db');
    const crypto = require('crypto');
    const mapped = await Promise.all(normalized.map(async (file) => {
      const seen = new Set();
      while (true) {
        if (seen.has(file) || seen.size >= 50) throw errorFrom('CONFLICT');
        seen.add(file);
        const id = `__image_file_${crypto.createHash('sha256').update(file).digest('hex')}`;
        const state = await getDoc(runtime.db.collection('settings'), id, false);
        if (!state?.newFileID) return file;
        file = state.newFileID;
      }
    }));
    const result = await method.call(runtime.app, { fileList: mapped });
    const files = result && result.fileList ? result.fileList : result;
    return Array.isArray(files) ? normalized.map((original, index) => {
      const file = files.find((item) => (item.fileID || item.fileId) === mapped[index]);
      if (!file) throw errorFrom('STORAGE_ERROR');
      return { ...file, fileID: original };
    }) : files;
  } catch (error) {
    throw errorFrom('STORAGE_ERROR');
  }
}

module.exports = { getTempFileURLs };
