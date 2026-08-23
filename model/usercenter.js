const userInfo = {
  nickName: '用户_1A4B',
  phoneNumber: '13438358888',
  gender: 2,
};
const orderTagInfos = [
  {
    orderNum: 1,
    tabType: 10,
  },
  {
    orderNum: 1,
    tabType: 40,
  },
  {
    orderNum: 2,
    tabType: 50,
  },
  {
    orderNum: 0,
    tabType: 0,
  },
];

export const genSimpleUserInfo = () => ({ ...userInfo });

export const genUsercenter = () => ({
  userInfo,
  orderTagInfos,
});
