import { getContract, readContract, createThirdwebClient, prepareContractCall } from 'thirdweb';
import { defineChain, arbitrum, base, avalanche, bsc, optimism, polygon, ethereum } from 'thirdweb/chains';
import { SUPPORTED_CHAINS, CONTRACT_CONSTANTS, getContractAddress, STREAMING_PLATFORM_TIPPING_ABI } from '@tippingchain/contracts-interface';
export { CONTRACT_CONSTANTS, MembershipTier, NETWORK_CONFIGS, RELAY_RECEIVER_ADDRESSES, SUPPORTED_CHAINS, SUPPORTED_TESTNETS, TIER_CREATOR_SHARES, getAllContractAddresses, getContractAddress, getRelayReceiverAddress, isContractDeployed } from '@tippingchain/contracts-interface';

// src/core/ApeChainTippingSDK.ts
var ApeChainRelayService = class {
  constructor() {
    this.APECHAIN_ID = SUPPORTED_CHAINS.APECHAIN;
    this.USDC_TOKEN_ADDRESS = CONTRACT_CONSTANTS.APECHAIN_USDC;
    this.baseUrl = "https://api.relay.link";
  }
  /**
   * Get a quote for relaying tokens to ApeChain (for estimation purposes)
   * Note: The actual relay is now handled by the integrated contract
   */
  async getQuote(params) {
    try {
      const response = await this.makeRequest("POST", "/quote", {
        originChainId: params.fromChainId,
        destinationChainId: params.toChainId,
        originCurrency: params.fromToken === "native" ? "0x0000000000000000000000000000000000000000" : params.fromToken,
        destinationCurrency: params.toToken,
        amount: params.amount
      });
      return {
        id: response.id || "",
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amount: params.amount,
        estimatedOutput: response.destinationAmount || "0",
        fees: response.fees || "0",
        estimatedTime: response.estimatedTime || 300,
        // 5 minutes default
        route: response.route
      };
    } catch (error) {
      throw new Error(`Failed to get relay quote: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  /**
   * Estimate USDC output for a tip (deprecated - contracts handle relay automatically)
   * @deprecated Use getQuote directly instead
   */
  async relayTipToApeChain(params) {
    try {
      const quote = await this.getQuote({
        fromChainId: params.fromChainId,
        fromToken: params.fromToken,
        toChainId: this.APECHAIN_ID,
        toToken: this.USDC_TOKEN_ADDRESS,
        amount: params.amount
      });
      return {
        success: true,
        relayId: quote.id,
        destinationChain: this.APECHAIN_ID,
        estimatedUsdcAmount: quote.estimatedOutput
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        destinationChain: this.APECHAIN_ID
      };
    }
  }
  async makeRequest(method, endpoint, data) {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const options = {
        method,
        headers: {
          "Content-Type": "application/json"
        }
      };
      if (data && (method === "POST" || method === "PUT")) {
        options.body = JSON.stringify(data);
      }
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`Request failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
};

// src/services/TransactionStatusService.ts
var DEFAULT_OPTIONS = {
  maxRetries: 100,
  // 100 * 3s = 5 minutes max
  retryInterval: 3e3,
  // 3 seconds
  timeout: 3e5,
  // 5 minutes
  confirmationsRequired: 1
};
var TransactionStatusService = class {
  constructor(client) {
    this.activeWatchers = /* @__PURE__ */ new Map();
    this.client = client;
  }
  /**
   * Watch a transaction until it's confirmed or fails
   */
  async watchTransaction(transactionHash, chain, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const watcherKey = `${chain.id}-${transactionHash}`;
    if (this.activeWatchers.has(watcherKey)) {
      return this.activeWatchers.get(watcherKey).promise;
    }
    const abortController = new AbortController();
    const promise = this._watchTransactionInternal(
      transactionHash,
      chain,
      opts,
      abortController.signal
    );
    this.activeWatchers.set(watcherKey, {
      abort: abortController,
      promise
    });
    promise.finally(() => {
      this.activeWatchers.delete(watcherKey);
    });
    return promise;
  }
  /**
   * Watch a transaction with callback for real-time updates
   */
  async watchTransactionWithCallback(transactionHash, chain, onUpdate, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let retries = 0;
    const startTime = Date.now();
    const poll = async () => {
      try {
        if (Date.now() - startTime > opts.timeout) {
          const update = {
            transactionHash,
            status: "failed",
            error: "Transaction monitoring timeout",
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }
        const receipt = await this.getTransactionReceipt(transactionHash, chain);
        if (receipt) {
          const status = receipt.status === "success" ? "confirmed" : "failed";
          const update = {
            transactionHash,
            status,
            receipt,
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }
        if (retries < opts.maxRetries) {
          const update = {
            transactionHash,
            status: "pending",
            timestamp: Date.now()
          };
          onUpdate(update);
          retries++;
          await new Promise((resolve) => setTimeout(resolve, opts.retryInterval));
          return poll();
        } else {
          const update = {
            transactionHash,
            status: "failed",
            error: "Transaction not found after maximum retries",
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }
      } catch (error) {
        retries++;
        if (retries >= opts.maxRetries) {
          const update = {
            transactionHash,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }
        await new Promise((resolve) => setTimeout(resolve, opts.retryInterval));
        return poll();
      }
    };
    return poll();
  }
  /**
   * Get transaction receipt (simplified implementation)
   */
  async getTransactionReceipt(transactionHash, chain) {
    try {
      const response = await fetch(`https://${chain.id}.rpc.thirdweb.com`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [transactionHash],
          id: 1
        })
      });
      const data = await response.json();
      const receipt = data.result;
      if (!receipt) {
        return null;
      }
      let confirmations = 1;
      return {
        transactionHash: receipt.transactionHash,
        blockNumber: parseInt(receipt.blockNumber, 16),
        blockHash: receipt.blockHash,
        gasUsed: parseInt(receipt.gasUsed, 16).toString(),
        effectiveGasPrice: receipt.effectiveGasPrice ? parseInt(receipt.effectiveGasPrice, 16).toString() : "0",
        status: receipt.status === "0x1" ? "success" : "failure",
        confirmations,
        timestamp: Date.now()
        // Use current timestamp as approximation
      };
    } catch (error) {
      console.error("Error fetching transaction receipt:", error);
      return null;
    }
  }
  /**
   * Check if a transaction exists in the mempool or blockchain
   */
  async getTransactionStatus(transactionHash, chain) {
    try {
      const receipt = await this.getTransactionReceipt(transactionHash, chain);
      if (receipt) {
        return receipt.status === "success" ? "confirmed" : "failed";
      }
      try {
        const response = await fetch(`https://${chain.id}.rpc.thirdweb.com`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getTransactionByHash",
            params: [transactionHash],
            id: 1
          })
        });
        const data = await response.json();
        if (data.result) {
          return "pending";
        }
      } catch (error) {
        console.warn("Error checking mempool:", error);
      }
      return "not_found";
    } catch (error) {
      console.error("Error checking transaction status:", error);
      return "not_found";
    }
  }
  /**
   * Cancel watching a specific transaction
   */
  cancelWatch(transactionHash, chainId) {
    const watcherKey = `${chainId}-${transactionHash}`;
    const watcher = this.activeWatchers.get(watcherKey);
    if (watcher) {
      watcher.abort.abort();
      this.activeWatchers.delete(watcherKey);
    }
  }
  /**
   * Cancel all active watchers
   */
  cancelAllWatches() {
    for (const watcher of this.activeWatchers.values()) {
      watcher.abort.abort();
    }
    this.activeWatchers.clear();
  }
  /**
   * Get the number of active watchers
   */
  getActiveWatchersCount() {
    return this.activeWatchers.size;
  }
  /**
   * Internal implementation for watching transactions
   */
  async _watchTransactionInternal(transactionHash, chain, options, signal) {
    let retries = 0;
    const startTime = Date.now();
    const poll = async () => {
      if (signal.aborted) {
        throw new Error("Transaction watching was cancelled");
      }
      try {
        if (Date.now() - startTime > options.timeout) {
          return {
            transactionHash,
            status: "failed",
            error: "Transaction monitoring timeout",
            timestamp: Date.now()
          };
        }
        const receipt = await this.getTransactionReceipt(transactionHash, chain);
        if (receipt) {
          if (receipt.confirmations >= options.confirmationsRequired) {
            return {
              transactionHash,
              status: receipt.status === "success" ? "confirmed" : "failed",
              receipt,
              timestamp: Date.now()
            };
          } else {
            if (retries < options.maxRetries) {
              retries++;
              await new Promise((resolve) => setTimeout(resolve, options.retryInterval));
              return poll();
            }
          }
        }
        if (retries < options.maxRetries) {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, options.retryInterval));
          return poll();
        } else {
          return {
            transactionHash,
            status: "failed",
            error: "Transaction not found after maximum retries",
            timestamp: Date.now()
          };
        }
      } catch (error) {
        if (signal.aborted) {
          throw new Error("Transaction watching was cancelled");
        }
        retries++;
        if (retries >= options.maxRetries) {
          return {
            transactionHash,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now()
          };
        }
        await new Promise((resolve) => setTimeout(resolve, options.retryInterval));
        return poll();
      }
    };
    return poll();
  }
};
var DEFAULT_BALANCE_OPTIONS = {
  pollInterval: 1e4,
  // 10 seconds
  enableOptimisticUpdates: true,
  refreshAfterTransaction: true,
  maxRetries: 3
};
var BalanceWatcherService = class {
  // 5 seconds
  constructor(client) {
    this.activeWatchers = /* @__PURE__ */ new Map();
    this.balanceCache = /* @__PURE__ */ new Map();
    this.CACHE_DURATION = 5e3;
    this.client = client;
  }
  /**
   * Watch balance changes for an address
   */
  watchBalance(address, chain, tokenAddress, onBalanceChange, options = {}) {
    const opts = { ...DEFAULT_BALANCE_OPTIONS, ...options };
    const watcherKey = `${chain.id}-${address}-${tokenAddress || "native"}`;
    this.cancelBalanceWatch(watcherKey);
    const pollBalance = async () => {
      try {
        const currentBalance = await this.getBalance(address, chain, tokenAddress);
        const cached = this.balanceCache.get(watcherKey);
        const previousBalance = cached?.balance;
        if (!previousBalance || currentBalance !== previousBalance) {
          const update = {
            address,
            tokenAddress,
            balance: currentBalance,
            previousBalance,
            chainId: chain.id,
            timestamp: Date.now()
          };
          onBalanceChange(update);
        }
        this.balanceCache.set(watcherKey, {
          balance: currentBalance,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`Error polling balance for ${watcherKey}:`, error);
      }
    };
    pollBalance();
    const interval = setInterval(pollBalance, opts.pollInterval);
    this.activeWatchers.set(watcherKey, {
      interval,
      lastBalance: "0",
      callback: onBalanceChange
    });
    return watcherKey;
  }
  /**
   * Get current balance for an address
   */
  async getBalance(address, chain, tokenAddress, useCache = true) {
    const cacheKey = `${chain.id}-${address}-${tokenAddress || "native"}`;
    if (useCache) {
      const cached = this.balanceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.balance;
      }
    }
    try {
      let balance;
      if (tokenAddress) {
        const contract = getContract({
          client: this.client,
          chain,
          address: tokenAddress
        });
        const balanceResult = await readContract({
          contract,
          method: "function balanceOf(address) view returns (uint256)",
          params: [address]
        });
        balance = balanceResult.toString();
      } else {
        const response = await fetch(`https://${chain.id}.rpc.thirdweb.com`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [address, "latest"],
            id: 1
          })
        });
        const data = await response.json();
        if (data.result) {
          balance = parseInt(data.result, 16).toString();
        } else {
          balance = "0";
        }
      }
      this.balanceCache.set(cacheKey, {
        balance,
        timestamp: Date.now()
      });
      return balance;
    } catch (error) {
      console.error(`Error fetching balance for ${address}:`, error);
      return "0";
    }
  }
  /**
   * Refresh balance after a transaction
   */
  async refreshBalanceAfterTransaction(transactionHash, address, chain, tokenAddress, maxWaitTime = 3e4) {
    const startTime = Date.now();
    const watcherKey = `${chain.id}-${address}-${tokenAddress || "native"}`;
    const initialBalance = await this.getBalance(address, chain, tokenAddress, false);
    const poll = async () => {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error("Balance refresh timeout");
      }
      const currentBalance = await this.getBalance(address, chain, tokenAddress, false);
      if (currentBalance !== initialBalance) {
        const update = {
          address,
          tokenAddress,
          balance: currentBalance,
          previousBalance: initialBalance,
          chainId: chain.id,
          timestamp: Date.now()
        };
        const watcher = this.activeWatchers.get(watcherKey);
        if (watcher) {
          watcher.callback(update);
        }
        return update;
      }
      await new Promise((resolve) => setTimeout(resolve, 2e3));
      return poll();
    };
    return poll();
  }
  /**
   * Get balances across multiple chains
   */
  async getMultiChainBalances(address, chains, tokenAddresses = {}) {
    const balancePromises = chains.map(async (chain) => {
      try {
        const nativeBalance = await this.getBalance(address, chain);
        const tokenAddrs = tokenAddresses[chain.id] || [];
        const tokenBalancePromises = tokenAddrs.map(async (tokenAddress) => ({
          tokenAddress,
          balance: await this.getBalance(address, chain, tokenAddress)
        }));
        const tokenBalances = await Promise.all(tokenBalancePromises);
        const tokensMap = {};
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
          native: "0",
          tokens: {}
        };
      }
    });
    const results = await Promise.all(balancePromises);
    const balanceMap = {};
    results.forEach((result) => {
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
  async refreshAllBalances() {
    const refreshPromises = Array.from(this.activeWatchers.entries()).map(
      async ([watcherKey, watcher]) => {
        try {
          const [chainId, address, tokenOrNative] = watcherKey.split("-");
          const tokenAddress = tokenOrNative === "native" ? void 0 : tokenOrNative;
          this.balanceCache.delete(watcherKey);
          await this.getBalance(address, { id: parseInt(chainId) }, tokenAddress, false);
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
  cancelBalanceWatch(watcherKey) {
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
  cancelBalanceWatchFor(address, chainId, tokenAddress) {
    const watcherKey = `${chainId}-${address}-${tokenAddress || "native"}`;
    this.cancelBalanceWatch(watcherKey);
  }
  /**
   * Cancel all balance watchers
   */
  cancelAllBalanceWatches() {
    for (const [watcherKey, watcher] of this.activeWatchers) {
      clearInterval(watcher.interval);
    }
    this.activeWatchers.clear();
    this.balanceCache.clear();
  }
  /**
   * Get active watchers count
   */
  getActiveWatchersCount() {
    return this.activeWatchers.size;
  }
  /**
   * Clear balance cache
   */
  clearCache() {
    this.balanceCache.clear();
  }
  /**
   * Get cached balance if available
   */
  getCachedBalance(address, chainId, tokenAddress) {
    const cacheKey = `${chainId}-${address}-${tokenAddress || "native"}`;
    const cached = this.balanceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.balance;
    }
    return null;
  }
};

// src/services/RelayStatusService.ts
var DEFAULT_RELAY_OPTIONS = {
  maxWaitTime: 6e5,
  // 10 minutes
  pollInterval: 5e3,
  // 5 seconds
  enableProgressUpdates: true
};
var RelayStatusService = class {
  constructor(client) {
    this.activeRelayWatchers = /* @__PURE__ */ new Map();
    // Relay.link API endpoints (if available)
    this.RELAY_API_BASE = "https://api.relay.link";
    this.client = client;
    this.transactionStatusService = new TransactionStatusService(client);
  }
  /**
   * Track a relay transaction from source to destination
   */
  async trackRelay(relayId, sourceChain, destinationChain, sourceTransactionHash, options = {}) {
    const opts = { ...DEFAULT_RELAY_OPTIONS, ...options };
    if (this.activeRelayWatchers.has(relayId)) {
      return this.activeRelayWatchers.get(relayId).promise;
    }
    const abortController = new AbortController();
    const promise = this._trackRelayInternal(
      relayId,
      sourceChain,
      destinationChain,
      sourceTransactionHash,
      opts,
      abortController.signal
    );
    this.activeRelayWatchers.set(relayId, {
      abort: abortController,
      promise
    });
    promise.finally(() => {
      this.activeRelayWatchers.delete(relayId);
    });
    return promise;
  }
  /**
   * Track relay with callback for real-time updates
   */
  async trackRelayWithCallback(relayId, sourceChain, destinationChain, sourceTransactionHash, onUpdate, options = {}) {
    const opts = { ...DEFAULT_RELAY_OPTIONS, ...options };
    const startTime = Date.now();
    let lastProgress = 0;
    const poll = async () => {
      try {
        if (Date.now() - startTime > opts.maxWaitTime) {
          const update = {
            relayId,
            status: "failed",
            progress: lastProgress,
            error: "Relay tracking timeout",
            timestamp: Date.now()
          };
          onUpdate(update);
          return {
            relayId,
            sourceChain: sourceChain.id,
            destinationChain: destinationChain.id,
            sourceTransactionHash,
            status: "failed",
            progress: lastProgress,
            error: "Relay tracking timeout",
            sourceAmount: "0",
            tokenSymbol: "UNKNOWN"
          };
        }
        const relayStatus = await this.getRelayStatus(
          relayId,
          sourceChain,
          destinationChain,
          sourceTransactionHash
        );
        if (relayStatus.progress !== lastProgress || opts.enableProgressUpdates) {
          const update = {
            relayId,
            status: relayStatus.status,
            progress: relayStatus.progress,
            error: relayStatus.error,
            timestamp: Date.now(),
            destinationTransactionHash: relayStatus.destinationTransactionHash
          };
          onUpdate(update);
          lastProgress = relayStatus.progress;
        }
        if (relayStatus.status === "completed" || relayStatus.status === "failed") {
          return relayStatus;
        }
        await new Promise((resolve) => setTimeout(resolve, opts.pollInterval));
        return poll();
      } catch (error) {
        const update = {
          relayId,
          status: "failed",
          progress: lastProgress,
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: Date.now()
        };
        onUpdate(update);
        throw error;
      }
    };
    return poll();
  }
  /**
   * Get current relay status
   */
  async getRelayStatus(relayId, sourceChain, destinationChain, sourceTransactionHash) {
    try {
      const sourceStatus = await this.transactionStatusService.getTransactionStatus(
        sourceTransactionHash,
        sourceChain
      );
      if (sourceStatus === "not_found" || sourceStatus === "failed") {
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status: "failed",
          progress: 0,
          error: sourceStatus === "not_found" ? "Source transaction not found" : "Source transaction failed",
          sourceAmount: "0",
          tokenSymbol: "UNKNOWN"
        };
      }
      if (sourceStatus === "pending") {
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status: "pending",
          progress: 25,
          sourceAmount: "0",
          tokenSymbol: "UNKNOWN"
        };
      }
      try {
        const apiStatus = await this.getRelayStatusFromAPI(relayId);
        if (apiStatus) {
          return apiStatus;
        }
      } catch (apiError) {
        console.warn("Relay API unavailable, using fallback method:", apiError);
      }
      const sourceReceipt = await this.transactionStatusService.getTransactionReceipt(
        sourceTransactionHash,
        sourceChain
      );
      if (sourceReceipt) {
        const elapsedTime = Date.now() - (sourceReceipt.timestamp || Date.now());
        const estimatedRelayTime = this.getEstimatedRelayTime(sourceChain.id, destinationChain.id);
        let progress = 50;
        let status = "relaying";
        if (elapsedTime > estimatedRelayTime) {
          const destinationTxHash = await this.findDestinationTransaction(
            sourceTransactionHash,
            destinationChain,
            relayId
          );
          if (destinationTxHash) {
            const destStatus = await this.transactionStatusService.getTransactionStatus(
              destinationTxHash,
              destinationChain
            );
            if (destStatus === "confirmed") {
              progress = 100;
              status = "completed";
            } else if (destStatus === "failed") {
              status = "failed";
              progress = 75;
            }
            return {
              relayId,
              sourceChain: sourceChain.id,
              destinationChain: destinationChain.id,
              sourceTransactionHash,
              destinationTransactionHash: destinationTxHash,
              status,
              progress,
              sourceAmount: "0",
              tokenSymbol: "USDC"
            };
          }
        } else {
          progress = Math.min(95, 50 + elapsedTime / estimatedRelayTime * 45);
        }
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status,
          progress,
          sourceAmount: "0",
          tokenSymbol: "USDC",
          estimatedCompletionTime: (sourceReceipt.timestamp || Date.now()) + estimatedRelayTime
        };
      }
      return {
        relayId,
        sourceChain: sourceChain.id,
        destinationChain: destinationChain.id,
        sourceTransactionHash,
        status: "initiated",
        progress: 10,
        sourceAmount: "0",
        tokenSymbol: "UNKNOWN"
      };
    } catch (error) {
      console.error("Error getting relay status:", error);
      return {
        relayId,
        sourceChain: sourceChain.id,
        destinationChain: destinationChain.id,
        sourceTransactionHash,
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        sourceAmount: "0",
        tokenSymbol: "UNKNOWN"
      };
    }
  }
  /**
   * Cancel relay tracking
   */
  cancelRelayTracking(relayId) {
    const watcher = this.activeRelayWatchers.get(relayId);
    if (watcher) {
      watcher.abort.abort();
      this.activeRelayWatchers.delete(relayId);
    }
  }
  /**
   * Cancel all relay tracking
   */
  cancelAllRelayTracking() {
    for (const watcher of this.activeRelayWatchers.values()) {
      watcher.abort.abort();
    }
    this.activeRelayWatchers.clear();
  }
  /**
   * Get estimated relay time between chains
   */
  getEstimatedRelayTime(sourceChainId, destinationChainId) {
    let baseTime = 12e4;
    const slowChains = [1, 137, 10];
    if (slowChains.includes(sourceChainId)) {
      baseTime += 6e4;
    }
    if (destinationChainId === 33139) {
      baseTime -= 3e4;
    }
    return Math.max(6e4, baseTime);
  }
  /**
   * Try to get relay status from Relay.link API
   */
  async getRelayStatusFromAPI(relayId) {
    try {
      const response = await fetch(`${this.RELAY_API_BASE}/status/${relayId}`);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return {
        relayId,
        sourceChain: data.sourceChain,
        destinationChain: data.destinationChain,
        sourceTransactionHash: data.sourceTx,
        destinationTransactionHash: data.destTx,
        status: this.mapApiStatusToRelayStatus(data.status),
        progress: data.progress || 0,
        sourceAmount: data.sourceAmount || "0",
        destinationAmount: data.destAmount,
        tokenSymbol: data.token || "USDC",
        estimatedCompletionTime: data.eta,
        actualCompletionTime: data.completedAt
      };
    } catch (error) {
      console.warn("Failed to fetch from Relay API:", error);
      return null;
    }
  }
  /**
   * Map API status to our RelayStatus
   */
  mapApiStatusToRelayStatus(apiStatus) {
    switch (apiStatus?.toLowerCase()) {
      case "pending":
        return "pending";
      case "processing":
      case "bridging":
        return "relaying";
      case "completed":
      case "success":
        return "completed";
      case "failed":
      case "error":
        return "failed";
      default:
        return "initiated";
    }
  }
  /**
   * Try to find the destination transaction by looking for patterns
   */
  async findDestinationTransaction(sourceTransactionHash, destinationChain, relayId) {
    try {
      return null;
    } catch (error) {
      console.error("Error finding destination transaction:", error);
      return null;
    }
  }
  /**
   * Generate a unique relay ID based on transaction hash and timestamp
   */
  static generateRelayId(transactionHash, timestamp) {
    const ts = timestamp || Date.now();
    return `relay_${transactionHash.slice(2, 10)}_${ts}`;
  }
  /**
   * Internal tracking implementation
   */
  async _trackRelayInternal(relayId, sourceChain, destinationChain, sourceTransactionHash, options, signal) {
    const startTime = Date.now();
    const poll = async () => {
      if (signal.aborted) {
        throw new Error("Relay tracking was cancelled");
      }
      if (Date.now() - startTime > options.maxWaitTime) {
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status: "failed",
          progress: 0,
          error: "Relay tracking timeout",
          sourceAmount: "0",
          tokenSymbol: "UNKNOWN"
        };
      }
      const relayStatus = await this.getRelayStatus(
        relayId,
        sourceChain,
        destinationChain,
        sourceTransactionHash
      );
      if (relayStatus.status === "completed" || relayStatus.status === "failed") {
        return relayStatus;
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollInterval));
      return poll();
    };
    return poll();
  }
};
var TypedABI = STREAMING_PLATFORM_TIPPING_ABI;
var ApeChainTippingSDK = class {
  constructor(config) {
    if (!config.clientId) {
      throw new Error("clientId is required");
    }
    this.config = config;
    this.client = createThirdwebClient({ clientId: config.clientId });
    this.relayService = new ApeChainRelayService();
    this.transactionStatus = new TransactionStatusService(this.client);
    this.balanceWatcher = new BalanceWatcherService(this.client);
    this.relayStatus = new RelayStatusService(this.client);
  }
  getContractAddress(chainId) {
    if (this.config.streamingPlatformAddresses && this.config.streamingPlatformAddresses[chainId]) {
      return this.config.streamingPlatformAddresses[chainId];
    }
    return getContractAddress(chainId, this.config.useTestnet || false);
  }
  async sendTip(params) {
    try {
      const contractAddress = this.getContractAddress(params.sourceChainId);
      if (!contractAddress) {
        throw new Error(`Source chain ${params.sourceChainId} not supported or contract not deployed`);
      }
      const creator = await this.getCreator(params.creatorId, params.sourceChainId);
      if (!creator.active) {
        throw new Error(`Creator ${params.creatorId} is not active`);
      }
      const chain = this.getChainById(params.sourceChainId);
      const contract = getContract({
        client: this.client,
        chain,
        address: contractAddress,
        abi: TypedABI
      });
      let transaction;
      if (params.token === "native") {
        transaction = prepareContractCall({
          contract,
          method: "function tipCreatorETH(uint256 creatorId)",
          params: [BigInt(params.creatorId)],
          value: BigInt(params.amount)
        });
      } else {
        transaction = prepareContractCall({
          contract,
          method: "function tipCreatorToken(uint256 creatorId, address token, uint256 amount)",
          params: [BigInt(params.creatorId), params.token, BigInt(params.amount)]
        });
      }
      const result = await this.executeTransaction(transaction);
      const relayResult = await this.relayService.relayTipToApeChain({
        fromChainId: params.sourceChainId,
        fromToken: params.token,
        amount: params.amount,
        creatorAddress: creator.wallet,
        // Use actual creator wallet from registry
        targetToken: "USDC"
        // Target USDC on ApeChain
      });
      return {
        success: true,
        sourceTransactionHash: result.transactionHash,
        relayId: relayResult.relayId,
        creatorId: params.creatorId,
        estimatedUsdcAmount: relayResult.estimatedUsdcAmount || "0"
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  // Creator management methods
  async addCreator(registration) {
    if (registration.chainId) {
      return this.addCreatorToChain(
        registration.creatorWallet,
        registration.tier,
        registration.thirdwebId,
        registration.chainId
      );
    }
    const sourceChains = [
      SUPPORTED_CHAINS.ETHEREUM,
      SUPPORTED_CHAINS.POLYGON,
      SUPPORTED_CHAINS.OPTIMISM,
      SUPPORTED_CHAINS.BSC,
      SUPPORTED_CHAINS.ABSTRACT,
      SUPPORTED_CHAINS.AVALANCHE,
      SUPPORTED_CHAINS.BASE,
      SUPPORTED_CHAINS.ARBITRUM,
      SUPPORTED_CHAINS.TAIKO
    ];
    let creatorId = null;
    const errors = [];
    for (const chainId of sourceChains) {
      try {
        const contractAddress = this.getContractAddress(chainId);
        if (!contractAddress) {
          console.warn(`Chain ${chainId} not deployed, skipping`);
          continue;
        }
        const id = await this.addCreatorToChain(
          registration.creatorWallet,
          registration.tier,
          registration.thirdwebId,
          chainId
        );
        if (creatorId === null) {
          creatorId = id;
        } else if (creatorId !== id) {
          console.warn(`Creator ID mismatch: expected ${creatorId}, got ${id} on chain ${chainId}`);
        }
      } catch (error) {
        errors.push(`Chain ${chainId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (creatorId === null) {
      throw new Error(`Failed to register creator on any chain. Errors: ${errors.join(", ")}`);
    }
    return creatorId;
  }
  async addCreatorToChain(creatorWallet, tier, thirdwebId, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported for creator registration or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function addCreator(address creatorWallet, uint8 tier, string thirdwebId)",
      params: [creatorWallet, tier, thirdwebId || ""]
    });
    await this.executeTransaction(transaction);
    const creatorId = await this.readContract(contract, "getCreatorByWallet", [creatorWallet]);
    return Number(creatorId);
  }
  /**
   * Prepare a creator addition transaction for external execution
   * This method returns the prepared transaction without executing it,
   * allowing the calling application to handle wallet interaction
   */
  async prepareAddCreatorTransaction(registration) {
    const chainId = registration.chainId || SUPPORTED_CHAINS.BASE;
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported for creator registration or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function addCreator(address creatorWallet, uint8 tier, string thirdwebId)",
      params: [
        registration.creatorWallet,
        registration.tier,
        registration.thirdwebId || ""
      ]
    });
    return {
      transaction,
      contractAddress,
      chainId
    };
  }
  async getCreator(creatorId, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const creatorInfo = await this.readContract(contract, "getCreatorInfo", [BigInt(creatorId)]);
    return {
      id: creatorId,
      wallet: creatorInfo[0],
      // wallet
      active: creatorInfo[1],
      // active
      totalTips: creatorInfo[2].toString(),
      // totalTips
      tipCount: Number(creatorInfo[3]),
      // tipCount
      tier: creatorInfo[4],
      // tier
      creatorShareBps: Number(creatorInfo[5])
      // creatorShareBps
    };
  }
  async getCreatorByWallet(walletAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const creatorId = await this.readContract(contract, "getCreatorByWallet", [walletAddress]);
    if (Number(creatorId) === 0) {
      return null;
    }
    return this.getCreator(Number(creatorId), chainId);
  }
  /**
   * Get creator by thirdweb account ID
   * @param thirdwebId Thirdweb account ID
   * @param chainId Chain ID
   * @returns Creator information or null if not found
   */
  async getCreatorByThirdwebId(thirdwebId, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const creatorId = await this.readContract(contract, "getCreatorByThirdwebId", [thirdwebId]);
    if (Number(creatorId) === 0) {
      return null;
    }
    return this.getCreator(Number(creatorId), chainId);
  }
  async updateCreatorWallet(creatorId, newWallet, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function updateCreatorWallet(uint256 creatorId, address newWallet)",
      params: [BigInt(creatorId), newWallet]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  async updateCreatorTier(creatorId, newTier, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function updateCreatorTier(uint256 creatorId, uint8 newTier)",
      params: [BigInt(creatorId), newTier]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  async calculateTipSplits(creatorId, tipAmount, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const result = await this.readContract(
      contract,
      "calculateTipSplits",
      [BigInt(creatorId), BigInt(tipAmount)]
    );
    return {
      platformFee: result[0].toString(),
      creatorAmount: result[1].toString(),
      businessAmount: result[2].toString()
    };
  }
  async getCreatorUsdcBalanceOnApeChain(creatorAddress) {
    const apeChainAddress = this.getContractAddress(SUPPORTED_CHAINS.APECHAIN);
    if (!apeChainAddress) {
      throw new Error("ApeChain contract not deployed or configured");
    }
    const chain = this.getChainById(SUPPORTED_CHAINS.APECHAIN);
    const contract = getContract({
      client: this.client,
      chain,
      address: apeChainAddress,
      abi: TypedABI
    });
    const balances = await this.readContract(contract, "getBalances", [creatorAddress]);
    return balances[1].toString();
  }
  async getPlatformStats(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const stats = await this.readContract(contract, "getPlatformStats", []);
    return {
      totalTips: stats[0].toString(),
      totalCount: Number(stats[1]),
      totalRelayed: stats[2].toString(),
      activeCreators: Number(stats[3]),
      autoRelayEnabled: stats[4]
    };
  }
  async getTopCreators(limit = 10, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const maxCreators = Math.max(limit * 2, 100);
    const result = await this.readContract(
      contract,
      "getAllActiveCreators",
      [BigInt(maxCreators)]
    );
    const [creatorIds, wallets] = result;
    const allCreators = [];
    for (let i = 0; i < creatorIds.length; i++) {
      allCreators.push({
        id: Number(creatorIds[i]),
        wallet: wallets[i],
        active: true,
        // getAllActiveCreators only returns active creators
        totalTips: "0",
        // Will be fetched below
        tipCount: 0
        // Will be fetched below
      });
    }
    const creatorsToEnrich = allCreators.slice(0, Math.min(limit * 3, allCreators.length));
    for (const creator of creatorsToEnrich) {
      try {
        const creatorInfo = await this.readContract(
          contract,
          "getCreatorInfo",
          [BigInt(creator.id)]
        );
        creator.totalTips = creatorInfo[1].toString();
        creator.tipCount = Number(creatorInfo[3]);
      } catch (error) {
        console.warn(`Failed to get creator info for ID ${creator.id}:`, error);
      }
    }
    allCreators.sort((a, b) => {
      const aTips = BigInt(a.totalTips);
      const bTips = BigInt(b.totalTips);
      if (bTips > aTips) return 1;
      if (bTips < aTips) return -1;
      return 0;
    });
    const topCreators = allCreators.slice(0, limit);
    return topCreators;
  }
  getChainById(chainId) {
    const chainMap = {
      // Mainnet chains
      1: ethereum,
      137: polygon,
      10: optimism,
      56: bsc,
      43114: avalanche,
      8453: base,
      42161: arbitrum,
      2741: defineChain({
        id: 2741,
        name: "Abstract",
        rpc: "https://api.testnet.abs.xyz",
        nativeCurrency: {
          name: "Ethereum",
          symbol: "ETH",
          decimals: 18
        }
      }),
      33139: defineChain({
        id: 33139,
        name: "ApeChain",
        rpc: "https://33139.rpc.thirdweb.com",
        nativeCurrency: {
          name: "APE",
          symbol: "APE",
          decimals: 18
        }
      }),
      167e3: defineChain({
        id: 167e3,
        name: "Taiko",
        rpc: "https://rpc.mainnet.taiko.xyz",
        nativeCurrency: {
          name: "Ethereum",
          symbol: "ETH",
          decimals: 18
        }
      }),
      // Testnets
      17e3: defineChain({
        id: 17e3,
        name: "Ethereum Holesky",
        rpc: "https://ethereum-holesky-rpc.publicnode.com",
        nativeCurrency: {
          name: "Ethereum",
          symbol: "ETH",
          decimals: 18
        }
      }),
      80002: defineChain({
        id: 80002,
        name: "Polygon Amoy",
        rpc: "https://rpc-amoy.polygon.technology",
        nativeCurrency: {
          name: "MATIC",
          symbol: "MATIC",
          decimals: 18
        }
      }),
      33111: defineChain({
        id: 33111,
        name: "ApeChain Curtis (Testnet)",
        rpc: "https://curtis.rpc.caldera.xyz/http",
        nativeCurrency: {
          name: "APE",
          symbol: "APE",
          decimals: 18
        }
      })
    };
    const chain = chainMap[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    return chain;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async executeTransaction(_transaction) {
    return {
      transactionHash: "0x" + Math.random().toString(16).substr(2, 64),
      blockNumber: Math.floor(Math.random() * 1e6),
      success: true
    };
  }
  async readContract(contract, method, params) {
    try {
      const result = await readContract({
        contract,
        method,
        params
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to read contract: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  // ============ Viewer Rewards Methods ============
  /**
   * Register a new viewer with optional thirdweb ID
   * @param registration Viewer registration parameters
   * @returns The assigned viewer ID
   */
  async registerViewer(registration) {
    const chainId = registration.chainId || SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function registerViewer(address viewerWallet, string thirdwebId)",
      params: [registration.walletAddress, registration.thirdwebId || ""]
    });
    await this.executeTransaction(transaction);
    const viewerId = await this.readContract(contract, "getViewerByWallet", [registration.walletAddress]);
    return Number(viewerId);
  }
  /**
   * Send a reward to a viewer
   * @param params Viewer reward parameters
   * @returns Transaction result
   */
  async rewardViewer(params) {
    const chainId = params.chainId || SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    try {
      let transaction;
      const amountBigInt = BigInt(params.amount);
      const platformFee = amountBigInt * BigInt(100) / BigInt(1e4);
      const viewerAmount = amountBigInt - platformFee;
      const relayQuote = await this.relayService.getQuote({
        fromChainId: chainId,
        fromToken: params.token === "native" ? "native" : params.token || "native",
        toChainId: SUPPORTED_CHAINS.APECHAIN,
        toToken: "USDC",
        amount: viewerAmount.toString()
      });
      const estimatedUsdcAmount = relayQuote.estimatedOutput;
      if (params.viewerId) {
        if (params.token === "native" || !params.token) {
          transaction = prepareContractCall({
            contract,
            method: "function rewardViewerByIdETH(uint256 viewerId, string reason)",
            params: [BigInt(params.viewerId), params.reason || ""],
            value: amountBigInt
          });
        } else {
          throw new Error("Token rewards by ID not yet implemented");
        }
      } else if (params.thirdwebId) {
        const viewerId = await this.readContract(contract, "getViewerByThirdwebId", [params.thirdwebId]);
        if (Number(viewerId) === 0) {
          throw new Error(`No viewer found for thirdweb ID: ${params.thirdwebId}`);
        }
        if (params.token === "native" || !params.token) {
          transaction = prepareContractCall({
            contract,
            method: "function rewardViewerByIdETH(uint256 viewerId, string reason)",
            params: [BigInt(Number(viewerId)), params.reason || ""],
            value: amountBigInt
          });
        } else {
          throw new Error("Token rewards by ID not yet implemented");
        }
      } else if (params.viewerAddress) {
        if (params.token === "native" || !params.token) {
          transaction = prepareContractCall({
            contract,
            method: "function rewardViewerETH(address viewer, string reason)",
            params: [params.viewerAddress, params.reason || ""],
            value: amountBigInt
          });
        } else {
          await this.approveTokenIfNeeded(params.token, contractAddress, params.amount, chainId);
          transaction = prepareContractCall({
            contract,
            method: "function rewardViewerToken(address viewer, address token, uint256 amount, string reason)",
            params: [params.viewerAddress, params.token, amountBigInt, params.reason || ""]
          });
        }
      } else {
        throw new Error("Must provide viewerId, thirdwebId, or viewerAddress");
      }
      const result = await this.executeTransaction(transaction);
      return {
        success: true,
        transactionHash: result.transactionHash,
        chainId,
        viewerAmount: viewerAmount.toString(),
        platformFee: platformFee.toString(),
        estimatedUsdcAmount,
        destinationChain: SUPPORTED_CHAINS.APECHAIN
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Batch reward multiple viewers (gas efficient)
   * @param params Batch viewer reward parameters
   * @returns Transaction result
   */
  async batchRewardViewers(params) {
    const chainId = params.chainId || SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    if (params.viewers.length > 50) {
      throw new Error("Too many viewers in batch (max 50)");
    }
    if (params.viewers.length === 0) {
      throw new Error("No viewers provided");
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const resolvedViewers = [];
    const amounts = params.viewers.map((v) => BigInt(v.amount));
    const reasons = params.viewers.map((v) => v.reason || "");
    const totalAmount = amounts.reduce((sum, amount) => sum + amount, BigInt(0));
    for (const viewer of params.viewers) {
      if (viewer.viewerId) {
        resolvedViewers.push({ isId: true, identifier: BigInt(viewer.viewerId) });
      } else if (viewer.thirdwebId) {
        const viewerId = await this.readContract(
          contract,
          "getViewerByThirdwebId",
          [viewer.thirdwebId]
        );
        if (viewerId === BigInt(0)) {
          throw new Error(`No viewer found for thirdweb ID: ${viewer.thirdwebId}`);
        }
        resolvedViewers.push({ isId: true, identifier: viewerId });
      } else if (viewer.address) {
        resolvedViewers.push({ isId: false, identifier: viewer.address });
      } else {
        throw new Error("Each viewer must have viewerId, thirdwebId, or address");
      }
    }
    const allIds = resolvedViewers.every((v) => v.isId);
    const allAddresses = resolvedViewers.every((v) => !v.isId);
    if (!allIds && !allAddresses) {
      throw new Error("Cannot mix viewer IDs and addresses in batch rewards");
    }
    try {
      let transaction;
      if (allIds) {
        const viewerIds = resolvedViewers.map((v) => v.identifier);
        transaction = prepareContractCall({
          contract,
          method: "function batchRewardViewersByIdETH(uint256[] viewerIds, uint256[] amounts, string[] reasons)",
          params: [viewerIds, amounts, reasons],
          value: totalAmount
        });
      } else {
        const viewerAddresses = resolvedViewers.map((v) => v.identifier);
        transaction = prepareContractCall({
          contract,
          method: "function batchRewardViewersETH(address[] viewers, uint256[] amounts, string[] reasons)",
          params: [viewerAddresses, amounts, reasons],
          value: totalAmount
        });
      }
      const result = await this.executeTransaction(transaction);
      const totalFee = totalAmount * BigInt(100) / BigInt(1e4);
      const totalToViewers = totalAmount - totalFee;
      const relayQuote = await this.relayService.getQuote({
        fromChainId: chainId,
        fromToken: "native",
        toChainId: SUPPORTED_CHAINS.APECHAIN,
        toToken: "USDC",
        amount: totalToViewers.toString()
      });
      const estimatedUsdcAmount = relayQuote.estimatedOutput;
      return {
        success: true,
        transactionHash: result.transactionHash,
        chainId,
        viewerAmount: totalToViewers.toString(),
        platformFee: totalFee.toString(),
        estimatedUsdcAmount,
        destinationChain: SUPPORTED_CHAINS.APECHAIN
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Get viewer reward statistics for an address
   * @param address Address to check (can be creator or viewer)
   * @param chainId Chain ID
   * @returns Viewer reward statistics
   */
  async getViewerRewardStats(address, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const result = await this.readContract(contract, "getViewerRewardStats", [address]);
    return {
      totalRewardsGiven: result[0].toString(),
      totalRewardsReceived: result[1].toString(),
      rewardCount: Number(result[2])
    };
  }
  /**
   * Check if viewer rewards are enabled on a chain
   * @param chainId Chain ID
   * @returns Whether viewer rewards are enabled
   */
  async areViewerRewardsEnabled(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    return await this.readContract(contract, "viewerRewardsEnabled", []);
  }
  /**
   * Get platform-wide viewer rewards statistics
   * @param chainId Chain ID
   * @returns Platform viewer rewards statistics
   */
  async getViewerRewardsPlatformStats(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const result = await this.readContract(contract, "getViewerRewardsPlatformStats", []);
    return {
      totalRewards: result[0].toString(),
      rewardsEnabled: result[1],
      platformFeeRate: Number(result[2])
    };
  }
  /**
   * Get viewer information by ID
   * @param viewerId Viewer's unique ID
   * @param chainId Chain ID
   * @returns Viewer information
   */
  async getViewer(viewerId, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const result = await this.readContract(contract, "getViewerInfo", [BigInt(viewerId)]);
    const [wallet, totalReceived] = result;
    if (wallet === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    return {
      id: viewerId,
      wallet,
      totalReceived: totalReceived.toString()
    };
  }
  /**
   * Get viewer by wallet address
   * @param walletAddress Wallet address
   * @param chainId Chain ID
   * @returns Viewer information or null if not found
   */
  async getViewerByWallet(walletAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const viewerId = await this.readContract(contract, "getViewerByWallet", [walletAddress]);
    if (viewerId === BigInt(0)) {
      return null;
    }
    return this.getViewer(Number(viewerId), chainId);
  }
  /**
   * Get viewer by thirdweb ID
   * @param thirdwebId Thirdweb account ID
   * @param chainId Chain ID
   * @returns Viewer information or null if not found
   */
  async getViewerByThirdwebId(thirdwebId, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const viewerId = await this.readContract(contract, "getViewerByThirdwebId", [thirdwebId]);
    if (viewerId === BigInt(0)) {
      return null;
    }
    const viewer = await this.getViewer(Number(viewerId), chainId);
    if (viewer) {
      viewer.thirdwebId = thirdwebId;
    }
    return viewer;
  }
  /**
   * Update viewer wallet address
   * @param viewerId Viewer's unique ID
   * @param newWallet New wallet address
   * @param chainId Chain ID
   * @returns Success status
   */
  async updateViewerWallet(viewerId, newWallet, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function updateViewerWallet(uint256 viewerId, address newWallet)",
      params: [BigInt(viewerId), newWallet]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Get viewer's USDC balance on ApeChain
   * @param viewerAddress Address of the viewer
   * @returns USDC balance on ApeChain
   */
  async getViewerUsdcBalanceOnApeChain(viewerAddress) {
    const apeChainAddress = this.getContractAddress(SUPPORTED_CHAINS.APECHAIN);
    if (!apeChainAddress) {
      throw new Error("ApeChain contract not deployed or configured");
    }
    const contract = getContract({
      client: this.client,
      chain: this.getChainById(SUPPORTED_CHAINS.APECHAIN),
      address: apeChainAddress
    });
    const balances = await this.readContract(contract, "getBalances", [viewerAddress]);
    return balances[1].toString();
  }
  /**
   * Helper method to approve token spending if needed
   * @private
   */
  /**
   * Create a reward pool and distribute equally among viewers
   * @param params Pool parameters
   * @returns Pool distribution result
   */
  async createRewardPool(params) {
    const chainId = params.chainId || SUPPORTED_CHAINS.POLYGON;
    const { totalAmount, viewerAddresses, reason = "Reward pool distribution" } = params;
    if (!viewerAddresses || viewerAddresses.length === 0) {
      return {
        success: false,
        error: "No viewer addresses provided",
        totalDistributed: "0",
        platformFee: "0",
        perViewerAmount: "0",
        viewerCount: 0,
        transactions: []
      };
    }
    const uniqueViewers = [...new Set(viewerAddresses)].filter(
      (addr) => typeof addr === "string" && addr.startsWith("0x") && addr.length === 42
    );
    if (uniqueViewers.length === 0) {
      return {
        success: false,
        error: "No valid viewer addresses found",
        totalDistributed: "0",
        platformFee: "0",
        perViewerAmount: "0",
        viewerCount: 0,
        transactions: []
      };
    }
    try {
      const calculation = this.calculateRewardPoolDistribution(totalAmount, uniqueViewers.length);
      const viewers = uniqueViewers.map((address) => ({
        address,
        amount: calculation.perViewerAmount,
        reason
      }));
      const batches = [];
      for (let i = 0; i < viewers.length; i += 50) {
        batches.push(viewers.slice(i, i + 50));
      }
      const transactions = [];
      let allSuccess = true;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const result = await this.batchRewardViewers({
          viewers: batch,
          chainId
        });
        if (result.success && result.transactionHash) {
          transactions.push(result.transactionHash);
        } else {
          allSuccess = false;
          console.error(`Batch ${i + 1} failed:`, result.error);
        }
      }
      const estimatedUsdcPerViewer = await this.estimateUsdcAmount(
        calculation.perViewerAmount,
        chainId
      );
      return {
        success: allSuccess,
        totalDistributed: calculation.distributableAmount,
        platformFee: calculation.platformFee,
        perViewerAmount: calculation.perViewerAmount,
        viewerCount: uniqueViewers.length,
        transactions,
        estimatedUsdcPerViewer,
        error: allSuccess ? void 0 : "Some batches failed to process"
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || "Failed to create reward pool",
        totalDistributed: "0",
        platformFee: "0",
        perViewerAmount: "0",
        viewerCount: 0,
        transactions: []
      };
    }
  }
  /**
   * Calculate reward pool distribution
   * @param totalAmount Total amount to distribute
   * @param viewerCount Number of viewers
   * @returns Distribution calculation
   */
  calculateRewardPoolDistribution(totalAmount, viewerCount) {
    const total = BigInt(totalAmount);
    const platformFee = total * 100n / 10000n;
    const distributableAmount = total - platformFee;
    const perViewerAmount = distributableAmount / BigInt(viewerCount);
    const batchCount = Math.ceil(viewerCount / 50);
    return {
      totalAmount: total.toString(),
      platformFee: platformFee.toString(),
      distributableAmount: distributableAmount.toString(),
      perViewerAmount: perViewerAmount.toString(),
      viewerCount,
      batchCount
    };
  }
  /**
   * Estimate USDC amount for a given native token amount
   * This is a rough estimate - actual conversion depends on current rates
   */
  async estimateUsdcAmount(nativeAmount, chainId) {
    const estimateRates = {
      1: 2e3,
      // ETH ~$2000
      137: 0.8,
      // MATIC ~$0.80
      10: 2e3,
      // ETH on Optimism
      56: 300,
      // BNB ~$300
      2741: 2e3,
      // ETH on Abstract
      43114: 30,
      // AVAX ~$30
      8453: 2e3,
      // ETH on Base
      42161: 2e3,
      // ETH on Arbitrum
      167e3: 2e3,
      // ETH on Taiko
      // Testnets (same rates as mainnet for estimation)
      17e3: 2e3,
      // ETH on Holesky
      80002: 0.8,
      // MATIC on Amoy
      33111: 1
      // APE on Curtis testnet
    };
    const rate = estimateRates[chainId] || 1;
    const amount = parseFloat(nativeAmount) / 1e18;
    const usdcAmount = (amount * rate * 1e6).toFixed(0);
    return usdcAmount;
  }
  async approveTokenIfNeeded(tokenAddress, spenderAddress, amount, chainId) {
    const chain = this.getChainById(chainId);
    const tokenContract = getContract({
      client: this.client,
      chain,
      address: tokenAddress
    });
    const allowance = await this.readContract(
      tokenContract,
      "allowance",
      [, spenderAddress]
    );
    if (allowance < BigInt(amount)) {
      const approveTx = prepareContractCall({
        contract: tokenContract,
        method: "function approve(address spender, uint256 amount)",
        params: [spenderAddress, BigInt(amount)]
      });
      await this.executeTransaction(approveTx);
    }
  }
  /**
   * Get contract owner address
   */
  async getOwner(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`No contract address for chain ${chainId}`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    return await this.readContract(contract, "owner", []);
  }
  /**
   * Get business owner address
   */
  async getBusinessOwner(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`No contract address for chain ${chainId}`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    return await this.readContract(contract, "businessOwner", []);
  }
  /**
   * Check if address is the contract owner
   */
  async isOwner(chainId, address) {
    const owner = await this.getOwner(chainId);
    return owner.toLowerCase() === address.toLowerCase();
  }
  // ============ Admin Role Management ============
  /**
   * Grant admin privileges to an address on a specific chain
   * @param adminAddress Address to grant admin role
   * @param chainId Chain ID
   * @returns True if successful
   */
  async grantAdmin(adminAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function grantAdmin(address admin)",
      params: [adminAddress]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Revoke admin privileges from an address on a specific chain
   * @param adminAddress Address to revoke admin role
   * @param chainId Chain ID
   * @returns True if successful
   */
  async revokeAdmin(adminAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function revokeAdmin(address admin)",
      params: [adminAddress]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Check if an address has admin privileges on a specific chain
   * @param adminAddress Address to check
   * @param chainId Chain ID
   * @returns True if address is admin
   */
  async isAdmin(adminAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    return await this.readContract(contract, "isAdmin", [adminAddress]);
  }
  /**
   * Add an authorized relayer for cross-chain operations
   * @param relayerAddress Address of the relayer to authorize
   * @param chainId Chain ID
   * @returns True if successful
   */
  async addAuthorizedRelayer(relayerAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function addAuthorizedRelayer(address relayer)",
      params: [relayerAddress]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Remove an authorized relayer for cross-chain operations
   * @param relayerAddress Address of the relayer to remove
   * @param chainId Chain ID
   * @returns True if successful
   */
  async removeAuthorizedRelayer(relayerAddress, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function removeAuthorizedRelayer(address relayer)",
      params: [relayerAddress]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Set whether viewer rewards are enabled on a chain
   * @param enabled True to enable viewer rewards, false to disable
   * @param chainId Chain ID
   * @returns True if successful
   */
  async setViewerRewardsEnabled(enabled, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function setViewerRewardsEnabled(bool enabled)",
      params: [enabled]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  // ============ Contract State Management ============
  /**
   * Pause the contract operations (admin only)
   * @param chainId Chain ID
   * @returns True if successful
   */
  async pause(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function pause()",
      params: []
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Unpause the contract operations (admin only)
   * @param chainId Chain ID
   * @returns True if successful
   */
  async unpause(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function unpause()",
      params: []
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  // ============ Emergency Withdrawal ============
  /**
   * Perform an emergency withdrawal of funds (admin only)
   * @param chainId Chain ID
   * @returns True if successful
   */
  async emergencyWithdraw(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function emergencyWithdraw()",
      params: []
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  // ============ Advanced Stats and Queries ============
  /**
   * Get statistics for ApeChain (total USDC and amount from chain)
   * @param chainId Chain ID (typically ApeChain)
   * @returns Object with total USDC and total from chain
   */
  async getApeChainStats(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const result = await this.readContract(contract, "getApeChainStats", []);
    return {
      totalUsdc: result[0].toString(),
      totalFromChain: result[1].toString()
    };
  }
  /**
   * Get all active creators with pagination
   * @param offset Starting index for pagination
   * @param limit Number of creators to return
   * @param chainId Chain ID
   * @returns Object with creator IDs, wallets, tip amounts, and total active count
   */
  async getAllActiveCreators(offset, limit, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const result = await this.readContract(contract, "getAllActiveCreators", [BigInt(offset), BigInt(limit)]);
    return {
      creatorIds: result[0].map((id) => Number(id)),
      wallets: result[1],
      tipAmounts: result[2].map((amount) => amount.toString()),
      totalActive: Number(result[3])
    };
  }
  /**
   * Get information for multiple creators by their IDs
   * @param creatorIds Array of creator IDs
   * @param chainId Chain ID
   * @returns Object with tip amounts, wallets, and active status for each creator
   */
  async getCreatorsByIds(creatorIds, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const bigIntIds = creatorIds.map((id) => BigInt(id));
    const result = await this.readContract(contract, "getCreatorsByIds", [bigIntIds]);
    return {
      tipAmounts: result[0].map((amount) => amount.toString()),
      wallets: result[1],
      activeStatus: result[2]
    };
  }
  // ============ Relay Management ============
  /**
   * Manually relay pending ETH to ApeChain
   * @param chainId Source chain ID
   * @returns True if successful
   */
  async manualRelayETH(chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function manualRelayETH()",
      params: []
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  /**
   * Manually relay pending token to ApeChain
   * @param token Token address
   * @param chainId Source chain ID
   * @returns True if successful
   */
  async manualRelayToken(token, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI
    });
    const transaction = prepareContractCall({
      contract,
      method: "function manualRelayToken(address token)",
      params: [token]
    });
    const result = await this.executeTransaction(transaction);
    return result.success;
  }
  // ===== TOKEN BALANCE AND APPROVAL METHODS =====
  /**
   * Get native token balance for a wallet
   * @param walletAddress Wallet address to check
   * @param chainId Chain ID
   * @returns Balance in wei as string
   */
  async getNativeBalance(walletAddress, chainId) {
    const chain = this.getChainById(chainId);
    try {
      const { getRpcClient } = await import('thirdweb/rpc');
      const rpcRequest = getRpcClient({ client: this.client, chain });
      const balance = await rpcRequest({
        method: "eth_getBalance",
        params: [walletAddress, "latest"]
      });
      return BigInt(balance).toString();
    } catch (error) {
      console.error(`Failed to get native balance for ${walletAddress} on chain ${chainId}:`, error);
      return "0";
    }
  }
  /**
   * Get ERC20 token balance for a wallet
   * @param walletAddress Wallet address to check
   * @param tokenAddress Token contract address
   * @param chainId Chain ID
   * @returns Balance in token units as string
   */
  async getTokenBalance(walletAddress, tokenAddress, chainId) {
    if (tokenAddress === "native") {
      return this.getNativeBalance(walletAddress, chainId);
    }
    const chain = this.getChainById(chainId);
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress,
        abi: TypedABI
      });
      const balance = await readContract({
        contract: tokenContract,
        method: "function balanceOf(address) view returns (uint256)",
        params: [walletAddress]
      });
      return balance.toString();
    } catch (error) {
      console.error(`Failed to get token balance for ${walletAddress} on chain ${chainId}:`, error);
      return "0";
    }
  }
  /**
   * Get balances for multiple tokens
   * @param walletAddress Wallet address to check
   * @param tokenAddresses Array of token addresses ('native' for native token)
   * @param chainId Chain ID
   * @returns Object mapping token addresses to balance strings
   */
  async getMultipleTokenBalances(walletAddress, tokenAddresses, chainId) {
    const balances = {};
    const balancePromises = tokenAddresses.map(async (tokenAddress) => {
      const balance = await this.getTokenBalance(walletAddress, tokenAddress, chainId);
      return { tokenAddress, balance };
    });
    const results = await Promise.allSettled(balancePromises);
    results.forEach((result, index) => {
      const tokenAddress = tokenAddresses[index];
      if (result.status === "fulfilled") {
        balances[tokenAddress] = result.value.balance;
      } else {
        console.warn(`Failed to get balance for token ${tokenAddress}:`, result.reason);
        balances[tokenAddress] = "0";
      }
    });
    return balances;
  }
  /**
   * Check ERC20 token allowance
   * @param tokenAddress Token contract address
   * @param ownerAddress Owner wallet address
   * @param spenderAddress Spender contract address
   * @param chainId Chain ID
   * @returns Allowance amount as string
   */
  async checkAllowance(tokenAddress, ownerAddress, spenderAddress, chainId) {
    if (tokenAddress === "native") {
      return "0";
    }
    const chain = this.getChainById(chainId);
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress
      });
      const allowance = await readContract({
        contract: tokenContract,
        method: "function allowance(address owner, address spender) view returns (uint256)",
        params: [ownerAddress, spenderAddress]
      });
      return allowance.toString();
    } catch (error) {
      console.error(`Failed to check allowance for ${tokenAddress}:`, error);
      return "0";
    }
  }
  /**
   * Check if token needs approval for spending
   * @param tokenAddress Token contract address
   * @param ownerAddress Owner wallet address
   * @param spenderAddress Spender contract address
   * @param amount Amount to spend
   * @param chainId Chain ID
   * @returns True if approval is needed
   */
  async needsApproval(tokenAddress, ownerAddress, spenderAddress, amount, chainId) {
    if (tokenAddress === "native") {
      return false;
    }
    const allowance = await this.checkAllowance(tokenAddress, ownerAddress, spenderAddress, chainId);
    return BigInt(allowance) < BigInt(amount);
  }
  /**
   * Get token information (name, symbol, decimals)
   * @param tokenAddress Token contract address
   * @param chainId Chain ID
   * @returns Token info object
   */
  async getTokenInfo(tokenAddress, chainId) {
    if (tokenAddress === "native") {
      const chain2 = this.getChainById(chainId);
      return {
        name: chain2.nativeCurrency?.name || "Ether",
        symbol: chain2.nativeCurrency?.symbol || "ETH",
        decimals: chain2.nativeCurrency?.decimals || 18
      };
    }
    const chain = this.getChainById(chainId);
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress
      });
      const [name, symbol, decimals] = await Promise.all([
        readContract({
          contract: tokenContract,
          method: "function name() view returns (string)",
          params: []
        }).catch(() => "Unknown"),
        readContract({
          contract: tokenContract,
          method: "function symbol() view returns (string)",
          params: []
        }).catch(() => "UNK"),
        readContract({
          contract: tokenContract,
          method: "function decimals() view returns (uint8)",
          params: []
        }).catch(() => 18)
      ]);
      return {
        name,
        symbol,
        decimals: Number(decimals)
      };
    } catch (error) {
      console.error(`Failed to get token info for ${tokenAddress}:`, error);
      return {
        name: "Unknown",
        symbol: "UNK",
        decimals: 18
      };
    }
  }
  /**
   * Approve token spending for a spender contract
   * @param tokenAddress Token contract address
   * @param spenderAddress Spender contract address (e.g., TippingChain contract)
   * @param amount Amount to approve (in token units, not wei)
   * @param chainId Chain ID
   * @returns Approval transaction result
   */
  async approveToken(tokenAddress, spenderAddress, amount, chainId) {
    if (tokenAddress === "native") {
      return {
        success: true
        // Native tokens don't need approval
      };
    }
    const chain = this.getChainById(chainId);
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress
      });
      const approveTx = prepareContractCall({
        contract: tokenContract,
        method: "function approve(address spender, uint256 amount) returns (bool)",
        params: [spenderAddress, BigInt(amount)]
      });
      const result = await this.executeTransaction(approveTx);
      return {
        success: true,
        transactionHash: result.transactionHash
      };
    } catch (error) {
      console.error(`Failed to approve token ${tokenAddress}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Approve unlimited token spending for a spender contract (max approval)
   * @param tokenAddress Token contract address
   * @param spenderAddress Spender contract address
   * @param chainId Chain ID
   * @returns Approval transaction result
   */
  async approveTokenMax(tokenAddress, spenderAddress, chainId) {
    const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    return this.approveToken(tokenAddress, spenderAddress, MAX_UINT256, chainId);
  }
};
var DEFAULT_CONFIG = {
  environment: "production",
  endpoints: {
    relayApi: "https://api.relay.link"
  }
};

export { ApeChainRelayService, ApeChainTippingSDK, BalanceWatcherService, DEFAULT_CONFIG, RelayStatusService, TransactionStatusService };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map