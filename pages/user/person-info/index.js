import { fetchPerson } from '../../../services/usercenter/fetchPerson';
import Toast from 'tdesign-miniprogram/toast/index';

Page({
  data: {
    personInfo: {
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
});
