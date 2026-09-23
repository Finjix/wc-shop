// @ts-nocheck

import { request } from '../../utils/api';

Component({
  properties: {
    top: {
      type: Number,
      value: 0,
    },
    left: {
      type: Number,
      value: 0,
    },
    width: {
      type: Number,
      value: 375,
    },
    value: {
      type: String,
      value: '',
    },
    focus: {
      type: Boolean,
      value: false,
    },
    searchBackground: {
      type: String,
      value: '#f5f5f5',
    },
    marqueeText: {
      type: String,
      value: '欢迎光临番薯鞋店！',
    },
  },

  lifetimes: {
    attached() { this.refreshMarquee(); },
  },
  pageLifetimes: {
    show() { this.refreshMarquee(); },
  },

  methods: {
    async refreshMarquee() {
      try {
        const result = await request('home.get', {});
        const text = result?.config?.searchText;
        if (typeof text === 'string' && text.trim()) this.setData({ marqueeText: text.trim() });
      } catch { /* 离线时沿用默认文案 */ }
    },
    focusSearch() {
      this.triggerEvent('focus');
    },

    handleSearchFocus(event) {
      this.triggerEvent('focus', event.detail);
    },

    handleSearchBlur(event) {
      this.triggerEvent('blur', event.detail);
    },

    handleSearchChange(event) {
      this.triggerEvent('change', event.detail);
    },

    handleSearchSubmit(event) {
      this.triggerEvent('submit', event.detail);
    },
  },
});
// @ts-nocheck
