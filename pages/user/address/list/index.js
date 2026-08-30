/* eslint-disable no-param-reassign */
import {
  fetchDeliveryAddressList,
  persistAddress,
  deleteDeliveryAddress,
} from '../../../../services/address/fetchAddress';
import Toast from 'tdesign-miniprogram/toast/index';
import { getAddressPromise, resolveAddress, rejectAddress } from '../../../../services/address/list';

const isTrueQueryValue = (value) => value === true || value === 1 || value === '1' || value === 'true';
const addressIdOf = (address = {}) => address.addressId ?? address.id ?? address._id ?? '';
const isDefaultAddress = (address = {}) => isTrueQueryValue(address.isDefault);

function sortAddressList(addressList) {
  return [...addressList].sort((prevAddress, nextAddress) => {
    if (isDefaultAddress(prevAddress) && !isDefaultAddress(nextAddress)) return -1;
    if (!isDefaultAddress(prevAddress) && isDefaultAddress(nextAddress)) return 1;
    return 0;
  });
}

Page({
  data: {
    addressList: [],
    deleteID: '',
    showDeleteConfirm: false,
    isOrderSure: false,
  },

  /** 选择模式 */
  selectMode: false,
  hasLoaded: false,
  /** 是否已经选择地址，不置为true的话页面离开时会触发取消选择行为 */
  hasSelect: false,

  onLoad(query) {
    const { selectMode = '', isOrderSure = '', id = '' } = query;
    this.setData({
      isOrderSure: isTrueQueryValue(isOrderSure),
      id,
    });
    this.selectMode = isTrueQueryValue(selectMode);
    this.init();
  },

  onShow() {
    if (this.hasLoaded) {
      this.getAddressList();
    }
  },

  init() {
    this.getAddressList();
  },
  onUnload() {
    if (this.selectMode && !this.hasSelect) {
      rejectAddress();
    }
  },
  getAddressList() {
    const { id } = this.data;
    fetchDeliveryAddressList().then((addressList) => {
      addressList.forEach((address) => {
        if (String(address.id ?? address.addressId) === String(id)) {
          address.checked = true;
        }
      });
      this.hasLoaded = true;
      this.setData({ addressList });
    }).catch(() => {
      Toast({ context: this, selector: '#t-toast', message: '地址加载失败，请稍后重试', icon: '' });
    });
  },
  getWXAddressHandle() {
    wx.chooseAddress({
      success: (res) => {
        if (res.errMsg.indexOf('ok') === -1) {
          Toast({
            context: this,
            selector: '#t-toast',
            message: res.errMsg,
            icon: '',
            duration: 1000,
          });
          return;
        }
        const address = {
          name: res.userName,
          phone: res.telNumber,
          provinceName: res.provinceName,
          cityName: res.cityName,
          districtName: res.countryName,
          detailAddress: res.detailInfo,
          isDefault: 0,
          addressTag: '微信地址',
        };
        persistAddress(address).then(() => {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '添加成功',
            icon: '',
            duration: 1000,
          });
          this.getAddressList();
        }).catch(() => {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '地址保存失败，请稍后重试',
            icon: '',
            duration: 1000,
          });
        });
      },
    });
  },
  getAddressId(event) {
    const address = event?.detail && typeof event.detail === 'object' ? event.detail : event?.currentTarget?.dataset?.item;
    return address?.id ?? address?.addressId ?? event?.currentTarget?.dataset?.id;
  },
  deleteAddressById(id) {
    if (id === undefined || id === null || id === '') return;

    const deletedAddress = this.data.addressList.find(
      (address) => String(addressIdOf(address)) === String(id),
    );
    const addressList = this.data.addressList.filter(
      (address) => String(addressIdOf(address)) !== String(id),
    );
    const nextDefaultAddress = isDefaultAddress(deletedAddress) ? addressList[0] : null;
    const nextDefaultId = nextDefaultAddress ? addressIdOf(nextDefaultAddress) : '';
    deleteDeliveryAddress(id, nextDefaultId).then(() => {
      if (nextDefaultAddress) nextDefaultAddress.isDefault = 1;
      this.setData({
        addressList: sortAddressList(addressList),
        deleteID: '',
        showDeleteConfirm: false,
      });
      Toast({
        context: this,
        selector: '#t-toast',
        message: '地址删除成功',
        theme: 'success',
        duration: 1000,
      });
    }).catch(() => {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '地址删除失败，请稍后重试',
        icon: '',
        duration: 1000,
      });
    });
  },
  deleteAddressHandle(e) {
    this.deleteAddressById(this.getAddressId(e));
  },
  onAddressLongPress(e) {
    const id = this.getAddressId(e);
    if (id === undefined || id === null) return;

    wx.showModal({
      title: '删除收货地址',
      content: '确定删除这个收货地址吗？',
      confirmText: '删除',
      confirmColor: '#695941',
      success: (result) => {
        if (result.confirm) this.deleteAddressById(id);
      },
    });
  },
  editAddressHandle({ detail }) {
    this.waitForNewAddress();

    const { id } = detail || {};
    wx.navigateTo({ url: `/pages/user/address/edit/index?id=${id}` });
  },
  selectHandle({ detail }) {
    if (this.selectMode) {
      this.hasSelect = true;
      resolveAddress(detail);
      wx.navigateBack({ delta: 1 });
    } else {
      this.editAddressHandle({ detail });
    }
  },
  createHandle() {
    this.waitForNewAddress();
    wx.navigateTo({ url: '/pages/user/address/edit/index' });
  },

  waitForNewAddress() {
    getAddressPromise()
      .then((newAddress) => {
        const savedAddress = { ...newAddress };
        const savedAddressId = addressIdOf(savedAddress);

        // 编辑页已经完成云端保存；这里只更新列表展示，避免再次调用 create。
        if (!savedAddressId) {
          this.getAddressList();
          return;
        }

        let addressList = [...this.data.addressList];
        if (isDefaultAddress(savedAddress)) {
          addressList = addressList.map((address) => ({ ...address, isDefault: 0 }));
        }
        const index = addressList.findIndex(
          (address) => String(addressIdOf(address)) === String(savedAddressId),
        );
        if (index > -1) addressList[index] = savedAddress;
        else addressList.push(savedAddress);

        this.setData({
          addressList: sortAddressList(addressList),
        });
      })
      .catch((e) => {
        if (e.message !== 'cancel') {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '地址编辑发生错误',
            icon: '',
            duration: 1000,
          });
        }
      });
  },
});
