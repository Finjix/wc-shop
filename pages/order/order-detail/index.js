import { formatTime } from '../../../utils/util';
import { OrderButtonTypes, OrderStatus, LogisticsIconMap } from '../config';
import { fetchBusinessTime, fetchOrderDetail } from '../../../services/order/orderDetail';
import { getAddressPromise } from '../../../services/address/list';
import { navigateToGoodsDetail } from '../../../utils/goods-detail-navigation';

Page({
  data: {
    pullDownRefreshing: false,
    pageLoading: true,
    order: {}, // 后台返回的原始数据
    _order: {}, // 内部使用和提供给 order-card 的数据
    storeDetail: {},
    addressEditable: false,
    backRefresh: false, // 用于接收其他页面back时的状态
    formatCreateTime: '', //格式化订单创建时间
    logisticsNodes: [],
  },

  onLoad(query) {
    this.orderNo = query.orderNo;
    this.init();
    this.navbar = this.selectComponent('#navbar');
    this.pullDownRefresh = this.selectComponent('#wr-pull-down-refresh');
  },

  onShow() {
    // 当从其他页面返回，并且 backRefresh 被置为 true 时，刷新数据
    if (!this.data.backRefresh) return;
    this.onRefresh();
    this.setData({ backRefresh: false });
  },

  onPageScroll(e) {
    this.pullDownRefresh && this.pullDownRefresh.onPageScroll(e);
  },

  // 页面初始化，会展示pageLoading
  init() {
    this.setData({ pageLoading: true });
    this.getStoreDetail();
    this.getDetail()
      .then(() => {
        this.setData({ pageLoading: false });
      })
      .catch((e) => {
        console.error(e);
      });
  },

  // 页面刷新，展示下拉刷新
  onRefresh() {
    this.init();
    // 如果上一页为订单列表，通知其刷新数据
    const pages = getCurrentPages();
    const lastPage = pages[pages.length - 2];
    if (lastPage) {
      lastPage.data.backRefresh = true;
    }
  },

  // 页面刷新，展示下拉刷新
  onPullDownRefresh_() {
    this.setData({ pullDownRefreshing: true }, () => {
      this.getDetail()
        .then(() => {
          this.setData({ pullDownRefreshing: false });
        })
        .catch(() => {
          this.setData({
            pullDownRefreshing: false,
          });
        });
    });
  },

  getDetail() {
    const params = {
      parameter: this.orderNo,
    };
    return fetchOrderDetail(params).then((res) => {
      const order = res.data;
      const orderButtons = [...(order.buttonVOs || [])];
      const hasOrderRefundButton = (order.orderItemVOs || []).some((goods) =>
        (goods.buttonVOs || []).some((button) => button.type === OrderButtonTypes.APPLY_REFUND),
      );
      if (
        hasOrderRefundButton &&
        !orderButtons.some((button) => button.type === OrderButtonTypes.APPLY_REFUND)
      ) {
        const confirmIndex = orderButtons.findIndex((button) => button.type === OrderButtonTypes.CONFIRM);
        orderButtons.splice(
          confirmIndex === -1 ? orderButtons.length : confirmIndex,
          0,
          { primary: false, type: OrderButtonTypes.APPLY_REFUND, name: '申请售后' },
        );
      }
      const _order = {
        id: order.orderId,
        orderNo: order.orderNo,
        parentOrderNo: order.parentOrderNo,
        storeId: order.storeId,
        storeName: order.storeName,
        status: order.orderStatus,
        statusDesc: order.orderStatusName,
        amount: order.paymentAmount,
        totalAmount: order.goodsAmountApp,
        logisticsNo: order.logisticsVO.logisticsNo,
        goodsList: (order.orderItemVOs || []).map((goods) =>
          Object.assign({}, goods, {
            id: goods.id,
            thumb: goods.goodsPictureUrl,
            title: goods.goodsName,
            skuId: goods.skuId,
            spuId: goods.spuId,
            specs: (goods.specifications || []).map((s) => s.specValue),
            price: goods.tagPrice ? goods.tagPrice : goods.actualPrice, // 商品销售单价, 优先取限时活动价
            num: goods.buyQuantity,
            titlePrefixTags: goods.tagText ? [{ text: goods.tagText }] : [],
          }),
        ),
        buttons: orderButtons,
        createTime: order.createTime,
        receiverAddress: this.composeAddress(order),
        groupInfoVo: order.groupInfoVo,
      };
      this.setData({
        order,
        _order,
        formatCreateTime: formatTime(parseFloat(`${order.createTime}`), 'YYYY-MM-DD HH:mm'), // 格式化订单创建时间
        addressEditable:
          [OrderStatus.PENDING_PAYMENT, OrderStatus.PENDING_DELIVERY].includes(order.orderStatus) &&
          order.orderSubStatus !== -1, // 订单正在取消审核时不允许修改地址（但是返回的状态码与待发货一致）
        isPaid: !!order.paymentVO.paySuccessTime,
        logisticsNodes: this.flattenNodes(order.trajectoryVos || []),
      });
    });
  },

  // 展开物流节点
  flattenNodes(nodes) {
    return (nodes || []).reduce((res, node) => {
      return (node.nodes || []).reduce((res1, subNode, index) => {
        res1.push({
          title: index === 0 ? node.title : '', // 子节点中仅第一个显示title
          desc: subNode.status,
          date: formatTime(+subNode.timestamp, 'YYYY-MM-DD HH:mm:ss'),
          icon: index === 0 ? LogisticsIconMap[node.code] || '' : '', // 子节点中仅第一个显示icon
        });
        return res1;
      }, res);
    }, []);
  },

  // 拼接省市区
  composeAddress(order) {
    return [
      //order.logisticsVO.receiverProvince,
      order.logisticsVO.receiverCity,
      order.logisticsVO.receiverCountry,
      order.logisticsVO.receiverArea,
      order.logisticsVO.receiverAddress,
    ]
      .filter((s) => !!s)
      .join(' ');
  },

  getStoreDetail() {
    fetchBusinessTime().then((res) => {
      const storeDetail = {
        storeTel: res.data.telphone,
      };
      this.setData({ storeDetail });
    });
  },

  onGoodsCardTap(e) {
    const { index } = e.currentTarget.dataset;
    const goods = this.data.order.orderItemVOs[index];
    navigateToGoodsDetail(`/pages/goods/details/index?spuId=${goods.spuId}`);
  },

  onEditAddressTap() {
    getAddressPromise()
      .then((address) => {
        this.setData({
          'order.logisticsVO.receiverName': address.name,
          'order.logisticsVO.receiverPhone': address.phone,
          '_order.receiverAddress': address.address,
        });
      })
      .catch(() => {});

    wx.navigateTo({
      url: `/pages/user/address/list/index?selectMode=1`,
    });
  },

  onOrderNumCopy() {
    wx.setClipboardData({
      data: this.data.order.orderNo,
    });
  },

  onDeliveryClick() {
    const logisticsData = {
      nodes: this.data.logisticsNodes,
      company: this.data.order.logisticsVO.logisticsCompanyName,
      logisticsNo: this.data.order.logisticsVO.logisticsNo,
      phoneNumber: this.data.order.logisticsVO.logisticsCompanyTel,
    };
    wx.navigateTo({
      url: `/pages/order/delivery-detail/index?data=${encodeURIComponent(JSON.stringify(logisticsData))}`,
    });
  },

});
