const { run } = require('./contracts.test');
const { run: runRegressions } = require('./regressions.test');

Promise.resolve()
  .then(() => run())
  .then(() => runRegressions())
  .then(() => {
    console.log('cloudfunctions contract and regression tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
