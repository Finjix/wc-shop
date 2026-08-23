import Toast from 'tdesign-miniprogram/toast/index';
import Dialog from 'tdesign-miniprogram/dialog/index';
import { OrderButtonTypes } from '../../config';
import { cancelOrder, confirmOrderReceived, deleteOrder } from '../../../../services/order/orderDetail';
import { addGoodsToCart } from '../../../../services/cart/cart';
import { getCloudErrorMessage } from '../../../../utils/cloud';

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

    onCancel(order) {
      Dialog.confirm({ title: '确认取消订单？', content: '取消后会释放已锁定的库存。', confirmBtn: '确认取消', cancelBtn: '暂不取消' })
        .then(() => cancelOrder(order.orderNo))
        .then(() => this.finishAction('订单已取消'))
        .catch((error) => { if (error) this.showActionError(error); });
    },

    onConfirm(order) {
      Dialog.confirm({
        title: '确认是否已经收到货？',
        content: '',
        confirmBtn: '确认收货',
        cancelBtn: '取消',
      })
        .then(() => confirmOrderReceived({ orderNo: order.orderNo }))
        .then(() => this.finishAction('已确认收货'))
        .catch((error) => { if (error) this.showActionError(error); });
    },

    onPay() {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '订单已创建，支付参数尚未配置，请先在后台完成支付能力配置',
        icon: '',
      });
    },

    onBuyAgain(order) {
      const goodsList = order.goodsList || [];
      if (!goodsList.length) return;
      Promise.all(goodsList.map((goods) => addGoodsToCart({
        spuId: goods.spuId,
        skuId: goods.skuId,
        quantity: goods.num || goods.buyQuantity || 1,
        title: goods.title,
        primaryImage: goods.thumb,
      }))).then(() => {
        Toast({ context: this, selector: '#t-toast', message: '商品已重新加入购物车', icon: 'check-circle' });
        wx.switchTab({ url: '/pages/cart/index' });
      }).catch((error) => this.showActionError(error));
    },

    onDelete(order) {
      Dialog.confirm({ title: '确认删除订单？', content: '删除后订单只会从你的订单列表隐藏。', confirmBtn: '确认删除', cancelBtn: '取消' })
        .then(() => deleteOrder(order.orderNo))
        .then(() => this.finishAction('订单已删除'))
        .catch((error) => { if (error) this.showActionError(error); });
    },

    finishAction(message) {
      Toast({
        context: this,
        selector: '#t-toast',
        message,
        icon: 'check-circle',
      });
      this.triggerEvent('refresh');
    },

    showActionError(error) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: getCloudErrorMessage(error, '订单操作失败，请稍后重试'),
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

    onViewRefund(order) {
      const rightsNo = order.rightsNo || order.afterSaleId;
      if (!rightsNo) {
        Toast({ context: this, selector: '#t-toast', message: '暂无售后记录', icon: '' });
        return;
      }
      wx.navigateTo({ url: `/pages/order/after-service-detail/index?rightsNo=${encodeURIComponent(rightsNo)}` });
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
        )}&spuId=${encodeURIComponent(order?.goodsList?.[0]?.spuId || '')}&imgUrl=${encodeURIComponent(imgUrl || '')}`,
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
