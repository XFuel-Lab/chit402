'use strict';
// CJS entry so `require('xfuel-sdk')` and `require('xfuel-sdk').default`
// are both the constructor (native ESM default-import of CJS is module.exports).
const cjs = require('./dist/index.js');
const Client = cjs.XFuelClient || cjs.default;
module.exports = Client;
module.exports.default = Client;
for (const [key, value] of Object.entries(cjs)) {
  if (module.exports[key] === undefined) module.exports[key] = value;
}
module.exports.XFuelClient = Client;
