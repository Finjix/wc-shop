// @ts-nocheck
const crypto = require('crypto');
const { all, getDoc, setDoc, withTransaction } = require('./db');
const { string, assert } = require('./validation');
const { errorFrom } = require('./errors');
const KIND = 'merchant_return_address';

function addressFields(data) {
  for (const field of ['receiver', 'phone', 'detail']) assert(typeof data[field] === 'string', { field });
  const { receiver, phone, detail } = data;
  return { receiver, phone, detail };
}

async function selectedReturnAddress(db, id) {
  const key = string(id, 'returnAddressId', { max: 128 });
  const address = await getDoc(db.collection('settings'), key, false);
  if (!address || address.kind !== KIND) throw errorFrom('RETURN_ADDRESS_REQUIRED');
  return { _id: key, ...addressFields(address) };
}

async function returnAddressesAction(runtime, data, action) {
  const collection = runtime.db.collection('settings');
  if (action === 'returnAddresses.list') {
    const items = await all(collection, { kind: KIND });
    return { items: items.map((row) => ({ _id: row._id, ...addressFields(row) })) };
  }
  if (action === 'returnAddresses.save') {
    const fields = addressFields(data);
    const id = data.id ? string(data.id, 'id', { max: 128 }) : `return_address_${crypto.randomUUID()}`;
    return withTransaction(runtime.db, async (tx) => {
      if (data.id) await selectedReturnAddress(tx, id);
      await setDoc(tx.collection('settings'), id, { kind: KIND, ...fields, updatedAt: new Date().toISOString() });
      return { _id: id, ...fields };
    });
  }
  if (action === 'returnAddresses.delete') {
    const id = string(data.id, 'id', { max: 128 });
    return withTransaction(runtime.db, async (tx) => {
      await selectedReturnAddress(tx, id);
      await tx.collection('settings').doc(id).remove();
      return { deleted: true, id };
    });
  }
  throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
}

module.exports = { returnAddressesAction, selectedReturnAddress };
