import { callShop, getCloudErrorMessage } from '../../utils/cloud';
import { normalizeUserInfo } from '../good/normalize';

const EMPTY_USER_CENTER = {
  userInfo: { nickName: '', phoneNumber: '' },
  orderTagInfos: [],
};

export function fetchUserCenter() {
  return callShop('user.me')
    .then((result) => {
      const source = result && typeof result === 'object' ? result : {};
      return {
        ...source,
        userInfo: normalizeUserInfo(source.userInfo || source.user || source),
        orderTagInfos: source.orderTagInfos || source.orderTags || [],
      };
    })
    .catch((error) => {
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({ title: getCloudErrorMessage(error), icon: 'none' });
      }
      return EMPTY_USER_CENTER;
    });
}
