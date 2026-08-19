// Native-ESM entry. `exports.import` used to point at the CJS build, so
// `import XFuelClient from 'xfuel-sdk'` was the module object, not the class.
import cjs from './dist/index.js';

const Client = cjs.XFuelClient ?? cjs.default;

export const XFuelClient = Client;
export default Client;

export const MessageType = cjs.MessageType;
export const ChainId = cjs.ChainId;
export const DEFAULT_BASE_URL = cjs.DEFAULT_BASE_URL;
export const PUBLIC_DEMO_API_KEY = cjs.PUBLIC_DEMO_API_KEY;
export const XFuelApiError = cjs.XFuelApiError;
export const selectAccept = cjs.selectAccept;
export const createMockPayer = cjs.createMockPayer;
export const createSignerPayer = cjs.createSignerPayer;
export const canonicalReceiptPayload = cjs.canonicalReceiptPayload;
export const verifyReceiptSignature = cjs.verifyReceiptSignature;
