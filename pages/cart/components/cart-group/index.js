import Toast from 'tdesign-miniprogram/toast/index';
import { fetchGood } from '../../../../services/good/fetchGood';

const shortageImg = 'https://tdesign.gtimg.com/miniprogram/template/retail/cart/shortage.png';

function skuStock(sku = {}) {
  const value = sku.stockQuantity ?? sku.stock ?? sku.stockInfo?.stockQuantity;
  const stockQuantity = Number(value);
  return Number.isFinite(stockQuantity) ? Math.max(0, stockQuantity) : 0;
}

function skuPrice(sku = {}, fallback = 0) {
  return sku.salePrice ?? sku.price ?? sku.priceInfo?.find((item) => item.priceType === 1)?.price ?? fallback;
}

Component({
  isSpecsTap: false, // 标记本次点击事件是否因为点击specs触发（由于底层goods-card组件没有catch specs点击事件，只能在此处加状态来避免点击specs时触发跳转商品详情）
  externalClasses: ['wr-class'],
  properties: {
    storeGoods: {
      type: Array,
      observer(storeGoods) {
        for (const store of storeGoods) {
          for (const activity of store.promotionGoodsList) {
            for (const goods of activity.goodsPromotionList) {
              goods.specs = goods.specInfo.map((item) => item.specValue); // 目前仅展示商品已选规格的值
            }
          }
          for (const goods of store.shortageGoodsList) {
            goods.specs = goods.specInfo.map((item) => item.specValue); // 目前仅展示商品已选规格的值
          }
        }

        this.setData({ _storeGoods: storeGoods });
      },
    },
    invalidGoodItems: {
      type: Array,
      observer(invalidGoodItems) {
        invalidGoodItems.forEach((goods) => {
          goods.specs = goods.specInfo.map((item) => item.specValue); // 目前仅展示商品已选规格的值
        });
        this.setData({ _invalidGoodItems: invalidGoodItems });
      },
    },
    thumbWidth: { type: null },
    thumbHeight: { type: null },
    themeColor: {
      type: String,
      value: '#F5CE2B',
    },
  },

  data: {
    shortageImg,
    currentGoods: {},
    specPopup: {
      show: false,
      title: '',
      price: '',
      thumb: '',
      specList: [],
      skuList: [],
      selectedSkuId: '',
    },
    isShowToggle: false,
    _storeGoods: [],
    _invalidGoodItems: [],
  },

  methods: {
    // 删除商品
    deleteGoods(e) {
      const { goods } = e.currentTarget.dataset;
      this.triggerEvent('delete', { goods });
    },

    // 长按删除需要二次确认
    confirmDeleteGoods(e) {
      const { goods } = e.currentTarget.dataset;
      this.triggerEvent('confirmdelete', { goods });
    },

    // 清空失效商品
    clearInvalidGoods() {
      this.triggerEvent('clearinvalidgoods');
    },

    // 选中商品
    selectGoods(e) {
      const { goods } = e.currentTarget.dataset;
      this.triggerEvent('selectgoods', {
        goods,
        isSelected: !goods.isSelected,
      });
    },

    changeQuantity(num, goods) {
      this.triggerEvent('changequantity', {
        goods,
        quantity: num,
      });
    },
    changeStepper(e) {
      const { value } = e.detail;
      const { goods } = e.currentTarget.dataset;
      let num = value;
      if (goods.stockKnown === true && value > goods.stockQuantity) {
        num = goods.stockQuantity;
      }
      this.changeQuantity(num, goods);
    },

    input(e) {
      const { value } = e.detail;
      const { goods } = e.currentTarget.dataset;
      const num = value;
      this.changeQuantity(num, goods);
    },

    // 选中门店
    selectStore(e) {
      const { storeIndex } = e.currentTarget.dataset;
      const store = this.data.storeGoods[storeIndex];
      const isSelected = !store.isSelected;
      if (store.storeStockShortage && isSelected) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '部分商品库存不足',
        });
        return;
      }
      this.triggerEvent('selectstore', {
        store,
        isSelected,
      });
    },

    // 展开/收起切换
    showToggle() {
      this.setData({
        isShowToggle: !this.data.isShowToggle,
      });
    },

    // 展示规格popup
    specsTap(e) {
      this.isSpecsTap = true;
      const { goods } = e.currentTarget.dataset;
      this.setData({ currentGoods: goods });
      fetchGood(goods.spuId)
        .then((details) => {
          const skuList = (details.skuList || []).map((sku) => ({
            ...sku,
            skuId: sku.skuId ?? sku._id,
            price: skuPrice(sku, details.minSalePrice),
            stockQuantity: skuStock(sku),
            stockKnown: sku.stockQuantity !== undefined || sku.stock !== undefined || sku.stockInfo?.stockQuantity !== undefined,
          }));
          let currentSku = skuList.find((sku) => String(sku.skuId) === String(goods.skuId));
          if (!currentSku && goods.specInfo?.length && details.specList?.length) {
            const fallbackSpecInfo = goods.specInfo
              .map((item) => {
                const group = details.specList.find((spec) => spec.title === item.specTitle);
                const value = group?.specValueList?.find((specValue) => specValue.specValue === item.specValue);
                if (!group || !value) return null;
                return {
                  specId: group.specId,
                  specTitle: group.title,
                  specValueId: value.specValueId,
                  specValue: value.specValue,
                };
              })
              .filter(Boolean);
            if (fallbackSpecInfo.length === details.specList.length) {
              currentSku = {
                skuId: goods.skuId,
                skuImage: goods.thumb,
                price: goods.price,
                stockQuantity: goods.stockQuantity || 0,
                stockKnown: goods.stockKnown === true,
                specInfo: fallbackSpecInfo,
              };
              skuList.unshift(currentSku);
            }
          }
          this.setData({
            specPopup: {
              show: true,
              title: details.title || goods.title,
              price: currentSku?.price || details.minSalePrice || goods.price,
              thumb: currentSku?.skuImage || details.primaryImage || goods.thumb,
              specList: details.specList || [],
              skuList,
              selectedSkuId: goods.skuId,
            },
          });
        })
        .catch(() => {
          this.isSpecsTap = false;
          Toast({
            context: this,
            selector: '#t-toast',
            message: '规格加载失败，请稍后重试',
          });
        });
    },

    hideSpecsPopup() {
      this.setData({
        'specPopup.show': false,
      });
      this.isSpecsTap = false;
    },

    confirmSpecs(e) {
      const { sku } = e.detail;
      const { currentGoods, specPopup } = this.data;
      if (!sku || !currentGoods?.spuId) return;

      const specInfo = (sku.specInfo || []).map((item) => {
        const group = specPopup.specList.find((spec) => String(spec.specId) === String(item.specId));
        const value = group?.specValueList?.find(
          (specValue) => String(specValue.specValueId) === String(item.specValueId),
        );
        return {
          specId: item.specId,
          specTitle: group?.title || item.specTitle || '',
          specValueId: item.specValueId,
          specValue: value?.specValue || item.specValue || '',
        };
      });
      const nextGoods = {
        ...currentGoods,
        skuId: sku.skuId,
        price: skuPrice(sku, currentGoods.price),
        thumb: sku.skuImage || currentGoods.thumb,
        primaryImage: sku.skuImage || currentGoods.primaryImage || currentGoods.thumb,
        stockQuantity: skuStock(sku),
        stockKnown: sku.stockQuantity !== undefined || sku.stock !== undefined || sku.stockInfo?.stockQuantity !== undefined,
        stockStatus: skuStock(sku) > 0,
        specInfo,
        specs: specInfo.map((item) => item.specValue),
      };
      this.triggerEvent('specschange', {
        oldGoods: currentGoods,
        goods: nextGoods,
      });
      this.setData({
        currentGoods: nextGoods,
        'specPopup.show': false,
      });
      this.isSpecsTap = false;
    },

    goGoodsDetail(e) {
      if (this.isSpecsTap) {
        this.isSpecsTap = false;
        return;
      }
      const { goods } = e.currentTarget.dataset;
      this.triggerEvent('goodsclick', { goods });
    }

  },
});
