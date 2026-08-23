import Toast from 'tdesign-miniprogram/toast/index';
import {
  clearInvalidCartItems,
  deleteCartItem,
  fetchCartGroupData,
  replaceCartItemSku,
  updateAllCartSelection,
  updateCartItemQuantity,
  updateCartItemSelection,
  updateCartStoreSelection,
} from '../../services/cart/cart';
import { setPendingGoodsRequestList } from '../../services/order/orderConfirm';
import { fetchGoodsList } from '../../services/good/fetchGoods';
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

Page({
  data: {
    cartGroupData: null,
    statusBarHeight: 0,
    navBarHeight: 44,
    customNavHeight: 44,
    recommendedLeft: [],
    recommendedRight: [],
    recommendedOffset: 0,
    recommendedLoading: false,
    recommendedHasMore: true,
    deleteDialogVisible: false,
    pendingDeleteGoods: null,
    cartLoadError: false,
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
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const navBarHeight = menuButtonInfo.height
      ? menuButtonInfo.height + (menuButtonInfo.top - statusBarHeight) * 2
      : 44;

    this.setData({
      statusBarHeight,
      navBarHeight,
      customNavHeight: statusBarHeight + navBarHeight,
    });
    this.refreshData();
  },

  onReachBottom() {
    this.loadMoreRecommendedGoods();
  },

  refreshData(forceRefresh = false) {
    return this.getCartGroupData(forceRefresh).then((res) => {
      let isEmpty = true;
      let hasSelectableGoods = false;
      let isAllSelected = true;
      let selectedGoodsCount = 0;
      let selectedGoodsAmount = 0;
      const cartGroupData = res?.data;
      if (!cartGroupData || typeof cartGroupData !== 'object') {
        throw new Error('购物车数据格式错误');
      }
      cartGroupData.storeGoods = Array.isArray(cartGroupData.storeGoods) ? cartGroupData.storeGoods : [];
      cartGroupData.invalidGoodItems = Array.isArray(cartGroupData.invalidGoodItems)
        ? cartGroupData.invalidGoodItems
        : [];
      // 一些组件中需要的字段可能接口并没有返回，或者返回的数据结构与预期不一致，需要在此先对数据做一些处理
      // 统计门店下加购的商品是否全选、是否存在缺货/无货
      for (const store of cartGroupData.storeGoods) {
        store.isSelected = true; // 该门店已加购商品是否全选
        store.storeStockShortage = false; // 该门店已加购商品是否存在库存不足
        if (!store.shortageGoodsList) {
          store.shortageGoodsList = []; // 该门店已加购商品如果库存为0需单独分组
        }
        store.promotionGoodsList = Array.isArray(store.promotionGoodsList) ? store.promotionGoodsList : [];
        for (const activity of store.promotionGoodsList) {
          activity.goodsPromotionList = Array.isArray(activity.goodsPromotionList)
            ? activity.goodsPromotionList
            : [];
          activity.goodsPromotionList = activity.goodsPromotionList.filter((goods) => {
            goods.originPrice = undefined;

            // 统计是否有加购数大于库存数的商品
            if (goods.stockKnown === true && goods.quantity > goods.stockQuantity) {
              store.storeStockShortage = true;
            }
            // 统计是否全选
            if (!goods.isSelected) {
              store.isSelected = false;
            }
            // 库存为0（无货）的商品单独分组
            if (goods.stockKnown !== true || goods.stockQuantity > 0) {
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
      this.setData({ cartGroupData, cartLoadError: false });
      if (shouldRefreshRecommendations) {
        this.loadRecommendedGoods(cartGroupData);
      }
    }).catch((error) => {
      console.error('load cart error:', error);
      this.setData({ cartLoadError: true });
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
    const { storeGoods = [] } = this.data.cartGroupData || {};
    for (const store of storeGoods) {
      for (const activity of store.promotionGoodsList || []) {
        for (const goods of activity.goodsPromotionList || []) {
          if (String(goods.spuId) === String(spuId) && String(goods.skuId) === String(skuId)) {
            currentStore = store;
            currentActivity = activity;
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

  getCartGroupData() {
    return fetchCartGroupData();
  },

  selectGoodsService({ spuId, skuId, isSelected }) {
    const { currentGoods } = this.findGoods(spuId, skuId);
    if (!currentGoods) return Promise.reject(new Error('购物车商品不存在'));
    return updateCartItemSelection({ spuId, skuId, isSelected });
  },

  selectStoreService({ storeId, isSelected }) {
    const currentStore = (this.data.cartGroupData?.storeGoods || []).find(
      (s) => String(s.storeId) === String(storeId),
    );
    if (!currentStore) return Promise.reject(new Error('购物车门店不存在'));
    return updateCartStoreSelection({ storeId, isSelected });
  },

  changeQuantityService({ spuId, skuId, quantity }) {
    const { currentGoods } = this.findGoods(spuId, skuId);
    if (!currentGoods) return Promise.reject(new Error('购物车商品不存在'));
    return updateCartItemQuantity({ spuId, skuId, quantity });
  },

  replaceGoodsSpecsService({ oldGoods, goods }) {
    return replaceCartItemSku({ oldGoods, goods });
  },

  deleteGoodsService({ spuId, skuId }) {
    return deleteCartItem({ spuId, skuId });
  },

  clearInvalidGoodsService() {
    return clearInvalidCartItems();
  },

  onGoodsSelect(e) {
    const {
      goods: { spuId, skuId },
      isSelected,
    } = e.detail;
    this.selectGoodsService({ spuId, skuId, isSelected })
      .then(() => this.refreshData(true))
      .catch(() => Toast({ context: this, selector: '#t-toast', message: '商品选择失败，请重试' }));
  },

  onStoreSelect(e) {
    const {
      store: { storeId },
      isSelected,
    } = e.detail;
    this.selectStoreService({ storeId, isSelected })
      .then(() => this.refreshData(true))
      .catch(() => Toast({ context: this, selector: '#t-toast', message: '门店选择失败，请重试' }));
  },

  onQuantityChange(e) {
    let {
      goods: { spuId, skuId },
      quantity,
    } = e.detail;
    const { currentGoods } = this.findGoods(spuId, skuId);
    if (!currentGoods) {
      Toast({ context: this, selector: '#t-toast', message: '购物车商品不存在，请刷新重试' });
      return;
    }
    quantity = Math.max(1, Number(quantity) || 1);
    const stockQuantity = currentGoods.stockKnown === true && currentGoods.stockQuantity > 0
      ? currentGoods.stockQuantity
      : 0;
    // 加购数量超过库存数量
    if (currentGoods.stockKnown === true && quantity > stockQuantity && quantity > currentGoods.quantity) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '当前商品库存不足',
      });
      return;
    }
    this.changeQuantityService({ spuId, skuId, quantity })
      .then(() => this.refreshData(true))
      .catch(() => Toast({ context: this, selector: '#t-toast', message: '数量修改失败，请重试' }));
  },

  onGoodsSpecsChange(e) {
    const { oldGoods, goods } = e.detail;
    this.replaceGoodsSpecsService({ oldGoods, goods })
      .then(() => this.refreshData(true))
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
    this.clearInvalidGoodsService()
      .then(() => this.refreshData(true))
      .catch(() => Toast({ context: this, selector: '#t-toast', message: '清空失效商品失败，请重试' }));
  },

  onGoodsDelete(e) {
    const {
      goods: { spuId, skuId },
    } = e.detail;
    this.deleteGoodsService({ spuId, skuId }).then(() => {
      Toast({ context: this, selector: '#t-toast', message: '商品删除成功' });
      this.refreshData(true);
    }).catch(() => Toast({ context: this, selector: '#t-toast', message: '商品删除失败，请重试' }));
  },

  onConfirmDeleteRequest(e) {
    this.setData({
      deleteDialogVisible: true,
      pendingDeleteGoods: e.detail.goods,
    });
  },

  confirmDeleteGoods() {
    const { pendingDeleteGoods } = this.data;
    this.setData({
      deleteDialogVisible: false,
      pendingDeleteGoods: null,
    });
    if (!pendingDeleteGoods) return;

    this.onGoodsDelete({ detail: { goods: pendingDeleteGoods } });
  },

  closeDeleteDialog() {
    this.setData({
      deleteDialogVisible: false,
      pendingDeleteGoods: null,
    });
  },

  onSelectAll(event) {
    const { isAllSelected } = event?.detail ?? {};
    if (typeof isAllSelected !== 'boolean') return;
    updateAllCartSelection({ isSelected: isAllSelected })
      .then(() => this.refreshData(true))
      .catch(() => Toast({ context: this, selector: '#t-toast', message: '全选操作失败，请重试' }));
  },

  onToSettle() {
    const goodsRequestList = [];
    this.data.cartGroupData.storeGoods.forEach((store) => {
      store.promotionGoodsList.forEach((promotion) => {
        promotion.goodsPromotionList.forEach((m) => {
          if (Boolean(m.isSelected)) {
            goodsRequestList.push(m);
          }
        });
      });
    });
    if (!goodsRequestList.length) {
      Toast({ context: this, selector: '#t-toast', message: '请先选择要结算的商品' });
      return;
    }
    setPendingGoodsRequestList(goodsRequestList);
    wx.navigateTo({ url: '/pages/order/order-confirm/index?type=cart' });
  },
  onGotoHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },
  onRetryCart() {
    this.refreshData(true);
  },
});
