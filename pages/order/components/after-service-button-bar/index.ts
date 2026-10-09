// @ts-nocheck

import Dialog from '../../utils/dialog';
import Toast from 'tdesign-miniprogram/toast/index';

import { cancelRights } from '../../after-service-detail/api';
import { fetchOrderDetail } from '../../services/orderDetail';
import { ServiceButtonTypes } from '../../config';

Component({
  properties: {
    service: {
      type: Object,
      observer(service) {
        const currentService = service || {};
        const buttonsRight = (currentService.buttons || currentService.buttonVOs || []).filter(
          (button) => button.type !== ServiceButtonTypes.VIEW_DELIVERY,
        );
        const normalizedButtonsRight = buttonsRight.map((button) => ({
          ...button,
          openType: button.openType || '',
        }));
        this.setData({
          currentService,
          buttons: {
            left: [],
            right: normalizedButtonsRight,
          },
        });
      },
    },
  },

  data: {
    currentService: {},
    buttons: {
      left: [],
      right: [],
    },
  },

  methods: {
    // 点击【订单操作】按钮，根据按钮类型分发
    onServiceBtnTap(e) {
      const type = Number(e.currentTarget.dataset.type);
      switch (type) {
        case ServiceButtonTypes.REAPPLY:
          this.onReapply(this.data.currentService);
          break;
        case ServiceButtonTypes.REVOKE:
          this.onConfirm(this.data.currentService);
          break;
        case ServiceButtonTypes.FILL_TRACKING_NO:
          this.onFillTrackingNo(this.data.currentService);
          break;
        case ServiceButtonTypes.CHANGE_TRACKING_NO:
          this.onChangeTrackingNo(this.data.currentService);
          break;
        case ServiceButtonTypes.VIEW_DELIVERY:
          this.viewDelivery(this.data.currentService);
          break;
      }
    },

    async onReapply(service) {
      if (this.reapplying) return;
      this.reapplying = true;
      try {
        const { data: order } = await fetchOrderDetail({ orderNo: service.orderNo });
        const canApplyReturn = [40, 50].includes(Number(order.orderStatus));
        const params = {
          orderNo: order.orderNo,
          orderStatus: order.orderStatus,
          orderAmt: order.goodsAmountApp,
          payAmt: order.paymentAmount,
          canApplyReturn,
          orderLevel: true,
          directApply: !canApplyReturn,
          reapply: true,
          reapplyId: service.id,
        };
        const query = Object.keys(params).map((key) => `${key}=${encodeURIComponent(params[key] ?? '')}`).join('&');
        wx.navigateTo({ url: `/pages/order/apply-service/index?${query}` });
      } catch (error) {
        const pages = getCurrentPages();
        Toast({ context: pages[pages.length - 1], selector: '#t-toast', message: error?.message || '加载订单失败，请稍后重试', icon: '' });
      } finally {
        this.reapplying = false;
      }
    },

    onFillTrackingNo(service) {
      wx.navigateTo({
        url: `/pages/order/fill-tracking-no/index?rightsNo=${service.id}`,
      });
    },

    viewDelivery(service) {
      wx.navigateTo({
        url: `/pages/order/delivery-detail/index?data=${encodeURIComponent(
          JSON.stringify(service.logistics || service.logisticsVO || {}),
        )}&source=2`,
      });
    },

    onChangeTrackingNo(service) {
      wx.navigateTo({
        url: `/pages/order/fill-tracking-no/index?rightsNo=${encodeURIComponent(
          service.id || '',
        )}&logisticsNo=${encodeURIComponent(service.logisticsNo || '')}&logisticsCompanyName=${encodeURIComponent(
          service.logisticsCompanyName || '',
        )}&logisticsCompanyCode=${encodeURIComponent(
          service.logisticsCompanyCode || '',
        )}&remark=${encodeURIComponent(service.remark || '')}`,
      });
    },

    onConfirm() {
      const pages = getCurrentPages();
      const context = pages[pages.length - 1];
      Dialog.confirm({
        context,
        title: '是否撤销退货申请？',
        content: '',
        confirmBtn: '确定',
        cancelBtn: '取消',
      })
        .then(() => {
          const params = { rightsNo: this.data.currentService.id };
          return cancelRights(params).then(() => {
            Toast({
              context,
              selector: '#t-toast',
              message: '售后申请已撤销',
            });
            this.triggerEvent('refresh', { deleted: true });
          });
        })
        .catch((error) => {
          if (error?.message === 'confirm' || error?.message === 'cancel' || error === 'cancel') return;
          Toast({ context: this, selector: '#t-toast', message: error?.msg || error?.message || '撤销失败，请稍后重试', icon: '' });
        });
    },
  },
});
// @ts-nocheck
