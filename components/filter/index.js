Component({
  externalClasses: ['wr-class'],

  options: {
    multipleSlots: true,
  },

  properties: {
    overall: {
      type: Number,
      value: 1,
    },
    layout: {
      type: Number,
      value: 1,
    },
    sorts: {
      type: String,
      value: '',
    },
    sortType: {
      type: String,
      value: '',
    },
    prices: {
      type: Array,
      value: [],
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

  methods: {
    onChangeShowAction() {
      const { layout } = this.properties;
      const nextLayout = layout === 1 ? 0 : 1;
      this.triggerEvent('change', { ...this.properties, layout: nextLayout });
    },

    handlePriseSort() {
      const { sorts } = this.properties;
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
      const { overall } = this.properties;
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
