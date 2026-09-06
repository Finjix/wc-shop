import { request, normalizeComment, normalizeCommentPayload } from './api';

function localPath(resource) {
  if (typeof resource === 'string') return resource;
  return resource?.tempFilePath || resource?.path || resource?.url || resource?.src || resource?.image || '';
}

function uploadCommentResource(resource) {
  return localPath(resource);
}

export async function createComment(params = {}) {
  const resources = Array.isArray(params.commentResources) ? params.commentResources : [];
  const uploaded = await Promise.all(resources.map(uploadCommentResource));
  return request('comments.create', normalizeCommentPayload({ ...params, commentResources: uploaded })).then((result) => {
    const data = result && result.data !== undefined ? result.data : result;
    return normalizeComment(data) || data;
  });
}
