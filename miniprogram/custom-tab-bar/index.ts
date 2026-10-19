// @ts-nocheck
import { isPageNavigationEnabled } from '../config/navigation';

import TabMenu from './data';
Component({
  data: {
    active: 0,
    list: TabMenu,
  },

  methods: {
    onItemTap(event) {
      this.selectTab(event.currentTarget.dataset.index);
    },

    selectTab(index) {
      const selectedIndex = Number(index);
      const selectedItem = this.data.list[selectedIndex];
      if (!selectedItem) return;
      if (!isPageNavigationEnabled(selectedItem.url)) return;
      if (selectedItem.disabled) return;
      if (selectedItem.special) {
        wx.showToast({
          title: '分销中心功能开发中',
          icon: 'none',
          duration: 1000,
        });
        return;
      }
      if (!selectedItem.url) return;

      this.setData({ active: selectedIndex });
      wx.switchTab({
        url: selectedItem.url.startsWith('/') ? selectedItem.url : `/${selectedItem.url}`,
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
// @ts-nocheck
