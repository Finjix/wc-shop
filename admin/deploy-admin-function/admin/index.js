const { createRuntime, getPayload } = require('../shared/runtime');
const { runEndpoint } = require('../shared/response');
const { errorFrom } = require('../shared/errors');
const { adminEndpoint } = require('../shared/admin');

exports.main = async (event, context) => runEndpoint(async (input, ctx) => {
  const runtime = createRuntime();
  const { action, data } = getPayload(input);
  if (!action || typeof action !== 'string') throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
  return adminEndpoint(input, ctx, runtime, action, data || {});
}, event, context);
