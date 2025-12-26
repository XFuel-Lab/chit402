// Mock for @walletconnect/ethereum-provider

class MockEthereumProvider {
  constructor(opts) {
    this.opts = opts;
    this.connected = false;
    this.accounts = [];
    this.chainId = 1;
    this.uri = '';
  }

  async connect() {
    this.connected = true;
    return { chainId: this.chainId };
  }

  async disconnect() {
    this.connected = false;
  }

  async request({ method, params }) {
    if (method === 'eth_requestAccounts') {
      return this.accounts;
    }
    if (method === 'eth_accounts') {
      return this.accounts;
    }
    if (method === 'eth_chainId') {
      return `0x${this.chainId.toString(16)}`;
    }
    return null;
  }

  on(event, handler) {
    // Mock event listener
  }

  off(event, handler) {
    // Mock event listener removal
  }

  removeAllListeners() {
    // Mock remove all listeners
  }
}

MockEthereumProvider.init = async function(opts) {
  return new MockEthereumProvider(opts);
};

export { MockEthereumProvider as EthereumProvider };
export default MockEthereumProvider;

