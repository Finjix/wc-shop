import Toast from 'tdesign-miniprogram/toast/index';
import { fetchCartGroupData, persistMockCartGroupData } from '../../services/cart/cart';
import { fetchGoodsList } from '../../services/good/fetchGoods';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

Page({
  data: {
    cartGroupData: null,
    recommendedLeft: [],
    recommendedRight: [],
    recommendedOffset: 0,
    recommendedLoading: false,
    recommendedHasMore: true,
    themeColor: '#F5CE2B',
  },

  // 调用自定义tabbar的init函数，使页面与tabbar激活状态保持一致
  onShow() {
    this.getTabBar().init();
    if (this.data.cartGroupData) {
      this.refreshData(true);
    }
  },

  onLoad() {
    this.recommendedSpuIds = new Set();
    this.refreshData();
  },

  onReachBottom() {
    this.loadMoreRecommendedGoods();
  },

  refreshData(forceRefresh = false) {
    this.getCartGroupData(forceRefresh).then((res) => {
      let isEmpty = true;
      let hasSelectableGoods = false;
      let isAllSelected = true;
      let selectedGoodsCount = 0;
      let selectedGoodsAmount = 0;
      const cartGroupData = res.data;
      // 一些组件中需要的字段可能接口并没有返回，或者返回的数据结构与预期不一致，需要在此先对数据做一些处理
      // 统计门店下加购的商品是否全选、是否存在缺货/无货
      for (const store of cartGroupData.storeGoods) {
        store.isSelected = true; // 该门店已加购商品是否全选
        store.storeStockShortage = false; // 该门店已加购商品是否存在库存不足
        if (!store.shortageGoodsList) {
          store.shortageGoodsList = []; // 该门店已加购商品如果库存为0需单独分组
        }
        for (const activity of store.promotionGoodsList) {
          activity.goodsPromotionList = activity.goodsPromotionList.filter((goods) => {
            goods.originPrice = undefined;

            // 统计是否有加购数大于库存数的商品
            if (goods.quantity > goods.stockQuantity) {
              store.storeStockShortage = true;
            }
            // 统计是否全选
            if (!goods.isSelected) {
              store.isSelected = false;
            }
            // 库存为0（无货）的商品单独分组
            if (goods.stockQuantity > 0) {
              hasSelectableGoods = true;
              if (!goods.isSelected) {
                isAllSelected = false;
              }
              if (goods.isSelected) {
                const quantity = Number(goods.quantity) || 0;
                selectedGoodsCount += quantity;
                selectedGoodsAmount += quantity * (Number(goods.price) || 0);
              }
              return true;
            }
            store.shortageGoodsList.push(goods);
            return false;
          });

          if (activity.goodsPromotionList.length > 0) {
            isEmpty = false;
          }
        }
        if (store.shortageGoodsList.length > 0) {
          isEmpty = false;
        }
      }
      cartGroupData.invalidGoodItems = cartGroupData.invalidGoodItems.map((goods) => {
        goods.originPrice = undefined;
        return goods;
      });
      cartGroupData.isNotEmpty = !isEmpty;
      cartGroupData.isAllSelected = hasSelectableGoods && isAllSelected;
      cartGroupData.selectedGoodsCount = selectedGoodsCount;
      cartGroupData.totalAmount = String(selectedGoodsAmount);
      const cartGoodsSignature = this.getCartGoodsSignature(cartGroupData);
      const shouldRefreshRecommendations = this.recommendedCartGoodsSignature !== cartGoodsSignature;
      this.recommendedCartGoodsSignature = cartGoodsSignature;
      this.setData({ cartGroupData });
      if (shouldRefreshRecommendations) {
        if (cartGroupData.isNotEmpty) {
          this.loadRecommendedGoods(cartGroupData);
        } else {
          this.setData({
            recommendedLeft: [],
            recommendedRight: [],
            recommendedOffset: 0,
            recommendedLoading: false,
            recommendedHasMore: true,
          });
        }
      }
    });
  },

  getCartGoodsSignature(cartGroupData) {
    const cartSpuIds = [];
    (cartGroupData.storeGoods || []).forEach((store) => {
      (store.promotionGoodsList || []).forEach((promotion) => {
        (promotion.goodsPromotionList || []).forEach((goods) => {
          cartSpuIds.push(String(goods.spuId));
        });
      });
      (store.shortageGoodsList || []).forEach((goods) => {
        cartSpuIds.push(String(goods.spuId));
      });
    });
    return Array.from(new Set(cartSpuIds)).sort().join(',');
  },

  loadRecommendedGoods(cartGroupData) {
    const cartSpuIds = new Set();
    cartGroupData.storeGoods.forEach((store) => {
      store.promotionGoodsList.forEach((promotion) => {
        promotion.goodsPromotionList.forEach((goods) => {
          cartSpuIds.add(String(goods.spuId));
        });
      });
      store.shortageGoodsList.forEach((goods) => {
        cartSpuIds.add(String(goods.spuId));
      });
    });

    this.recommendedSpuIds = cartSpuIds;
    this.setData({
      recommendedLeft: [],
      recommendedRight: [],
      recommendedOffset: 0,
      recommendedLoading: false,
      recommendedHasMore: true,
    });
    this.loadMoreRecommendedGoods();
  },

  loadMoreRecommendedGoods() {
    const { recommendedLoading, recommendedHasMore, recommendedOffset } = this.data;
    if (recommendedLoading || !recommendedHasMore) return;

    const pageSize = 8;
    this.setData({ recommendedLoading: true });
    fetchGoodsList(recommendedOffset, pageSize)
      .then((goodsList) => {
        if (!Array.isArray(goodsList)) {
          this.setData({ recommendedLoading: false, recommendedHasMore: false });
          return;
        }

        const newGoods = goodsList.filter((goods) => {
          const spuId = String(goods.spuId);
          if (this.recommendedSpuIds.has(spuId)) return false;
          this.recommendedSpuIds.add(spuId);
          return true;
        });
        const recommendedLeft = this.data.recommendedLeft.slice();
        const recommendedRight = this.data.recommendedRight.slice();
        newGoods.forEach((goods) => {
          const targetColumn = recommendedLeft.length <= recommendedRight.length ? recommendedLeft : recommendedRight;
          targetColumn.push(goods);
        });

        this.setData({
          recommendedLeft,
          recommendedRight,
          recommendedOffset: recommendedOffset + goodsList.length,
          recommendedLoading: false,
          recommendedHasMore: goodsList.length >= pageSize,
        });
      })
      .catch(() => {
        this.setData({ recommendedLoading: false });
      });
  },

  findGoods(spuId, skuId) {
    let currentStore;
    let currentActivity;
    let currentGoods;
    const { storeGoods } = this.data.cartGroupData;
    for (const store of storeGoods) {
      for (const activity of store.promotionGoodsList) {
        for (const goods of activity.goodsPromotionList) {
          if (goods.spuId === spuId && goods.skuId === skuId) {
            currentStore = store;
            currentActivity = currentActivity;
            currentGoods = goods;
            return {
              currentStore,
              currentActivity,
              currentGoods,
            };
          }
        }
      }
    }
    return {
      currentStore,
      currentActivity,
      currentGoods,
    };
  },

  // 注：实际场景时应该调用接口获取购物车数据
  getCartGroupData(forceRefresh = false) {
    const { cartGroupData } = this.data;
    if (!cartGroupData || forceRefresh) {
      return fetchCartGroupData();
    }
    return Promise.resolve({ data: cartGroupData });
  },

  persistCartData() {
    return persistMockCartGroupData(this.data.cartGroupData);
  },

  // 选择单个商品
  // 注：实际场景时应该调用接口更改选中状态
  selectGoodsService({ spuId, skuId, isSelected }) {
    const { currentGoods } = this.findGoods(spuId, skuId);
    if (!currentGoods) return Promise.reject(new Error('购物车商品不存在'));
    currentGoods.isSelected = isSelected;
    return this.persistCartData();
  },

  // 全选门店
  // 注：实际场景时应该调用接口更改选中状态
  selectStoreService({ storeId, isSelected }) {
    const currentStore = this.data.cartGroupData.storeGoods.find((s) => s.storeId === storeId);
    if (!currentStore) return Promise.reject(new Error('购物车门店不存在'));
    currentStore.isSelected = isSelected;
    currentStore.promotionGoodsList.forEach((activity) => {
      activity.goodsPromotionList.forEach((goods) => {
        goods.isSelected = isSelected;
      });
    });
    return this.persistCartData();
  },

  // 加购数量变更
  // 注：实际场景时应该调用接口
  changeQuantityService({ spuId, skuId, quantity }) {
    const { currentGoods } = this.findGoods(spuId, skuId);
    if (!currentGoods) return Promise.reject(new Error('购物车商品不存在'));
    currentGoods.quantity = quantity;
    return this.persistCartData();
  },

  // 修改购物车商品规格
  replaceGoodsSpecsService({ oldGoods, goods }) {
    const replaceInList = (list) => {
      const index = list.findIndex((item) => item.spuId === oldGoods.spuId && item.skuId === oldGoods.skuId);
      if (index < 0) return false;
      list[index] = goods;
      return true;
    };

    const { cartGroupData } = this.data;
    let replaced = false;
    for (const store of cartGroupData.storeGoods) {
      for (const activity of store.promotionGoodsList) {
        if (replaceInList(activity.goodsPromotionList)) {
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        const shortageIndex = store.shortageGoodsList.findIndex(
          (item) => item.spuId === oldGoods.spuId && item.skuId === oldGoods.skuId,
        );
        if (shortageIndex > -1) {
          store.shortageGoodsList.splice(shortageIndex, 1);
          const targetActivity = store.promotionGoodsList.find((activity) => activity.goodsPromotionList);
          if (targetActivity) {
            targetActivity.goodsPromotionList.push(goods);
          }
          replaced = true;
        }
      }
      if (replaced) break;
    }
    if (!replaced) return Promise.reject(new Error('购物车商品不存在'));

    const oldAmount = Number(oldGoods.price) * Number(oldGoods.quantity || 0);
    const newAmount = Number(goods.price) * Number(goods.quantity || 0);
    const totalAmount = Number(cartGroupData.totalAmount) || 0;
    cartGroupData.totalAmount = String(Math.max(0, totalAmount - oldAmount + newAmount));
    return this.persistCartData();
  },

  // 删除加购商品
  // 注：实际场景时应该调用接口
  deleteGoodsService({ spuId, skuId }) {
    function deleteGoods(group) {
      for (const gindex in group) {
        const goods = group[gindex];
        if (goods.spuId === spuId && goods.skuId === skuId) {
          group.splice(gindex, 1);
          return gindex;
        }
      }
      return -1;
    }
    const { storeGoods, invalidGoodItems } = this.data.cartGroupData;
    for (const store of storeGoods) {
      for (const activity of store.promotionGoodsList) {
        if (deleteGoods(activity.goodsPromotionList) > -1) {
          return this.persistCartData();
        }
      }
      if (deleteGoods(store.shortageGoodsList) > -1) {
        return this.persistCartData();
      }
    }
    if (deleteGoods(invalidGoodItems) > -1) {
      return this.persistCartData();
    }
    return Promise.reject();
  },

  // 清空失效商品
  // 注：实际场景时应该调用接口
  clearInvalidGoodsService() {
    this.data.cartGroupData.invalidGoodItems = [];
    return this.persistCartData();
  },

  onGoodsSelect(e) {
    const {
      goods: { spuId, skuId },
      isSelected,
    } = e.detail;
    this.selectGoodsService({ spuId, skuId, isSelected }).then(() => this.refreshData());
  },

  onStoreSelect(e) {
    const {
      store: { storeId },
      isSelected,
    } = e.detail;
    this.selectStoreService({ storeId, isSelected }).then(() => this.refreshData());
  },

  onQuantityChange(e) {
    const {
      goods: { spuId, skuId },
      quantity,
    } = e.detail;
    const { currentGoods } = this.findGoods(spuId, skuId);
    const stockQuantity = currentGoods.stockQuantity > 0 ? currentGoods.stockQuantity : 0; // 避免后端返回的是-1
    // 加购数量超过库存数量
    if (quantity > stockQuantity && quantity > currentGoods.quantity) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '当前商品库存不足',
      });
      return;
    }
    this.changeQuantityService({ spuId, skuId, quantity }).then(() => this.refreshData());
  },

  onGoodsSpecsChange(e) {
    const { oldGoods, goods } = e.detail;
    this.replaceGoodsSpecsService({ oldGoods, goods })
      .then(() => {
        this.persistCartData();
        this.setData({ cartGroupData: { ...this.data.cartGroupData } });
      })
      .catch(() => {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '规格修改失败，请重试',
        });
      });
  },

  goGoodsDetail(e) {
    const { spuId, storeId } = e.detail.goods;
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}&storeId=${storeId}`);
  },

  goRecommendedGoodsDetail(e) {
    const { spuId } = e.currentTarget.dataset;
    if (spuId === undefined || spuId === null || spuId === '') return;

    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}`);
  },

  clearInvalidGoods() {
    // 实际场景时应该调用接口清空失效商品
    this.clearInvalidGoodsService().then(() => this.refreshData());
  },

  onGoodsAdded(goods) {
    const { cartGroupData } = this.data;
    if (!goods || !cartGroupData?.storeGoods?.length) return;

    const store = cartGroupData.storeGoods[0];
    const activity = store.promotionGoodsList.find((item) => Array.isArray(item.goodsPromotionList));
    if (!activity) return;

    const existingGoods = activity.goodsPromotionList.find(
      (item) => item.spuId === goods.spuId && item.skuId === goods.skuId,
    );
    if (existingGoods) {
      existingGoods.quantity = (Number(existingGoods.quantity) || 0) + (Number(goods.quantity) || 1);
    } else {
      activity.goodsPromotionList.push({ ...goods });
    }
    cartGroupData.totalAmount = String(
      (Number(cartGroupData.totalAmount) || 0) + (Number(goods.price) || 0) * (Number(goods.quantity) || 1),
    );
    cartGroupData.isNotEmpty = true;
    this.persistCartData();
    this.setData({ cartGroupData: { ...cartGroupData } });
    this.refreshData();
  },

  onGoodsDelete(e) {
    const {
      goods: { spuId, skuId },
    } = e.detail;
    this.deleteGoodsService({ spuId, skuId }).then(() => {
      Toast({ context: this, selector: '#t-toast', message: '商品删除成功' });
      this.refreshData();
    });
  },

  onSelectAll(event) {
    const { isAllSelected } = event?.detail ?? {};
    if (typeof isAllSelected !== 'boolean') return;
    const { cartGroupData } = this.data;
    let selectedGoodsCount = 0;
    let selectedGoodsAmount = 0;
    for (const store of cartGroupData.storeGoods) {
      store.isSelected = isAllSelected;
      for (const activity of store.promotionGoodsList) {
        for (const goods of activity.goodsPromotionList) {
          goods.isSelected = isAllSelected;
          if (isAllSelected) {
            const quantity = Number(goods.quantity) || 0;
            selectedGoodsCount += quantity;
            selectedGoodsAmount += quantity * (Number(goods.price) || 0);
          }
        }
      }
    }
    cartGroupData.isAllSelected = isAllSelected;
    cartGroupData.selectedGoodsCount = selectedGoodsCount;
    cartGroupData.totalAmount = String(selectedGoodsAmount);
    this.persistCartData();
    this.setData({ cartGroupData: { ...cartGroupData } });
  },

  onToSettle() {
    const goodsRequestList = [];
    this.data.cartGroupData.storeGoods.forEach((store) => {
      store.promotionGoodsList.forEach((promotion) => {
        promotion.goodsPromotionList.forEach((m) => {
          if (m.isSelected == 1) {
            goodsRequestList.push(m);
          }
        });
      });
    });
    wx.setStorageSync('order.goodsRequestList', JSON.stringify(goodsRequestList));
    wx.navigateTo({ url: '/pages/order/order-confirm/index?type=cart' });
  },
  onGotoHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
