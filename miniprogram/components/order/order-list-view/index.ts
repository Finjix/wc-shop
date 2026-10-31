// Keep slotted order cards and their scroll container in one synchronous component tree.
Component({
  properties: {
    tabs: { type: Array, value: [] },
    status: { type: Number, value: -1 },
    orderList: { type: Array, value: [] },
    listLoading: { type: Number, value: 0 },
    pullDownRefreshing: Boolean,
  },
  methods: {
    onTabChange(event) { this.triggerEvent('tabchange', event.detail); },
    onReachBottom() { this.triggerEvent('reachbottom'); },
    onRefresh(event) { this.triggerEvent('refresh', event.detail); },
    onReTryLoad() { this.triggerEvent('retry'); },
    onPullDownRefresh() { this.triggerEvent('pulldownrefresh'); },
    onOrderCardTap(event) { this.triggerEvent('cardtap', { order: event.currentTarget.dataset.order }); },
  },
});
