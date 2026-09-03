/**
 * chit402-sdk — Chit402 SDK re-export (CommonJS)
 *
 * This is the public-facing package. Internally it re-exports xfuel-sdk
 * for compatibility. Install this package; do not install xfuel-sdk directly.
 */
'use strict';

const xfuel = require('xfuel-sdk');

// Re-export everything
module.exports = xfuel;

// Also expose Chit402Client alias
module.exports.Chit402Client = xfuel.XFuelClient;
