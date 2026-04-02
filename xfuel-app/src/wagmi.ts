import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

const thetaMainnet = {
  id: 361,
  name: 'Theta Mainnet',
  nativeCurrency: { name: 'TFUEL', symbol: 'TFUEL', decimals: 18 },
  rpcUrls: { default: { http: ['https://eth-rpc-api.thetatoken.org/rpc'] } },
  blockExplorers: { default: { name: 'Theta Explorer', url: 'https://explorer.thetatoken.org' } },
} as const;

const thetaTestnet = {
  id: 365,
  name: 'Theta Testnet',
  nativeCurrency: { name: 'TFUEL', symbol: 'TFUEL', decimals: 18 },
  rpcUrls: { default: { http: ['https://eth-rpc-api-testnet.thetatoken.org/rpc'] } },
  blockExplorers: { default: { name: 'Theta Testnet Explorer', url: 'https://testnet-explorer.thetatoken.org' } },
} as const;

const bittensorEVM = {
  id: 964,
  name: 'Bittensor EVM',
  nativeCurrency: { name: 'TAO', symbol: 'TAO', decimals: 18 },
  rpcUrls: { default: { http: ['https://lite.chain.opentensor.ai'] } },
} as const;

export const config = createConfig({
  chains: [thetaMainnet, thetaTestnet, bittensorEVM],
  connectors: [injected()],
  transports: {
    [thetaMainnet.id]: http(),
    [thetaTestnet.id]: http(),
    [bittensorEVM.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
