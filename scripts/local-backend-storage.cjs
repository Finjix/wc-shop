const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultLocalStorageDirectory(root) {
  return userStorageDirectory(root, 'runtime');
}

function userStorageDirectory(root, folder) {
  const workspace = path.resolve(root);
  const key = crypto.createHash('sha256')
    .update(process.platform === 'win32' ? workspace.toLowerCase() : workspace)
    .digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.wc-shop', folder, key);
}

function prepareLocalStorage(root, storageDirectory) {
  const workspace = path.resolve(root);
  const directory = path.resolve(storageDirectory || defaultLocalStorageDirectory(workspace));
  const dataFile = path.join(directory, '.local-backend.json');
  // Runtime writes must stay outside the mini-program source watcher.
  const filesRoot = path.join(directory, '.local-files');
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(filesRoot, { recursive: true });
  return { dataFile, filesRoot };
}

module.exports = { defaultLocalStorageDirectory, prepareLocalStorage };
