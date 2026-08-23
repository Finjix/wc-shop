import { fetchComments } from '../../../services/comments/fetchComments';
import { fetchCommentsCount } from '../../../services/comments/fetchCommentsCount';
import { fetchOrderComment } from '../../../services/comments/fetchOrderComment';
import { getCloudErrorMessage } from '../../../utils/cloud';
import Toast from 'tdesign-miniprogram/toast/index';
import dayjs from 'dayjs';

const layoutMap = { 0: 'vertical' };

const sortCommentsByLatest = (comments = []) =>
  [...comments].sort((a, b) => Number(b.commentTime) - Number(a.commentTime));

Page({
  data: {
    pageLoading: false,
    commentList: [],
    pageNum: 1,
    pageSize: 10,
    total: 0,
    totalCount: 0,
    hasLoaded: false,
    layoutText: layoutMap[0],
    loadMoreStatus: 0,
    myLoadStatus: 0,
    spuId: '',
    commentLevel: '',
    hasImage: '',
    commentType: '',
    countObj: {
      badCount: '0', commentCount: '0', goodCount: '0', middleCount: '0',
      hasImageCount: '0', uidCount: '0',
    },
    mineOnly: false,
    ownComment: null,
    loadError: '',
  },

  onLoad(options = {}) {
    if (options.orderNo) {
      const productId = options.productId || options.spuId || '';
      this.setData({ mineOnly: true, spuId: productId });
      this.getOwnComment(options.orderNo, productId);
      return;
    }
    const productId = options.productId || options.spuId;
    if (!productId) {
      this.showError('商品不存在，无法查看评价');
      return;
    }
    this.getCount({ ...options, productId });
    this.getComments({ ...options, productId });
  },

  showError(message) {
    Toast({
      context: this,
      selector: '#t-toast',
      message: message || '评论加载失败，请稍后重试',
      icon: '',
    });
  },

  async getOwnComment(orderNo, productId = '') {
    try {
      const ownComment = await fetchOrderComment(orderNo, productId);
      this.setData({ ownComment, loadError: '' });
    } catch (error) {
      const message = getCloudErrorMessage(error);
      this.setData({ ownComment: null, loadError: message });
      this.showError(message);
    }
  },

  async getCount(options) {
    try {
      const productId = options.productId || options.spuId;
      const result = await fetchCommentsCount({ productId, spuId: productId });
      this.setData({ countObj: result, loadError: '' });
    } catch (error) {
      const message = getCloudErrorMessage(error);
      this.setData({ loadError: message });
      this.showError(message);
    }
  },

  generalQueryData(reset) {
    const { hasImage, pageNum, pageSize, spuId, commentLevel } = this.data;
    const queryParameter = { productId: spuId, spuId };
    if ([1, 2, 3].includes(Number(commentLevel))) queryParameter.commentLevel = Number(commentLevel);
    if (hasImage === '1') queryParameter.hasImage = true;
    const params = { pageNum: 1, pageSize: 30, queryParameter };
    return reset ? params : { ...params, pageNum: pageNum + 1, pageSize };
  },

  setCommentResult(data, params, reset, commentList) {
    const pageList = Array.isArray(data.pageList) ? data.pageList : [];
    const displayPageList = this.data.commentType === 'latest'
      ? sortCommentsByLatest(pageList)
      : pageList;
    displayPageList.forEach((item) => {
      if (item.commentTime) item.commentTime = dayjs(Number(item.commentTime)).format('YYYY/MM/DD HH:mm');
    });
    const totalCount = Number(data.totalCount || 0);
    const nextList = reset ? displayPageList : commentList.concat(displayPageList);
    this.setData({
      commentList: nextList,
      pageNum: params.pageNum || 1,
      total: totalCount,
      totalCount,
      hasLoaded: true,
      loadMoreStatus: nextList.length >= totalCount ? 2 : 0,
      loadError: '',
    });
  },

  async init(reset = true, mineOnly = false) {
    if (this.data.loadMoreStatus === 1) return;
    const params = this.generalQueryData(reset);
    this.setData({ loadMoreStatus: 1 });
    try {
      const data = await fetchComments({ ...params, mineOnly });
      this.setCommentResult(data, params, reset, this.data.commentList || []);
    } catch (error) {
      const message = getCloudErrorMessage(error);
      this.setData({ hasLoaded: true, loadMoreStatus: 3, loadError: message });
      this.showError(message);
    }
  },

  getMyCommentsList() {
    return this.init(true, true);
  },

  getScoreArray(score) {
    const array = [];
    for (let i = 0; i < 5; i += 1) array.push(i < score ? 2 : 0);
    return array;
  },

  getComments(options) {
    const { commentLevel = -1, hasImage = '' } = options;
    const spuId = options.productId || options.spuId;
    this.setData({
      commentLevel: commentLevel === -1 ? '' : commentLevel,
      hasImage,
      commentType: hasImage ? '4' : '',
      spuId,
    });
    this.init(true);
  },

  changeTag(e) {
    const { commenttype } = e.currentTarget.dataset;
    if (this.data.commentType === commenttype) return;
    this.setData({ loadMoreStatus: 0, commentList: [], total: 0, totalCount: 0, pageNum: 1 });
    if (commenttype === '' || commenttype === '5' || commenttype === 'latest') {
      this.setData({ hasImage: '', commentLevel: '' });
    } else if (commenttype === '4') {
      this.setData({ hasImage: '1', commentLevel: '' });
    } else {
      this.setData({ hasImage: '', commentLevel: commenttype });
    }
    this.setData({ myLoadStatus: 0, commentType: commenttype });
    if (commenttype === '5') this.getMyCommentsList();
    else this.init(true);
  },

  onReachBottom() {
    const { totalCount = 0, commentList } = this.data;
    if (commentList.length >= totalCount) {
      this.setData({ loadMoreStatus: 2 });
      return;
    }
    this.init(false, this.data.commentType === '5');
  },
});
