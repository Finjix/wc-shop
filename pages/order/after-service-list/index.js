import { getRightsList } from './api';
import { AfterServiceStatus, ServiceType, ServiceTypeDesc } from '../config';
import Toast from 'tdesign-miniprogram/toast/index';
import { getCloudErrorMessage } from '../../../utils/cloud';
import { normalizeLogistics, normalizeServiceType } from '../after-service-detail/contract';

Page({
  page: {
    size: 10,
    num: 1,
  },

  data: {
    tabs: [
      {
        key: -1,
        text: '全部',
      },
      {
        key: AfterServiceStatus.TO_AUDIT,
        text: '待审核',
      },
      {
        key: AfterServiceStatus.THE_APPROVED,
        text: '已审核',
      },
      {
        key: AfterServiceStatus.COMPLETE,
        text: '已完成',
      },
      {
        key: AfterServiceStatus.CLOSED,
        text: '已关闭',
      },
    ],
    curTab: -1,
    dataList: [],
    listLoading: 0, // 0-未加载，1-加载中，2-已全部加载
    pullDownRefreshing: false, // 下拉刷新时不显示load-more
    emptyImg: 'https://tdesign.gtimg.com/miniprogram/template/retail/order/empty-order-list.png',
    backRefresh: false,
    errorMessage: '',
  },

  onLoad(query) {
    let status = parseInt(query.status);
    status = this.data.tabs.map((t) => t.key).includes(status) ? status : -1;
    this.init(status);
    this.pullDownRefresh = this.selectComponent('#wr-pull-down-refresh');
  },

  onShow() {
    // 当从其他页面返回，并且 backRefresh 被置为 true 时，刷新数据
    if (!this.data.backRefresh) return;
    this.onRefresh();
    this.setData({
      backRefresh: false,
    });
  },

  onReachBottom() {
    if (this.data.listLoading === 0) {
      this.getAfterServiceList(this.data.curTab);
    }
  },

  onPageScroll(e) {
    this.pullDownRefresh && this.pullDownRefresh.onPageScroll(e);
  },

  onPullDownRefresh_() {
    this.setData({
      pullDownRefreshing: true,
    }); // 下拉刷新时不显示load-more
    this.refreshList(this.data.curTab)
      .then(() => {
        this.setData({
          pullDownRefreshing: false,
        });
      })
      .catch((err) => {
        this.setData({
          pullDownRefreshing: false,
        });
        console.error('refresh after-service list error:', err);
      });
  },

  init(status) {
    status = status !== undefined ? status : this.data.curTab;
    this.refreshList(status);
  },

  getAfterServiceList(statusCode = -1, reset = false) {
    const params = {
      parameter: {
        pageSize: this.page.size,
        pageNum: this.page.num,
      },
    };
    if (statusCode !== -1) params.parameter.afterServiceStatus = statusCode;
    this.setData({
      listLoading: 1,
    });
    return getRightsList(params)
      .then((res) => {
        this.page.num++;
        this.setData({ errorMessage: '' });
        let dataList = [];
        let { tabs } = this.data;
        if (res && res.data && res.data.states) {
          tabs = this.data.tabs.map((item) => {
            switch (item.key) {
              case AfterServiceStatus.TO_AUDIT:
                item.info = res.data.states.audit;
                break;
              case AfterServiceStatus.THE_APPROVED:
                item.info = res.data.states.approved;
                break;
              case AfterServiceStatus.COMPLETE:
                item.info = res.data.states.complete;
                break;
              case AfterServiceStatus.CLOSED:
                item.info = res.data.states.closed;
                break;
            }
            return item;
          });
        }
        if (res && res.data && Array.isArray(res.data.dataList)) {
          dataList = (res.data.dataList || []).map((_data) => {
            const rights = _data.rights || _data;
            const rightsItem = _data.rightsItem || _data.items || [];
            const logistics = _data.logisticsVO || _data.logistics || {};
            return {
              id: rights.rightsNo || rights.id || rights._id,
              serviceNo: rights.rightsNo || rights.id || rights._id,
              storeName: rights.storeName,
              type: normalizeServiceType(rights.rightsType ?? rights.type),
              typeDesc: ServiceTypeDesc[normalizeServiceType(rights.rightsType ?? rights.type)] || rights.typeDesc || '',
              typeDescIcon:
                normalizeServiceType(rights.rightsType ?? rights.type) === ServiceType.ONLY_REFUND
                  ? 'money-circle'
                  : 'return-goods-1',
              status: rights.rightsStatus,
              statusName: rights.userRightsStatusName || rights.statusName,
              statusDesc: rights.userRightsStatusDesc || rights.statusDesc,
              amount: rights.refundAmount ?? rights.refundRequestAmount,
              goodsList: rightsItem.map((item, i) => ({
                id: i,
                thumb: item.goodsPictureUrl || item.thumb,
                title: item.goodsName || item.title,
                specs: Array.isArray(item.specInfo)
                  ? item.specInfo.map((s) => s.specValues || s.specValue || '')
                  : [],
                itemRefundAmount: item.itemRefundAmount ?? item.refundAmount,
                rightsQuantity: item.rightsQuantity ?? item.quantity,
              })),
              storeId: _data.storeId,
              buttons: _data.buttonVOs || [],
              logisticsNo: logistics.logisticsNo,
              logisticsCompanyName: logistics.logisticsCompanyName,
              logisticsCompanyCode: logistics.logisticsCompanyCode,
              remark: logistics.remark,
              logisticsVO: normalizeLogistics(logistics),
            };
          });
        }
        return new Promise((resolve) => {
          if (reset) {
            this.setData(
              {
                dataList: [],
              },
              () => resolve(),
            );
          } else resolve();
        }).then(() => {
          this.setData({
            tabs,
            dataList: this.data.dataList.concat(dataList),
            listLoading: dataList.length > 0 ? 0 : 2,
          });
        });
      })
      .catch((err) => {
        const message = getCloudErrorMessage(err, '售后列表加载失败，请稍后重试');
        this.setData({
          listLoading: 3,
          errorMessage: message,
        });
        console.error('load after-service list error:', err);
        Toast({ context: this, selector: '#t-toast', message, icon: '' });
        return null;
      });
  },

  onReTryLoad() {
    this.getAfterServiceList(this.data.curTab);
  },

  onTabChange(e) {
    const { value } = e.detail;
    const tab = this.data.tabs.find((v) => v.key === value);
    if (!tab) return;
    this.refreshList(value);
  },

  refreshList(status = -1) {
    this.page = {
      size: 10,
      num: 1,
    };
    this.setData({
      curTab: status,
      dataList: [],
    });
    return this.getAfterServiceList(status, true);
  },

  onRefresh() {
    this.refreshList(this.data.curTab);
  },

  // 点击订单卡片
  onAfterServiceCardTap(e) {
    wx.navigateTo({
      url: `/pages/order/after-service-detail/index?rightsNo=${e.currentTarget.dataset.order.id}`,
    });
  },
});
