// @ts-nocheck
import { isPageNavigationEnabled } from '../../../../config/navigation';

import Toast from 'tdesign-miniprogram/toast/index';
import Dialog from '../../utils/dialog';
import { OrderButtonTypes } from '../../config';
import { confirmOrderReceived, cancelOrder } from '../../services/orderDetail';
import { addGoodsToCart } from '../../../../services/cart/cart';
import { getApiErrorMessage } from '../../../../utils/api';

Component({
  options: {
    addGlobalClass: true,
  },
  properties: {
    order: {
      type: Object,
      observer(order) {
        const normalizedButtonsRight = (order.buttons || [])
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
          .map((button) => ({
            ...button,
            openType: button.openType || '',
          }));
        this.setData({
          currentOrder: order || {},
          buttons: {
            right: normalizedButtonsRight,
          },
        });
      },
    },
    isBtnMax: {
      type: Boolean,
      value: false,
    },
    showAmount: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    currentOrder: {},
    buttons: {
      right: [],
    },
  },

  methods: {
    // 点击【订单操作】按钮，根据按钮类型分发
    onOrderBtnTap(e) {
      const type = Number(e.currentTarget.dataset.type);
      switch (type) {
        case OrderButtonTypes.CONFIRM:
          this.onConfirm(this.data.currentOrder);
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

    onConfirm(order) {
      Dialog.confirm({
        context: this,
        title: '确认是否已经收到货？',
        content: '',
        confirmBtn: '确认收货',
        cancelBtn: '取消',
      })
        .then(() => confirmOrderReceived({ orderNo: order.orderNo }))
        .then(() => this.finishAction('已确认收货'))
        .catch((error) => { if (error) this.showActionError(error); });
    },

    onBuyAgain(order) {
      if (!isPageNavigationEnabled('/pages/cart/index')) return;
      const goodsList = (order.goodsList || []).filter((goods) => Number(
        goods.fulfillableQuantity ?? goods.remainingQuantity ?? goods.num ?? goods.buyQuantity ?? 1,
      ) > 0);
      if (!goodsList.length) return;
      Promise.all(goodsList.map((goods) => addGoodsToCart({
        spuId: goods.spuId,
        skuId: goods.skuId,
        quantity: goods.fulfillableQuantity ?? goods.remainingQuantity ?? goods.num ?? goods.buyQuantity ?? 1,
        title: goods.title,
        primaryImage: goods.thumb,
      }))).then(() => {
        Toast({ context: this, selector: '#t-toast', message: '商品已重新加入购物车', icon: 'check-circle' });
        wx.switchTab({ url: '/pages/cart/index' });
      }).catch((error) => this.showActionError(error));
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
        message: getApiErrorMessage(error, '订单操作失败，请稍后重试'),
        icon: '',
      });
    },

    onApplyRefund(order) {
      if (Number(order.status) === 10) {
        let confirmed = false;
        Dialog.confirm({
          context: this,
          title: '取消订单',
          content: '确定取消此订单吗？取消后订单将保留为已取消状态。',
          confirmBtn: '确认取消',
          cancelBtn: '暂不取消',
        }).then(() => {
          confirmed = true;
          return cancelOrder({ orderId: order.id || order.orderNo });
        })
          .then(() => {
            const pages = getCurrentPages();
            const current = pages[pages.length - 1];
            if (current?.route === 'pages/order/order-detail/index') {
              const previous = pages[pages.length - 2];
              if (previous) previous.data.backRefresh = true;
              wx.showToast({ title: '订单已取消', icon: 'success' });
              wx.navigateBack({ delta: 1 });
            } else {
              this.finishAction('订单已取消');
            }
          }).catch((error) => {
            if (!confirmed) return;
            this.showActionError(error);
          });
        return;
      }
      const goodsAmount = (order.goodsList || []).reduce(
        (total, goods) => total + Number(goods.price || 0) * Number(goods.num || 1),
        0,
      );
      const orderAmt = Number(order.totalAmount || 0) || goodsAmount;
      const payAmt = Number(order.amount || 0) || orderAmt;
      const canApplyReturn = [40, 50].includes(Number(order.status));
      const params = {
        orderNo: order.orderNo,
        orderStatus: order.status,
        logisticsNo: order.logisticsNo,
        createTime: order.createTime,
        orderAmt,
        payAmt,
        canApplyReturn,
        orderLevel: true,
        directApply: !canApplyReturn,
      };
      const paramsStr = Object.keys(params)
        .map((key) => `${key}=${encodeURIComponent(params[key] ?? '')}`)
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

    onViewComment(order) {
      const spuId = order?.goodsList?.[0]?.spuId;
      if (!spuId) return;
      wx.navigateTo({
        url: `/pages/goods/comments/index?spuId=${encodeURIComponent(spuId)}&orderNo=${encodeURIComponent(
          order.orderNo || '',
        )}`,
      });
    },

    /** 添加订单评论 */
    onAddComment(order) {
      const eligibleGoods = (order.goodsList || []).filter((item) => Number(item.fulfillableQuantity ?? item.remainingQuantity ?? item.num ?? 1) > 0);
      const goods = eligibleGoods.find((item) => item.spuId === order.commentableProductId) || eligibleGoods[0];
      if (!goods) return;
      const imgUrl = goods?.thumb;
      const title = goods?.title;
      const specs = goods?.specs;
      wx.navigateTo({
        url: `/pages/goods/comments/create/index?specs=${encodeURIComponent(
          specs || '',
        )}&title=${encodeURIComponent(title || '')}&orderNo=${encodeURIComponent(
          order?.orderNo || '',
        )}&spuId=${encodeURIComponent(goods.spuId || '')}&skuId=${encodeURIComponent(goods.skuId || '')}&orderItemId=${encodeURIComponent(goods.orderItemId || goods.id || '')}&imgUrl=${encodeURIComponent(imgUrl || '')}`,
      });
    },

  },
});
// @ts-nocheck
