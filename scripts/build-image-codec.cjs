// Keep the encoder in form-ui, shared by the two async component consumers.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'admin/node_modules/@jsquash/webp');
const target = path.join(root, 'packages/form-ui/image-processor/codec');
fs.mkdirSync(target, { recursive: true });
let glue = fs.readFileSync(path.join(source, 'codec/enc/webp_enc.js'), 'utf8');
glue = glue.replace('new URL("webp_enc.wasm",import.meta.url).href', '"packages/form-ui/image-processor/codec/webp_enc.wasm"')
  .replaceAll('import.meta.url', 'wasmScriptUrl')
  .replace('"./this.program"', '"webp-encoder"')
  .replace('export default Module;', 'module.exports = Module;');
// Scope the platform adapter locally; do not change global WebAssembly.
glue = 'var wasmScriptUrl = "";\nvar WebAssembly = typeof WXWebAssembly !== "undefined" ? WXWebAssembly : globalThis.WebAssembly;\n' + glue;
fs.writeFileSync(path.join(target, 'webp_enc.js'), glue.replace(/[ \t]+$/gm, ''));
fs.copyFileSync(path.join(source, 'codec/enc/webp_enc.wasm'), path.join(target, 'webp_enc.wasm'));
let meta = fs.readFileSync(path.join(source, 'meta.js'), 'utf8');
meta = meta.slice(meta.indexOf('export const defaultOptions')).replace('export const defaultOptions =', 'module.exports =');
fs.writeFileSync(path.join(target, 'options.js'), meta);
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
console.log('WebP encoder generated in form-ui subpackage');
