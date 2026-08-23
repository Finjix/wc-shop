const { createRuntime, getPayload } = require('../shared/runtime');
const { runEndpoint } = require('../shared/response');
const { errorFrom } = require('../shared/errors');
const { shopEndpoint } = require('../shared/shop');

exports.main = async (event, context) => runEndpoint(async (input, ctx) => {
  const runtime = createRuntime();
  const { action, data } = getPayload(input);
  if (!action || typeof action !== 'string') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  return shopEndpoint(input, ctx, runtime, action, data || {});
}, event, context);
