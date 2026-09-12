const LOGISTICS_THIRD_PARTY_URL = 'https://m.kuaidi100.com/result.jsp?nu=';

function decodeQueryValue(value) {
  const text = value == null ? '' : String(value);
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

Page({
  data: {
    url: '',
  },

  onLoad(options = {}) {
    const logisticsNo = decodeQueryValue(options.logisticsNo);
    if (!logisticsNo) return;
    this.setData({
      url: `${LOGISTICS_THIRD_PARTY_URL}${encodeURIComponent(logisticsNo)}`,
    });
  },
});
