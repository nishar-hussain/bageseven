/** Local re-export so Turbopack can resolve workspace SDK subpaths. */
export {
  AVALANCHE_FUJI,
  paymentTokenLabel,
  withWalletOperation,
  getWalletOperation,
  subscribeWalletOperation,
  dismissWalletReminder,
  authorizeAvalanchePayment,
  connectAvalancheWallet,
  payStablecoinOnAvalanche,
} from '../../../packages/sdk/dist/wallet.js';
