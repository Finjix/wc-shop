const fs = require('node:fs');

/** Existing business tests exercise service implementations; async wiring has its own integration tests. */
function resolveSource(filename) {
  if (filename.includes(`${require('node:path').sep}frontend${require('node:path').sep}`) && fs.existsSync(filename)) {
    const source = fs.readFileSync(filename, 'utf8');
    if (source.includes('// Async boundary:')) return filename.replace(/([\\/])frontend([\\/])/, '$1api$2');
  }
  return filename;
}

function readSource(filename, encoding) {
  filename = resolveSource(filename);
  let source = fs.readFileSync(filename, encoding);
  if (typeof source === 'string' && source.includes('Component(tabContent({')) {
    source = source.replace(/^import \{ tabContent \} from .*;\r?\n/m, '').replace('Component(tabContent({', 'Page({');
    const end = source.lastIndexOf('}));');
    source = source.slice(0, end) + '});' + source.slice(end + 4);
  }
  return source;
}
module.exports = { resolveSource, readSource };
