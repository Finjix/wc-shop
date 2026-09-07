import { request } from '../../utils/api';
import { normalizeUserInfo } from '../good/normalize';

const EMPTY_USER_CENTER = {
  userInfo: { nickName: '', phoneNumber: '' },
  orderTagInfos: [],
};

export function fetchUserCenter() {
  return request('user.me')
    .then((result) => {
      const source = result && typeof result === 'object' ? result : {};
      return {
        ...source,
        userInfo: normalizeUserInfo(source.userInfo || source.user || source),
        orderTagInfos: source.orderTagInfos || source.orderTags || [],
      };
    })
    .catch(() => EMPTY_USER_CENTER);
}
