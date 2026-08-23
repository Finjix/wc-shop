const crypto = require('crypto');
const { toPublicError } = require('./errors');

function requestId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function ok(data, id) {
  return { ok: true, data: data === undefined ? null : data, requestId: id || requestId() };
}

function fail(error, id) {
  const publicError = toPublicError(error);
  return {
    ok: false,
    data: null,
    requestId: id || requestId(),
    error: {
      code: publicError.code,
      message: publicError.message,
      ...(publicError.details ? { details: publicError.details } : {}),
    },
  };
}

async function runEndpoint(endpoint, event, context, runtime) {
  const id = requestId();
  try {
    return { ...ok(await endpoint(event, context, runtime), id), requestId: id };
  } catch (error) {
    if (!(error && error.code)) console.error(`[${id}]`, error);
    return fail(error, id);
  }
}

module.exports = { requestId, ok, fail, runEndpoint };
