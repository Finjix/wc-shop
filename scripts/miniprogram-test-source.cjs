const fs = require('node:fs');
const path = require('node:path');

// Business tests exercise service implementations; package-loading tests exercise async facades.
function resolveSource(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const implementation = typeof source === 'string' && source.match(/^\/\/ Service implementation: (.+)$/m);
  return implementation ? path.resolve(__dirname, '../miniprogram', implementation[1]) : filename;
}
module.exports = {
  resolveSource,
  readSource: (filename, encoding) => fs.readFileSync(resolveSource(filename), encoding),
};
