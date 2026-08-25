let impl;
let isNative = false;
let reason = '';

if (process.env.KARDEX_CANVAS_FORCE_SHIM === '1') {
  impl = require('./canvas-shim');
  reason = 'shim';
} else {
  try {
    impl = require('@napi-rs/canvas');
    isNative = true;
    reason = 'native';
  } catch (e) {
    impl = require('./canvas-shim');
    reason = 'shim';
  }
}

module.exports = impl;
module.exports.isNative = isNative;
module.exports.implementation = reason;
