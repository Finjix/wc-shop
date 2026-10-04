const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../admin/src/auth/persistent-session.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });

async function main() {
  const { readPersistentSession } = exportsObject;
  const renewedSession = { user: { uid: 'admin' }, expires_at: 'renewed' };
  assert.equal(await readPersistentSession({ getSession: async () => ({ data: { session: renewedSession }, error: null }) }), renewedSession);
  assert.equal(await readPersistentSession({ getSession: async () => ({ data: { session: null }, error: null }) }), null);
  const networkFailure = new Error('offline while refreshing');
  await assert.rejects(readPersistentSession({ getSession: async () => ({ data: { session: null }, error: networkFailure }) }), (error) => error === networkFailure);
  await assert.rejects(readPersistentSession({ getSession: async () => { throw networkFailure; } }), (error) => error === networkFailure);
  console.log('Admin session checks passed: restored session, signed-out session and refresh failures.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
