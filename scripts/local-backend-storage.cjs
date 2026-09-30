const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultLocalStorageDirectory(root) {
  return path.join(path.resolve(root), '.local-data');
}

function previousLocalStorageDirectory(root) {
  const workspace = path.resolve(root);
  const key = crypto.createHash('sha256')
    .update(process.platform === 'win32' ? workspace.toLowerCase() : workspace)
    .digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.wc-shop', 'local-backend', key);
}

function prepareLocalStorage(root, storageDirectory) {
  const workspace = path.resolve(root);
  const directory = path.resolve(storageDirectory || defaultLocalStorageDirectory(workspace));
  const dataFile = path.join(directory, '.local-backend.json');
  const filesRoot = path.join(workspace, '.local-files');
  const legacyData = path.join(workspace, 'data', '.local-backend.json');
  const legacyFiles = path.join(workspace, 'data', '.local-files');
  const previousDirectory = previousLocalStorageDirectory(workspace);
  fs.mkdirSync(directory, { recursive: true });
  // Copy once without overwriting existing data; keep the old workspace files intact.
  for (const source of [path.join(previousDirectory, '.local-backend.json'), legacyData]) {
    if (!fs.existsSync(dataFile) && fs.existsSync(source)) fs.copyFileSync(source, dataFile);
  }
  fs.mkdirSync(filesRoot, { recursive: true });
  const previousFiles = path.join(directory, '.local-files');
  for (const source of [previousFiles, path.join(previousDirectory, '.local-files'), legacyFiles]) {
    if (path.resolve(source) !== filesRoot && fs.existsSync(source)) {
      fs.cpSync(source, filesRoot, { recursive: true, force: false, errorOnExist: false });
    }
  }
  return { dataFile, filesRoot };
}

module.exports = { defaultLocalStorageDirectory, prepareLocalStorage };
