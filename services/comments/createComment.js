import { callShop, normalizeComment, normalizeCommentPayload } from './api';

function localPath(resource) {
  if (typeof resource === 'string') return resource;
  return resource?.tempFilePath || resource?.path || resource?.url || resource?.src || resource?.image || '';
}

async function uploadCommentResource(resource, index) {
  const path = localPath(resource);
  if (!path || path.startsWith('cloud://') || /^https?:\/\//i.test(path)) return path;
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    const error = new Error('当前环境无法上传评价图片');
    error.code = 'CLOUD_UPLOAD_UNAVAILABLE';
    throw error;
  }
  const suffixMatch = path.match(/\.([a-zA-Z0-9]{1,8})(?:\?|$)/);
  const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : 'jpg';
  const cloudPath = `comments/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${index}.${suffix}`;
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: path });
  return result.fileID;
}

export async function createComment(params = {}) {
  const resources = Array.isArray(params.commentResources) ? params.commentResources : [];
  const uploaded = await Promise.all(resources.map(uploadCommentResource));
  return callShop('comments.create', normalizeCommentPayload({ ...params, commentResources: uploaded })).then((result) => {
    const data = result && result.data !== undefined ? result.data : result;
    return normalizeComment(data) || data;
  });
}
