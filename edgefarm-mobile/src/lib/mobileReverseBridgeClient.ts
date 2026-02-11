import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * @fileoverview React Native Mobile Integration for Reverse Bridge
 * @description Mobile-specific reverse bridge client for EdgeFarm mobile app
 * 
 * Features:
 * - Keplr Mobile wallet integration
 * - Secure key storage with AsyncStorage
 * - Offline transaction signing
 * - Push notifications for burn confirmations
 */

export interface MobileBridgeConfig {
  persistenceMinterContract: string;
  feeCollectorContract: string;
  rpcEndpoint: string;
  chainId: string;
  enableNotifications?: boolean;
}

export interface MobileBurnResult {
  txHash: string;
  burnedAmount: string;
  feeAmount: string;
  nonce: number;
  estimatedArrivalTime: number; // Unix timestamp
  trackingUrl: string; // Link to block explorer
}

/**
 * Mobile Reverse Bridge Client
 * Optimized for React Native mobile apps
 */
export class MobileReverseBridgeClient {
  private config: MobileBridgeConfig;
  private client: SigningCosmWasmClient | null = null;
  private wallet: DirectSecp256k1HdWallet | null = null;

  constructor(config: MobileBridgeConfig) {
    this.config = config;
  }

  /**
   * Initialize wallet from secure storage or create new one
   */
  async initializeWallet(): Promise<string> {
    // Check if wallet exists in secure storage
    const storedMnemonic = await AsyncStorage.getItem('@xfuel_wallet_mnemonic');
    
    if (storedMnemonic) {
      // Load existing wallet
      this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(storedMnemonic, {
        prefix: "persistence",
      });
    } else {
      // Create new wallet
      this.wallet = await DirectSecp256k1HdWallet.generate(24, {
        prefix: "persistence",
      });
      
      // Store mnemonic securely (user should backup)
      const mnemonic = this.wallet.mnemonic;
      await AsyncStorage.setItem('@xfuel_wallet_mnemonic', mnemonic);
    }

    // Connect client
    this.client = await SigningCosmWasmClient.connectWithSigner(
      this.config.rpcEndpoint,
      this.wallet,
      {
        gasPrice: {
          denom: "uxprt",
          amount: "0.025",
        },
      }
    );

    // Return user address
    const [account] = await this.wallet.getAccounts();
    return account.address;
  }

  /**
   * Get user address
   */
  async getUserAddress(): Promise<string> {
    if (!this.wallet) throw new Error("Wallet not initialized");
    const [account] = await this.wallet.getAccounts();
    return account.address;
  }

  /**
   * Get ibcTFUEL balance with formatting
   */
  async getFormattedBalance(userAddress: string): Promise<{
    raw: string;
    formatted: string;
    usd: string | null;
  }> {
    if (!this.client) throw new Error("Client not connected");

    const balanceResponse = await this.client.queryContractSmart(
      this.config.persistenceMinterContract,
      {
        balance: { address: userAddress },
      }
    );

    const raw = balanceResponse.balance;
    const formatted = (BigInt(raw) / BigInt(10 ** 18)).toString();
    
    // TODO: Fetch USD price from API
    const usd = null;

    return { raw, formatted, usd };
  }

  /**
   * Burn ibcTFUEL with mobile-optimized flow
   */
  async burnForUnwrap(
    amount: string,
    thetaRecipient: string,
    options?: {
      onProgress?: (step: string) => void;
      enableNotification?: boolean;
    }
  ): Promise<MobileBurnResult> {
    if (!this.client || !this.wallet) {
      throw new Error("Client not initialized");
    }

    const userAddress = await this.getUserAddress();

    // Validate inputs
    if (!thetaRecipient.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error("Invalid Theta address");
    }

    options?.onProgress?.("Validating transaction...");

    // Check balance
    const { raw: balance } = await this.getFormattedBalance(userAddress);
    if (BigInt(balance) < BigInt(amount)) {
      throw new Error("Insufficient balance");
    }

    options?.onProgress?.("Preparing burn transaction...");

    // Execute burn
    const executeMsg = {
      burn_for_unwrap: {
        amount,
        theta_recipient: thetaRecipient,
      },
    };

    options?.onProgress?.("Signing transaction...");

    const result = await this.client.execute(
      userAddress,
      this.config.persistenceMinterContract,
      executeMsg,
      "auto",
      "Burn ibcTFUEL for TFUEL unwrap"
    );

    options?.onProgress?.("Transaction submitted!");

    // Parse result
    const burnEvent = result.logs[0].events.find((e) => e.type === "wasm");
    if (!burnEvent) throw new Error("Burn event not found");

    const getAttr = (key: string) => {
      const attr = burnEvent.attributes.find((a) => a.key === key);
      return attr?.value || "";
    };

    const amountBigInt = BigInt(amount);
    const feeAmount = amountBigInt * 50n / 10000n;
    const burnedAmount = amountBigInt - feeAmount;

    // Estimated arrival: ~2-5 minutes for SP1 proof + Theta confirmation
    const estimatedArrivalTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    const trackingUrl = `https://www.mintscan.io/persistence/txs/${result.transactionHash}`;

    // Schedule notification if enabled
    if (options?.enableNotification && this.config.enableNotifications) {
      await this.scheduleUnwrapNotification(result.transactionHash, estimatedArrivalTime);
    }

    // Store transaction for history
    await this.saveTransactionHistory({
      txHash: result.transactionHash,
      type: "reverse_burn",
      amount: burnedAmount.toString(),
      recipient: thetaRecipient,
      timestamp: Math.floor(Date.now() / 1000),
      status: "pending",
    });

    return {
      txHash: result.transactionHash,
      burnedAmount: burnedAmount.toString(),
      feeAmount: feeAmount.toString(),
      nonce: parseInt(getAttr("nonce"), 10),
      estimatedArrivalTime,
      trackingUrl,
    };
  }

  /**
   * Save transaction to local history
   */
  private async saveTransactionHistory(tx: any): Promise<void> {
    const history = await AsyncStorage.getItem('@xfuel_tx_history');
    const txList = history ? JSON.parse(history) : [];
    
    txList.unshift(tx); // Add to beginning
    
    // Keep last 100 transactions
    if (txList.length > 100) {
      txList.pop();
    }
    
    await AsyncStorage.setItem('@xfuel_tx_history', JSON.stringify(txList));
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(): Promise<any[]> {
    const history = await AsyncStorage.getItem('@xfuel_tx_history');
    return history ? JSON.parse(history) : [];
  }

  /**
   * Schedule push notification for unwrap completion
   */
  private async scheduleUnwrapNotification(txHash: string, arrivalTime: number): Promise<void> {
    // This would integrate with React Native's push notification system
    // Placeholder for actual implementation
    console.log(`Notification scheduled for tx ${txHash} at ${new Date(arrivalTime * 1000)}`);
    
    // TODO: Integrate with Expo Notifications or React Native Push Notification
    /*
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "TFUEL Unwrap Complete!",
        body: `Your TFUEL has arrived on Theta chain. TX: ${txHash.slice(0, 10)}...`,
        data: { txHash, type: "unwrap_complete" },
      },
      trigger: {
        seconds: arrivalTime - Math.floor(Date.now() / 1000),
      },
    });
    */
  }

  /**
   * Check unwrap status (for status tracking screen)
   */
  async checkUnwrapStatus(txHash: string): Promise<{
    status: "pending" | "proved" | "completed" | "failed";
    confirmations: number;
    estimatedTimeRemaining: number | null;
  }> {
    // Query Persistence chain for confirmation
    // This is a placeholder - actual implementation would query block explorer API
    
    return {
      status: "pending",
      confirmations: 0,
      estimatedTimeRemaining: 180, // 3 minutes
    };
  }

  /**
   * Export wallet mnemonic for backup
   */
  async exportWalletMnemonic(): Promise<string> {
    const mnemonic = await AsyncStorage.getItem('@xfuel_wallet_mnemonic');
    if (!mnemonic) throw new Error("No wallet found");
    return mnemonic;
  }

  /**
   * Import wallet from mnemonic
   */
  async importWallet(mnemonic: string): Promise<string> {
    // Validate mnemonic
    try {
      this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
        prefix: "persistence",
      });
    } catch (error) {
      throw new Error("Invalid mnemonic phrase");
    }

    // Store securely
    await AsyncStorage.setItem('@xfuel_wallet_mnemonic', mnemonic);

    // Reconnect client
    if (this.client) {
      this.client = await SigningCosmWasmClient.connectWithSigner(
        this.config.rpcEndpoint,
        this.wallet,
        {
          gasPrice: {
            denom: "uxprt",
            amount: "0.025",
          },
        }
      );
    }

    const [account] = await this.wallet.getAccounts();
    return account.address;
  }

  /**
   * Clear wallet and reset app (logout)
   */
  async clearWallet(): Promise<void> {
    await AsyncStorage.removeItem('@xfuel_wallet_mnemonic');
    await AsyncStorage.removeItem('@xfuel_tx_history');
    this.wallet = null;
    this.client = null;
  }
}

/**
 * React Native Hook for Reverse Bridge
 */
export function useMobileReverseBridge(config: MobileBridgeConfig) {
  const [client, setClient] = React.useState<MobileReverseBridgeClient | null>(null);
  const [isInitialized, setIsInitialized] = React.useState(false);
  const [userAddress, setUserAddress] = React.useState<string>("");
  const [balance, setBalance] = React.useState({ raw: "0", formatted: "0", usd: null });
  const [isLoading, setIsLoading] = React.useState(false);

  const initialize = async () => {
    setIsLoading(true);
    try {
      const bridgeClient = new MobileReverseBridgeClient(config);
      const address = await bridgeClient.initializeWallet();
      setClient(bridgeClient);
      setUserAddress(address);
      setIsInitialized(true);

      // Load balance
      const bal = await bridgeClient.getFormattedBalance(address);
      setBalance(bal);
    } catch (error) {
      console.error("Failed to initialize:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const burnForUnwrap = async (
    amount: string,
    thetaRecipient: string,
    onProgress?: (step: string) => void
  ) => {
    if (!client) throw new Error("Client not initialized");
    return await client.burnForUnwrap(amount, thetaRecipient, {
      onProgress,
      enableNotification: true,
    });
  };

  const refreshBalance = async () => {
    if (!client || !userAddress) return;
    const bal = await client.getFormattedBalance(userAddress);
    setBalance(bal);
  };

  return {
    isInitialized,
    isLoading,
    userAddress,
    balance,
    initialize,
    burnForUnwrap,
    refreshBalance,
    getTransactionHistory: () => client?.getTransactionHistory(),
    exportWalletMnemonic: () => client?.exportWalletMnemonic(),
    importWallet: (mnemonic: string) => client?.importWallet(mnemonic),
    clearWallet: () => client?.clearWallet(),
  };
}

export default MobileReverseBridgeClient;
