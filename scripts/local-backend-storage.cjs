const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultLocalStorageDirectory(root) {
  return path.join(path.dirname(path.resolve(root)), '.wc-shop-local');
}

function legacyUserDirectory(root) {
  const key = crypto.createHash('sha256')
    .update(process.platform === 'win32' ? root.toLowerCase() : root)
    .digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.wc-shop', 'runtime', key);
}

function copyMissing(source, target) {
  if (!fs.existsSync(source)) return;
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copyMissing(path.join(source, name), path.join(target, name));
  } else if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function migrateStorage(root, directory) {
  const sources = [
    ['user-runtime', legacyUserDirectory(root)],
    ['local-data', path.join(root, '.local-data')],
    ['local', path.join(root, '.local')],
    ['loacl', path.join(root, '.loacl')],
    ['data', path.join(root, 'data')],
    ['root', root],
  ];
  const dataFile = path.join(directory, '.local-backend.json');
  for (const [label, source] of sources) {
    if (path.resolve(source) === directory) continue;
    const names = label === 'data' || label === 'root'
      ? ['.local-backend.json', '.local-files'].filter(name => fs.existsSync(path.join(source, name)))
      : fs.existsSync(source) ? fs.readdirSync(source) : [];
    if (!names.length) continue;
    const archives = path.join(directory, 'migrations');
    fs.mkdirSync(archives, { recursive: true });
    const archive = fs.mkdtempSync(path.join(archives, `${label}-`));
    for (const name of names) {
      const from = path.join(source, name);
      const to = path.join(archive, name);
      fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    }
    const oldData = path.join(archive, '.local-backend.json');
    if (fs.existsSync(oldData) && (!fs.existsSync(dataFile) || fs.statSync(oldData).mtimeMs > fs.statSync(dataFile).mtimeMs)) {
      // Keep every original snapshot, including an existing destination, before replacing it.
      if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, path.join(archive, 'destination-backup.json'));
      fs.cpSync(oldData, dataFile, { preserveTimestamps: true });
    }
    copyMissing(path.join(archive, '.local-files'), path.join(directory, '.local-files'));
    for (const name of names) fs.rmSync(path.join(source, name), { recursive: true, force: true });
    if (label !== 'data' && label !== 'root') fs.rmdirSync(source);
  }
}

function prepareLocalStorage(root, storageDirectory) {
  const workspace = path.resolve(root);
  const directory = path.resolve(storageDirectory || defaultLocalStorageDirectory(workspace));
  const relative = path.relative(workspace, directory);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    throw new Error('Local backend data must be outside the project directory.');
  }
  fs.mkdirSync(directory, { recursive: true });
  // Explicit overrides are isolated (e.g. HTTP tests); never import real shop data into them.
  if (!storageDirectory) migrateStorage(workspace, directory);
  const dataFile = path.join(directory, '.local-backend.json');
  const filesRoot = path.join(directory, '.local-files');
  fs.mkdirSync(filesRoot, { recursive: true });
  return { dataFile, filesRoot };
}

module.exports = { defaultLocalStorageDirectory, prepareLocalStorage };
