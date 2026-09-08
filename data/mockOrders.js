import { mockAddresses } from './mockAddresses';
import { mockProducts } from './mockProducts';

export const MockOrderStatus = {
  PENDING_PAYMENT: 5,
  PENDING_DELIVERY: 10,
  PENDING_RECEIPT: 40,
  COMPLETE: 50,
  CANCELED: 80,
};

const STATUS_NAMES = {
  [MockOrderStatus.PENDING_PAYMENT]: '待支付',
  [MockOrderStatus.PENDING_DELIVERY]: '待发货',
  [MockOrderStatus.PENDING_RECEIPT]: '待收货',
  [MockOrderStatus.COMPLETE]: '已完成',
  [MockOrderStatus.CANCELED]: '已取消',
};

const STORE = {
  storeId: '1000',
  storeName: '云mall标准版旗舰店',
};

const MOCK_NOW = 1750000000000;
let orderSequence = 1009;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getPrice(sku, product) {
  return sku?.priceInfo?.find((item) => item.priceType === 1)?.price ?? product?.minSalePrice ?? 0;
}

function toReceiverAddress(address = {}) {
  return {
    receiverName: address.receiverName || address.name || '',
    receiverPhone: address.receiverPhone || address.phone || address.phoneNumber || '',
    receiverProvince: address.receiverProvince || address.provinceName || '',
    receiverCity: address.receiverCity || address.cityName || '',
    receiverCountry: address.receiverCountry || address.districtName || '',
    receiverArea: address.receiverArea || '',
    receiverAddress: address.receiverAddress || address.detailAddress || '',
    addressId: address.addressId || address.id || '',
  };
}

function getDefaultAddress() {
  const address = mockAddresses.find((item) => item.isDefault) || mockAddresses[0] || {};
  return toReceiverAddress(address);
}

function buttonsForStatus(status, commented = false) {
  if (status === MockOrderStatus.PENDING_PAYMENT) {
    return [
      { type: 1, name: '去支付', primary: true },
      { type: 2, name: '取消订单' },
    ];
  }
  if (status === MockOrderStatus.PENDING_DELIVERY) {
    return [{ type: 4, name: '申请售后' }];
  }
  if (status === MockOrderStatus.PENDING_RECEIPT) {
    return [{ type: 3, name: '确认收货', primary: true }];
  }
  if (status === MockOrderStatus.COMPLETE) {
    return commented
      ? [{ type: 10, name: '查看评价' }, { type: 7, name: '删除订单' }]
      : [{ type: 6, name: '评价', primary: true }, { type: 7, name: '删除订单' }];
  }
  return [{ type: 7, name: '删除订单' }];
}

export function findMockSku(skuId) {
  for (const product of mockProducts) {
    const skuIndex = (product.skuList || []).findIndex((sku) => String(sku.skuId) === String(skuId));
    if (skuIndex >= 0) return { product, sku: product.skuList[skuIndex], skuIndex };
  }
  return null;
}

function createGoodsRecord(product, sku, quantity = 1, id = '') {
  const price = getPrice(sku, product);
  return {
    id: id || `${product.spuId}-${sku.skuId}`,
    spuId: product.spuId,
    skuId: sku.skuId,
    goodsPictureUrl: sku.skuImage || product.primaryImage,
    goodsName: product.title,
    specifications: sku.specInfo || [],
    buyQuantity: quantity,
    actualPrice: price,
    itemPaymentAmount: price * quantity,
  };
}

function createProductGoods(productIndex, skuIndex = 0, quantity = 1) {
  const product = mockProducts[(productIndex - 1) % mockProducts.length];
  const sku = product?.skuList?.[skuIndex % (product.skuList.length || 1)];
  return sku ? createGoodsRecord(product, sku, quantity) : null;
}

function createOrder({
  orderId,
  orderNo,
  status,
  goods,
  createdAt,
  commented = false,
  address,
}) {
  const orderGoods = goods.filter(Boolean);
  const totalAmount = orderGoods.reduce((total, item) => total + Number(item.itemPaymentAmount || 0), 0);
  const freightFee = 0;
  const orderAddress = address ? toReceiverAddress(address) : getDefaultAddress();
  const paid = status !== MockOrderStatus.PENDING_PAYMENT && status !== MockOrderStatus.CANCELED;
  const trajectoryVos = status === MockOrderStatus.PENDING_RECEIPT || status === MockOrderStatus.COMPLETE
    ? [{
      title: status === MockOrderStatus.COMPLETE ? '已签收' : '运输中',
      code: status === MockOrderStatus.COMPLETE ? 200005 : 200007,
      nodes: [{
        status: status === MockOrderStatus.COMPLETE ? '包裹已签收' : '包裹正在运输中',
        timestamp: createdAt + 86400000 * 2,
      }],
    }]
    : [];

  return {
    orderId,
    orderNo,
    parentOrderNo: '',
    ...STORE,
    orderStatus: status,
    orderStatusName: STATUS_NAMES[status],
    paymentAmount: totalAmount + freightFee,
    totalAmount,
    goodsAmountApp: totalAmount,
    freightFee,
    createTime: createdAt,
    orderItemVOs: orderGoods,
    buttonVOs: buttonsForStatus(status, commented),
    logisticsVO: {
      ...orderAddress,
      logisticsNo: status === MockOrderStatus.PENDING_RECEIPT || status === MockOrderStatus.COMPLETE
        ? `SF${orderNo.slice(-10)}`
        : '',
      logisticsCompanyName: '顺丰速运',
      logisticsCompanyTel: '95338',
    },
    trajectoryVos,
    paymentVO: paid ? { paySuccessTime: createdAt + 3600000 } : {},
    groupInfoVo: null,
  };
}

function createInitialOrders() {
  return [
    createOrder({
      orderId: 'mock-order-1001',
      orderNo: 'MOCK202506180001',
      status: MockOrderStatus.PENDING_PAYMENT,
      goods: [createProductGoods(1, 0, 1)],
      createdAt: MOCK_NOW,
    }),
    createOrder({
      orderId: 'mock-order-1002',
      orderNo: 'MOCK202506170002',
      status: MockOrderStatus.PENDING_DELIVERY,
      goods: [createProductGoods(2, 0, 1), createProductGoods(3, 1, 2)],
      createdAt: MOCK_NOW - 86400000,
    }),
    createOrder({
      orderId: 'mock-order-1003',
      orderNo: 'MOCK202506160003',
      status: MockOrderStatus.PENDING_RECEIPT,
      goods: [createProductGoods(4, 0, 1)],
      createdAt: MOCK_NOW - 86400000 * 2,
    }),
    createOrder({
      orderId: 'mock-order-1004',
      orderNo: 'MOCK202506150004',
      status: MockOrderStatus.COMPLETE,
      goods: [createProductGoods(5, 0, 1), createProductGoods(6, 0, 1)],
      createdAt: MOCK_NOW - 86400000 * 3,
    }),
    createOrder({
      orderId: 'mock-order-1005',
      orderNo: 'MOCK202506140005',
      status: MockOrderStatus.COMPLETE,
      goods: [createProductGoods(7, 1, 1)],
      createdAt: MOCK_NOW - 86400000 * 4,
      commented: true,
    }),
    createOrder({
      orderId: 'mock-order-1006',
      orderNo: 'MOCK202506130006',
      status: MockOrderStatus.CANCELED,
      goods: [createProductGoods(8, 0, 1)],
      createdAt: MOCK_NOW - 86400000 * 5,
    }),
    createOrder({
      orderId: 'mock-order-1007',
      orderNo: 'MOCK202506120007',
      status: MockOrderStatus.PENDING_RECEIPT,
      goods: [createProductGoods(9, 0, 1)],
      createdAt: MOCK_NOW - 86400000 * 6,
    }),
  ];
}

export const mockOrders = createInitialOrders();

export function listMockOrders(params = {}) {
  const requestedStatus = params.orderStatus ?? params.status;
  const filtered = requestedStatus === undefined || requestedStatus === '' || Number(requestedStatus) === -1
    ? mockOrders
    : mockOrders.filter((order) => Number(order.orderStatus) === Number(requestedStatus));
  const page = Math.max(1, Number(params.page || params.pageNum) || 1);
  const pageSize = Math.max(1, Number(params.pageSize) || 20);
  const start = (page - 1) * pageSize;
  return {
    page,
    pageNum: page,
    pageSize,
    totalCount: filtered.length,
    orders: clone(filtered.slice(start, start + pageSize)),
  };
}

export function getMockOrderCounts() {
  return [
    MockOrderStatus.PENDING_DELIVERY,
    MockOrderStatus.PENDING_RECEIPT,
    MockOrderStatus.COMPLETE,
  ].map((tabType) => ({
    tabType,
    orderNum: mockOrders.filter((order) => {
      if (order.orderStatus !== tabType) return false;
      if (tabType === MockOrderStatus.COMPLETE) {
        return (order.buttonVOs || []).some((button) => button.type === 6);
      }
      return true;
    }).length,
  }));
}

export function getMockOrder(orderNo) {
  const order = mockOrders.find((item) => String(item.orderNo) === String(orderNo) || String(item.orderId) === String(orderNo));
  return clone(order);
}

function updateMockOrderStatus(orderNo, status) {
  const order = mockOrders.find((item) => String(item.orderNo) === String(orderNo));
  if (!order) return null;
  order.orderStatus = status;
  order.orderStatusName = STATUS_NAMES[status];
  order.buttonVOs = buttonsForStatus(status);
  return clone(order);
}

export function cancelMockOrder(orderNo) {
  return updateMockOrderStatus(orderNo, MockOrderStatus.CANCELED);
}

export function confirmMockOrder(orderNo) {
  return updateMockOrderStatus(orderNo, MockOrderStatus.COMPLETE);
}

export function deleteMockOrder(orderNo) {
  const index = mockOrders.findIndex((item) => String(item.orderNo) === String(orderNo));
  if (index >= 0) mockOrders.splice(index, 1);
  return { success: true };
}

export function createMockOrderFromItems(items = {}, addressId = '') {
  const goods = (Array.isArray(items) ? items : []).map((item, index) => {
    const matched = findMockSku(item.skuId);
    if (!matched) return null;
    return createGoodsRecord(
      matched.product,
      matched.sku,
      Math.max(1, Number(item.quantity) || 1),
      `mock-order-item-${Date.now()}-${index}`,
    );
  }).filter(Boolean);
  if (!goods.length) return null;

  const orderNo = `MOCK${Date.now()}${String(orderSequence++).padStart(4, '0')}`;
  const order = createOrder({
    orderId: `mock-order-${orderSequence}`,
    orderNo,
    status: MockOrderStatus.PENDING_PAYMENT,
    goods,
    createdAt: Date.now(),
    address: mockAddresses.find((item) => String(item.addressId) === String(addressId)),
  });
  mockOrders.unshift(order);
  return clone(order);
}

export function buildMockSettleDetail(items = [], addressId = '') {
  const goods = (Array.isArray(items) ? items : []).map((item) => {
    const matched = findMockSku(item.skuId);
    if (!matched) return null;
    const quantity = Math.max(1, Number(item.quantity) || 1);
    return {
      product: matched.product,
      sku: matched.sku,
      quantity,
      price: getPrice(matched.sku, matched.product),
    };
  }).filter(Boolean);
  const totalAmount = goods.reduce((total, item) => total + item.price * item.quantity, 0);
  const address = mockAddresses.find((item) => String(item.addressId) === String(addressId)) || null;
  const storeGoods = {
    storeId: STORE.storeId,
    storeName: STORE.storeName,
    skuDetailVos: goods.map((item) => ({
      spuId: item.product.spuId,
      skuId: item.sku.skuId,
      image: item.sku.skuImage || item.product.primaryImage,
      goodsName: item.product.title,
      skuSpecLst: item.sku.specInfo || [],
      settlePrice: item.price,
      quantity: item.quantity,
    })),
  };
  return {
    settleType: 1,
    userAddress: address ? { ...address, checked: true } : null,
    totalGoodsCount: goods.reduce((total, item) => total + item.quantity, 0),
    totalAmount,
    totalPayAmount: totalAmount,
    totalSalePrice: totalAmount,
    totalDeliveryFee: 0,
    storeGoodsList: goods.length ? [storeGoods] : [],
    outOfStockGoodsList: [],
    abnormalDeliveryGoodsList: [],
    inValidGoodsList: [],
  };
}
