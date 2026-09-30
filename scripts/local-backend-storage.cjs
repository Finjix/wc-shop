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
  const projectData = path.join(workspace, '.local-data', '.local-backend.json');
  const projectFiles = path.join(workspace, '.local-files');
  const legacyData = path.join(workspace, 'data', '.local-backend.json');
  const legacyFiles = path.join(workspace, 'data', '.local-files');
  const previousDirectory = userStorageDirectory(workspace, 'local-backend');
  fs.mkdirSync(directory, { recursive: true });
  // Copy once without overwriting existing data; keep the old workspace files intact.
  for (const source of [projectData, path.join(previousDirectory, '.local-backend.json'), legacyData]) {
    if (!fs.existsSync(dataFile) && fs.existsSync(source)) fs.copyFileSync(source, dataFile);
  }
  fs.mkdirSync(filesRoot, { recursive: true });
  for (const source of [projectFiles, path.join(workspace, '.local-data', '.local-files'), path.join(previousDirectory, '.local-files'), legacyFiles]) {
    if (path.resolve(source) !== filesRoot && fs.existsSync(source)) {
      fs.cpSync(source, filesRoot, { recursive: true, force: false, errorOnExist: false });
    }
  }
  return { dataFile, filesRoot };
}

module.exports = { defaultLocalStorageDirectory, prepareLocalStorage };
