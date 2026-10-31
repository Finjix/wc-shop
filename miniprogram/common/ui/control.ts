// @ts-nocheck
const any = (value = null) => ({ type: null, value });
// Measure on attachment and viewport changes, never during scrolling.
export function measureControlLayout(info, menu, topInset = 0) {
  const statusHeight = Math.max(0, Number(info.statusBarHeight) || 0);
  const navHeight = Math.max(44, ((menu.top ?? statusHeight + 4) - statusHeight) * 2 + (menu.height || 32));
  const width = Number(info.windowWidth) || 375;
  const capsuleInset = width - (menu.left ?? width - 100) + 8;
  return {
    statusHeight,
    navHeight,
    titleWidth: Math.max(80, width - capsuleInset * 2),
    scrollHeight: Math.max(0, info.windowHeight - statusHeight - navHeight - topInset * width / 750),
  };
}
export function control(kind): any {
  const properties = {
    topInset: Number, zIndex: { type: Number, value: 1100 },
    value: any(''), visible: Boolean, disabled: Boolean, loading: any(kind === 'loading'), title: String, content: String,
    customStyle: String, label: String, note: String, description: String, placeholder: String, type: { type: String, value: 'text' },
    maxlength: { type: Number, value: 140 }, focus: Boolean, align: String, clearable: Boolean, autosize: Boolean, indicator: Boolean,
    bordered: { type: Boolean, value: true },
    min: { type: Number, value: 0 }, max: { type: Number, value: 99 }, name: String, size: { type: String, value: kind === 'button' ? 'medium' : '32rpx' },
    arrow: Boolean, image: String,
    color: { type: String, value: '#695941' }, prefix: String, src: String, mode: { type: String, value: 'aspectFill' },
    lazy: Boolean, lazyLoad: Boolean, showMenuByLongpress: Boolean, current: Number, interval: { type: Number, value: 2500 },
    duration: { type: Number, value: 500 }, autoplay: Boolean, circular: { type: Boolean, value: true },
    list: { type: Array, value: [] }, height: any('300rpx'), imageProps: Object,
    placement: { type: String, value: 'bottom' }, closeBtn: Boolean, leftArrow: Boolean, fixed: Boolean,
    background: { type: String, value: '#fff' }, count: Number, maxCount: { type: Number, value: 99 },
    options: { type: Array, value: [] }, files: { type: Array, value: [] }, sizeLimit: { type: Number, value: 10485760 },
    confirmBtn: any('确定'), cancelBtn: any('取消'), actions: { type: Array, value: [] },
    openType: String, block: Boolean, variant: String, shape: String, text: String, column: { type: Number, value: 3 },
  };
  return {
    // Icons and cells retain their host so caller classes keep spacing and sizing.
    options: { multipleSlots: true, virtualHost: !['icon', 'cell'].includes(kind) },
    externalClasses: ['t-class','t-class-title','t-class-left','t-class-note','t-class-content','t-class-input','t-class-input-container','t-class-textarea','t-class-image','t-class-action','t-class-confirm','t-class-cancel','t-class-indicator','t-class-text','t-class-active','t-class-track','t-class-load'],
    properties,
    data: { kind, statusHeight: 20, navHeight: 44, titleWidth: 220, tabItems: [], slideItems: [], areaColumns: [], selectedArea: [], heightStyle: '300rpx', iconSource: '', scrollHeight: 600 },
    observers: {
      list(list) { if (kind === 'swiper') this.setData({ slideItems: (list || []).map((item, index) => ({ src: typeof item === 'string' ? item : item.value || item.image, key: index })) }); },
      height(value) { this.setData({ heightStyle: typeof value === 'number' ? `${value}px` : value }); },
      options(options) { if (kind === 'cascader') this.setData({ areaColumns: [options || []], selectedArea: [] }); },
      visible(value) { if (value && kind === 'cascader') this.setData({ areaColumns: [this.data.options], selectedArea: [] }); },
      'name, color'(name, color) { if (kind === 'icon') this.updateIcon(name, color); },
      topInset() { if (kind === 'pull-down-refresh') this.updateLayout(); },
    },
    relations: kind === 'tabs' ? { '/components/ui/tab-panel/index': { type: 'child', linked() { this.updateTabs(); }, unlinked() { this.updateTabs(); } } } : kind === 'tab-panel' ? { '/components/ui/tabs/index': { type: 'parent' } } : {},
    lifetimes: {
      attached() {
        if (kind === 'pull-down-refresh' || kind === 'navbar') this.updateLayout();
      },
      ready() { if (kind === 'tabs') this.updateTabs(); },
    },
    pageLifetimes: {
      resize() { if (kind === 'pull-down-refresh' || kind === 'navbar') this.updateLayout(); },
    },
    methods: {
      noop() {},
      updateLayout() { this.setData(measureControlLayout(wx.getWindowInfo(), wx.getMenuButtonBoundingClientRect(), this.data.topInset)); },
      input(event) {
        this.setData({ value: event.detail.value });
        this.triggerEvent('change', { value: event.detail.value });
      },
      focusInput(event) { this.triggerEvent('focus', event.detail); }, blurInput(event) { this.triggerEvent('blur', event.detail); },
      submitInput(event) { this.triggerEvent('submit', { value: event.detail.value }); },
      tapButton(event) { if (!this.data.disabled && !this.data.loading) this.triggerEvent('tap', event.detail); },
      tapCell() { this.triggerEvent('click'); },
      back() { wx.navigateBack(); this.triggerEvent('go-back'); },
      close() { this.triggerEvent('visible-change', { visible: false }); this.triggerEvent('close', { visible: false }); },
      confirm() { this.setData({ visible: false }); this.triggerEvent('confirm'); this._onConfirm?.(); },
      cancel() { this.setData({ visible: false }); this.triggerEvent('cancel'); this.triggerEvent('close'); this._onCancel?.(); },
      action(event) { this.setData({ visible: false }); this._onAction?.({ index: event.currentTarget.dataset.index }); },
      changeSlide(event) { this.triggerEvent('change', event.detail); },
      tapSlide(event) { this.triggerEvent('click', { index: event.currentTarget.dataset.index }); },
      imageLoad(event) { this.triggerEvent('load', event.detail); }, imageError(event) { this.triggerEvent('error', event.detail); },
      changeQuantity(event) {
        if (this.data.disabled) return;
        const action = event.currentTarget.dataset.action;
        const requested = action ? Number(this.data.value) + Number(action) : Number(event.detail.value);
        const value = Math.min(this.data.max, Math.max(this.data.min, Number.isFinite(requested) ? requested : this.data.min));
        this.triggerEvent('change', { value });
        if (action) this.triggerEvent(Number(action) > 0 ? 'plus' : 'minus', { value });
      },
      quantityBlur(event) { this.changeQuantity(event); this.triggerEvent('blur', { value: Number(event.detail.value) }); },
      updateTabs() { const children = this.getRelationNodes('/components/ui/tab-panel/index') || []; this.setData({ tabItems: children.map(child => ({ label: child.data.label, value: child.data.value })) }); },
      selectTab(event) { this.triggerEvent('change', { value: this.data.tabItems[event.currentTarget.dataset.index].value }); },
      refresh() { this.triggerEvent('refresh'); },
      reachBottom() { this.triggerEvent('reachbottom'); },
      onPageScroll() {},
      chooseArea(event) {
        const column = event.currentTarget.dataset.column, index = event.currentTarget.dataset.index;
        const item = this.data.areaColumns[column][index];
        const selected = [...this.data.selectedArea.slice(0, column), { label: item.label, value: item.value }];
        if (item.children?.length) this.setData({ selectedArea: selected, areaColumns: [...this.data.areaColumns.slice(0, column + 1), item.children] });
        else this.triggerEvent('change', { value: item.value, selectedOptions: selected });
      },
      async chooseFiles() {
        if (this.data.disabled || this.data.files.length >= this.data.max) return;
        wx.chooseMedia({ count: Math.min(9, this.data.max - this.data.files.length), mediaType: ['image'], sourceType: ['album','camera'],
          success: result => {
            const additions = result.tempFiles.filter(file => file.size <= this.data.sizeLimit).map(file => ({ url: file.tempFilePath, size: file.size, type: 'image' }));
            if (additions.length !== result.tempFiles.length) wx.showToast({ title: '图片不能超过10MB', icon: 'none' });
            if (!additions.length) return;
            const detail = { files: [...this.data.files, ...additions] };
            this.triggerEvent('select-change', detail); this.triggerEvent('success', detail); this.triggerEvent('complete', detail);
          },
        });
      },
      removeFile(event) { if (!this.data.disabled) this.triggerEvent('remove', { index: event.currentTarget.dataset.index }); },
      previewFile(event) { const index = event.currentTarget.dataset.index; this.triggerEvent('click', { index, file: this.data.files[index] }); },
      swipeStart(event) { this.startX = event.touches[0].clientX; },
      swipeEnd(event) { const end = event.changedTouches[0].clientX; this.setData({ swiped: this.startX - end > 40 }); },
      updateIcon(name, color) {
        const paths = {
          'chevron-right':'M9 5l7 7-7 7', 'chevron-left':'M15 5l-7 7 7 7', 'chevron-down':'M5 9l7 7 7-7', 'close':'M6 6l12 12M6 18L18 6',
          'add':'M12 4v16M4 12h16','minus':'M4 12h16','check':'M4 12l5 5L20 6','search':'M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14M15 15l6 6',
          'home':'M3 10l9-7 9 7v11h-7v-7h-4v7H3z','cart':'M2 3h3l3 13h11l3-10H6M9 20h.1M18 20h.1',
          'user':'M12 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8M4 21v-3a8 5 0 0 1 16 0v3z','app':'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
          'service':'M4 14v-3a8 8 0 0 1 16 0v6l-4 4h-4M4 11H2v7h4v-7zM20 11h2v7h-4v-7z',
          'delete':'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7','location':'M12 22S4 14 4 9a8 8 0 0 1 16 0c0 5-8 13-8 13zM12 6a3 3 0 1 0 0 6a3 3 0 0 0 0-6',
          'deliver':'M2 5h12v12H2zM14 10h4l4 4v3h-8M5 17a2 2 0 1 0 4 0M16 17a2 2 0 1 0 4 0','package':'M3 6l9-4 9 4v13l-9 3-9-3zM3 6l9 4 9-4M12 10v12','comment':'M3 3h18v14H9l-6 5zM7 8h10M7 12h7','refund':'M5 8h12l-4-4M19 16H7l4 4M17 8l-4 4M7 16l4-4',
          'circle':'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20','check-circle-filled':'M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20M7 12l3 3 7-7',
          'order':'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5','star':'M12 2l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z',
        };
        const aliases = { cartAdd:'cart', cart1:'cart', cart2:'cart', home1:'home', user1:'user', person:'user', category:'app', sort:'app', classify:'app', delete1:'delete', address:'location', 'location-1':'location', 'star-filled':'star', 'check-circle':'check-circle-filled', 'close-circle':'close', 'add-circle':'add', 'arrow-left':'chevron-left', arrow_forward:'chevron-right', exchang:'refund', payment:'order' };
        if (!color || color === 'inherit' || color.startsWith('var(')) color = '#695941';
        const path = paths[aliases[name] || name] || paths.order;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color || '#695941'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
        const bytes = [];
        for (let index = 0; index < svg.length; index++) bytes.push(svg.charCodeAt(index));
        this.setData({ iconSource: 'data:image/svg+xml;base64,' + wx.arrayBufferToBase64(new Uint8Array(bytes).buffer) });
      },
    },
  };
}
