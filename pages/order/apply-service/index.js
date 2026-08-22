import Dialog from 'tdesign-miniprogram/dialog/index';
import Toast from 'tdesign-miniprogram/toast/index';
import { priceFormat } from '../../../utils/util';
import { OrderStatus, ServiceType, ServiceReceiptStatus } from '../config';
import reasonSheet from '../components/reason-sheet/reasonSheet';
import {
  fetchRightsPreview,
  dispatchConfirmReceived,
  fetchApplyReasonList,
  dispatchApplyService,
} from '../../../services/order/applyService';
import { fetchOrderDetail } from '../../../services/order/orderDetail';

Page({
  query: {},
  data: {
    uploading: false, // 凭证上传状态
    canApplyReturn: true, // 是否可退货
    goodsInfo: {},
    goodsInfoList: [],
    orderLevel: false,
    receiptStatusList: [
      { desc: '未收到货', status: ServiceReceiptStatus.NOT_RECEIPTED },
      { desc: '已收到货', status: ServiceReceiptStatus.RECEIPTED },
    ],
    applyReasons: [],
    serviceType: ServiceType.RETURN_GOODS, // 20-仅退款，10-退货退款
    serviceFrom: {
      returnNum: 1,
      receiptStatus: { desc: '请选择', status: null },
      applyReason: { desc: '请选择', type: null },
      // max-填写上限(单位分)，current-当前值(单位分)，temp输入框中的值(单位元)
      amount: { max: 0, current: 0, temp: 0, focus: false },
      remark: '',
      rightsImageUrls: [],
    },
    maxApplyNum: 2, // 最大可申请售后的商品数
    amountTip: '',
    refundAmountText: '0.00',
    showReceiptStatusDialog: false,
    validateRes: {
      valid: false,
      msg: '',
    },
    submitting: false,
    inputDialogVisible: false,
    uploadGridConfig: {
      column: 3,
      width: 212,
      height: 212,
    },
    serviceRequireType: 'REFUND_GOODS',
  },

  setWatcher(key, callback) {
    let lastData = this.data;
    const keys = key.split('.');
    keys.slice(0, -1).forEach((k) => {
      lastData = lastData[k];
    });
    const lastKey = keys[keys.length - 1];
    this.observe(lastData, lastKey, callback);
  },

  observe(data, k, callback) {
    let val = data[k];
    Object.defineProperty(data, k, {
      configurable: true,
      enumerable: true,
      set: (value) => {
        val = value;
        callback();
      },
      get: () => {
        return val;
      },
    });
  },

  validate() {
    let valid = true;
    let msg = '';
    // 检查必填项
    if (!this.data.serviceFrom.applyReason.type) {
      valid = false;
      msg = '请填写退款原因';
    } else if (!this.data.serviceFrom.amount.current) {
      valid = false;
      msg = '请填写退款金额';
    }
    if (this.data.serviceFrom.amount.current <= 0) {
      valid = false;
      msg = '退款金额必须大于0';
    }
    this.setData({ validateRes: { valid, msg } });
  },

  onLoad(query) {
    this.query = query;
    this.isOrderLevel = query.orderLevel === 'true';
    if (!this.checkQuery()) return;
    this.setData({
      canApplyReturn: query.canApplyReturn === 'true',
      orderLevel: this.isOrderLevel,
    });
    this.init();
    this.setWatcher('serviceFrom.returnNum', this.validate.bind(this));
    this.setWatcher('serviceFrom.applyReason', this.validate.bind(this));
    this.setWatcher('serviceFrom.amount', this.validate.bind(this));
    this.setWatcher('serviceFrom.rightsImageUrls', this.validate.bind(this));
  },

  async init() {
    try {
      await this.refresh();
      // 收货状态仍保持“请选择”，但退款原因可以直接打开查看
      const applyReasons = await this.getApplyReasons(ServiceReceiptStatus.RECEIPTED);
      this.setData({ applyReasons });
    } catch (e) {}
  },

  checkQuery() {
    const { orderNo, skuId } = this.query;
    if (!orderNo) {
      Dialog.alert({
        content: '请先选择订单',
      }).then(() => {
        wx.redirectTo({ url: 'pages/order/order-list/index' });
      });
      return false;
    }
    if (!this.isOrderLevel && !skuId) {
      Dialog.alert({
        content: '请先选择商品',
      }).then(() => {
        wx.redirectTo(`pages/order/order-detail/index?orderNo=${orderNo}`);
      });
      return false;
    }
    return true;
  },

  async refresh() {
    wx.showLoading({ title: 'loading' });
    try {
      const res = await this.getRightsPreview();
      wx.hideLoading();
      const preview = (res && res.data) || {};
      const previewAmount = Number(preview.refundableAmount || 0);
      const orderAmount = Number(this.query.payAmt || this.query.orderAmt || 0);
      const refundableAmount = previewAmount > 0 ? previewAmount : orderAmount;
      const previewGoods = this.isOrderLevel ? preview.goodsList || [] : [preview];
      const goodsInfoList = previewGoods.map((goods) => ({
        id: goods.skuId,
        thumb: goods.goodsInfo && goods.goodsInfo.skuImage,
        title: goods.goodsInfo && goods.goodsInfo.goodsName,
        spuId: goods.spuId,
        skuId: goods.skuId,
        specs: ((goods.goodsInfo && goods.goodsInfo.specInfo) || []).map((s) => s.specValue),
        paidAmountEach: goods.paidAmountEach,
        boughtQuantity: goods.boughtQuantity,
      }));
      this.setData({
        goodsInfo: goodsInfoList[0] || {},
        goodsInfoList,
        refundAmountText: priceFormat(refundableAmount, 2),
        'serviceFrom.amount': {
          max: refundableAmount,
          current: refundableAmount,
        },
        'serviceFrom.returnNum': preview.numOfSku || 1,
        amountTip: `最多可申请退款¥ ${priceFormat(refundableAmount, 2)}，含发货运费¥ ${priceFormat(
          preview.shippingFeeIncluded || 0,
          2,
        )}`,
        maxApplyNum: preview.numOfSkuAvailable || preview.numOfSku || 1,
      });
    } catch (err) {
      wx.hideLoading();
      throw err;
    }
  },

  async getRightsPreview() {
    const { orderNo, skuId, spuId } = this.query;
    if (this.isOrderLevel) {
      // 订单级售后金额以订单详情的实付金额为准，避免沿用按商品聚合的旧预览 mock。
      const orderPreview = await this.getOrderPreview(orderNo);
      if (Number(orderPreview && orderPreview.data && orderPreview.data.refundableAmount) > 0) {
        return orderPreview;
      }
      try {
        const preview = await fetchRightsPreview({ orderNo, orderLevel: true });
        if (preview && preview.data) return preview;
      } catch (e) {}
      return this.getOrderPreview(orderNo);
    }
    const params = {
      orderNo,
      skuId,
      spuId,
      numOfSku: this.data.serviceFrom.returnNum,
    };
    const res = await fetchRightsPreview(params);
    return res;
  },

  async getOrderPreview(orderNo) {
    try {
      const res = await fetchOrderDetail({ parameter: orderNo });
      const order = res && res.data;
      const orderItems = (order && order.orderItemVOs) || [];
      const goodsList = orderItems.map((goods) => {
        const quantity = Number(goods.buyQuantity || 0);
        const paidAmountEach =
          Number(goods.goodsPaymentPrice || 0) ||
          (quantity ? Number(goods.itemPaymentAmount || 0) / quantity : 0);
        return {
          spuId: goods.spuId,
          skuId: goods.skuId,
          numOfSku: quantity,
          numOfSkuAvailable: quantity,
          refundableAmount: `${goods.itemPaymentAmount || 0}`,
          paidAmountEach: `${paidAmountEach}`,
          boughtQuantity: quantity,
          goodsInfo: {
            goodsName: goods.goodsName,
            skuImage: goods.goodsPictureUrl,
            specInfo: goods.specifications || [],
          },
        };
      });
      const quantity = goodsList.reduce((sum, goods) => sum + goods.boughtQuantity, 0);
      const orderAmount =
        Number(order && order.paymentAmount) ||
        Number(order && order.goodsAmountApp) ||
        Number(order && order.totalAmount) ||
        Number(this.query.payAmt || this.query.orderAmt || 0);
      return {
        data: {
          refundableAmount: `${orderAmount}`,
          shippingFeeIncluded: `${(order && order.freightFee) || 0}`,
          numOfSku: quantity,
          numOfSkuAvailable: quantity,
          goodsList,
        },
      };
    } catch (e) {
      return {
        data: {
          refundableAmount: `${Number(this.query.payAmt || this.query.orderAmt || 0)}`,
          shippingFeeIncluded: '0',
          numOfSku: 1,
          numOfSkuAvailable: 1,
          goodsList: [],
        },
      };
    }
  },

  onApplyOnlyRefund() {
    wx.setNavigationBarTitle({ title: '售后申请' });
    this.setData({
      serviceRequireType: 'REFUND_MONEY',
      serviceType: ServiceType.ONLY_REFUND,
    });
    this.switchReceiptStatus(0);
  },

  onApplyReturnGoods() {
    wx.setNavigationBarTitle({ title: '售后申请' });
    this.setData({ serviceRequireType: 'REFUND_GOODS' });
    const orderStatus = parseInt(this.query.orderStatus);
    Promise.resolve()
      .then(() => {
        if (orderStatus === OrderStatus.PENDING_RECEIPT) {
          return Dialog.confirm({
            title: '订单商品是否已经收到货',
            content: '',
            confirmBtn: '确认收货，并申请退货',
            cancelBtn: '未收到货',
          }).then(() => {
            return dispatchConfirmReceived({
              parameter: {
                logisticsNo: this.query.logisticsNo,
                orderNo: this.query.orderNo,
              },
            }).then(() => ServiceReceiptStatus.RECEIPTED);
          }).catch(() => ServiceReceiptStatus.NOT_RECEIPTED);
        }
        return ServiceReceiptStatus.RECEIPTED;
      })
      .then((receiptStatus) => {
        this.setData({ serviceType: ServiceType.RETURN_GOODS });
        this.switchReceiptStatus(
          receiptStatus === ServiceReceiptStatus.NOT_RECEIPTED ? 0 : 1,
        );
      });
  },

  onApplyReturnGoodsStatus() {
    reasonSheet({
      show: true,
      title: '选择退款原因',
      options: this.data.applyReasons.map((r) => ({
        title: r.desc,
        checked: r.type === this.data.serviceFrom.applyReason.type,
      })),
      showConfirmButton: true,
      showCancelButton: true,
      emptyTip: '请选择退款原因',
    }).then((indexes) => {
      this.setData({
        'serviceFrom.applyReason': this.data.applyReasons[indexes[0]],
      });
    });
  },

  onChangeReturnNum(e) {
    const { value } = e.detail;
    this.setData({
      'serviceFrom.returnNum': value,
    });
  },

  onApplyGoodsStatus() {
    reasonSheet({
      show: true,
      title: '请选择收货状态',
      options: this.data.receiptStatusList.map((r) => ({
        title: r.desc,
        checked: r.status === this.data.serviceFrom.receiptStatus.status,
      })),
      showConfirmButton: true,
      emptyTip: '请选择收货状态',
    }).then((indexes) => {
      this.setData({
        'serviceFrom.receiptStatus': this.data.receiptStatusList[indexes[0]],
      });
    });
  },

  switchReceiptStatus(index) {
    const statusItem = this.data.receiptStatusList[index];
    // 没有找到对应的状态，则清空/初始化
    if (!statusItem) {
      this.setData({
        showReceiptStatusDialog: false,
        'serviceFrom.receiptStatus': { desc: '请选择', status: null },
        'serviceFrom.applyReason': { desc: '请选择', type: null }, // 收货状态改变时，初始化申请原因
        applyReasons: [],
      });
      return;
    }
    // 仅选中项与当前项不一致时，才切换申请原因列表applyReasons
    if (!statusItem || statusItem.status === this.data.serviceFrom.receiptStatus.status) {
      this.setData({ showReceiptStatusDialog: false });
      return;
    }
    this.getApplyReasons(statusItem.status).then((reasons) => {
      this.setData({
        showReceiptStatusDialog: false,
        'serviceFrom.receiptStatus': statusItem,
        'serviceFrom.applyReason': { desc: '请选择', type: null }, // 收货状态改变时，重置申请原因
        applyReasons: reasons,
      });
    });
  },

  getApplyReasons(receiptStatus) {
    const params = { rightsReasonType: receiptStatus };
    return fetchApplyReasonList(params)
      .then((res) => {
        return res.data.rightsReasonList.map((reason) => ({
          type: reason.id,
          desc: reason.desc,
        }));
      })
      .catch(() => {
        return [];
      });
  },

  onReceiptStatusDialogConfirm(e) {
    const { index } = e.currentTarget.dataset;
    this.switchReceiptStatus(index);
  },

  onRemarkChange(e) {
    const { value } = e.detail;
    this.setData({
      'serviceFrom.remark': value,
    });
  },

  // 发起申请售后请求
  onSubmit() {
    this.submitCheck().then(() => {
      const rightsItem = this.data.orderLevel
        ? this.data.goodsInfoList.map((goods) => ({
            itemTotalAmount: Number(goods.paidAmountEach || 0) * Number(goods.boughtQuantity || 0),
            rightsQuantity: goods.boughtQuantity,
            skuId: goods.skuId,
            spuId: goods.spuId,
          }))
        : [
            {
              itemTotalAmount:
                Number(this.data.goodsInfo.paidAmountEach || 0) * Number(this.data.serviceFrom.returnNum || 0),
              rightsQuantity: this.data.serviceFrom.returnNum,
              skuId: this.query.skuId,
              spuId: this.query.spuId,
            },
          ];
      const params = {
        rights: {
          orderNo: this.query.orderNo,
          refundRequestAmount: this.data.serviceFrom.amount.current,
          receiptStatus: this.data.serviceFrom.receiptStatus.status,
          rightsImageUrls: this.data.serviceFrom.rightsImageUrls,
          rightsReasonDesc: this.data.serviceFrom.applyReason.desc,
          rightsReasonType: this.data.serviceFrom.applyReason.type,
          rightsType: this.data.serviceType,
        },
        rightsItem,
        refundMemo: this.data.serviceFrom.remark,
      };
      this.setData({ submitting: true });
      // 发起申请售后请求
      dispatchApplyService(params)
        .then((res) => {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '申请成功',
            icon: '',
          });

          wx.redirectTo({
            url: `/pages/order/after-service-detail/index?rightsNo=${res.data.rightsNo}`,
          });
        })
        .then(() => this.setData({ submitting: false }))
        .catch(() => this.setData({ submitting: false }));
    });
  },

  submitCheck() {
    return new Promise((resolve) => {
      const { msg, valid } = this.data.validateRes;
      if (!valid) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: msg,
          icon: '',
        });
        return;
      }
      resolve();
    });
  },

  handleSuccess(e) {
    const { files } = e.detail;
    this.setData({
      'serviceFrom.rightsImageUrls': files,
    });
  },

  handleRemove(e) {
    const { index } = e.detail;
    const {
      serviceFrom: { rightsImageUrls },
    } = this.data;
    rightsImageUrls.splice(index, 1);
    this.setData({
      'serviceFrom.rightsImageUrls': rightsImageUrls,
    });
  },

  handleComplete() {
    this.setData({
      uploading: false,
    });
  },

  handleSelectChange() {
    this.setData({
      uploading: true,
    });
  },
});
