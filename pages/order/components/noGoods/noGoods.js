Component({
  properties: {
    settleDetailData: {
      type: Object,
      value: {},
      observer(settleDetailData) {
        const data = settleDetailData || {};
        const outOfStockGoodsList = Array.isArray(data.outOfStockGoodsList) ? data.outOfStockGoodsList : [];
        const abnormalDeliveryGoodsList = Array.isArray(data.abnormalDeliveryGoodsList)
          ? data.abnormalDeliveryGoodsList
          : [];
        const inValidGoodsList = Array.isArray(data.inValidGoodsList) ? data.inValidGoodsList : [];
        // 弹窗逻辑   超出配送范围   失效    库存不足;
        const tempList = [
          ...abnormalDeliveryGoodsList,
          ...inValidGoodsList,
          ...outOfStockGoodsList,
        ].filter((goods) => goods && typeof goods === 'object');

        const goodsList = tempList.map((goods, index) => ({
          ...goods,
          id: index,
          unSettlementGoods: (Array.isArray(goods.unSettlementGoods) ? goods.unSettlementGoods : []).map((ele) => ({
            ...ele,
            name: ele.goodsName,
            price: ele.payPrice,
            imgUrl: ele.image,
          })),
        }));
        this.setData({
          goodsList,
        });
      },
    },
  },

  data: {
    goodList: [],
  },
  methods: {
    onCard(e) {
      const { item } = e.currentTarget.dataset;
      if (item === 'cart') {
        // 购物车
        wx.switchTab({ url: '/pages/cart/index' });
      } else if (item === 'orderSure') {
        // 结算页
        this.triggerEvent('change', { action: 'continue' });
      }
    },
    onDelive() {
      // 修改配送地址
      this.triggerEvent('change', { action: 'address' });
    },
  },
});
