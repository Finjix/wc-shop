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
    const result = await method.call(runtime.app, { fileList: normalized });
    return result && result.fileList ? result.fileList : result;
  } catch (error) {
    throw errorFrom('STORAGE_ERROR');
  }
}

module.exports = { getTempFileURLs };
