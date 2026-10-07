// @ts-nocheck

const crypto = require('crypto');

function shippingAddressOf(order) {
  const source = [order.addressSnapshot, order.userAddress, order.userAddressReq, order.address]
    .find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
  const text = (...keys) => keys.map((key) => String(source[key] ?? '').trim().replace(/\s+/g, ' ')).find(Boolean) || '';
  const address = {
    receiver: text('receiver', 'name', 'consignee'),
    phone: text('phone', 'phoneNumber', 'mobile').replace(/\s+/g, ''),
    province: text('province', 'provinceName'),
    city: text('city', 'cityName'),
    district: text('district', 'districtName'),
    detail: text('detail', 'detailAddress', 'address'),
  };
  return { ...address, address: [address.province, address.city, address.district, address.detail].filter(Boolean).join(' ') };
}

function shippingGroupKey(order) {
  const address = shippingAddressOf(order);
  // Never combine incomplete addresses or orders belonging to different users.
  // Address document IDs do not matter; only the actual delivery snapshot does.
  const userId = order.userId || order.uid;
  if (!userId || !address.receiver || !address.phone || !address.detail) return null;
  return crypto.createHash('sha256').update(JSON.stringify([
    String(userId), address.receiver, address.phone, address.province, address.city, address.district, address.detail,
  ])).digest('hex');
}

module.exports = { shippingAddressOf, shippingGroupKey };
