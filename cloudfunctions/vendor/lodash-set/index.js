// Preserve the SDK's callable CommonJS/default export using maintained Lodash.
const set = require('lodash/set');
module.exports = set;
module.exports.default = set;
