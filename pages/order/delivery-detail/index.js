Page({
  data: {
    logisticsData: {
      logisticsNo: '',
      nodes: [],
      company: '',
      phoneNumber: '',
    },
    active: 0,
    emptyMessage: '暂无物流信息',
  },

  onLoad(query) {
    let data;
    try {
      data = JSON.parse(decodeURIComponent(query.data || '{}'));
    } catch (e) {
      console.warn('物流节点数据解析失败', e);
    }
    if (Number(query.source) === 2) {
      const service = {
        company: data.logisticsCompanyName || data.company || '',
        logisticsNo: data.logisticsNo || '',
        phoneNumber: data.phoneNumber || '',
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
      };
      this.setData({
        logisticsData: service,
        emptyMessage: service.logisticsNo || service.company ? '暂无物流节点' : '暂无物流信息',
      });
    } else if (data && typeof data === 'object') {
      this.setData({
        logisticsData: {
          ...data,
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
        },
        emptyMessage: data.logisticsNo || data.company ? '暂无物流节点' : '暂无物流信息',
      });
    }
  },

  onLogisticsNoCopy() {
    if (!this.data.logisticsData.logisticsNo) return;
    wx.setClipboardData({ data: this.data.logisticsData.logisticsNo });
  },

  onCall() {
    const { phoneNumber } = this.data.logisticsData;
    if (!phoneNumber) return;
    wx.makePhoneCall({
      phoneNumber,
    });
  },
});
