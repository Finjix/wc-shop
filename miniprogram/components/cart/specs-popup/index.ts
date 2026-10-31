// @ts-nocheck

import Toast from '../../../common/ui/toast';

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '',
    },
    price: {
      type: null,
      value: '',
    },
    thumb: {
      type: String,
      value: '',
    },
    zIndex: {
      type: Number,
      value: 99,
    },
    specList: {
      type: Array,
      value: [],
      observer() {
        this.initOptions();
      },
    },
    skuList: {
      type: Array,
      value: [],
      observer() {
        this.initOptions();
      },
    },
    selectedSkuId: {
      type: null,
      value: '',
      observer() {
        this.initOptions();
      },
    },
    themeColor: {
      type: String,
      value: '#695941',
    },
  },

  data: {
    optionGroups: [],
    selectedSku: {},
    selectedGoodsSku: null,
    currentPrice: '',
    isComplete: false,
  },

  methods: {
    initOptions() {
      const { specList, skuList, selectedSkuId } = this.properties;
      if (!specList.length || !skuList.length) return;

      const selectedSku = {};
      const currentSku = skuList.find((sku) => String(sku.skuId) === String(selectedSkuId));
      specList.forEach((group) => {
        const selectedValue = currentSku?.specInfo?.find((item) => String(item.specId) === String(group.specId));
        selectedSku[group.specId] = selectedValue?.specValueId || '';
      });
      this.applySelection(selectedSku);
    },

    getStockQuantity(sku) {
      return Number(sku.stockQuantity) || 0;
    },

    getSkuPrice(sku) {
      return sku.salePrice ?? '';
    },

    hasSkuValue(sku, specId, valueId) {
      return (sku.specInfo || []).some(
        (item) => String(item.specId) === String(specId) && String(item.specValueId) === String(valueId),
      );
    },

    isSkuCompatible(sku, selectedSku, excludedSpecId) {
      return Object.keys(selectedSku).every((specId) => {
        if (String(specId) === String(excludedSpecId) || !selectedSku[specId]) return true;
        return this.hasSkuValue(sku, specId, selectedSku[specId]);
      });
    },

    isOptionAvailable(specId, valueId, selectedSku) {
      return this.properties.skuList.some(
        (sku) =>
          this.getStockQuantity(sku) > 0 &&
          this.hasSkuValue(sku, specId, valueId) &&
          this.isSkuCompatible(sku, selectedSku, specId),
      );
    },

    findMatchingSku(selectedSku) {
      const { skuList } = this.properties;
      const selected = Object.entries(selectedSku).filter(([, value]) => value !== '');
      if (!selected.length) return null;
      return (
        skuList.find(
          (sku) =>
            (sku.specInfo || []).length === selected.length &&
            selected.every(([specId, valueId]) => this.hasSkuValue(sku, specId, valueId)) &&
            this.getStockQuantity(sku) > 0,
        ) || null
      );
    },

    applySelection(selectedSku) {
      const { specList } = this.properties;
      const optionGroups = specList.map((group) => ({
        ...group,
        hidden: group.optional === true && !this.properties.skuList.some((sku) =>
          (sku.specInfo || []).some((entry) => String(entry.specId) === String(group.specId)) &&
          this.isSkuCompatible(sku, selectedSku, group.specId)),
        specValueList: (group.specValueList || []).map((value) => ({
          ...value,
          isSelected: String(selectedSku[group.specId] || '') === String(value.specValueId),
          hasStock: this.isOptionAvailable(group.specId, value.specValueId, selectedSku),
        })),
      }));
      const selectedGoodsSku = this.findMatchingSku(selectedSku);
      const isComplete = Boolean(selectedGoodsSku);
      const currentSku = this.properties.skuList.find(
        (sku) =>
          specList.length > 0 &&
          (sku.specInfo || []).length === Object.values(selectedSku).filter(Boolean).length &&
          this.isSkuCompatible(sku, selectedSku),
      );

      this.setData({
        optionGroups,
        selectedSku,
        selectedGoodsSku,
        isComplete,
        currentPrice: this.getSkuPrice(selectedGoodsSku || currentSku || {}),
      });
    },

    handleVisibleChange(e) {
      const visible = typeof e.detail === 'boolean' ? e.detail : e.detail?.visible;
      if (!visible) this.onClose();
    },

    onClose() {
      this.triggerEvent('close');
    },

    selectOption(e) {
      const { specId, valueId, hasStock } = e.currentTarget.dataset;
      const selectedValue = this.data.selectedSku[specId];
      const optionHasStock = hasStock === true || hasStock === 'true';
      if (!optionHasStock && String(selectedValue) !== String(valueId)) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '该规格已售罄',
          icon: '',
          duration: 1000,
        });
        return;
      }
      this.applySelection({ ...this.data.selectedSku, [specId]: String(selectedValue) === String(valueId) ? '' : valueId });
    },

    confirmSelection() {
      if (!this.data.isComplete) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '请选择有库存的完整规格',
          icon: '',
          duration: 1000,
        });
        return;
      }
      this.triggerEvent('confirm', {
        sku: this.data.selectedGoodsSku,
        selectedSku: this.data.selectedSku,
      });
    },
  },
});
// @ts-nocheck
