const { errorFrom } = require('./errors');

function assert(condition, details) {
  if (!condition) throw errorFrom('INVALID_ARGUMENT', details);
}

function string(value, field, options) {
  const opts = options || {};
  assert(typeof value === 'string' && value.trim().length > 0, { field });
  const result = value.trim();
  if (opts.max && result.length > opts.max) throw errorFrom('INVALID_ARGUMENT', { field, max: opts.max });
  return result;
}

function optionalString(value, field, options) {
  if (value === undefined || value === null || value === '') return undefined;
  return string(value, field, options);
}

function number(value, field, options) {
  const opts = options || {};
  assert(typeof value === 'number' && Number.isFinite(value), { field });
  if (opts.integer && !Number.isInteger(value)) throw errorFrom('INVALID_ARGUMENT', { field });
  if (opts.min !== undefined && value < opts.min) throw errorFrom('INVALID_ARGUMENT', { field, min: opts.min });
  if (opts.max !== undefined && value > opts.max) throw errorFrom('INVALID_ARGUMENT', { field, max: opts.max });
  return value;
}

function integer(value, field, options) {
  return number(value, field, { ...(options || {}), integer: true });
}

function object(value, field) {
  assert(value && typeof value === 'object' && !Array.isArray(value), { field });
  return value;
}

function array(value, field) {
  assert(Array.isArray(value), { field });
  return value;
}

function page(input) {
  const source = input || {};
  const pageValue = source.page === undefined ? source.pageNum : source.page;
  return {
    page: pageValue === undefined ? 1 : integer(Number(pageValue), 'page', { min: 1, max: 100000 }),
    pageSize: source.pageSize === undefined ? 20 : integer(source.pageSize, 'pageSize', { min: 1, max: 100 }),
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

module.exports = { assert, string, optionalString, number, integer, object, array, page, clone };
