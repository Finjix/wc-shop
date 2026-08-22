/* eslint-disable no-param-reassign */
import { fetchDeliveryAddressList, persistMockAddressList } from '../../../../services/address/fetchAddress';
import Toast from 'tdesign-miniprogram/toast/index';
import { resolveAddress, rejectAddress } from '../../../../services/address/list';
import { getAddressPromise } from '../../../../services/address/edit';

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
      isOrderSure: !!isOrderSure,
      id,
    });
    this.selectMode = !!selectMode;
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
        if (address.id === id) {
          address.checked = true;
        }
      });
      this.hasLoaded = true;
      this.setData({ addressList });
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
        Toast({
          context: this,
          selector: '#t-toast',
          message: '添加成功',
          icon: '',
          duration: 1000,
        });
        const { length: len } = this.data.addressList;
        this.setData({
          [`addressList[${len}]`]: {
            name: res.userName,
            phoneNumber: res.telNumber,
            address: `${res.provinceName}${res.cityName}${res.countryName}${res.detailInfo}`,
            isDefault: 0,
            tag: '微信地址',
            id: len,
          },
        });
      },
    });
  },
  getAddressId(event) {
    const address = event?.detail && typeof event.detail === 'object' ? event.detail : event?.currentTarget?.dataset?.item;
    return address?.id ?? address?.addressId ?? event?.currentTarget?.dataset?.id;
  },
  deleteAddressById(id) {
    if (id === undefined || id === null) return;

    const addressList = this.data.addressList.filter(
      (address) => String(address.id ?? address.addressId) !== String(id),
    );
    persistMockAddressList(addressList).then(() => {
      this.setData({
        addressList,
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
      confirmColor: '#F5CE2B',
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
        let addressList = [...this.data.addressList];

        newAddress.phoneNumber = newAddress.phone;
        newAddress.address = `${newAddress.provinceName}${newAddress.cityName}${newAddress.districtName}${newAddress.detailAddress}`;
        newAddress.tag = newAddress.addressTag;

        if (!newAddress.addressId) {
          newAddress.id = `${addressList.length}`;
          newAddress.addressId = `${addressList.length}`;

          if (newAddress.isDefault === 1) {
            addressList = addressList.map((address) => {
              address.isDefault = 0;

              return address;
            });
          } else {
            newAddress.isDefault = 0;
          }

          addressList.push(newAddress);
        } else {
          if (Number(newAddress.isDefault) === 1) {
            addressList = addressList.map((address) => {
              address.isDefault = 0;

              return address;
            });
          }
          addressList = addressList.map((address) => {
            if (address.addressId === newAddress.addressId) {
              return newAddress;
            }
            return address;
          });
        }

        addressList.sort((prevAddress, nextAddress) => {
          if (prevAddress.isDefault && !nextAddress.isDefault) {
            return -1;
          }
          if (!prevAddress.isDefault && nextAddress.isDefault) {
            return 1;
          }
          return 0;
        });

        this.setData({
          addressList: addressList,
        });
        persistMockAddressList(addressList);
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
