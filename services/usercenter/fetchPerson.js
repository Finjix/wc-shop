import { callShop, getCloudErrorMessage } from '../../utils/cloud';
import { normalizeUserInfo } from '../good/normalize';

const EMPTY_PERSON = {
  nickName: '',
  phoneNumber: '',
  gender: '',
  address: { provinceName: '', provinceCode: '', cityName: '', cityCode: '' },
};

export function fetchPerson() {
  return callShop('user.me')
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
        wx.showToast({ title: getCloudErrorMessage(error), icon: 'none' });
      }
      return EMPTY_PERSON;
    });
}
