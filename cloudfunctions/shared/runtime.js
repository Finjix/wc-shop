function createRuntime(options) {
  if (options && options.db) return options;
  // CloudBase cloud functions provide the runtime credentials; no SecretId or SecretKey is read here.
  // eslint-disable-next-line global-require
  const cloudbase = (options && options.cloudbase) || require('@cloudbase/node-sdk');
  const app = (options && options.app) || cloudbase.init({});
  return {
    cloudbase,
    app,
    auth: app.auth(),
    db: app.database(),
  };
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
