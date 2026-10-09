// @ts-nocheck

import Toast from 'tdesign-miniprogram/toast/index';
import { ServiceType, ServiceTypeDesc, ServiceStatus } from '../config';
import { formatTime, getRightsDetail } from './api';
import { navigateToGoodsDetail } from '../../../utils/goods-detail-navigation';
import { getApiErrorMessage } from '../../../utils/api';
import {
  normalizeServiceStatus,
  normalizeServiceButtons,
  serviceStatusLabel,
} from './contract';

const TitleConfig = {
  [ServiceType.ONLY_REFUND]: '退款详情',
  [ServiceType.RETURN_GOODS]: '退货退款详情',
};

Page({
  data: {
    pageTitle: '退款详情',
    pullDownRefreshing: false,
    pageLoading: true,
    serviceRaw: {},
    service: { buttons: [] },
    deliveryButton: {},
    gallery: {
      current: 0,
      show: false,
      proofs: [],
    },
    showProofs: false,
    backRefresh: false,
  },

  onLoad(query) {
    this.rightsNo = query.rightsNo;
    this.inputDialog = this.selectComponent('#input-dialog');
    if (!this.rightsNo) {
      this.setData({ pageLoading: false });
      Toast({ context: this, selector: '#t-toast', message: '售后记录不存在', icon: '' });
      return;
    }
    this.init();
  },

  onShow() {
    // 当从其他页面返回，并且 backRefresh 被置为 true 时，刷新数据
    if (!this.data.backRefresh) return;
    this.init();
    this.setData({ backRefresh: false });
  },

  // 页面刷新，展示下拉刷新
  onPullDownRefresh_() {
    this.setData({ pullDownRefreshing: true }, () => {
      this.getService()
        .then(() => {
          this.setData({ pullDownRefreshing: false });
        })
        .catch(() => {
          this.setData({
            pullDownRefreshing: false,
          });
        });
    });
  },

  init() {
    this.setData({ pageLoading: true });
    this.getService().then(() => {
      this.setData({ pageLoading: false });
    }).catch((error) => {
      console.error('load after-service detail error:', error);
      this.setData({ pageLoading: false });
      Toast({
        context: this,
        selector: '#t-toast',
        message: getApiErrorMessage(error, '售后详情加载失败，请稍后重试'),
        icon: '',
      });
    });
  },

  getService() {
    const params = { rightsNo: this.rightsNo };
    return getRightsDetail(params).then((res) => {
      const serviceRaw = res && Array.isArray(res.data) ? res.data[0] : null;
      if (!serviceRaw) {
        wx.showToast({
          title: '售后记录不存在',
          icon: 'none',
        });
        return;
      }
      // 滤掉填写运单号、修改运单号按钮，这两个按钮特殊处理，不在底部按钮栏展示
      if (!serviceRaw.buttonVOs) serviceRaw.buttonVOs = [];
      const deliveryButton = {};
      const rights = serviceRaw.rights;
      const rightsItem = serviceRaw.rightsItem;
      const logisticsVO = serviceRaw.logisticsVO;
      const serviceType = rights.rightsType;
      const rawStatus = rights.userRightsStatus;
      const serviceStatus = normalizeServiceStatus(rawStatus);
      const returnAddress = serviceRaw.returnAddressSnapshot || {};
      const service = {
        id: rights._id,
        storeName: rights.storeName,
        type: serviceType,
        receiptStatusDesc: Number(rights.receiptStatus) === 1 ? '已收到货' : Number(rights.receiptStatus) === 2 ? '未收到货' : '未记录',
        requestedTypeDesc: ServiceTypeDesc[rights.requestedType ?? serviceType] || '',
        decidedTypeDesc: rights.decidedType ? ServiceTypeDesc[rights.decidedType] : rights.reviewedAt && ['approved', 'refunding', 'refunded'].includes(rights.status) ? ServiceTypeDesc[serviceType] : '待商家审核决定',
        typeDesc: ServiceTypeDesc[serviceType] || rights.typeDesc || '',
        status: serviceStatus,
        statusIcon: this.genStatusIcon(rights),
        statusName: rights.userRightsStatusName || rights.statusName || serviceStatusLabel(rawStatus, serviceType),
        statusDesc: rights.userRightsStatusDesc || rights.statusDesc || rights.description || serviceStatusLabel(rawStatus, serviceType),
        amount: rights.refundRequestAmount ?? rights.refundAmount,
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
        orderNo: rights.orderNo || rights.orderId, // 订单编号
        rightsReasonDesc: rights.rightsReasonDesc, // 申请售后原因
        isRefunded: Number(rights.userRightsStatus) === ServiceStatus.REFUNDED, // 是否已退款
        refundMethodList: (serviceRaw.refundMethodList || []).map((m) => ({
          name: m.refundMethodName,
          amount: m.refundMethodAmount,
        })), // 退款明细
        refundRequestAmount: rights.refundRequestAmount ?? rights.refundAmount, // 申请退款金额
        payTraceNo: serviceRaw.rightsRefund?.traceNo, // 交易流水号
        createTime: formatTime(rights.createTime || rights.createdAt, 'YYYY-MM-DD HH:mm'), // 申请时间
        logisticsNo: logisticsVO.logisticsNo, // 退货物流单号
        logisticsCompanyName: logisticsVO.logisticsCompanyName, // 退货物流公司
        logisticsCompanyCode: logisticsVO.logisticsCompanyCode, // 退货物流公司
        remark: logisticsVO.remark, // 退货备注
        logisticsDescription: logisticsVO.description || logisticsVO.logisticsDescription || '',
        receiverName: returnAddress.receiver || '',
        receiverPhone: returnAddress.phone || '',
        receiverAddress: returnAddress.detail || '',
        buttons: normalizeServiceButtons(rawStatus, serviceType, serviceRaw.buttonVOs, logisticsVO.logisticsNo),
        logistics: logisticsVO,
      };
      const proofs = rights.rightsImageUrls || [];
      this.setData({
        serviceRaw,
        service,
        deliveryButton,
        pageTitle: TitleConfig[service.type] || '退款详情',
        'gallery.proofs': proofs,
        showProofs: proofs.length > 0,
      });
    });
  },

  onRefresh() {
    this.init();
  },

  onLogisticsTap() {
    const logistics = this.data.service.logistics || {};
    if (!logistics.logisticsNo && !logistics.nodes?.length) {
      Toast({ context: this, selector: '#t-toast', message: '暂无物流信息', icon: '' });
      return;
    }

    wx.navigateTo({
      url: `/pages/order/delivery-detail/index?data=${encodeURIComponent(
        JSON.stringify(logistics),
      )}&source=2`,
    });
  },

  editLogistices() {
    this.setData({
      inputDialogVisible: true,
    });
    this.inputDialog.setData({
      cancelBtn: '取消',
      confirmBtn: { content: '确定', style: 'order: -1; margin-left: 0;' },
    });
    this.inputDialog._onConfirm = () => {
      Toast({
        message: '确定填写物流单号',
      });
    };
  },

  onProofTap(e) {
    if (this.data.gallery.show) {
      this.setData({
        'gallery.show': false,
      });
      return;
    }
    const { index } = e.currentTarget.dataset;
    this.setData({
      'gallery.show': true,
      'gallery.current': index,
    });
  },

  onGoodsCardTap(e) {
    const { index } = e.currentTarget.dataset;
    const goods = (this.data.serviceRaw.rightsItem || [])[index];
    if (!goods || !goods.spuId) return;
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${encodeURIComponent(goods.spuId)}`);
  },

  onAddressCopy() {
    wx.setClipboardData({
      data: `${this.data.service.receiverName}  ${this.data.service.receiverPhone}\n${this.data.service.receiverAddress}`,
    });
  },

  /** 获取状态ICON */
  genStatusIcon(item) {
    const { userRightsStatus, afterSaleRequireType } = item;
    switch (userRightsStatus) {
      // 退款成功
      case ServiceStatus.REFUNDED: {
        return 'succeed';
      }
      // 已撤销、已关闭
      case ServiceStatus.CLOSED: {
        return 'indent_close';
      }
      default: {
        switch (afterSaleRequireType) {
          case 'REFUND_MONEY': {
            return 'goods_refund';
          }
          case 'REFUND_GOODS_MONEY':
            return 'goods_return';
          default: {
            return 'goods_return';
          }
        }
      }
    }
  },
});
// @ts-nocheck
