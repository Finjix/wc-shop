import { mockIp, mockReqId } from '../../utils/mock';
import { genOrderDetail } from './orderDetail';
import { createMockAfterService } from './afterService';

const ServiceReceiptStatus = {
  RECEIPTED: 1,
  NOT_RECEIPTED: 2,
};

const ServiceType = {
  RETURN_GOODS: 10,
  ONLY_REFUND: 20,
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function getOrder(orderNo) {
  const response = genOrderDetail({ parameter: orderNo });
  return response && response.data;
}

function getOrderItems(orderNo, skuId, orderLevel) {
  const order = getOrder(orderNo);
  const items = (order && order.orderItemVOs) || [];
  return {
    order,
    items: orderLevel ? items : items.filter((item) => `${item.skuId}` === `${skuId}`),
  };
}

function toPreviewItem(order, item) {
  const quantity = Number(item.buyQuantity || 1);
  const paidAmountEach =
    Number(item.goodsPaymentPrice || 0) ||
    (quantity ? Number(item.itemPaymentAmount || 0) / quantity : 0);
  return {
    spuId: item.spuId,
    skuId: item.skuId,
    numOfSku: quantity,
    numOfSkuAvailable: quantity,
    refundableAmount: `${item.itemPaymentAmount || 0}`,
    paidAmountEach: `${paidAmountEach}`,
    boughtQuantity: quantity,
    goodsInfo: {
      goodsName: item.goodsName,
      skuImage: item.goodsPictureUrl,
      specInfo: item.specifications || [],
    },
    orderNo: order && order.orderNo,
  };
}

export function genRightsPreview(params = {}) {
  const { orderNo, skuId, orderLevel } = params;
  const { order, items } = getOrderItems(orderNo, skuId, orderLevel);
  if (!order || items.length === 0) return undefined;

  const goodsList = items.map((item) => toPreviewItem(order, item));
  const quantity = goodsList.reduce((total, item) => total + Number(item.numOfSku || 0), 0);
  const refundableAmount = orderLevel
    ? Number(order.paymentAmount || 0) ||
      goodsList.reduce((total, item) => total + Number(item.refundableAmount || 0), 0)
    : Number(goodsList[0].refundableAmount || 0);

  return {
    data: {
      ...goodsList[0],
      skuId: orderLevel ? '' : goodsList[0].skuId,
      numOfSku: quantity,
      numOfSkuAvailable: quantity,
      boughtQuantity: quantity,
      refundableAmount: `${refundableAmount}`,
      shippingFeeIncluded: `${order.freightFee || 0}`,
      goodsList,
    },
    code: 'Success',
    msg: null,
    requestId: mockReqId(),
    clientIp: mockIp(),
    rt: 24,
    success: true,
  };
}

const RECEIVED_REASONS = [
  { id: '1', desc: '实际商品与描述不符' },
  { id: '2', desc: '质量问题' },
  { id: '3', desc: '少件/漏发' },
  { id: '4', desc: '包装/商品/污迹/裂痕/变形' },
  { id: '5', desc: '发货太慢' },
  { id: '6', desc: '物流配送太慢' },
  { id: '7', desc: '商家发错货' },
  { id: '8', desc: '不喜欢' },
];

const NOT_RECEIVED_REASONS = [
  { id: '9', desc: '空包裹' },
  { id: '10', desc: '快递/物流一直未送到' },
  { id: '11', desc: '货物破损已拒签' },
  { id: '12', desc: '收到商品与订单不符' },
];

export function genApplyReasonList(params = {}) {
  const notReceived =
    Number(params.rightsReasonType) === ServiceReceiptStatus.NOT_RECEIPTED;
  return {
    data: {
      saasId: '70000001',
      rightsReasonList: clone(notReceived ? NOT_RECEIVED_REASONS : RECEIVED_REASONS),
    },
    code: 'Success',
    msg: null,
    requestId: mockReqId(),
    clientIp: mockIp(),
    rt: 6,
    success: true,
  };
}

export function applyService(params = {}) {
  const record = createMockAfterService(params);
  return {
    data: {
      rightsNo: record.rights.rightsNo,
      saasId: record.rights.saasId,
      uid: record.rights.uid,
      storeId: record.rights.storeId,
      result: null,
    },
    code: 'Success',
    msg: null,
    requestId: mockReqId(),
    clientIp: mockIp(),
    rt: 40,
    success: true,
  };
}

export { ServiceReceiptStatus, ServiceType };
