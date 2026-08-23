import { callShop } from '../../utils/cloud';

let cachedAddressList = null;
let addressMutationQueue = Promise.resolve();

function firstValue(source, keys, fallback = '') {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return fallback;
}

function addressIdOf(address = {}) {
  const value = address.addressId ?? address.id ?? address._id;
  return value === undefined || value === null || value === '' ? '' : String(value);
}

function isDefaultAddress(address = {}) {
  return address.isDefault === true
    || address.isDefault === 1
    || address.isDefault === '1'
    || address.isDefault === 'true';
}

export function normalizeAddress(address = {}) {
  const addressId = addressIdOf(address);
  const provinceName = firstValue(address, ['provinceName', 'province']);
  const cityName = firstValue(address, ['cityName', 'city']);
  const districtName = firstValue(address, ['districtName', 'district', 'countyName', 'countryName']);
  const detailAddress = firstValue(address, ['detailAddress', 'detail', 'detailInfo']);
  const displayAddress = firstValue(address, ['address'])
    || `${provinceName}${cityName}${districtName}${detailAddress}`;
  return {
    ...address,
    id: addressId,
    addressId,
    name: firstValue(address, ['name', 'receiver']),
    phone: firstValue(address, ['phone', 'phoneNumber']),
    phoneNumber: firstValue(address, ['phoneNumber', 'phone']),
    provinceName,
    provinceCode: firstValue(address, ['provinceCode']),
    cityName,
    cityCode: firstValue(address, ['cityCode']),
    districtName,
    districtCode: firstValue(address, ['districtCode']),
    detailAddress,
    address: displayAddress,
    tag: firstValue(address, ['tag', 'addressTag']),
    addressTag: firstValue(address, ['addressTag', 'tag']),
    isDefault: isDefaultAddress(address) ? 1 : 0,
  };
}

function toCloudAddress(address = {}) {
  const payload = {
    receiver: firstValue(address, ['receiver', 'name']),
    phone: firstValue(address, ['phone', 'phoneNumber']),
    province: firstValue(address, ['province', 'provinceName']),
    city: firstValue(address, ['city', 'cityName']),
    district: firstValue(address, ['district', 'districtName', 'countryName']),
    detail: firstValue(address, ['detail', 'detailAddress', 'detailInfo', 'address']),
    postalCode: firstValue(address, ['postalCode', 'zipCode']),
    isDefault: isDefaultAddress(address),
  };
  const addressId = addressIdOf(address);
  if (addressId) payload.addressId = addressId;
  return payload;
}

function getAddressList(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  const list = result.addressList || result.items || result.list || result.addresses || [];
  return Array.isArray(list) ? list : [];
}

function cacheAddressList(addressList) {
  cachedAddressList = addressList.map(normalizeAddress);
  return cachedAddressList.map((address) => ({ ...address }));
}

function enqueueAddressMutation(operation) {
  const nextOperation = addressMutationQueue.then(operation);
  addressMutationQueue = nextOperation.catch(() => undefined);
  return nextOperation;
}

function mergeSavedAddress(originalAddress, result) {
  const savedSource = result && typeof result === 'object'
    ? (result.address && typeof result.address === 'object' ? result.address : result)
    : {};
  return normalizeAddress({ ...originalAddress, ...savedSource });
}

function updateCachedAddress(savedAddress) {
  if (!Array.isArray(cachedAddressList)) return savedAddress;

  let nextAddressList = cachedAddressList.map((address) => ({ ...address }));
  if (savedAddress.isDefault) {
    nextAddressList = nextAddressList.map((address) => ({ ...address, isDefault: 0 }));
  }
  const index = nextAddressList.findIndex(
    (address) => String(address.addressId) === String(savedAddress.addressId),
  );
  if (index > -1) nextAddressList[index] = savedAddress;
  else nextAddressList.push(savedAddress);
  cachedAddressList = nextAddressList.map(normalizeAddress);
  return savedAddress;
}

function persistAddressNow(address) {
  const payload = toCloudAddress(address);
  const action = payload.addressId ? 'addresses.update' : 'addresses.create';
  return callShop(action, payload)
    .then((result) => mergeSavedAddress(address, result))
    .then((savedAddress) => updateCachedAddress(savedAddress));
}

function setDefaultAddressNow(id) {
  return callShop('addresses.setDefault', { addressId: id }).then((result) => {
    const savedAddress = normalizeAddress({
      ...(result && typeof result === 'object' ? result : {}),
      addressId: id,
      isDefault: true,
    });
    if (Array.isArray(cachedAddressList)) {
      cachedAddressList = cachedAddressList.map((address) => ({
        ...address,
        isDefault: String(address.addressId) === String(id) ? 1 : 0,
      }));
    }
    return savedAddress;
  });
}

function deleteAddressNow(id, nextDefaultId = '') {
  return callShop('addresses.remove', { addressId: id })
    .then(() => {
      if (nextDefaultId) return setDefaultAddressNow(nextDefaultId);
      return null;
    })
    .then((defaultAddress) => {
      if (Array.isArray(cachedAddressList)) {
        cachedAddressList = cachedAddressList.filter(
          (address) => String(address.addressId) !== String(id),
        );
      }
      return defaultAddress;
    });
}

/** 获取收货地址详情；id 为空或 0 时由云端列表解析默认地址。 */
export function fetchDeliveryAddress(id = '') {
  if (id === '' || id === null || id === undefined || String(id) === '0') {
    return fetchDeliveryAddressList().then((addressList) => addressList.find((item) => item.isDefault) || addressList[0] || null);
  }
  return callShop('addresses.get', { addressId: id })
    .then((result) => (result ? normalizeAddress(result.address || result) : null));
}

/** 获取收货地址列表，不读取本地存储。 */
export function fetchDeliveryAddressList(len = 50) {
  return callShop('addresses.list', { page: 1, pageSize: Math.max(1, Number(len) || 50) })
    .then((result) => cacheAddressList(getAddressList(result)));
}

/** 新增或编辑真实地址。 */
export function persistAddress(address) {
  return enqueueAddressMutation(() => persistAddressNow(address));
}

/** 删除单个真实地址。 */
export function deleteDeliveryAddress(id, nextDefaultId = '') {
  return enqueueAddressMutation(() => deleteAddressNow(id, nextDefaultId));
}

/** 设置默认真实地址。 */
export function setDefaultDeliveryAddress(id) {
  return enqueueAddressMutation(() => setDefaultAddressNow(id));
}

/** 地址列表批量保存入口，全部通过云函数持久化。 */
export function persistAddressList(addressList) {
  if (!Array.isArray(addressList)) return Promise.resolve([]);
  const nextAddressList = addressList.map(normalizeAddress);
  const previousAddressList = Array.isArray(cachedAddressList) ? cachedAddressList : [];
  const nextIds = new Set(nextAddressList.filter((address) => address.addressId).map((address) => String(address.addressId)));
  const removedIds = previousAddressList
    .filter((address) => address.addressId && !nextIds.has(String(address.addressId)))
    .map((address) => address.addressId);
  return enqueueAddressMutation(() => removedIds
    .reduce((promise, id) => promise.then(() => deleteAddressNow(id)), Promise.resolve())
    .then(() => nextAddressList.reduce(
      (promise, address) => promise.then(() => persistAddressNow(address)),
      Promise.resolve(),
    )))
    .then(() => cacheAddressList(nextAddressList));
}
