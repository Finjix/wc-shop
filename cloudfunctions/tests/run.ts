// @ts-nocheck

const { run } = require('./contracts.test');
const { run: runRegressions } = require('./regressions.test');

Promise.resolve()
  .then(() => run())
  .then(() => require('./after-sale-policy.test').run())
  .then(() => require('./admin-commerce-delete.test').run())
  .then(() => require('./admin-all-status-delete.test').run())
  .then(() => runRegressions())
  .then(() => require('./image-lifecycle.test').run())
  .then(() => {
    console.log('cloudfunctions contract and regression tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
