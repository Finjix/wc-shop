Component({
  options: {
    addGlobalClass: true,
  },
  /**
   * 组件的属性列表
   */
  properties: {
    isAllSelected: {
      type: Boolean,
      value: false,
    },
    totalAmount: {
      type: Number,
      value: 1,
    },
    totalGoodsNum: {
      type: Number,
      value: 0,
      observer(num) {
        const isDisabled = num === 0;
        if (this.disableTimer) clearTimeout(this.disableTimer);
        this.disableTimer = setTimeout(() => {
          this.setData({
            isDisabled,
          });
        }, 0);
      },
    },
    totalDiscountAmount: {
      type: Number,
      value: 0,
    },
    themeColor: {
      type: String,
      value: '#F5CE2B',
    },
    bottomHeight: {
      type: Number,
      value: 100,
    },
    fixed: Boolean,
  },
  data: {
    isDisabled: false,
  },

  lifetimes: {
    detached() {
      if (this.disableTimer) clearTimeout(this.disableTimer);
    },
  },

  methods: {
    handleSelectAll() {
      const { isAllSelected } = this.properties;
      const nextIsAllSelected = !isAllSelected;
      this.triggerEvent('handleSelectAll', {
        isAllSelected: nextIsAllSelected,
      });
    },

    handleToSettle() {
      if (this.data.isDisabled) return;
      this.triggerEvent('handleToSettle');
    },
  },
});
