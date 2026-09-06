const TEST_IMAGE = '/assets/home-test-image.jpg';

function createCategoryItem(groupId, name) {
  return {
    groupId,
    name,
    thumbnail: TEST_IMAGE,
  };
}

function createCategoryGroup(groupId, name, items, image = '') {
  return {
    groupId,
    name,
    thumbnail: TEST_IMAGE,
    image,
    children: items.map((item, index) => createCategoryItem(`${groupId}-${index + 1}`, item)),
  };
}

export const mockCategories = [
  {
    groupId: 'clothing',
    name: '服装',
    thumbnail: TEST_IMAGE,
    children: [
      createCategoryGroup('women', '女装', ['卫衣', '外套', '衬衫', '羽绒服', '毛衣', '连衣裙', '半身裙', '裤装'], TEST_IMAGE),
      createCategoryGroup('men', '男装', ['卫衣', '夹克', '衬衫', '羽绒服', '西装', '针织衫', '休闲裤', '牛仔裤']),
      createCategoryGroup('children', '儿童装', ['外套', '卫衣', '羽绒服', '连衣裙', 'T恤', '运动裤', '牛仔裤', '套装'], TEST_IMAGE),
    ],
  },
  {
    groupId: 'beauty',
    name: '美妆',
    thumbnail: TEST_IMAGE,
    children: [
      createCategoryGroup('makeup', '彩妆', ['唇釉', '口红', '眼影', '腮红', '粉底'], TEST_IMAGE),
      createCategoryGroup('skincare', '护肤', ['洁面', '爽肤水', '乳液', '面霜', '面膜']),
      createCategoryGroup('beauty-tools', '美容工具', ['美妆蛋', '化妆刷', '睫毛夹', '美容仪'], TEST_IMAGE),
    ],
  },
  {
    groupId: 'shoes-bags',
    name: '鞋包',
    thumbnail: TEST_IMAGE,
    children: [
      createCategoryGroup('women-shoes', '女鞋', ['单鞋', '凉鞋', '运动鞋', '靴子']),
      createCategoryGroup('men-shoes', '男鞋', ['休闲鞋', '板鞋', '运动鞋', '皮鞋'], TEST_IMAGE),
      createCategoryGroup('bags', '箱包', ['双肩包', '手提包', '斜挎包', '钱包']),
    ],
  },
  {
    groupId: 'home',
    name: '家居',
    thumbnail: TEST_IMAGE,
    children: [
      createCategoryGroup('home-textiles', '家纺', ['四件套', '被子', '枕头', '毛毯'], TEST_IMAGE),
      createCategoryGroup('kitchen', '厨房用品', ['水杯', '餐具', '收纳', '烹饪用具']),
      createCategoryGroup('daily-use', '生活用品', ['香薰', '清洁用品', '纸品', '置物架'], TEST_IMAGE),
    ],
  },
];
