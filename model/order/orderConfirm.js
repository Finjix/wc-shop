import { mockIp, mockReqId } from '../../utils/mock';

export const transformGoodsDataToConfirmData = (goodsDataList) => {
  const list = [];

  goodsDataList.forEach((goodsData) => {
    list.push({
      storeId: goodsData.storeId,
      spuId: goodsData.spuId,
      skuId: goodsData.skuId,
      goodsName: goodsData.title,
      image: goodsData.primaryImage,
      reminderStock: 119,
      quantity: goodsData.quantity,
      payPrice: goodsData.price,
      totalSkuPrice: goodsData.price,
      discountSettlePrice: goodsData.price,
      realSettlePrice: goodsData.price,
      settlePrice: goodsData.price,
      oriPrice: goodsData.originPrice,
      tagPrice: null,
      tagText: null,
      skuSpecLst: goodsData.specInfo,
      weight: 0.0,
      unit: 'KG',
      volume: null,
      masterGoodsType: 0,
      viceGoodsType: 0,
      roomId: goodsData.roomId,
      egoodsName: null,
    });
  });

  return list;
};

/** 生成结算数据 */
export function genSettleDetail(params) {
  const { userAddressReq, goodsRequestList } = params;

  const resp = {
    data: {
      settleType: 0,
      userAddress: null,
      totalGoodsCount: 0,
      totalAmount: '289997',
      totalPayAmount: '',
      totalSalePrice: '289997',
      totalDeliveryFee: '0',
      storeGoodsList: [
        {
          storeId: '1000',
          storeName: '云Mall深圳旗舰店',
          remark: null,
          goodsCount: 1,
          deliveryFee: '0',
          deliveryWords: null,
          skuDetailVos: [],
        },
      ],
      inValidGoodsList: null,
      outOfStockGoodsList: null,
      abnormalDeliveryGoodsList: null,
    },
    code: 'Success',
    msg: null,
    requestId: mockReqId(),
    clientIp: mockIp(),
    rt: 244,
    success: true,
  };

  const list = transformGoodsDataToConfirmData(goodsRequestList);

  // 获取购物车传递的商品数据
  resp.data.storeGoodsList[0].skuDetailVos = list;

  // 计算总价
  const totalPrice = list.reduce((pre, cur) => {
    return pre + cur.quantity * Number(cur.settlePrice);
  }, 0);

  const totalGoodsCount = list.reduce((pre, cur) => {
    return pre + (Number(cur.quantity) || 0);
  }, 0);

  resp.data.totalSalePrice = totalPrice;

  resp.data.totalGoodsCount = totalGoodsCount;

  resp.data.totalPayAmount = totalPrice;

  if (userAddressReq) {
    resp.data.settleType = 1;
    resp.data.userAddress = userAddressReq;
  }
  return resp;
}
