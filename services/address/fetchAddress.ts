// @ts-nocheck
// Address books are device-local. No address operation imports the cloud API.
const STORAGE_KEY = 'wc-shop.addresses.v1';
let addressMutationQueue = Promise.resolve();

function addressIdOf(address = {}) {
  const value = address.addressId ?? address.id ?? address._id;
  return value === undefined || value === null || value === '' ? '' : String(value);
}
function isDefaultAddress(address = {}) { return address.isDefault === true || address.isDefault === 1; }

export function normalizeAddress(address = {}) {
  const addressId = addressIdOf(address);
  const provinceName = address.province || '';
  const cityName = address.city || '';
  const districtName = address.district || '';
  const detailAddress = address.detail || '';
  const displayAddress = `${provinceName}${cityName}${districtName}${detailAddress}`;
  return {
    ...address,
    id: addressId,
    addressId,
    name: address.receiver,
    phone: address.phone,
    phoneNumber: address.phone,
    provinceName,
    provinceCode: address.provinceCode || '',
    cityName,
    cityCode: address.cityCode || '',
    districtName,
    districtCode: address.districtCode || '',
    detailAddress,
    address: displayAddress,
    tag: address.tag || '',
    addressTag: address.tag || '',
    isDefault: isDefaultAddress(address) ? 1 : 0,
  };
}

export function toOrderAddress(address = {}) {
  return {
    receiver: address.name ?? address.receiver ?? '',
    phone: address.phone ?? address.phoneNumber ?? '',
    province: address.provinceName ?? address.province ?? '',
    city: address.cityName ?? address.city ?? '',
    district: address.districtName ?? address.district ?? '',
    detail: address.detailAddress ?? address.detail ?? '',
    postalCode: address.postalCode ?? '',
    tag: address.addressTag ?? address.tag ?? '',
    provinceCode: address.provinceCode ?? '',
    cityCode: address.cityCode ?? '',
    districtCode: address.districtCode ?? '',
  };
}
function readAddresses() {
  const value = wx.getStorageSync(STORAGE_KEY);
  if (value === '' || value === undefined || value === null) return [];
  if (value.version !== 1 || !Array.isArray(value.items)) throw new Error('本地地址数据异常，请检查小程序存储');
  return value.items.map((item) => normalizeAddress(item));
}
function writeAddresses(items) {
  wx.setStorageSync(STORAGE_KEY, { version: 1, items });
  return items.map((item) => normalizeAddress(item));
}
function enqueue(operation) {
  const next = addressMutationQueue.then(operation);
  addressMutationQueue = next.catch(() => undefined);
  return next;
}
function newId() { return `local_addr_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
function storedAddress(address, previous) {
  const fields = toOrderAddress(address);
  if (!fields.receiver.trim() || !fields.phone.trim() || !fields.detail.trim()) throw new Error('请填写完整收货地址');
  return { ...fields, _id: previous?._id || newId(), isDefault: isDefaultAddress(address),
    createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function normalizeDefault(items, preferred = '') {
  const id = preferred || items.find((item) => item.isDefault)?._id || items[0]?._id;
  return items.map((item) => ({ ...item, isDefault: item._id === id }));
}
export function fetchDeliveryAddressList(len = 50) {
  return Promise.resolve().then(() => readAddresses().sort((a, b) => b.isDefault - a.isDefault).slice(0, Math.max(1, Number(len) || 50)));
}
export function fetchDeliveryAddress(id = '') {
  return Promise.resolve().then(() => {
    const items = readAddresses();
    if (id === '' || id === null || id === undefined || String(id) === '0') return items.find((item) => item.isDefault) || items[0] || null;
    return items.find((item) => item.addressId === String(id)) || null;
  });
}
export function persistAddress(address) {
  return enqueue(() => {
    const items = readAddresses();
    const id = addressIdOf(address);
    const previous = id ? items.find((item) => item.addressId === id) : undefined;
    if (id && !previous) throw new Error('该本地地址已删除，请重新添加');
    const saved = storedAddress(address, previous);
    const next = previous ? items.map((item) => item.addressId === id ? saved : item) : [...items, saved];
    const written = writeAddresses(normalizeDefault(next, saved.isDefault ? saved._id : ''));
    return written.find((item) => item.addressId === saved._id);
  });
}
export function setDefaultDeliveryAddress(id) {
  return enqueue(() => {
    const items = readAddresses();
    if (!items.some((item) => item.addressId === String(id))) throw new Error('该本地地址已删除');
    return writeAddresses(normalizeDefault(items, String(id))).find((item) => item.addressId === String(id));
  });
}
export function deleteDeliveryAddress(id, nextDefaultId = '') {
  return enqueue(() => {
    const items = readAddresses().filter((item) => item.addressId !== String(id));
    const preferred = items.some((item) => item.addressId === String(nextDefaultId)) ? String(nextDefaultId) : '';
    return writeAddresses(normalizeDefault(items, preferred)).find((item) => item.isDefault) || null;
  });
}
export function persistAddressList(addressList) {
  return enqueue(() => {
    if (!Array.isArray(addressList)) throw new Error('地址列表无效');
    const previous = readAddresses();
    const items = addressList.map((address) => storedAddress(address, previous.find((item) => item.addressId === addressIdOf(address))));
    if (new Set(items.map((item) => item._id)).size !== items.length) throw new Error('地址列表包含重复地址');
    return writeAddresses(normalizeDefault(items));
  });
}
