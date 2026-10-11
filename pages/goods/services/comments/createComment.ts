// @ts-nocheck

import { request, normalizeComment, normalizeCommentPayload } from './api';
import { uploadCloudFile, cleanupCloudFiles } from '../../../../utils/api';

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
  const uploaded = [], temporary = [];
  try {
    for (const resource of resources) {
      const fileID = await uploadCommentResource(resource);
      uploaded.push(fileID);
      if (fileID !== localPath(resource)) temporary.push(fileID);
    }
    const result = await request('comments.create', normalizeCommentPayload({ ...params, commentResources: uploaded }));
    return normalizeComment(result);
  } finally {
    // Also covers partial uploads and duplicate/lost-response submissions.
    // Successfully referenced files are retained by the server.
    await cleanupCloudFiles(temporary);
  }
}
// @ts-nocheck
