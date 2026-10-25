// @ts-nocheck
// Images stay inside their owning package; main pages reference this component asynchronously.
Component({
  options: { virtualHost: true },
  properties: {
    asset: { type: String, value: '' },
    size: { type: String, value: '100%' },
  },
});
