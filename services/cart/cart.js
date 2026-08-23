import { config } from '../../config/index';
import { apiUnavailable } from '../_utils/apiUnavailable';

const MOCK_CART_ADDITIONS_KEY = 'wc-shop.mock-cart-additions';
const MOCK_CART_DATA_KEY = 'wc-shop.mock-cart-data';
let memoryMockCartAdditions = [];
let memoryMockCartGroupData = null;

function cloneMockCartData(data) {
  return data ? JSON.parse(JSON.stringify(data)) : null;
}

function getMockCartAdditions() {
  try {
    const additions = wx.getStorageSync(MOCK_CART_ADDITIONS_KEY);
    if (Array.isArray(additions)) {
      memoryMockCartAdditions = additions;
      return additions;
    }
  } catch (error) {
    // 使用内存备份，避免开发者工具 storage 暂不可用时加入结果丢失。
  }
  return memoryMockCartAdditions;
}

function saveMockCartAdditions(additions) {
  memoryMockCartAdditions = additions;
  try {
    wx.setStorageSync(MOCK_CART_ADDITIONS_KEY, additions);
  } catch (error) {
    // 微信开发者工具未提供 storage 时仍允许当前页面完成加入购物车反馈。
  }
}

function getSavedMockCartGroupData() {
  if (memoryMockCartGroupData) return cloneMockCartData(memoryMockCartGroupData);
  try {
    const cartData = wx.getStorageSync(MOCK_CART_DATA_KEY);
    if (cartData && typeof cartData === 'object') {
      memoryMockCartGroupData = cartData;
      return cloneMockCartData(cartData);
    }
  } catch (error) {
    // 使用内存备份，避免开发者工具 storage 暂不可用时购物车状态丢失。
  }
  return null;
}

function saveMockCartGroupData(cartData) {
  memoryMockCartGroupData = cloneMockCartData(cartData);
  memoryMockCartAdditions = [];
  try {
    wx.setStorageSync(MOCK_CART_DATA_KEY, memoryMockCartGroupData);
    wx.removeStorageSync(MOCK_CART_ADDITIONS_KEY);
  } catch (error) {
    // 微信开发者工具未提供 storage 时保留内存状态。
  }
}

function mergeMockCartAdditions(resp) {
  const additions = getMockCartAdditions();
  if (!additions.length || !resp?.data?.storeGoods?.length) return resp;

  additions.forEach((addition) => {
    const store = resp.data.storeGoods.find(
      (item) => String(item.storeId) === String(addition.storeId),
    );
    const targetActivity = store?.promotionGoodsList?.find((activity) =>
      Array.isArray(activity.goodsPromotionList),
    );
    if (!targetActivity) return;

    const additionQuantity = Number(addition.quantity) || 1;
    const existingGoods = targetActivity.goodsPromotionList.find(
      (goods) => goods.spuId === addition.spuId && goods.skuId === addition.skuId,
    );
    if (existingGoods) {
      existingGoods.quantity = (Number(existingGoods.quantity) || 0) + additionQuantity;
    } else {
      targetActivity.goodsPromotionList.push({ ...addition, quantity: additionQuantity });
    }
    resp.data.totalAmount = String(
      (Number(resp.data.totalAmount) || 0) + (Number(addition.price) || 0) * additionQuantity,
    );
  });

  return resp;
}

/** 获取购物车mock数据 */
function mockFetchCartGroupData(params) {
  const { delay } = require('../_utils/delay');
  const { genCartGroupData } = require('../../model/cart');

  return delay().then(() => genCartGroupData(params));
}

/** 获取购物车数据 */
export function fetchCartGroupData(params) {
  if (config.useMock) {
    const savedCartData = getSavedMockCartGroupData();
    if (savedCartData) return Promise.resolve({ data: savedCartData });

    return mockFetchCartGroupData(params).then((resp) => {
      const mergedResp = mergeMockCartAdditions(resp);
      saveMockCartGroupData(mergedResp.data);
      return mergedResp;
    });
  }

  return apiUnavailable('fetchCartGroupData');
}

/** 保存购物车 mock 快照，供页面切换和重新加载时复用。 */
export function persistMockCartGroupData(cartData) {
  if (config.useMock && cartData) saveMockCartGroupData(cartData);
  return Promise.resolve();
}

function appendGoodsToMockCart(cartData, goods) {
  const store = (cartData.storeGoods || []).find(
    (item) => String(item.storeId) === String(goods.storeId),
  );
  const targetActivity = store?.promotionGoodsList?.find((activity) => Array.isArray(activity.goodsPromotionList));
  if (!targetActivity) return false;

  const quantity = Number(goods.quantity) || 1;
  const existingGoods = targetActivity.goodsPromotionList.find(
    (item) => item.spuId === goods.spuId && item.skuId === goods.skuId,
  );
  if (existingGoods) {
    existingGoods.quantity = (Number(existingGoods.quantity) || 0) + quantity;
  } else {
    targetActivity.goodsPromotionList.push({ ...goods, quantity });
  }
  cartData.totalAmount = String((Number(cartData.totalAmount) || 0) + (Number(goods.price) || 0) * quantity);
  cartData.isNotEmpty = true;
  return true;
}

/** 将详情页选中的 SKU 加入 mock 购物车。真实环境由后端购物车接口替换。 */
export function addGoodsToCart(goods) {
  if (!goods || !goods.spuId || !goods.skuId) {
    return Promise.reject(new Error('购物车商品信息不完整'));
  }

  const savedCartData = getSavedMockCartGroupData();
  if (savedCartData) {
    if (!appendGoodsToMockCart(savedCartData, goods)) {
      return Promise.reject(new Error('购物车门店不存在'));
    }
    saveMockCartGroupData(savedCartData);
    return Promise.resolve();
  }

  const additions = getMockCartAdditions();
  const existingGoods = additions.find((item) => item.spuId === goods.spuId && item.skuId === goods.skuId);
  if (existingGoods) {
    existingGoods.quantity = (Number(existingGoods.quantity) || 0) + (Number(goods.quantity) || 1);
  } else {
    additions.push({ ...goods, quantity: Number(goods.quantity) || 1 });
  }
  saveMockCartAdditions(additions);
  return Promise.resolve();
}
