import { fetchPerson } from '../../../services/usercenter/fetchPerson';
import Toast from 'tdesign-miniprogram/toast/index';

Page({
  data: {
    personInfo: {
      avatarUrl: '',
      nickName: '',
    },
    editingNickname: false,
    nicknameDraft: '',
  },
  onLoad() {
    this.init();
  },
  init() {
    this.fetchData();
  },
  fetchData() {
    fetchPerson().then((personInfo) => {
      this.setData({
        personInfo,
      });
    });
  },
  onClickCell({ currentTarget }) {
    const { dataset } = currentTarget;

    switch (dataset.type) {
      case 'name':
        this.setData({
          editingNickname: true,
          nicknameDraft: this.data.personInfo.nickName || '',
        });
        break;
      case 'avatarUrl':
        this.toModifyAvatar();
        break;
      default: {
        break;
      }
    }
  },
  saveNickname() {
    const nickname = this.data.nicknameDraft.trim();
    if (!nickname) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '昵称不能为空',
        theme: 'error',
      });
      return;
    }
    this.setData({
      'personInfo.nickName': nickname,
      editingNickname: false,
    });
  },
  cancelNickname() {
    this.setData({
      editingNickname: false,
      nicknameDraft: this.data.personInfo.nickName || '',
    });
  },
  async toModifyAvatar() {
    try {
      const tempFilePath = await new Promise((resolve, reject) => {
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: (res) => {
            const { path, size } = res.tempFiles[0];
            if (size <= 10485760) {
              resolve(path);
            } else {
              reject({ errMsg: '图片大小超出限制，请重新上传' });
            }
          },
          fail: (err) => reject(err),
        });
      });
      const tempUrlArr = tempFilePath.split('/');
      const tempFileName = tempUrlArr[tempUrlArr.length - 1];
      Toast({
        context: this,
        selector: '#t-toast',
        message: `已选择图片-${tempFileName}`,
        theme: 'success',
      });
    } catch (error) {
      if (error.errMsg === 'chooseImage:fail cancel') return;
      Toast({
        context: this,
        selector: '#t-toast',
        message: error.errMsg || error.msg || '修改头像出错了',
        theme: 'error',
      });
    }
  },
});
