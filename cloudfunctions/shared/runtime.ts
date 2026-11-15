// @ts-nocheck

let defaultRuntime;
function createRuntime(options) {
  if (options && options.db) return options;
  if (!options && defaultRuntime) return defaultRuntime;
  // CloudBase cloud functions provide the runtime credentials; no SecretId or SecretKey is read here.
  // eslint-disable-next-line global-require
  const cloudbase = (options && options.cloudbase) || require('@cloudbase/node-sdk');
  const app = (options && options.app) || cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  const runtime = {
    cloudbase,
    app,
    db: app.database(),
    catalogCacheEnabled: true,
  };
  if (!options) defaultRuntime = runtime;
  return runtime;
}

function getPayload(event) {
  const source = event && typeof event === 'object' ? event : {};
  const action = source.action;
  const data = source.data && typeof source.data === 'object' && !Array.isArray(source.data)
    ? source.data
    : source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
      ? source.payload
      : {};
  return { action, data };
}

module.exports = { createRuntime, getPayload };
