const path = require('path');

const tesseractRoot = path.join(__dirname, '..', 'node_modules', 'tesseract.js');
const isElectronPath = require.resolve('is-electron', { paths: [path.join(__dirname, '..', 'node_modules')] });

require(isElectronPath);
require.cache[isElectronPath].exports = function isElectron() {
  return false;
};

require(path.join(tesseractRoot, 'src', 'worker-script', 'node', 'index.js'));
