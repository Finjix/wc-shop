// @ts-nocheck

import { request, normalizeComment, normalizeCommentPayload } from './api';
import { uploadCloudFile } from '../../../../utils/api';

function localPath(resource) {
  if (typeof resource === 'string') return resource;
  return resource?.tempFilePath || resource?.path || resource?.url || resource?.src || resource?.image || '';
}

async function uploadCommentResource(resource) {
  const path = localPath(resource);
  const userPath = wx.env?.USER_DATA_PATH;
  const isLocalPath = path && ((userPath && path.startsWith(`${userPath}/`))
    || /^(wxfile:|https?:\/\/(?:tmp|usr)\/)/i.test(path));
  if (!path || (!isLocalPath && /^(cloud:|local:|data:|https?:\/\/)/i.test(path))) return path;
  return uploadCloudFile(path, 'comments');
}

export async function createComment(params = {}) {
  const resources = Array.isArray(params.commentResources) ? params.commentResources : [];
  const uploaded = await Promise.all(resources.map(uploadCommentResource));
  return request('comments.create', normalizeCommentPayload({ ...params, commentResources: uploaded })).then((result) => {
    return normalizeComment(result);
  });
}
// @ts-nocheck
