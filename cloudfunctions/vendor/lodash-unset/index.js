// Preserve the SDK's callable CommonJS/default export using maintained Lodash.
const unset = require('lodash/unset');
module.exports = unset;
module.exports.default = unset;
