// @ts-nocheck

import { resolveImage } from '../../../../../../../utils/images';

Component({
  /**
   * 组件的属性列表
   */
  properties: {
    compact: {
      type: Boolean,
      value: false,
    },
    resources: {
      type: Array,
      value: [],
    },
  },

  /**
   * 组件的初始数据
   */
  data: {
    classType: 'single',
    imageResources: [],
  },

  observers: {
    resources: function (newVal) {
      const version = this.resourceVersion = (this.resourceVersion || 0) + 1;
      const imageResources = Array.isArray(newVal)
        ? newVal.filter((resource) => resource && resource.type === 'image')
        : [];
      const resourceCount = imageResources.length;
      let classType = 'single';

      if (resourceCount === 2) {
        classType = 'double';
      } else if (resourceCount > 2) {
        classType = 'multiple';
      }

      this.setData({ classType, imageResources: [] });
      Promise.all(imageResources.map(async (resource) => ({
        ...resource,
        image: resource.expired ? '' : await resolveImage(resource.image || resource.fileID || ''),
      }))).then((resolvedResources) => {
        if (this.resourceVersion === version) this.setData({ imageResources: resolvedResources });
      });
    },
  },

  /**
   * 组件的方法列表
   */
  methods: {
    onPreview(event) {
      const resource = this.data.imageResources[Number(event.currentTarget.dataset.index)];
      if (!resource?.image || resource.failed || resource.expired) return;
      const urls = this.data.imageResources.filter((item) => item.image && !item.failed && !item.expired).map((item) => item.image);
      wx.previewImage({ current: resource.image, urls });
    },
    onImageError(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index) || !this.data.imageResources[index]) return;
      this.setData({ [`imageResources[${index}].failed`]: true });
    },
  },
});
// @ts-nocheck
