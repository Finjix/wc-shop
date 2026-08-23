import { addSearchHistory, clearSearchHistory, deleteSearchHistory, getSearchHistory } from '../../../services/good/fetchSearchHistory';
import { getCloudErrorMessage } from '../../../utils/cloud';

Page({
  data: {
    historyWords: [],
    searchValue: '',
    dialog: {
      title: '确认删除当前历史记录',
      showCancelButton: true,
      message: '',
    },
    dialogShow: false,
  },

  deleteType: 0,
  deleteIndex: '',

  onShow() {
    this.queryHistory();
  },

  async queryHistory() {
    try {
      const data = await getSearchHistory();
      const code = 'Success';
      if (String(code).toUpperCase() === 'SUCCESS') {
        const { historyWords = [] } = data;
        this.setData({
          historyWords,
        });
      }
    } catch (error) {
      this.setData({ historyWords: [] });
      wx.showToast({ title: getCloudErrorMessage(error, '搜索历史加载失败，请稍后重试'), icon: 'none' });
    }
  },

  async confirm() {
    const { historyWords } = this.data;
    const { deleteType, deleteIndex } = this;
    try {
      if (deleteType === 0) {
        await deleteSearchHistory(historyWords[deleteIndex]);
        historyWords.splice(deleteIndex, 1);
        this.setData({ historyWords, dialogShow: false });
      } else {
        await clearSearchHistory();
        this.setData({ historyWords: [], dialogShow: false });
      }
    } catch (error) {
      wx.showToast({ title: getCloudErrorMessage(error, '搜索历史删除失败'), icon: 'none' });
    }
  },

  close() {
    this.setData({ dialogShow: false });
  },

  handleClearHistory() {
    const { dialog } = this.data;
    this.deleteType = 1;
    this.setData({
      dialog: {
        ...dialog,
        message: '确认删除所有历史记录',
      },
      dialogShow: true,
    });
  },

  deleteCurr(e) {
    const { index } = e.currentTarget.dataset;
    const { dialog } = this.data;
    this.deleteIndex = index;
    this.setData({
      dialog: {
        ...dialog,
        message: '确认删除当前历史记录',
        deleteType: 0,
      },
      dialogShow: true,
    });
  },

  handleHistoryTap(e) {
    const { historyWords } = this.data;
    const { dataset } = e.currentTarget;
    const _searchValue = historyWords[dataset.index || 0] || '';
    if (_searchValue) {
      wx.navigateTo({
        url: `/pages/goods/result/index?searchValue=${encodeURIComponent(_searchValue)}`,
      });
    }
  },

  async handleSubmit(e) {
    const { value = '' } = e.detail || {};
    const keyword = String(value).trim();
    if (!keyword) return;

    try { await addSearchHistory(keyword); } catch { /* 搜索不因历史记录写入失败而中断 */ }
    wx.navigateTo({
      url: `/pages/goods/result/index?searchValue=${encodeURIComponent(keyword)}`,
    });
  },
});
