// packages/sdk/src/services/BalanceWatcherService.ts
import { ThirdwebClient, getContract, readContract } from 'thirdweb';
import { Chain } from 'thirdweb/chains';
import { balanceOf } from 'thirdweb/extensions/erc20';

export interface BalanceUpdate {
  address: string;
  tokenAddress?: string; // undefined for native token
  balance: string;
  previousBalance?: string;
  chainId: number;
  timestamp: number;
}

export interface ChainBalanceMap {
  [chainId: number]: {
    native: string;
    tokens: { [tokenAddress: string]: string };
  };
}

export interface BalanceWatchOptions {
  pollInterval?: number;
  enableOptimisticUpdates?: boolean;
  refreshAfterTransaction?: boolean;
  maxRetries?: number;
}

const DEFAULT_BALANCE_OPTIONS: Required<BalanceWatchOptions> = {
  pollInterval: 10000, // 10 seconds
  enableOptimisticUpdates: true,
  refreshAfterTransaction: true,
  maxRetries: 3,
};

export class BalanceWatcherService {
  private client: ThirdwebClient;
  private activeWatchers: Map<string, { 
    interval: NodeJS.Timeout; 
    lastBalance: string; 
    callback: (update: BalanceUpdate) => void 
  }> = new Map();
  private balanceCache: Map<string, { balance: string; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5000; // 5 seconds

  constructor(client: ThirdwebClient) {
    this.client = client;
  }

  /**
   * Watch balance changes for an address
   */
  watchBalance(
    address: string,
    chain: Chain,
    tokenAddress: string | undefined,
    onBalanceChange: (update: BalanceUpdate) => void,
    options: BalanceWatchOptions = {}
  ): string {
    const opts = { ...DEFAULT_BALANCE_OPTIONS, ...options };
    const watcherKey = `${chain.id}-${address}-${tokenAddress || 'native'}`;

    // Cancel existing watcher if any
    this.cancelBalanceWatch(watcherKey);

    const pollBalance = async () => {
      try {
        const currentBalance = await this.getBalance(address, chain, tokenAddress);
        const cached = this.balanceCache.get(watcherKey);
        const previousBalance = cached?.balance;

        // Only trigger callback if balance changed
        if (!previousBalance || currentBalance !== previousBalance) {
          const update: BalanceUpdate = {
            address,
            tokenAddress,
            balance: currentBalance,
            previousBalance,
            chainId: chain.id,
            timestamp: Date.now()
          };

          onBalanceChange(update);
        }

        // Update cache
        this.balanceCache.set(watcherKey, {
          balance: currentBalance,
          timestamp: Date.now()
        });

      } catch (error) {
        console.error(`Error polling balance for ${watcherKey}:`, error);
      }
    };

    // Initial balance fetch
    pollBalance();

    // Set up polling interval
    const interval = setInterval(pollBalance, opts.pollInterval);

    // Store the watcher
    this.activeWatchers.set(watcherKey, {
      interval,
      lastBalance: '0',
      callback: onBalanceChange
    });

    return watcherKey;
  }

  /**
   * Get current balance for an address
   */
  async getBalance(
    address: string,
    chain: Chain,
    tokenAddress?: string,
    useCache: boolean = true
  ): Promise<string> {
    const cacheKey = `${chain.id}-${address}-${tokenAddress || 'native'}`;

    // Check cache first
    if (useCache) {
      const cached = this.balanceCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
        return cached.balance;
      }
    }

    try {
      let balance: string;

      if (tokenAddress) {
        // ERC20 token balance
        const contract = getContract({
          client: this.client,
          chain,
          address: tokenAddress,
        });

        const balanceResult = await readContract({
          contract,
          method: "function balanceOf(address) view returns (uint256)",
          params: [address]
        });

        balance = balanceResult.toString();
      } else {
        // Native token balance - use direct RPC call
        const response = await fetch(`https://${chain.id}.rpc.thirdweb.com`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getBalance',
            params: [address, 'latest'],
            id: 1
          })
        });

        const data = await response.json();
        if (data.result) {
          balance = parseInt(data.result, 16).toString();
        } else {
          balance = '0';
        }
      }

      // Update cache
      this.balanceCache.set(cacheKey, {
        balance,
        timestamp: Date.now()
      });

      return balance;
    } catch (error) {
      console.error(`Error fetching balance for ${address}:`, error);
      return '0';
    }
  }

  /**
   * Refresh balance after a transaction
   */
  async refreshBalanceAfterTransaction(
    transactionHash: string,
    address: string,
    chain: Chain,
    tokenAddress?: string,
    maxWaitTime: number = 30000 // 30 seconds
  ): Promise<BalanceUpdate> {
    const startTime = Date.now();
    const watcherKey = `${chain.id}-${address}-${tokenAddress || 'native'}`;
    
    // Get initial balance
    const initialBalance = await this.getBalance(address, chain, tokenAddress, false);
    
    // Poll for balance change
    const poll = async (): Promise<BalanceUpdate> => {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Balance refresh timeout');
      }

      const currentBalance = await this.getBalance(address, chain, tokenAddress, false);
      
      if (currentBalance !== initialBalance) {
        const update: BalanceUpdate = {
          address,
          tokenAddress,
          balance: currentBalance,
          previousBalance: initialBalance,
          chainId: chain.id,
          timestamp: Date.now()
        };

        // Notify any active watchers
        const watcher = this.activeWatchers.get(watcherKey);
        if (watcher) {
          watcher.callback(update);
        }

        return update;
      }

      // Wait and try again
      await new Promise(resolve => setTimeout(resolve, 2000));
      return poll();
    };

    return poll();
  }

  /**
   * Get balances across multiple chains
   */
  async getMultiChainBalances(
    address: string,
    chains: Chain[],
    tokenAddresses: { [chainId: number]: string[] } = {}
  ): Promise<ChainBalanceMap> {
    const balancePromises = chains.map(async (chain) => {
      try {
        // Get native balance
        const nativeBalance = await this.getBalance(address, chain);
        
        // Get token balances for this chain
        const tokenAddrs = tokenAddresses[chain.id] || [];
        const tokenBalancePromises = tokenAddrs.map(async (tokenAddress) => ({
          tokenAddress,
          balance: await this.getBalance(address, chain, tokenAddress)
        }));
        
        const tokenBalances = await Promise.all(tokenBalancePromises);
        const tokensMap: { [tokenAddress: string]: string } = {};
        
        tokenBalances.forEach(({ tokenAddress, balance }) => {
          tokensMap[tokenAddress] = balance;
        });

        return {
          chainId: chain.id,
          native: nativeBalance,
          tokens: tokensMap
        };
      } catch (error) {
        console.error(`Error fetching balances for chain ${chain.id}:`, error);
        return {
          chainId: chain.id,
          native: '0',
          tokens: {}
        };
      }
    });

    const results = await Promise.all(balancePromises);
    const balanceMap: ChainBalanceMap = {};
    
    results.forEach(result => {
      balanceMap[result.chainId] = {
        native: result.native,
        tokens: result.tokens
      };
    });

    return balanceMap;
  }

  /**
   * Force refresh all cached balances
   */
  async refreshAllBalances(): Promise<void> {
    const refreshPromises = Array.from(this.activeWatchers.entries()).map(
      async ([watcherKey, watcher]) => {
        try {
          const [chainId, address, tokenOrNative] = watcherKey.split('-');
          const tokenAddress = tokenOrNative === 'native' ? undefined : tokenOrNative;
          
          // Clear cache to force fresh fetch
          this.balanceCache.delete(watcherKey);
          
          // This will trigger the watcher callback if balance changed
          await this.getBalance(address, { id: parseInt(chainId) } as Chain, tokenAddress, false);
        } catch (error) {
          console.error(`Error refreshing balance for ${watcherKey}:`, error);
        }
      }
    );

    await Promise.all(refreshPromises);
  }

  /**
   * Cancel a specific balance watch
   */
  cancelBalanceWatch(watcherKey: string): void {
    const watcher = this.activeWatchers.get(watcherKey);
    if (watcher) {
      clearInterval(watcher.interval);
      this.activeWatchers.delete(watcherKey);
      this.balanceCache.delete(watcherKey);
    }
  }

  /**
   * Cancel balance watch by parameters
   */
  cancelBalanceWatchFor(
    address: string,
    chainId: number,
    tokenAddress?: string
  ): void {
    const watcherKey = `${chainId}-${address}-${tokenAddress || 'native'}`;
    this.cancelBalanceWatch(watcherKey);
  }

  /**
   * Cancel all balance watchers
   */
  cancelAllBalanceWatches(): void {
    for (const [watcherKey, watcher] of this.activeWatchers) {
      clearInterval(watcher.interval);
    }
    this.activeWatchers.clear();
    this.balanceCache.clear();
  }

  /**
   * Get active watchers count
   */
  getActiveWatchersCount(): number {
    return this.activeWatchers.size;
  }

  /**
   * Clear balance cache
   */
  clearCache(): void {
    this.balanceCache.clear();
  }

  /**
   * Get cached balance if available
   */
  getCachedBalance(
    address: string,
    chainId: number,
    tokenAddress?: string
  ): string | null {
    const cacheKey = `${chainId}-${address}-${tokenAddress || 'native'}`;
    const cached = this.balanceCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
      return cached.balance;
    }
    
    return null;
  }
}