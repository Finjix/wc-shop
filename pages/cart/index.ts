// @ts-nocheck
import { isPageNavigationEnabled } from '../../config/navigation';

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
import { navigateToGoodsDetail } from '../../utils/goods-detail-navigation';

Page({
  data: {
    cartGroupData: null,
    statusBarHeight: 0,
    navBarHeight: 44,
    customNavHeight: 44,
    specPopup: {
      show: false,
      title: '',
      price: '',
      thumb: '',
      specList: [],
      skuList: [],
      selectedSkuId: '',
    },
    deleteDialogVisible: false,
    pendingDeleteGoods: null,
    cartLoadError: false,
    themeColor: '#695941',
  },

  // 调用自定义tabbar的init函数，使页面与tabbar激活状态保持一致
  onShow() {
    this.getTabBar().init();
    if (this.data.cartGroupData) {
      this.refreshData(true);
    }
  },

  onLoad() {
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

  refreshData(forceRefresh = false) {
    const refreshId = (this.cartRefreshId || 0) + 1;
    this.cartRefreshId = refreshId;
    return this.getCartGroupData(forceRefresh).then((res) => {
      if (refreshId !== this.cartRefreshId) return;
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
      cartGroupData.isNotEmpty = !isEmpty;
      cartGroupData.isAllSelected = hasSelectableGoods && isAllSelected;
      cartGroupData.selectedGoodsCount = selectedGoodsCount;
      cartGroupData.totalAmount = String(selectedGoodsAmount);
      this.setData({ cartGroupData, cartLoadError: false });
    }).catch((error) => {
      if (refreshId !== this.cartRefreshId) return;
      console.error('load cart error:', error);
      this.setData({ cartLoadError: true });
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
    quantity = Math.min(99, Math.max(1, Number(quantity) || 1));
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

  onSpecsOpen(e) {
    this.setData({
      specPopup: e.detail.specPopup,
    });
  },

  onSpecsClose() {
    this.setData({
      'specPopup.show': false,
    });
    this.selectComponent('#cartGroup')?.hideSpecsPopup();
  },

  onSpecsConfirm(e) {
    this.selectComponent('#cartGroup')?.confirmSpecs(e);
    this.setData({
      'specPopup.show': false,
    });
  },

  goGoodsDetail(e) {
    const { spuId, storeId } = e.detail.goods;
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${spuId}&storeId=${storeId}`);
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
    if (!isPageNavigationEnabled('/pages/order/order-confirm/index')) return;
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
  onRetryCart() {
    this.refreshData(true);
  },
});
// @ts-nocheck
