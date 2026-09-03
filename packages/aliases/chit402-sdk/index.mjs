/**
 * chit402-sdk — Chit402 SDK re-export
 *
 * This is the public-facing package. Internally it re-exports xfuel-sdk
 * for compatibility. Install this package; do not install xfuel-sdk directly.
 */
export * from 'xfuel-sdk';
export { default } from 'xfuel-sdk';

import { XFuelClient } from 'xfuel-sdk';
export { XFuelClient as Chit402Client };
