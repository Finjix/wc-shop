// @ts-nocheck

import { request, getApiErrorMessage } from '../../utils/api';
import { normalizeUserInfo } from '../good/normalize';

const EMPTY_PERSON = {
  nickName: '',
  phoneNumber: '',
  gender: '',
  address: { provinceName: '', provinceCode: '', cityName: '', cityCode: '' },
};

export function fetchPerson() {
  return request('user.me')
    .then((result) => {
      const person = result && typeof result === 'object' ? result : {};
      return {
        ...person,
        ...normalizeUserInfo(person.userInfo || person.user || person),
        address: person.address || EMPTY_PERSON.address,
      };
    })
    .catch((error) => {
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({ title: getApiErrorMessage(error), icon: 'none' });
      }
      return EMPTY_PERSON;
    });
}
// @ts-nocheck
