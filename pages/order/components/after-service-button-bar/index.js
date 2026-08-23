import Dialog from 'tdesign-miniprogram/dialog/index';
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
      const { type } = e.currentTarget.dataset;
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
      Dialog.confirm({
        title: '是否撤销退货申请？',
        content: '',
        // Dialog 默认右侧为确认、左侧为取消；调整文案后保持两侧实际逻辑一致。
        confirmBtn: {
          content: '不撤销',
          variant: 'text',
          theme: 'default',
        },
        cancelBtn: {
          content: '撤销申请',
          variant: 'text',
          theme: 'default',
        },
      })
        .then(() => {})
        .catch(() => {
          const params = { rightsNo: this.data.currentService.id };
          return cancelRights(params).then(() => {
            Toast({
              context: this,
              selector: '#t-toast',
              message: '你确认撤销申请',
            });
          });
        });
    },
  },
});
