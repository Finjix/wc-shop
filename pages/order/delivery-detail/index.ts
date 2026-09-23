// @ts-nocheck

Page({
  data: {
    logisticsData: {
      logisticsNo: '',
      nodes: [],
      company: '',
      phoneNumber: '',
    },
    active: 0,
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
      });
    } else if (data && typeof data === 'object') {
      this.setData({
        logisticsData: {
          ...data,
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
        },
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
// @ts-nocheck
