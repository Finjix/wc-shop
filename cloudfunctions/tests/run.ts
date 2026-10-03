// @ts-nocheck

const { run } = require('./contracts.test');
const { run: runRegressions, makeRuntime } = require('./regressions.test');
const { run: runResources } = require('./image-resources.test');

Promise.resolve()
  .then(() => run())
  .then(() => runRegressions())
  .then(() => runResources(makeRuntime))
  .then(() => {
    console.log('cloudfunctions contract and regression tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
