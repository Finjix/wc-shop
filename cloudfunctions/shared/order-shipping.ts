// @ts-nocheck

const crypto = require('crypto');

function shippingAddressOf(order) {
  const source = order.addressSnapshot || {};
  const text = (key) => String(source[key] ?? '').trim().replace(/\s+/g, ' ');
  const address = {
    receiver: text('receiver'),
    phone: text('phone').replace(/\s+/g, ''),
    province: text('province'),
    city: text('city'),
    district: text('district'),
    detail: text('detail'),
  };
  return { ...address, address: [address.province, address.city, address.district, address.detail].filter(Boolean).join(' ') };
}

function shippingGroupKey(order) {
  const address = shippingAddressOf(order);
  // Never combine incomplete addresses or orders belonging to different users.
  // Address document IDs do not matter; only the actual delivery snapshot does.
  const userId = order.userId;
  if (!userId || !address.receiver || !address.phone || !address.detail) return null;
  return crypto.createHash('sha256').update(JSON.stringify([
    String(userId), address.receiver, address.phone, address.province, address.city, address.district, address.detail,
  ])).digest('hex');
}

module.exports = { shippingAddressOf, shippingGroupKey };
