import { config } from '../../config/index';

const MOCK_ADDRESS_LIST_KEY = 'wc-shop.mock-address-list';
let memoryMockAddressList = null;

function cloneMockAddressList(addressList) {
  return addressList ? JSON.parse(JSON.stringify(addressList)) : null;
}

function getSavedMockAddressList() {
  if (memoryMockAddressList) return cloneMockAddressList(memoryMockAddressList);

  try {
    const addressList = wx.getStorageSync(MOCK_ADDRESS_LIST_KEY);
    if (Array.isArray(addressList)) {
      memoryMockAddressList = addressList;
      return cloneMockAddressList(addressList);
    }
  } catch (error) {
    // 使用内存备份，避免开发者工具 storage 暂不可用时地址数据丢失。
  }
  return null;
}

function saveMockAddressList(addressList) {
  memoryMockAddressList = cloneMockAddressList(addressList);
  try {
    wx.setStorageSync(MOCK_ADDRESS_LIST_KEY, memoryMockAddressList);
  } catch (error) {
    // 微信开发者工具未提供 storage 时保留内存状态。
  }
}

function normalizeAddress(address) {
  return {
    ...address,
    phoneNumber: address.phone,
    address: `${address.provinceName}${address.cityName}${address.districtName}${address.detailAddress}`,
    tag: address.addressTag,
  };
}

function getMockAddressList(len = 10) {
  const savedAddressList = getSavedMockAddressList();
  if (savedAddressList) return savedAddressList;

  const { genAddressList } = require('../../model/address');
  const addressList = genAddressList(len).map(normalizeAddress);
  saveMockAddressList(addressList);
  return cloneMockAddressList(addressList);
}

/** 获取收货地址 */
function mockFetchDeliveryAddress(id) {
  const { delay } = require('../_utils/delay');

  return delay().then(() => {
    const addressList = getMockAddressList(Math.max(Number(id) + 1, 10));
    return addressList.find((address) => String(address.id) === String(id)) || null;
  });
}

/** 获取收货地址 */
export function fetchDeliveryAddress(id = 0) {
  if (config.useMock) {
    return mockFetchDeliveryAddress(id);
  }

  return new Promise((resolve) => {
    resolve('real api');
  });
}

/** 获取收货地址列表 */
function mockFetchDeliveryAddressList(len = 0) {
  const { delay } = require('../_utils/delay');

  return delay().then(() => getMockAddressList(len));
}

/** 获取收货地址列表 */
export function fetchDeliveryAddressList(len = 10) {
  if (config.useMock) {
    return mockFetchDeliveryAddressList(len);
  }

  return new Promise((resolve) => {
    resolve('real api');
  });
}

/** 保存 mock 收货地址列表，供地址新增、编辑和删除后复用。 */
export function persistMockAddressList(addressList) {
  if (config.useMock && Array.isArray(addressList)) {
    saveMockAddressList(addressList);
  }
  return Promise.resolve();
}

/** 保存单个 mock 收货地址，确保直接返回地址页时数据也不会丢失。 */
export function persistMockAddress(address) {
  if (config.useMock && address && typeof address === 'object') {
    const addressList = getMockAddressList();
    const addressId = address.addressId || address.id || `${addressList.length}`;
    const normalizedAddress = normalizeAddress({ ...address, id: addressId, addressId });
    const addressIndex = addressList.findIndex(
      (item) => String(item.id ?? item.addressId) === String(addressId),
    );

    if (normalizedAddress.isDefault === 1) {
      addressList.forEach((item) => {
        item.isDefault = 0;
      });
    }

    if (addressIndex > -1) {
      addressList[addressIndex] = normalizedAddress;
    } else {
      addressList.push(normalizedAddress);
    }
    saveMockAddressList(addressList);
  }
  return Promise.resolve();
}
