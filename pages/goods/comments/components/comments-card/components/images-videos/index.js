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
    },
  },

  /**
   * 组件的方法列表
   */
  methods: {},
});
