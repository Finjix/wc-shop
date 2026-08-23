import Toast from 'tdesign-miniprogram/toast/index';
import { fetchSettleDetail } from '../../../services/order/orderConfirm';
import { getPendingGoodsRequestList } from '../../../services/order/orderConfirm';
import { fetchCartGroupData } from '../../../services/cart/cart';
import { fetchDeliveryAddress } from '../../../services/address/fetchAddress';
import { commitPay } from './pay';
import { getAddressPromise } from '../../../services/address/list';

function getSelectedGoodsFromCart(cartGroupData) {
  const result = [];
  (cartGroupData?.storeGoods || []).forEach((store) => {
    (store.promotionGoodsList || []).forEach((promotion) => {
      (promotion.goodsPromotionList || []).forEach((goods) => {
        if (Boolean(goods.isSelected)) result.push(goods);
      });
    });
  });
  return result;
}

Page({
  data: {
    loading: false,
    settleDetailData: {
      storeGoodsList: [], //正常下单商品列表
      outOfStockGoodsList: [], //库存不足商品
      abnormalDeliveryGoodsList: [], // 不能正常配送商品
      inValidGoodsList: [], // 失效或者库存不足
    }, // 获取结算页详情 data
    orderCardList: [], // 仅用于商品卡片展示
    userAddressReq: null,
    popupShow: false, // 不在配送范围 失效 库存不足 商品展示弹框
    storeInfoList: [],
    userAddress: null,
  },

  payLock: false,
  onLoad(options) {
    this.setData({
      loading: true,
    });
    this.handleOptionsParams(options);
  },
  init() {
    this.setData({
      loading: true,
    });
    const { goodsRequestList } = this;
    this.handleOptionsParams({ goodsRequestList });
  },
  // 处理不同情况下跳转到结算页时需要的参数
  handleOptionsParams(options) {
    let { goodsRequestList } = this; // 商品列表
    let { userAddressReq } = this; // 收货地址

    // 首次进入结算页时自动使用默认收货地址，用户刚选择的地址优先。
    if (!userAddressReq && !options.userAddressReq && !options.skipDefaultAddress) {
      fetchDeliveryAddress(0)
        .then((defaultAddress) => {
          const userAddress =
            defaultAddress && typeof defaultAddress === 'object' ? { ...defaultAddress, checked: true } : null;
          this.handleOptionsParams({ ...options, userAddressReq: userAddress, skipDefaultAddress: true });
        })
        .catch(() => {
          this.handleOptionsParams({ ...options, skipDefaultAddress: true });
        });
      return;
    }

    const storeInfoList = []; // 门店列表
    // 如果是从地址选择页面返回，则使用地址显选择页面新选择的地址去获取结算数据
    if (options.userAddressReq) {
      userAddressReq = options.userAddressReq;
    }
    if (Array.isArray(options.goodsRequestList)) goodsRequestList = options.goodsRequestList;
    if (options.type === 'cart') {
      goodsRequestList = getPendingGoodsRequestList();
      if (!Array.isArray(goodsRequestList) || goodsRequestList.length === 0) {
        fetchCartGroupData()
          .then((res) => this.handleOptionsParams({
            ...options,
            type: undefined,
            goodsRequestList: getSelectedGoodsFromCart(res.data),
            skipDefaultAddress: true,
          }))
          .catch(() => this.handleError('购物车读取失败，请稍后重试'));
        return;
      }
    } else if (typeof options.goodsRequestList === 'string') {
      try {
        goodsRequestList = JSON.parse(options.goodsRequestList);
      } catch (error) {
        goodsRequestList = null;
      }
    }
    if (!Array.isArray(goodsRequestList) || goodsRequestList.length === 0) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '没有可结算的商品',
        duration: 1500,
        icon: '',
      });
      this.setData({ loading: false });
      setTimeout(() => wx.navigateBack(), 500);
      return;
    }
    //获取结算页请求数据列表
    const storeMap = {};
    goodsRequestList.forEach((goods) => {
      if (!storeMap[goods.storeId]) {
        storeInfoList.push({
          storeId: goods.storeId,
          storeName: goods.storeName,
        });
        storeMap[goods.storeId] = true;
      }
    });
    this.goodsRequestList = goodsRequestList;
    const params = {
      goodsRequestList,
      storeInfoList,
      userAddressReq,
    };
    fetchSettleDetail(params).then(
      (res) => {
        this.setData({
          loading: false,
        });
        this.initData(res.data);
      },
      () => {
        //接口异常处理
        this.handleError();
      },
    );
  },
  initData(resData) {
    // 转换商品卡片显示数据
    const data = this.handleResToGoodsCard(resData);
    this.userAddressReq = resData.userAddress;

    if (resData.userAddress) {
      this.setData({ userAddress: resData.userAddress });
    }
    this.setData({ settleDetailData: data });
    this.isInvalidOrder(data);
  },

  isInvalidOrder(data) {
    // 失效、不在配送范围的商品提示弹窗
    if (
      (data.abnormalDeliveryGoodsList && data.abnormalDeliveryGoodsList.length > 0) ||
      (data.inValidGoodsList && data.inValidGoodsList.length > 0)
    ) {
      this.setData({ popupShow: true });
      return true;
    }
    this.setData({ popupShow: false });
    if (data.settleType === 0) {
      return true;
    }
    return false;
  },

  handleError(message = '结算异常, 请稍后重试') {
    Toast({
      context: this,
      selector: '#t-toast',
      message,
      duration: 2000,
      icon: '',
    });

    setTimeout(() => {
      wx.navigateBack();
    }, 1500);
    this.setData({
      loading: false,
    });
  },
  getRequestGoodsList(storeGoodsList) {
    const filterStoreGoodsList = [];
    storeGoodsList &&
      storeGoodsList.forEach((store) => {
        const { storeName } = store;
        store.skuDetailVos &&
          store.skuDetailVos.forEach((goods) => {
            const data = goods;
            data.storeName = storeName;
            filterStoreGoodsList.push(data);
          });
      });
    return filterStoreGoodsList;
  },
  handleResToGoodsCard(data) {
    // 转换数据 符合 goods-card展示
    const orderCardList = []; // 订单卡片列表
    const storeInfoList = [];

    data.storeGoodsList &&
      data.storeGoodsList.forEach((ele) => {
        const orderCard = {
          id: ele.storeId,
          storeName: ele.storeName,
          goodsList: [],
        }; // 订单卡片
        ele.skuDetailVos.forEach((item, index) => {
          orderCard.goodsList.push({
            id: index,
            thumb: item.image,
            title: item.goodsName,
            specs: item.skuSpecLst.map((s) => s.specValue), // 规格列表 string[]
            price: item.tagPrice || item.settlePrice || '0', // 优先取限时活动价
            num: item.quantity,
          });
        });

        storeInfoList.push({
          storeId: ele.storeId,
          storeName: ele.storeName,
        });
        orderCardList.push(orderCard);
      });

    this.setData({ orderCardList, storeInfoList });
    return data;
  },
  onGotoAddress() {
    /** 获取一个Promise */
    getAddressPromise()
      .then((address) => {
        this.handleOptionsParams({
          userAddressReq: { ...address, checked: true },
        });
      })
      .catch(() => {});

    const { userAddressReq } = this; // 收货地址

    let id = '';

    if (userAddressReq?.id) {
      id = `&id=${userAddressReq.id}`;
    }

    wx.navigateTo({
      url: `/pages/user/address/list/index?selectMode=1&isOrderSure=1${id}`,
    });
  },
  onSureCommit() {
    // 商品库存不足继续结算
    const { settleDetailData } = this.data;
    const { outOfStockGoodsList, storeGoodsList, inValidGoodsList } = settleDetailData;
    if (
      (outOfStockGoodsList && outOfStockGoodsList.length > 0) ||
      (inValidGoodsList && inValidGoodsList.length > 0 && storeGoodsList && storeGoodsList.length > 0)
    ) {
      // 合并正常商品 和 库存 不足商品继续支付
      // 过滤不必要的参数
      const filterOutGoodsList = [];
      outOfStockGoodsList &&
        outOfStockGoodsList.forEach((outOfStockGoods) => {
          const { storeName } = outOfStockGoods;
          outOfStockGoods.unSettlementGoods.forEach((ele) => {
            const data = ele;
            data.quantity = ele.reminderStock;
            data.storeName = storeName;
            filterOutGoodsList.push(data);
          });
        });
      const filterStoreGoodsList = this.getRequestGoodsList(storeGoodsList);
      const goodsRequestList = filterOutGoodsList.concat(filterStoreGoodsList);
      this.handleOptionsParams({ goodsRequestList });
    }
  },
  // 提交订单
  submitOrder() {
    const { settleDetailData, userAddressReq, storeInfoList } = this.data;
    const { goodsRequestList } = this;
    const address = settleDetailData.userAddress || userAddressReq;

    if (!Array.isArray(goodsRequestList) || goodsRequestList.length === 0) {
      Toast({ context: this, selector: '#t-toast', message: '购物车为空，请返回购物车重新选择' });
      return;
    }
    if (!address) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请添加收货地址',
        duration: 2000,
        icon: 'help-circle',
      });

      return;
    }
    if (this.payLock || !settleDetailData.settleType) {
      return;
    }
    this.payLock = true;
    this.createRequestId = this.createRequestId || `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const params = {
      userAddressReq: address,
      goodsRequestList: goodsRequestList,
      userName: address.name,
      totalAmount: settleDetailData.totalPayAmount,
      storeInfoList,
      requestKey: this.createRequestId,
    };
    commitPay(params).then(
      (res) => {
        this.payLock = false;
        const { data } = res;
        this.createRequestId = null;
        Toast({ context: this, selector: '#t-toast', message: '订单已创建，当前为待支付状态', duration: 1600, icon: 'check-circle' });
        setTimeout(() => {
          if (data?.orderNo) wx.redirectTo({ url: `/pages/order/order-detail/index?orderNo=${encodeURIComponent(data.orderNo)}` });
          else wx.redirectTo({ url: '/pages/order/order-list/index' });
        }, 600);
      },
      (err) => {
        this.payLock = false;
        const code = String(err?.code || '').toUpperCase();
        if (['CONTAINS_INSUFFICIENT_GOODS', 'STOCK_INSUFFICIENT', 'OUT_OF_STOCK', 'TOTAL_AMOUNT_DIFFERENT'].includes(code)) {
          Toast({
            context: this,
            selector: '#t-toast',
            message: err.msg || '商品库存或金额已变化，请重新确认',
            duration: 2000,
            icon: '',
          });
          this.init();
        } else if (['ADDRESS_REQUIRED', 'ADDRESS_MISSING'].includes(code)) {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '请先添加收货地址',
            duration: 2000,
            icon: 'help-circle',
          });
        } else if (['EMPTY_CART', 'CART_EMPTY'].includes(code)) {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '购物车为空，请返回购物车重新选择',
            duration: 2000,
            icon: '',
          });
          setTimeout(() => wx.navigateBack(), 1000);
        } else if (['DUPLICATE_ORDER', 'DUPLICATE_SUBMIT', 'ORDER_DUPLICATE'].includes(code)) {
          Toast({ context: this, selector: '#t-toast', message: '订单已提交，请勿重复操作', duration: 1800, icon: '' });
          setTimeout(() => wx.redirectTo({ url: '/pages/order/order-list/index' }), 600);
        } else {
          Toast({
            context: this,
            selector: '#t-toast',
            message: err.msg || '订单提交失败，请稍后重试',
            duration: 2000,
            icon: '',
          });
        }
      },
    );
  },

  onNoGoodsChange(e) {
    if (e?.detail?.action === 'address') {
      this.onGotoAddress();
    } else {
      this.onSureCommit();
    }
  },

  onPopupChange() {
    this.setData({
      popupShow: !this.data.popupShow,
    });
  },
});
