// @ts-nocheck

import { getTempFileUrl } from '../../../../../../../utils/api';

Component({
  /**
   * 组件的属性列表
   */
  properties: {
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

      this.setData({ classType, imageResources });
      Promise.all(imageResources.map(async (resource) => ({
        ...resource,
        image: await getTempFileUrl(resource.fileID || resource.image || ''),
      }))).then((resolvedResources) => {
        this.setData({ imageResources: resolvedResources });
      }).catch(() => {
        // 预览链接解析失败时仍保留 fileID，避免评论卡片整体渲染失败。
      });
    },
  },

  /**
   * 组件的方法列表
   */
  methods: {},
});
// @ts-nocheck
