// @ts-nocheck

import { request, getApiErrorMessage } from '../../../../utils/api';
import { resolveImage } from '../../../../utils/images';

export function normalizeCommentStatus(value, fallback = '') {
  return ['active', 'pending_review', 'rejected'].includes(value) ? value : fallback;
}
export function normalizeCommentResources(resources = []) {
  return resources.map((fileID) => ({ type: 'image', image: fileID, fileID }));
}
export function normalizeComment(comment) {
  if (!comment) return null;
  return {
    ...comment,
    spuId: comment.productId,
    commentStatus: comment.status,
    commentContent: comment.content,
    commentScore: comment.rating,
    commentTime: comment.createdAt,
    commentResources: normalizeCommentResources(comment.images),
  };
}
export function normalizeCommentList(data) {
  return { ...data, pageNum: data.page, totalCount: data.total, pageList: data.items.map(normalizeComment) };
}
export function normalizeCommentPayload(payload) {
  return { orderId: payload.orderId, productId: payload.productId, content: payload.commentContent, rating: payload.rating, images: payload.commentResources };
}
export { request, getApiErrorMessage };
export async function resolveCommentImages(comment) {
  if (!comment) return null;
  return { ...comment, userHeadUrl: '/assets/user-avatar.jpg', commentResources: await Promise.all(comment.commentResources.map(async (resource) => ({ ...resource, image: await resolveImage(resource.fileID) }))) };
}
export async function resolveCommentListImages(list) {
  return { ...list, pageList: await Promise.all(list.pageList.map(resolveCommentImages)) };
}
