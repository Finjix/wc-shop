// @ts-nocheck

Component({
  externalClasses: ['wr-class'],
  properties: {
    goodsDetailInfo: {
      type: String,
      value: '',
    },
    sellerReply: {
      type: String,
      value: '',
    },
    commentContent: {
      type: String,
      value: '',
    },
    commentScore: {
      type: Number,
      value: 0,
    },
    commentTime: {
      type: String,
      value: '',
    },
    commentResources: {
      type: Array,
      value: [],
    },
    isLast: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    showContent: false,
  },
  methods: {},
});
// @ts-nocheck
