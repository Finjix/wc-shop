// @ts-nocheck

/* eslint-disable no-param-reassign */
/* eslint-disable no-nested-ternary */
import Toast from '../../../../components/tdesign/toast/index';

Component({
  options: {
    multipleSlots: true,
    addGlobalClass: true,
  },

  properties: {
    title: { type: String, value: '' },
    price: { type: null, value: 0 },
    src: {
      type: String,
    },
    show: {
      type: Boolean,
      value: false,
    },
    isStock: {
      type: Boolean,
      value: true,
    },
    skuList: {
      type: Array,
      value: [],
      observer(skuList) {
        this.initData();
      },
    },
    specList: {
      type: Array,
      value: [],
      observer(specList) {
        this.initData();
      },
    },
    outOperateStatus: {
      type: Boolean,
      value: false,
    },
    hasAuth: {
      type: Boolean,
      value: false,
    },
    count: {
      type: Number,
      value: 1,
      observer(count) {
        this.setData({
          buyNum: count,
        });
      },
    },
  },

  initStatus: false,
  selectedSku: {},

  data: {
    viewSpecList: [],
    buyNum: 1,
    isAllSelectedSku: false,
    stockQuantity: 0,
  },

  methods: {
    previewImage() {
      if (this.properties.src) this.triggerEvent('previewImage', { src: this.properties.src });
    },

    initData() {
      const { skuList } = this.properties;
      const sourceSpecs = this.properties.specList;
      const signature = JSON.stringify({ skuList, specList: sourceSpecs.map((group) => ({
        ...group,
        specValueList: group.specValueList.map((sourceOption) => {
          const option = Object.assign({}, sourceOption);
          delete option.isSelected;
          delete option.hasStockObj;
          return option;
        }),
      })) });
      if (this.specDataSignature === signature) return;
      this.specDataSignature = signature;
      const specList = sourceSpecs.map((group) => ({ ...group, specValueList: group.specValueList.map((option) => ({ ...option })) }));
      specList.forEach((item) => {
        if (item.specValueList.length > 0) {
          item.specValueList.forEach((subItem) => {
            subItem.isSelected = false;
          });
        }
      });
      const selectedSku = {};
      specList.forEach((item) => {
        selectedSku[item.specId] = '';
      });
      if (skuList.length === 1) {
        specList.forEach((item) => {
          const spec = (skuList[0].specInfo || []).find((entry) => String(entry.specId) === String(item.specId));
          const option = item.specValueList.find((entry) => String(entry.specValueId) === String(spec?.specValueId));
          if (option) {
            selectedSku[item.specId] = option.specValueId;
            option.isSelected = true;
          }
        });
      }
      this.updateAvailability(specList, selectedSku);
      const isAllSelectedSku = skuList.length > 0 && this.isAllSelected(specList, selectedSku);
      this.setData({
        viewSpecList: specList,
        isAllSelectedSku,
        stockQuantity: isAllSelectedSku ? this.getCompatibleStockQuantity(selectedSku, true) : 0,
      });
      this.selectedSku = selectedSku;
      this.initStatus = true;
      Promise.resolve().then(() => {
        if (this.specDataSignature === signature) this.triggerEvent('change', { specList, selectedSku, isAllSelectedSku });
      });
    },

    updateAvailability(specList, selectedSku) {
      specList.forEach((group) => {
        group.hidden = group.optional === true && !this.properties.skuList.some((sku) =>
          (sku.specInfo || []).some((entry) => String(entry.specId) === String(group.specId)) &&
          Object.entries(selectedSku).every(([specId, valueId]) => !valueId || String(specId) === String(group.specId) ||
            (sku.specInfo || []).some((entry) => String(entry.specId) === String(specId) && String(entry.specValueId) === String(valueId))));
        group.specValueList.forEach((option) => {
          const candidate = { ...selectedSku, [group.specId]: option.specValueId };
          option.hasStockObj = { hasStock: this.getCompatibleStockQuantity(candidate) > 0 };
        });
      });
    },
    getStockQuantity(sku) {
      if (!sku) return 0;
      return Math.max(0, Number(sku.quantity) || 0);
    },

    getCompatibleStockQuantity(selectedSku, exact = false) {
      const { skuList } = this.properties;
      const selectedEntries = Object.entries(selectedSku || {}).filter(([, value]) => value !== '');
      return skuList
        .filter((sku) => (!exact || (sku.specInfo || []).length === selectedEntries.length) &&
          selectedEntries.every(([specId, valueId]) =>
            (sku.specInfo || []).some(
              (item) => String(item.specId) === String(specId) && String(item.specValueId) === String(valueId),
            ),
          ),
        )
        .reduce((total, sku) => total + this.getStockQuantity(sku), 0);
    },

    toChooseItem(e) {
      const { isStock } = this.properties;
      if (!isStock) return;
      const { id } = e.currentTarget.dataset;
      const specId = e.currentTarget.dataset.specid;
      const hasStock = e.currentTarget.dataset.hasstock;
      if (hasStock !== true && hasStock !== 'true' && String(this.selectedSku[specId]) !== String(id)) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '该规格已售罄',
          icon: '',
          duration: 1000,
        });
        return;
      }

      let { selectedSku } = this;
      const specList = this.data.viewSpecList;
      selectedSku =
        selectedSku[specId] === id ? { ...this.selectedSku, [specId]: '' } : { ...this.selectedSku, [specId]: id };
      specList.forEach((item) => {
        item.specValueList.forEach((valuesItem) => {
          if (item.specId === specId) {
            valuesItem.isSelected = valuesItem.specValueId === selectedSku[specId];
          }
        });
      });
      this.updateAvailability(specList, selectedSku);
      const isAllSelectedSku = this.isAllSelected(specList, selectedSku);
      const stockQuantity = isAllSelectedSku ? this.getCompatibleStockQuantity(selectedSku, true) : 0;
      if (stockQuantity > 0 && this.data.buyNum > stockQuantity) this.setBuyNum(Math.min(99, stockQuantity));
      if (!isAllSelectedSku) {
        this.setData({
          selectSkuSellsPrice: 0,
          selectSkuImg: '',
        });
      }
      this.setData({
        viewSpecList: specList,
        isAllSelectedSku,
        stockQuantity,
      });
      this.selectedSku = selectedSku;
      this.triggerEvent('change', {
        specList,
        selectedSku,
        isAllSelectedSku,
      });
    },

    // 判断是否所有的sku都已经选中
    isAllSelected(skuTree, selectedSku) {
      const selected = Object.entries(selectedSku).filter(([, value]) => value !== '');
      return this.properties.skuList.some((sku) => (sku.specInfo || []).length === selected.length
        && selected.every(([specId, valueId]) => (sku.specInfo || []).some((entry) =>
          String(entry.specId) === String(specId) && String(entry.specValueId) === String(valueId))));
    },

    handlePopupHide() {
      this.triggerEvent('closeSpecsPopup', {
        show: false,
      });
    },

    specsConfirm() {
      const { isStock } = this.properties;
      if (!isStock) return;
      this.triggerEvent('specsConfirm');
    },

    addCart() {
      const { isStock } = this.properties;
      if (!isStock) return;
      this.triggerEvent('addCart');
    },

    buyNow() {
      const { isAllSelectedSku } = this.data;
      const { isStock } = this.properties;
      if (!isStock) return;
      this.triggerEvent('buyNow', {
        isAllSelectedSku,
      });
    },

    // 总处理
    setBuyNum(buyNum) {
      this.setData({
        buyNum,
      });
      this.triggerEvent('changeNum', {
        buyNum,
      });
    },

    handleBuyNumChange(e) {
      if (!this.data.isAllSelectedSku || !this.properties.isStock || this.data.stockQuantity <= 0) return;
      const { value } = e.detail;
      this.setData({
        buyNum: value,
      });
      this.triggerEvent('changeNum', {
        buyNum: value,
      });
    },
  },
});
// @ts-nocheck
