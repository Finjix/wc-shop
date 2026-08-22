import { mockIp, mockReqId } from '../../utils/mock';
import { genOrderDetail } from './orderDetail';

const ServiceType = {
  RETURN_GOODS: 10,
  ONLY_REFUND: 20,
};

const ServiceReceiptStatus = {
  RECEIPTED: 1,
  NOT_RECEIPTED: 2,
};

const AfterServiceStatus = {
  TO_AUDIT: 10,
  THE_APPROVED: 20,
  HAVE_THE_GOODS: 30,
  ABNORMAL_RECEIVING: 40,
  COMPLETE: 50,
  CLOSED: 60,
};

const ServiceStatus = {
  PENDING_VERIFY: 100,
  VERIFIED: 110,
  PENDING_RECEIPT: 130,
  EXCEPTION: 150,
  REFUNDED: 160,
  CLOSED: 170,
};

const STORE = {
  saasId: '88888888',
  storeId: '1000',
  storeName: '云Mall深圳旗舰店',
  uid: '88888888205468',
};

const STATUS_META = {
  [AfterServiceStatus.TO_AUDIT]: {
    rightsStatusName: '待审核',
    userRightsStatus: ServiceStatus.PENDING_VERIFY,
    userRightsStatusName: '待商家审核',
    userRightsStatusDesc: '商家将在1-2个工作日内处理您的申请',
  },
  [AfterServiceStatus.THE_APPROVED]: {
    rightsStatusName: '已审核',
    userRightsStatus: ServiceStatus.VERIFIED,
    userRightsStatusName: '商家已审核',
    userRightsStatusDesc: '商家已审核，请按提示寄回商品',
  },
  [AfterServiceStatus.HAVE_THE_GOODS]: {
    rightsStatusName: '已收货',
    userRightsStatus: ServiceStatus.PENDING_RECEIPT,
    userRightsStatusName: '等待商家收货',
    userRightsStatusDesc: '退货物流运输中，商家收货后会处理退款',
  },
  [AfterServiceStatus.ABNORMAL_RECEIVING]: {
    rightsStatusName: '收货异常',
    userRightsStatus: ServiceStatus.EXCEPTION,
    userRightsStatusName: '收货异常',
    userRightsStatusDesc: '商家反馈包裹存在异常，请联系客服处理',
  },
  [AfterServiceStatus.COMPLETE]: {
    rightsStatusName: '已完成',
    userRightsStatus: ServiceStatus.REFUNDED,
    userRightsStatusName: '已退款',
    userRightsStatusDesc: '退款已原路退回，请在微信支付账单中查看',
  },
  [AfterServiceStatus.CLOSED]: {
    rightsStatusName: '已关闭',
    userRightsStatus: ServiceStatus.CLOSED,
    userRightsStatusName: '已关闭',
    userRightsStatusDesc: '售后申请已关闭',
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function getOrder(orderNo) {
  const response = genOrderDetail({ parameter: orderNo });
  return response && response.data;
}

function getOrderItem(order, skuId) {
  return (order && order.orderItemVOs ? order.orderItemVOs : []).find(
    (item) => `${item.skuId}` === `${skuId}`,
  );
}

function getUnitAmount(item) {
  const quantity = Number(item && item.buyQuantity) || 1;
  return (
    Number(item && item.goodsPaymentPrice) ||
    Number(item && item.itemPaymentAmount) / quantity ||
    0
  );
}

function getSpecs(item) {
  return (item && item.specifications ? item.specifications : []).map((spec) => ({
    specTitle: spec.specTitle,
    specValues: spec.specValue,
  }));
}

function buildRightsItem(order, item, request = {}, defaultQuantity) {
  if (!item) return null;
  const quantity = Math.max(
    1,
    Number(request.rightsQuantity || defaultQuantity || item.buyQuantity || 1),
  );
  const itemRefundAmount =
    Number(request.itemTotalAmount) || Math.round(getUnitAmount(item) * quantity);

  return {
    actualPrice: Number(item.actualPrice || 0),
    createTime: (order && order.createTime) || `${Date.now()}`,
    goodsName: item.goodsName,
    goodsPictureUrl: item.goodsPictureUrl,
    goodsViceType: item.goodsViceType || 0,
    itemDiscountAmount: Number(item.itemDiscountAmount || 0),
    itemRefundAmount,
    itemStatus: 2,
    itemTotalAmount: Number(item.itemPaymentAmount || itemRefundAmount),
    orderNo: order && order.orderNo,
    parentOrderNo: order && order.parentOrderNo,
    rightsId: `${order && order.orderNo}-${item.skuId}`,
    rightsNo: '',
    rightsQuantity: quantity,
    saasId: STORE.saasId,
    skuId: item.skuId,
    spuId: item.spuId,
    specInfo: getSpecs(item),
    updateTime: `${Date.now()}`,
  };
}

function buildLogistics(order, definition, isReturnGoods, receiptStatus) {
  const source = (order && order.logisticsVO) || {};
  if (!isReturnGoods) {
    return {
      logisticsType: source.logisticsType || 1,
      logisticsNo: '',
      logisticsStatus: null,
      logisticsCompanyCode: '',
      logisticsCompanyName: '',
      receiverProvince: '',
      receiverCity: '',
      receiverCountry: '',
      receiverArea: '',
      receiverAddress: '',
      receiverPhone: '',
      receiverName: '',
      nodes: [],
      remark: '',
    };
  }

  // 未收到货时展示订单原始物流；已收到货时只展示用户填写的退货物流，避免把商家发货单号当成退货单号。
  const useOrderLogistics = receiptStatus === ServiceReceiptStatus.NOT_RECEIPTED;
  const base = useOrderLogistics ? source : {};
  return {
    logisticsType: base.logisticsType || 1,
    logisticsNo: useOrderLogistics ? base.logisticsNo || '' : definition.logisticsNo || '',
    logisticsStatus: useOrderLogistics ? base.logisticsStatus || null : definition.logisticsStatus || null,
    logisticsCompanyCode: useOrderLogistics
      ? base.logisticsCompanyCode || ''
      : definition.logisticsCompanyCode || '',
    logisticsCompanyName: useOrderLogistics
      ? base.logisticsCompanyName || ''
      : definition.logisticsCompanyName || '',
    receiverAddress: useOrderLogistics ? base.receiverAddress || '' : definition.receiverAddress || '',
    receiverArea: useOrderLogistics ? base.receiverArea || '' : definition.receiverArea || '',
    receiverCity: useOrderLogistics ? base.receiverCity || '' : definition.receiverCity || '',
    receiverCountry: useOrderLogistics ? base.receiverCountry || '' : definition.receiverCountry || '',
    receiverName: useOrderLogistics ? base.receiverName || '' : definition.receiverName || '',
    receiverPhone: useOrderLogistics ? base.receiverPhone || '' : definition.receiverPhone || '',
    receiverProvince: useOrderLogistics ? base.receiverProvince || '' : definition.receiverProvince || '',
    remark: useOrderLogistics ? base.remark || '' : definition.logisticsRemark || '',
    nodes: useOrderLogistics ? base.nodes || [] : definition.nodes || [],
  };
}

function buildRightsItems(definition, order) {
  const requests = definition.rightsItems || [];
  if (requests.length > 0) {
    return requests
      .map((request, index) => {
        const item =
          getOrderItem(order, request.skuId) ||
          (order && order.orderItemVOs ? order.orderItemVOs[index] : null);
        return buildRightsItem(order, item, request);
      })
      .filter(Boolean);
  }

  const item = getOrderItem(order, definition.skuId);
  if (item) {
    return [buildRightsItem(order, item, {}, definition.quantity)];
  }
  return [];
}

function buildServiceButtons({ isRefunded, isReturnGoods, rightsStatus, receiptStatus, logisticsNo }) {
  const isCompleted = isRefunded || rightsStatus === AfterServiceStatus.COMPLETE;
  if (isCompleted) return [];

  const buttons = [{ name: '撤销申请', primary: false, type: 2 }];

  if (!isReturnGoods) return buttons;

  const canFillTrackingNo =
    receiptStatus === ServiceReceiptStatus.RECEIPTED &&
    (rightsStatus === AfterServiceStatus.TO_AUDIT || rightsStatus === AfterServiceStatus.THE_APPROVED);
  if (canFillTrackingNo) {
    buttons.push({
      name: logisticsNo ? '修改运单号' : '填写运单号',
      primary: false,
      type: logisticsNo ? 4 : 3,
    });
  }

  return buttons;
}

function buildRecord(definition = {}) {
  const order = getOrder(definition.orderNo) || {};
  const rightsStatus = definition.rightsStatus || AfterServiceStatus.TO_AUDIT;
  const meta = STATUS_META[rightsStatus] || STATUS_META[AfterServiceStatus.TO_AUDIT];
  const rightsType = definition.rightsType || ServiceType.ONLY_REFUND;
  const isReturnGoods = rightsType === ServiceType.RETURN_GOODS;
  const receiptStatus = isReturnGoods
    ? Number(definition.receiptStatus) || ServiceReceiptStatus.RECEIPTED
    : Number(definition.receiptStatus) || ServiceReceiptStatus.NOT_RECEIPTED;
  const rightsNo = definition.rightsNo || `AS-${Date.now()}-${nextRightsSequence++}`;
  const rightsItem = buildRightsItems(definition, order);
  rightsItem.forEach((item) => {
    item.rightsNo = rightsNo;
  });
  const refundAmount =
    Number(definition.refundAmount) ||
    rightsItem.reduce((total, item) => total + Number(item.itemRefundAmount || 0), 0);
  const createTime = definition.createTime || (order && order.createTime) || `${Date.now()}`;
  const isRefunded = meta.userRightsStatus === ServiceStatus.REFUNDED;
  const refundMethodList = isRefunded
    ? [
        {
          refundMethodAmount: refundAmount,
          refundMethodName: '微信支付',
        },
      ]
    : [];
  const logisticsVO = buildLogistics(order, definition, isReturnGoods, receiptStatus);
  const buttonVOs = buildServiceButtons({
    isRefunded,
    isReturnGoods,
    rightsStatus,
    receiptStatus,
    logisticsNo: logisticsVO.logisticsNo,
  });
  let statusDesc = meta.userRightsStatusDesc;
  if (isReturnGoods && receiptStatus === ServiceReceiptStatus.NOT_RECEIPTED) {
    statusDesc =
      rightsStatus === AfterServiceStatus.THE_APPROVED
        ? '商品尚未收到，请查看物流信息'
        : rightsStatus === AfterServiceStatus.TO_AUDIT
          ? '商品尚未收到，商家审核后可查看物流信息'
          : statusDesc;
  } else if (isReturnGoods && receiptStatus === ServiceReceiptStatus.RECEIPTED) {
    statusDesc =
      rightsStatus === AfterServiceStatus.THE_APPROVED
        ? '商家已审核，请填写退货运单'
        : rightsStatus === AfterServiceStatus.TO_AUDIT
          ? '您已收到货，请填写退货运单'
          : statusDesc;
  }

  return {
    buttonVOs,
    ...STORE,
    refundMethodList,
    createTime,
    rights: {
      ...STORE,
      bizRightsStatus: 1,
      bizRightsStatusName: isReturnGoods ? '退款退货' : '仅退款',
      createTime,
      orderNo: definition.orderNo,
      refundAmount,
      refundRequestAmount: refundAmount,
      rightsMethod: 1,
      rightsNo,
      rightsParentNo: `${rightsNo}-P`,
      rightsReasonDesc: definition.rightsReasonDesc || '其他',
      rightsReasonType: definition.rightsReasonType || '1',
      rightsStatus,
      rightsStatusName: meta.rightsStatusName,
      rightsType,
      receiptStatus,
      shippingFee: Number(definition.shippingFee || 0),
      shippingFeeBear: 0,
      updateTime: `${Date.now()}`,
      userRightsStatus: meta.userRightsStatus,
      userRightsStatusDesc: statusDesc,
      userRightsStatusName: meta.userRightsStatusName,
      afterSaleRequireType: isReturnGoods ? 'REFUND_GOODS_MONEY' : 'REFUND_MONEY',
      rightsImageUrls: definition.rightsImageUrls || [],
    },
    rightsItem,
    rightsRefund: {
      callbackTime: isRefunded ? createTime : null,
      channel: '微信支付',
      channelTrxNo: isRefunded ? `WX${rightsNo}` : '',
      createTime,
      refundDesc: definition.refundDesc || '商家将尽快处理您的售后申请',
      memo: definition.remark || '',
      refundAmount: isRefunded ? refundAmount : 0,
      refundStatus: isRefunded ? 1 : 0,
      requestTime: createTime,
      successTime: isRefunded ? createTime : null,
      traceNo: isRefunded ? `TRACE${rightsNo}` : '',
      updateTime: `${Date.now()}`,
    },
    logisticsVO,
  };
}

let nextRightsSequence = 1;

const mockDefinitions = [
  {
    rightsNo: 'AS-132222-001',
    orderNo: '132222623132329291',
    skuId: '135676631',
    rightsType: ServiceType.RETURN_GOODS,
    receiptStatus: ServiceReceiptStatus.RECEIPTED,
    rightsStatus: AfterServiceStatus.TO_AUDIT,
    rightsReasonType: '2',
    rightsReasonDesc: '质量问题',
    rightsImageUrls: ['https://tdesign.gtimg.com/miniprogram/template/retail/goods/nz-09a.png'],
  },
  {
    rightsNo: 'AS-132222-002',
    orderNo: '132222623132329291',
    skuId: '135676629',
    rightsType: ServiceType.RETURN_GOODS,
    receiptStatus: ServiceReceiptStatus.RECEIPTED,
    rightsStatus: AfterServiceStatus.THE_APPROVED,
    rightsReasonType: '4',
    rightsReasonDesc: '包装/商品/污迹/裂痕/变形',
  },
  {
    rightsNo: 'AS-132222-003',
    orderNo: '132222623132329291',
    skuId: '135676629',
    quantity: 2,
    rightsType: ServiceType.RETURN_GOODS,
    receiptStatus: ServiceReceiptStatus.RECEIPTED,
    rightsStatus: AfterServiceStatus.HAVE_THE_GOODS,
    rightsReasonType: '3',
    rightsReasonDesc: '少件/漏发',
    logisticsNo: 'YD20260822003',
    logisticsCompanyCode: 'yunda',
    logisticsCompanyName: '韵达快递',
  },
  {
    rightsNo: 'AS-132222-004',
    orderNo: '132222623132329291',
    skuId: '135691625',
    rightsType: ServiceType.RETURN_GOODS,
    receiptStatus: ServiceReceiptStatus.RECEIPTED,
    rightsStatus: AfterServiceStatus.ABNORMAL_RECEIVING,
    rightsReasonType: '2',
    rightsReasonDesc: '质量问题',
    logisticsNo: 'ST20260822004',
    logisticsCompanyCode: 'shentong',
    logisticsCompanyName: '申通快递',
  },
  {
    rightsNo: 'AS-130169-005',
    orderNo: '130169571554503755',
    skuId: '135691631',
    quantity: 2,
    rightsType: ServiceType.ONLY_REFUND,
    rightsStatus: AfterServiceStatus.COMPLETE,
    rightsReasonType: '8',
    rightsReasonDesc: '不喜欢',
  },
  {
    rightsNo: 'AS-130150-006',
    orderNo: '130150835531421259',
    skuId: '135681631',
    rightsType: ServiceType.ONLY_REFUND,
    rightsStatus: AfterServiceStatus.CLOSED,
    rightsReasonType: '1',
    rightsReasonDesc: '实际商品与描述不符',
  },
];

const records = mockDefinitions.map((definition) => buildRecord(definition));

export function getAfterServiceRecords() {
  return clone(records);
}

export function getAfterServiceStates() {
  return {
    audit: records.filter((item) => item.rights.rightsStatus === AfterServiceStatus.TO_AUDIT).length,
    approved: records.filter((item) => item.rights.rightsStatus === AfterServiceStatus.THE_APPROVED).length,
    complete: records.filter((item) => item.rights.rightsStatus === AfterServiceStatus.COMPLETE).length,
    closed: records.filter((item) => item.rights.rightsStatus === AfterServiceStatus.CLOSED).length,
  };
}

export function getAfterServiceDetail(rightsNo) {
  return clone(records.filter((item) => item.rights.rightsNo === rightsNo));
}

export function createMockAfterService(params = {}) {
  const rights = params.rights || {};
  const record = buildRecord({
    orderNo: rights.orderNo,
    rightsType: Number(rights.rightsType) || ServiceType.ONLY_REFUND,
    receiptStatus: Number(rights.receiptStatus),
    rightsStatus: AfterServiceStatus.TO_AUDIT,
    rightsReasonType: rights.rightsReasonType,
    rightsReasonDesc: rights.rightsReasonDesc,
    refundAmount: rights.refundRequestAmount,
    rightsItems: params.rightsItem || [],
    rightsImageUrls: rights.rightsImageUrls || [],
    remark: params.refundMemo || '',
    refundDesc: params.refundMemo || '商家将尽快处理您的售后申请',
    createTime: `${Date.now()}`,
  });
  records.unshift(record);
  return clone(record);
}

export function updateMockAfterServiceLogistics(params = {}) {
  const record = records.find((item) => item.rights.rightsNo === params.rightsNo);
  if (!record) return null;

  record.logisticsVO = {
    ...record.logisticsVO,
    logisticsNo: params.logisticsNo || '',
    logisticsCompanyCode: params.logisticsCompanyCode || '',
    logisticsCompanyName: params.logisticsCompanyName || '',
    remark: params.remark || '',
    nodes: params.nodes || record.logisticsVO.nodes || [],
  };
  record.rights.rightsStatus = AfterServiceStatus.HAVE_THE_GOODS;
  record.rights.rightsStatusName = STATUS_META[AfterServiceStatus.HAVE_THE_GOODS].rightsStatusName;
  record.rights.userRightsStatus = STATUS_META[AfterServiceStatus.HAVE_THE_GOODS].userRightsStatus;
  record.rights.userRightsStatusName = STATUS_META[AfterServiceStatus.HAVE_THE_GOODS].userRightsStatusName;
  record.rights.userRightsStatusDesc = STATUS_META[AfterServiceStatus.HAVE_THE_GOODS].userRightsStatusDesc;
  record.buttonVOs = [];
  record.rights.updateTime = `${Date.now()}`;

  return clone(record);
}

export function createMockResponse(data) {
  return {
    data,
    code: 'Success',
    msg: null,
    requestId: mockReqId(),
    clientIp: mockIp(),
    rt: 20,
    success: true,
  };
}
