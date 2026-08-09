import TabMenu from './data';
Component({
  data: {
    active: 0,
    list: TabMenu,
  },

  methods: {
    onChange(event) {
      const selectedIndex = event.detail.value;
      if (selectedIndex !== 0) return;

      this.setData({ active: selectedIndex });
      wx.switchTab({
        url: this.data.list[selectedIndex].url.startsWith('/')
          ? this.data.list[selectedIndex].url
          : `/${this.data.list[selectedIndex].url}`,
      });
    },

    init() {
      const page = getCurrentPages().pop();
      const route = page ? page.route.split('?')[0] : '';
      const active = this.data.list.findIndex(
        (item) =>
          (item.url.startsWith('/') ? item.url.substr(1) : item.url) ===
          `${route}`,
      );
      this.setData({ active });
    },
  },
});
