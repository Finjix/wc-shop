import Toast from 'tdesign-miniprogram/toast/index';
import Dialog from 'tdesign-miniprogram/dialog/index';
import { OrderButtonTypes } from '../../config';

Component({
  options: {
    addGlobalClass: true,
  },
  properties: {
    order: {
      type: Object,
      observer(order) {
        const buttonsRight = (order.buttons || [])
          .map((button) => {
            //邀请好友拼团按钮
            if (button.type === OrderButtonTypes.INVITE_GROUPON && order.groupInfoVo) {
              const {
                groupInfoVo: { groupId, promotionId, remainMember, groupPrice },
                goodsList,
              } = order;
              const goodsImg = goodsList[0] && goodsList[0].imgUrl;
              const goodsName = goodsList[0] && goodsList[0].name;
              return {
                ...button,
                openType: 'share',
                dataShare: {
                  goodsImg,
                  goodsName,
                  groupId,
                  promotionId,
                  remainMember,
                  groupPrice,
                  storeId: order.storeId,
                },
              };
            }
            return button;
          })
          .filter(
            (button) =>
              !(order.hideApplyRefund && button.type === OrderButtonTypes.APPLY_REFUND),
          );
        const hasApplyRefundButton = buttonsRight.some(
          (button) => button.type === OrderButtonTypes.APPLY_REFUND,
        );
        const confirmButtonIndex = buttonsRight.findIndex(
          (button) => button.type === OrderButtonTypes.CONFIRM,
        );
        if (confirmButtonIndex > -1 && !hasApplyRefundButton && !order.hideApplyRefund) {
          buttonsRight.splice(confirmButtonIndex, 0, {
            primary: false,
            type: OrderButtonTypes.APPLY_REFUND,
            name: '申请售后',
          });
        }
        // 删除订单按钮单独挪到左侧
        const deleteBtnIndex = buttonsRight.findIndex((b) => b.type === OrderButtonTypes.DELETE);
        let buttonsLeft = [];
        if (deleteBtnIndex > -1) {
          buttonsLeft = buttonsRight.splice(deleteBtnIndex, 1);
        }
        const normalizedButtonsRight = buttonsRight.map((button) => ({
          ...button,
          openType: button.openType || '',
        }));
        this.setData({
          currentOrder: order || {},
          buttons: {
            left: buttonsLeft,
            right: normalizedButtonsRight,
          },
        });
      },
    },
    isBtnMax: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    currentOrder: {},
    buttons: {
      left: [],
      right: [],
    },
  },

  methods: {
    // 点击【订单操作】按钮，根据按钮类型分发
    onOrderBtnTap(e) {
      const { type } = e.currentTarget.dataset;
      switch (type) {
        case OrderButtonTypes.DELETE:
          this.onDelete(this.data.currentOrder);
          break;
        case OrderButtonTypes.CANCEL:
          this.onCancel(this.data.currentOrder);
          break;
        case OrderButtonTypes.CONFIRM:
          this.onConfirm(this.data.currentOrder);
          break;
        case OrderButtonTypes.PAY:
          this.onPay(this.data.currentOrder);
          break;
        case OrderButtonTypes.APPLY_REFUND:
          this.onApplyRefund(this.data.currentOrder);
          break;
        case OrderButtonTypes.VIEW_REFUND:
          this.onViewRefund(this.data.currentOrder);
          break;
        case OrderButtonTypes.COMMENT:
          this.onAddComment(this.data.currentOrder);
          break;
        case OrderButtonTypes.VIEW_COMMENT:
          this.onViewComment(this.data.currentOrder);
          break;
        case OrderButtonTypes.INVITE_GROUPON:
          //分享邀请好友拼团
          break;
        case OrderButtonTypes.REBUY:
          this.onBuyAgain(this.data.currentOrder);
      }
    },

    onCancel() {
      this.confirmDemoAction('取消订单');
    },

    onConfirm() {
      Dialog.confirm({
        title: '确认是否已经收到货？',
        content: '',
        confirmBtn: '确认收货',
        cancelBtn: '取消',
      })
        .then(() => {
          this.showDemoUnavailable('确认收货');
        })
        .catch(() => {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '已取消确认收货',
            icon: 'check-circle',
          });
        });
    },

    onPay() {
      this.showDemoUnavailable('订单支付');
    },

    onBuyAgain() {
      this.showDemoUnavailable('再次购买');
    },

    onDelete() {
      this.confirmDemoAction('删除订单');
    },

    confirmDemoAction(action) {
      Dialog.confirm({
        title: `确认${action}？`,
        content: '当前使用演示数据，真实订单服务尚未接入。',
        confirmBtn: '继续',
        cancelBtn: '取消',
      }).then(() => {
        this.showDemoUnavailable(action);
      }).catch(() => {});
    },

    showDemoUnavailable(action) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: `${action}未执行：订单服务尚未接入`,
        icon: '',
      });
    },

    onApplyRefund(order) {
      const goodsAmount = (order.goodsList || []).reduce(
        (total, goods) => total + Number(goods.price || 0) * Number(goods.num || 1),
        0,
      );
      const orderAmt = Number(order.totalAmount || 0) || goodsAmount;
      const payAmt = Number(order.amount || 0) || orderAmt;
      const params = {
        orderNo: order.orderNo,
        orderStatus: order.status,
        logisticsNo: order.logisticsNo,
        createTime: order.createTime,
        orderAmt,
        payAmt,
        canApplyReturn: true,
        orderLevel: true,
      };
      const paramsStr = Object.keys(params)
        .map((k) => `${k}=${encodeURIComponent(params[k] ?? '')}`)
        .join('&');
      wx.navigateTo({ url: `/pages/order/apply-service/index?${paramsStr}` });
    },

    onViewRefund() {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '你点击了查看退款',
        icon: '',
      });
    },

    /** 添加订单评论 */
    onAddComment(order) {
      const imgUrl = order?.goodsList?.[0]?.thumb;
      const title = order?.goodsList?.[0]?.title;
      const specs = order?.goodsList?.[0]?.specs;
      wx.navigateTo({
        url: `/pages/goods/comments/create/index?specs=${encodeURIComponent(
          specs || '',
        )}&title=${encodeURIComponent(title || '')}&orderNo=${encodeURIComponent(
          order?.orderNo || '',
        )}&imgUrl=${encodeURIComponent(imgUrl || '')}`,
      });
    },

    onViewComment(order) {
      const spuId = order?.goodsList?.[0]?.spuId;
      if (spuId === undefined || spuId === null || spuId === '') return;
      wx.navigateTo({
        url: `/pages/goods/comments/index?spuId=${encodeURIComponent(spuId)}&orderNo=${encodeURIComponent(
          order.orderNo || '',
        )}`,
      });
    },
  },
});
