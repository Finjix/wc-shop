/* eslint-disable no-param-reassign */
import { getSearchResult } from '../../../services/good/fetchSearchResult';
import { getCloudErrorMessage } from '../../../utils/cloud';
import Toast from 'tdesign-miniprogram/toast/index';
import { navigateToGoodsDetail } from '../../../utils/goods-detail-navigation';

const initFilters = {
  overall: 1,
  sorts: '',
  layout: 0,
  sortType: '',
};

Page({
  data: {
    goodsList: [],
    layout: 0,
    sorts: '',
    overall: 1,
    sortType: '',
    show: false,
    minVal: '',
    maxVal: '',
    minSalePriceFocus: false,
    maxSalePriceFocus: false,
    filter: initFilters,
    hasLoaded: false,
    keywords: '',
    searchInput: '',
    searchTitle: '',
    loadMoreStatus: 0,
    loading: true,
  },

  total: 0,
  pageNum: 1,
  pageSize: 30,

  onLoad(options) {
    const { searchValue = '' } = options || {};
    let keyword = searchValue;
    try {
      keyword = decodeURIComponent(searchValue);
    } catch (error) {
      keyword = searchValue;
    }
    this.setData(
      {
        keywords: keyword,
        searchInput: '',
        searchTitle: keyword || '搜索',
      },
      () => {
        this.init(true);
      },
    );
  },

  generalQueryData(reset = false) {
    const { filter, keywords, minVal, maxVal } = this.data;
    const { pageNum, pageSize } = this;
    const { sorts, overall, sortType } = filter;
    const params = {
      sort: 0, // 0 综合，1 价格
      pageNum: 1,
      pageSize: 30,
      keyword: keywords,
    };

    if (sorts) {
      params.sort = 1;
      params.sortType = sorts === 'desc' ? 1 : 0;
    }
    if (sortType === 'sales') {
      params.sort = 2;
    } else if (sortType === 'new') {
      params.sort = 3;
    }

    if (overall && !sortType) {
      params.sort = 0;
    } else if (!sortType && !sorts) {
      params.sort = 1;
    }
    params.minPrice = minVal ? minVal * 100 : 0;
    params.maxPrice = maxVal ? maxVal * 100 : undefined;
    if (reset) return params;
    return {
      ...params,
      pageNum: pageNum + 1,
      pageSize,
    };
  },

  async init(reset = true) {
    const { loadMoreStatus, goodsList = [] } = this.data;
    const params = this.generalQueryData(reset);
    if (loadMoreStatus !== 0) return;
    this.setData({
      loadMoreStatus: 1,
      loading: true,
    });
    try {
      const result = await getSearchResult(params);
      const { spuList = [], totalCount = 0 } = result || {};
      if (totalCount === 0 && reset) {
        this.total = totalCount;
        this.setData({
          emptyInfo: { tip: '抱歉，未找到相关商品' },
          hasLoaded: true,
          loadMoreStatus: 0,
          loading: false,
          goodsList: [],
        });
        return;
      }

      const _goodsList = reset ? spuList : goodsList.concat(spuList);
      this.pageNum = params.pageNum || 1;
      this.total = totalCount;
      this.setData({
        goodsList: _goodsList,
        loadMoreStatus: _goodsList.length >= totalCount ? 2 : 0,
        emptyInfo: { tip: '' },
      });
    } catch (error) {
      this.setData({
        loading: false,
        hasLoaded: true,
        loadMoreStatus: 3,
        emptyInfo: { tip: getCloudErrorMessage(error, '查询失败，请稍后重试') },
      });
      wx.showToast({ title: getCloudErrorMessage(error, '查询失败，请稍后重试'), icon: 'none' });
    }
    this.setData({
      hasLoaded: true,
      loading: false,
    });
  },

  handleCartTap() {
    wx.switchTab({
      url: '/pages/cart/index',
    });
  },

  handleSubmit(e) {
    const { value = '' } = e.detail || {};
    const keyword = value.trim();
    if (!keyword) return;
    this.pageNum = 1;
    this.setData(
      {
        keywords: keyword,
        searchTitle: keyword,
        searchInput: '',
        goodsList: [],
        loadMoreStatus: 0,
      },
      () => {
        this.init(true);
      },
    );
  },

  onReachBottom() {
    const { goodsList } = this.data;
    const { total = 0 } = this;
    if (goodsList.length === total) {
      this.setData({
        loadMoreStatus: 2,
      });
      return;
    }
    this.init(false);
  },

  gotoGoodsDetail(e) {
    const { index } = e.detail;
    const { spuId } = this.data.goodsList[index];
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  handleFilterChange(e) {
    const { layout, overall, sorts, sortType = '' } = e.detail;
    this.pageNum = 1;
    this.setData(
      {
        layout,
        sorts,
        overall,
        sortType,
        filter: {
          layout,
          overall,
          sorts,
          sortType,
        },
        goodsList: [],
        loadMoreStatus: 0,
      },
      () => this.init(true),
    );
  },

  showFilterPopup() {
    this.setData({
      show: true,
    });
  },

  showFilterPopupClose() {
    this.setData({
      show: false,
    });
  },

  onMinValAction(e) {
    const { value } = e.detail;
    this.setData({ minVal: value });
  },

  onMaxValAction(e) {
    const { value } = e.detail;
    this.setData({ maxVal: value });
  },

  reset() {
    this.setData({ minVal: '', maxVal: '' });
  },

  confirm() {
    const { minVal, maxVal } = this.data;
    let message = '';
    if (!minVal && !maxVal) {
      message = '';
    } else if (minVal && !maxVal) {
      message = `价格最小是${minVal}`;
    } else if (!minVal && maxVal) {
      message = `价格范围是0-${maxVal}`;
    } else if (Number(minVal) <= Number(maxVal)) {
      message = `价格范围${minVal}-${maxVal}`;
    } else {
      message = '请输入正确范围';
    }
    if (minVal && maxVal && Number(minVal) > Number(maxVal)) {
      Toast({
        context: this,
        selector: '#t-toast',
        message,
      });
      return;
    }
    if (message) {
      Toast({
        context: this,
        selector: '#t-toast',
        message,
      });
    }
    this.pageNum = 1;
    this.setData(
      {
        show: false,
        goodsList: [],
        loadMoreStatus: 0,
      },
      () => {
        this.init();
      },
    );
  },

  onRetryLoad() {
    this.pageNum = 1;
    this.setData({ goodsList: [], loadMoreStatus: 0 }, () => this.init(true));
  },
});
