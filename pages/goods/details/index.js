import Toast from 'tdesign-miniprogram/toast/index';
import { fetchGood } from '../../../services/good/fetchGood';
import { addGoodsToCart } from '../../../services/cart/cart';
import { getGoodsDetailsCommentsCount } from '../../../services/good/fetchGoodsDetailsComments';
import { getCloudErrorMessage } from '../../../utils/cloud';

import { cdnBase } from '../../../config/index';

const imgPrefix = `${cdnBase}/`;

const obj2Params = (obj = {}, encode = false) => {
  const result = [];
  Object.keys(obj).forEach((key) => result.push(`${key}=${encode ? encodeURIComponent(obj[key]) : obj[key]}`));

  return result.join('&');
};

Page({
  data: {
    commentsStatistics: {
      badCount: 0,
      commentCount: 0,
      goodCount: 0,
      goodRate: 0,
      hasImageCount: 0,
      middleCount: 0,
    },
    details: { images: [], desc: [], specList: [], skuList: [] },
    detailLoading: false,
    detailLoaded: false,
    goodsTabArray: [
      {
        name: '商品',
        value: '', // 空字符串代表置顶
      },
      {
        name: '详情',
        value: 'goods-page',
      },
    ],
    storeLogo: `${imgPrefix}common/store-logo.png`,
    storeName: '云mall标准版旗舰店',
    jumpArray: [
      {
        title: '客服',
        iconName: 'service',
        isContact: true,
      },
      {
        title: '购物车',
        url: '/pages/cart/index',
        iconName: 'cart',
      },
    ],
    isStock: true,
    soldout: false,
    buttonType: 1,
    buyNum: 1,
    selectedAttrStr: '',
    skuArray: [],
    primaryImage: '',
    specImg: '',
    isSpuSelectPopupShow: false,
    isAllSelectedSku: false,
    buyType: 0,
    outOperateStatus: false, // 是否外层加入购物车
    operateType: 0,
    selectSkuSellsPrice: 0,
    maxLinePrice: 0,
    minSalePrice: 0,
    maxSalePrice: 0,
    spuId: '',
    current: 0,
    autoplay: true,
    duration: 500,
    interval: 5000,
    soldNum: 0, // 已售数量
  },

  handlePopupHide() {
    this.setData({
      isSpuSelectPopupShow: false,
    });
  },

  showSkuSelectPopup(type) {
    this.setData({
      buyType: type || 0,
      outOperateStatus: type >= 1,
      isSpuSelectPopupShow: true,
    });
  },

  buyItNow() {
    this.showSkuSelectPopup(1);
  },

  toAddCart() {
    this.showSkuSelectPopup(2);
  },

  toNav(e) {
    const { url } = e.detail;
    wx.switchTab({
      url: url,
    });
  },

  showCurImg(e) {
    const { index } = e.detail;
    const { images } = this.data.details;
    wx.previewImage({
      current: images[index],
      urls: images, // 需要预览的图片http链接列表
    });
  },

  onPageScroll({ scrollTop }) {
    const goodsTab = this.selectComponent('#goodsTab');
    goodsTab && goodsTab.onScroll(scrollTop);
  },

  chooseSpecItem(e) {
    const { specList } = this.data.details;
    const { selectedSku, isAllSelectedSku } = e.detail;
    if (!isAllSelectedSku) {
      this.setData({
        selectSkuSellsPrice: 0,
      });
    }
    this.setData({
      isAllSelectedSku,
    });
    this.getSkuItem(specList, selectedSku);
  },

  getSkuItem(specList, selectedSku) {
    const { skuArray, primaryImage } = this.data;
    const selectedSkuValues = this.getSelectedSkuValues(specList, selectedSku);
    let selectedAttrStr = ` 件  `;
    selectedSkuValues.forEach((item) => {
      selectedAttrStr += `，${item.specValue}  `;
    });
    // eslint-disable-next-line array-callback-return
    const skuItem = skuArray.find((item) => {
      const specInfo = item.specInfo || [];
      return (
        specInfo.length === Object.keys(selectedSku).length &&
        specInfo.every((subItem) => selectedSku[subItem.specId] && selectedSku[subItem.specId] === subItem.specValueId)
      );
    });
    this.selectSpecsName(selectedSkuValues.length > 0 ? selectedAttrStr : '');
    if (skuItem) {
      this.setData({
        selectItem: skuItem,
        selectSkuSellsPrice: skuItem.price || 0,
      });
    } else {
      this.setData({
        selectItem: null,
        selectSkuSellsPrice: 0,
      });
    }
    this.setData({
      specImg: skuItem && skuItem.skuImage ? skuItem.skuImage : primaryImage,
    });
  },

  // 获取已选择的sku名称
  getSelectedSkuValues(skuTree, selectedSku) {
    const normalizedTree = this.normalizeSkuTree(skuTree);
    return Object.keys(selectedSku).reduce((selectedValues, skuKeyStr) => {
      const skuValues = normalizedTree[skuKeyStr];
      const skuValueId = selectedSku[skuKeyStr];
      if (skuValueId !== '') {
        const skuValue = skuValues.filter((value) => {
          return value.specValueId === skuValueId;
        })[0];
        skuValue && selectedValues.push(skuValue);
      }
      return selectedValues;
    }, []);
  },

  normalizeSkuTree(skuTree) {
    const normalizedTree = {};
    skuTree.forEach((treeItem) => {
      normalizedTree[treeItem.specId] = treeItem.specValueList;
    });
    return normalizedTree;
  },

  selectSpecsName(selectSpecsName) {
    if (selectSpecsName) {
      this.setData({
        selectedAttrStr: selectSpecsName,
      });
    } else {
      this.setData({
        selectedAttrStr: '',
      });
    }
  },

  addCart() {
    const { isAllSelectedSku } = this.data;
    if (!isAllSelectedSku) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请选择规格',
        icon: '',
        duration: 1000,
      });
      return;
    }

    const goods = this.buildCartGoods();
    if (!goods) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请选择规格',
        icon: '',
        duration: 1000,
      });
      return;
    }
    if (goods.quantity > goods.stockQuantity || !goods.stockStatus) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '当前商品库存不足',
        icon: '',
        duration: 1000,
      });
      return;
    }

    addGoodsToCart(goods)
      .then(() => {
        const currentPages = getCurrentPages();
        const cartPage = currentPages.find((page) => page.route === 'pages/cart/index');
        if (cartPage && typeof cartPage.refreshData === 'function') {
          // 服务层已经持久化了 Mock 购物车，这里只刷新页面，避免同一商品被追加两次。
          cartPage.refreshData(true);
        }
        this.setData(
          {
            isSpuSelectPopupShow: false,
          },
          () => {
            Toast({
              context: this,
              selector: '#t-toast',
              message: '已加入购物车',
              icon: '',
              duration: 1000,
            });
          },
        );
      })
      .catch(() => {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '加入购物车失败，请重试',
          icon: '',
          duration: 1000,
        });
      });
  },

  buildCartGoods() {
    const { details, selectItem, buyNum, primaryImage } = this.data;
    const sku = Array.isArray(selectItem) ? selectItem[0] : selectItem;
    if (!sku || !sku.skuId) return null;

    const salePrice = sku.price || (sku.priceInfo || []).find((item) => item.priceType === 1)?.price;
    const linePrice = (sku.priceInfo || []).find((item) => item.priceType === 2)?.price || '0';
    const stockQuantity = Math.max(0, Number(sku.quantity || sku.stockInfo?.stockQuantity || 0));
    const specInfo = (sku.specInfo || []).map((item) => {
      const spec = (details.specList || []).find((specItem) => specItem.specId === item.specId);
      const value = (spec?.specValueList || []).find((valueItem) => valueItem.specValueId === item.specValueId);
      return {
        specTitle: item.specTitle || spec?.title || '',
        specValue: item.specValue || value?.specValue || '',
      };
    });

    return {
      uid: `${details.spuId}-${sku.skuId}`,
      saasId: details.saasId || '88888888',
      storeId: details.storeId || '1000',
      spuId: details.spuId || this.data.spuId,
      skuId: sku.skuId,
      isSelected: 1,
      thumb: sku.skuImage || details.primaryImage || primaryImage,
      title: details.title,
      primaryImage: details.primaryImage || primaryImage,
      quantity: Number(buyNum) || 1,
      stockStatus: stockQuantity > 0,
      stockQuantity,
      price: String(salePrice || details.minSalePrice || 0),
      originPrice: String(linePrice),
      tagPrice: null,
      titlePrefixTags: null,
      roomId: null,
      specInfo,
      available: details.available,
      putOnSale: details.isPutOnSale,
      etitle: details.etitle || null,
    };
  },

  gotoBuy(type) {
    const { isAllSelectedSku } = this.data;
    if (!isAllSelectedSku) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请选择规格',
        icon: '',
        duration: 1000,
      });
      return;
    }
    const goods = this.buildCartGoods();
    if (!goods) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请选择规格',
        icon: '',
        duration: 1000,
      });
      return;
    }
    if (goods.quantity > goods.stockQuantity || !goods.stockStatus) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '当前商品库存不足',
        icon: '',
        duration: 1000,
      });
      return;
    }
    this.handlePopupHide();
    const query = {
      ...goods,
      goodsName: goods.title,
    };
    let urlQueryStr = obj2Params({
      goodsRequestList: JSON.stringify([query]),
    }, true);
    urlQueryStr = urlQueryStr ? `?${urlQueryStr}` : '';
    const path = `/pages/order/order-confirm/index${urlQueryStr}`;
    wx.navigateTo({
      url: path,
    });
  },

  specsConfirm() {
    const { buyType } = this.data;
    if (buyType === 1) {
      this.gotoBuy();
    } else {
      this.addCart();
    }
  },

  changeNum(e) {
    this.setData({
      buyNum: e.detail.buyNum,
    });
  },

  getDetail(spuId) {
    this.setData({ detailLoading: true, detailLoaded: false });
    fetchGood(spuId).then((details) => {
      const skuArray = [];
      const {
        skuList = [],
        primaryImage,
        isPutOnSale,
        minSalePrice,
        maxSalePrice,
        maxLinePrice,
        soldNum,
      } = details;
      skuList.forEach((item) => {
        const salePrice = (item.priceInfo || []).find((price) => price.priceType === 1);
        skuArray.push({
          skuId: item.skuId,
          quantity: Math.max(0, Number(item.stockInfo ? item.stockInfo.stockQuantity : 0)),
          price: salePrice ? salePrice.price : minSalePrice,
          skuImage: item.skuImage,
          specInfo: item.specInfo,
        });
      });
      this.setData({
        details,
        isStock: details.spuStockQuantity > 0,
        maxSalePrice: maxSalePrice ? parseInt(maxSalePrice) : 0,
        maxLinePrice: maxLinePrice ? parseInt(maxLinePrice) : 0,
        minSalePrice: minSalePrice ? parseInt(minSalePrice) : 0,
        skuArray: skuArray,
        primaryImage,
        soldout: isPutOnSale === 0,
        soldNum,
        detailLoading: false,
        detailLoaded: true,
      });
    }).catch((error) => {
      this.setData({ detailLoading: false, detailLoaded: true });
      Toast({
        context: this,
        selector: '#t-toast',
        message: getCloudErrorMessage(error, '商品详情加载失败，请稍后重试'),
        icon: '',
      });
    });
  },

  onShareAppMessage() {
    // 自定义的返回信息
    const { selectedAttrStr } = this.data;
    let shareSubTitle = '';
    if (selectedAttrStr.indexOf('件') > -1) {
      const count = selectedAttrStr.indexOf('件');
      shareSubTitle = selectedAttrStr.slice(count + 1, selectedAttrStr.length);
    }
    const customInfo = {
      imageUrl: this.data.details.primaryImage,
      title: this.data.details.title + shareSubTitle,
      path: `/pages/goods/details/index?spuId=${this.data.spuId}`,
    };
    return customInfo;
  },

  /** 获取评价统计 */
  async getCommentsStatistics() {
    try {
      const code = 'Success';
      const data = await getGoodsDetailsCommentsCount(this.data.spuId);
      if (code.toUpperCase() === 'SUCCESS') {
        const { badCount, commentCount, goodCount, goodRate, hasImageCount, middleCount } = data;
        const nextState = {
          commentsStatistics: {
            badCount: parseInt(`${badCount}`),
            commentCount: parseInt(`${commentCount}`),
            goodCount: parseInt(`${goodCount}`),
            /** 后端返回百分比后数据但没有限制位数 */
            goodRate: Math.floor(goodRate * 10) / 10,
            hasImageCount: parseInt(`${hasImageCount}`),
            middleCount: parseInt(`${middleCount}`),
          },
        };
        this.setData(nextState);
      }
    } catch (error) {
      console.error('comments statiistics error:', error);
    }
  },

  /** 跳转到评价列表 */
  navToCommentsListPage() {
    wx.navigateTo({
      url: `/pages/goods/comments/index?spuId=${this.data.spuId}`,
    });
  },

  onLoad(query) {
    const { spuId } = query;
    if (spuId === undefined || spuId === null || spuId === '') {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '商品信息不存在',
        icon: '',
      });
      return;
    }
    this.setData({
      spuId: spuId,
    });
    this.getDetail(spuId);
    this.getCommentsStatistics(spuId);
  },
});
