Component({
  externalClasses: ['wr-class'],

  options: {
    multipleSlots: true,
  },

  properties: {
    overall: {
      type: Number,
      value: 1,
      observer(overall) {
        this.setData({
          overall,
        });
      },
    },
    layout: {
      type: Number,
      value: 1,
      observer(layout) {
        this.setData({
          layout,
        });
      },
    },
    sorts: {
      type: String,
      value: '',
      observer(sorts) {
        this.setData({
          sorts,
        });
      },
    },
    sortType: {
      type: String,
      value: '',
      observer(sortType) {
        this.setData({
          sortType,
        });
      },
    },
    showMoreSorts: {
      type: Boolean,
      value: false,
    },
    color: {
      type: String,
      value: '#FA550F',
    },
  },

  data: {
    layout: 1,
    overall: 1,
    sorts: '',
    sortType: '',
  },

  methods: {
    onChangeShowAction() {
      const { layout } = this.data;
      const nextLayout = layout === 1 ? 0 : 1;
      this.triggerEvent('change', { ...this.properties, layout: nextLayout });
    },

    handlePriseSort() {
      const { sorts } = this.data;
      this.triggerEvent('change', {
        ...this.properties,
        overall: 0,
        sorts: sorts === 'desc' ? 'asc' : 'desc',
        sortType: '',
      });
    },

    handleSortType(e) {
      const { sortType } = e.currentTarget.dataset;
      this.triggerEvent('change', {
        ...this.properties,
        overall: 0,
        sorts: '',
        sortType,
      });
    },

    open() {
      this.triggerEvent('showFilterPopup', {
        show: true,
      });
    },

    onOverallAction() {
      const { overall } = this.data;
      if (this.properties.showMoreSorts) {
        this.triggerEvent('change', {
          ...this.properties,
          overall: 1,
          sorts: '',
          sortType: '',
        });
        return;
      }
      const nextOverall = overall === 1 ? 0 : 1;
      const nextData = {
        sorts: '',
        prices: [],
      };
      this.triggerEvent('change', {
        ...this.properties,
        ...nextData,
        overall: nextOverall,
      });
    },
  },
});
