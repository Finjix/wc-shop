// @ts-nocheck

import Dialog from '../../utils/dialog';
import Toast from 'tdesign-miniprogram/toast/index';

import { cancelRights } from '../../after-service-detail/api';
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
        content: '撤销后可重新提交售后申请。',
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
            this.triggerEvent('refresh');
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
