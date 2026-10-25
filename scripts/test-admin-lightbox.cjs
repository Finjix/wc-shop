const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const zoom = {};
vm.runInNewContext(compile('admin/src/lib/lightbox-zoom.ts'), { exports: zoom });
const { zoomLightbox, INITIAL_LIGHTBOX_VIEW } = zoom;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const enlarged = zoomLightbox(INITIAL_LIGHTBOX_VIEW, -100);
assert(enlarged.scale > 1);
assert.equal(enlarged.x, 0); assert.equal(enlarged.y, 0);
const panned = zoomLightbox({ scale: 2, x: 40, y: -20 }, -100);
assert.equal(panned.x, 40); assert.equal(panned.y, -20);
const restored = zoomLightbox(enlarged, 100);
near(restored.scale, 1); near(restored.x, 0); near(restored.y, 0);
assert.equal(zoomLightbox(INITIAL_LIGHTBOX_VIEW, -1e6).scale, 8);
assert.equal(zoomLightbox(INITIAL_LIGHTBOX_VIEW, 1e6).scale, 0.25);
assert.equal(zoomLightbox(INITIAL_LIGHTBOX_VIEW, NaN), INITIAL_LIGHTBOX_VIEW);

// Execute the component with a small hook/DOM harness to exercise native wheel and drag events.
const hooks = [];
let cursor = 0;
let effects = [];
const documentEvents = new Map();
const stageEvents = new Map();
class Element { focus() { this.focused = true; } }
class Image extends Element {
  currentSrc = 'https://example.test/image.webp'; naturalWidth = 100; alt = '测试图片';
  closest() { return null; }
}
const focused = new Element();
const stage = new Element();
Object.assign(stage, {
  addEventListener(name, handler, options) { stageEvents.set(name, handler); if (name === 'wheel') assert.equal(options.passive, false); },
  removeEventListener(name, handler) { assert.equal(stageEvents.get(name), handler); stageEvents.delete(name); },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 800 }; },
  setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; },
  releasePointerCapture() { this.capture = null; },
});
const document = {
  activeElement: focused, body: { style: { overflow: 'auto' } }, documentElement: { style: { scrollbarGutter: 'stable' } },
  addEventListener(name, handler) { documentEvents.set(name, handler); },
  removeEventListener(name, handler) { assert.equal(documentEvents.get(name), handler); documentEvents.delete(name); },
};
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], (value) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
  },
  useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
  useEffect(callback, deps) {
    const index = cursor++;
    const previous = hooks[index];
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
  },
};
const jsx = (type, props) => {
  if (props.ref) props.ref.current = stage;
  return { type, props };
};
const component = {};
vm.runInNewContext(compile('admin/src/components/ImageLightbox.tsx'), {
  exports: component, document, HTMLElement: Element, HTMLImageElement: Image,
  require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-dom') return { createPortal: (element) => element };
    if (name === '../lib/lightbox-zoom') return zoom;
    throw new Error(name);
  },
});
function render() {
  cursor = 0; effects = [];
  const tree = component.ImageLightbox();
  effects.forEach((effect) => effect());
  return tree;
}
function open() {
  documentEvents.get('click')({ target: new Image(), preventDefault() {}, stopPropagation() {} });
  return render();
}
assert.equal(render(), null);
let tree = open();
assert.equal(document.body.style.overflow, 'hidden');
let prevented = false;
stageEvents.get('wheel')({ deltaY: -100, deltaMode: 0, clientX: 600, clientY: 400,
  preventDefault() { prevented = true; }, stopPropagation() {} });
assert(prevented);
tree = render();
let props = tree.props.children.props;
assert.notEqual(props.children.props.style.transform, 'translate(0px, 0px) scale(1)');
assert.ok(props.children.props.style.transform.startsWith('translate(0px, 0px)'), 'off-center mouse position must not shift the image');
props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, clientY: 100, currentTarget: stage });
props.onPointerMove({ pointerId: 1, clientX: 150, clientY: 120 });
props.onPointerUp({ pointerId: 1, currentTarget: stage });
props.onClick({ target: stage, currentTarget: stage });
assert(render(), 'dragging must not accidentally close the preview');
props.onClick({ target: stage, currentTarget: stage });
assert.equal(render(), null);
assert.equal(stageEvents.size, 0);
assert.equal(document.body.style.overflow, 'auto');
assert.equal(document.documentElement.style.scrollbarGutter, 'stable');
assert(focused.focused);
tree = open();
assert.equal(tree.props.children.props.children.props.style.transform, 'translate(0px, 0px) scale(1)');
documentEvents.get('keydown')({ key: 'Escape' });
assert.equal(render(), null);
class Filename extends Element {
  dataset = { imagePreview: 'https://example.test/sku.webp', imageAlt: 'sku-photo.jpg' };
  closest(selector) { return selector === '[data-image-preview]' ? this : null; }
}
documentEvents.get('click')({ target: new Filename(), preventDefault() {}, stopPropagation() {} });
tree = render();
assert.equal(tree.props['aria-label'], 'sku-photo.jpg');
assert.equal(tree.props.children.props.children.props.src, 'https://example.test/sku.webp');
documentEvents.get('keydown')({ key: 'Escape' });
assert.equal(render(), null);
const unavailable = new Filename();
unavailable.dataset.imagePreview = '';
documentEvents.get('click')({ target: unavailable, preventDefault() {}, stopPropagation() {} });
assert.equal(render(), null, 'unresolved filename links must not open an empty preview');
const styles = fs.readFileSync(path.join(root, 'admin/src/styles.css'), 'utf8');
assert.match(styles, /\*, \*::before, \*::after\s*\{[^}]*animation: none !important;[^}]*transition: none !important;[^}]*scroll-behavior: auto !important;/);
const main = fs.readFileSync(path.join(root, 'admin/src/main.tsx'), 'utf8');
assert.match(main, /exclude: \['ripple', 'expand', 'fade'\]/);
console.log('PASS image and filename previews; no admin animations; centered wheel zoom, bounds, drag/click separation, reset, Escape and listener/focus/scroll cleanup');
