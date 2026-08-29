const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = ['app.js', 'config', 'pages', 'services', 'utils', 'cloudfunctions', 'admin/src'];
const extensions = new Set(['.js', '.ts', '.tsx']);
const allowedMockBoundaryFiles = new Set([
  'app.js',
  'config/runtime.js',
  'pages/order/apply-service/api.js',
  'services/comments/createComment.js',
  'services/_utils/delay.js',
  'utils/cloud.js',
  'utils/mock.js',
  'utils/mockApi.js',
]);
const forbidden = [
  { pattern: /\buseMock\b|\benableMockPayment\b/i, label: '旧兼容开关' },
  { pattern: /apiUnavailable|mockIp|mockReqId|MOCK_[A-Z0-9_]+/i, label: 'mock 运行时工具' },
  { pattern: /演示数据|演示服务|mock(?:Data|Payment|Request|Response)/i, label: '演示运行时分支' },
];

function filesIn(target) {
  const absolute = path.join(root, target);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [absolute];
  const result = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    result.push(...filesIn(path.relative(root, path.join(absolute, entry.name))));
  }
  return result;
}

const violations = [];
const runtimeConfigPath = path.join(root, 'config', 'runtime.js');
if (fs.existsSync(runtimeConfigPath)) {
  const runtimeConfig = fs.readFileSync(runtimeConfigPath, 'utf8');
  if (/\buseMock\s*:\s*true\b/i.test(runtimeConfig)) {
    violations.push('config/runtime.js: useMock=true，请切换为 false 后再执行云端发布检查');
  }
}
for (const file of scanRoots.flatMap(filesIn)) {
  if (!extensions.has(path.extname(file))) continue;
  const relativeFile = path.relative(root, file).replace(/\\/g, '/');
  if (allowedMockBoundaryFiles.has(relativeFile)) continue;
  const source = fs.readFileSync(file, 'utf8');
  forbidden.forEach(({ pattern, label }) => {
    if (pattern.test(source)) violations.push(`${path.relative(root, file)}: ${label}`);
  });
}

if (violations.length) {
  console.error('发现运行时 mock 残留：');
  violations.forEach((item) => console.error(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log('runtime mock scan passed');
}
