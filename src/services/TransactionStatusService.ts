// packages/sdk/src/services/TransactionStatusService.ts
import { ThirdwebClient } from 'thirdweb';
import { Chain } from 'thirdweb/chains';

export type TransactionStatus = 
  | 'pending' 
  | 'confirmed' 
  | 'failed' 
  | 'dropped' 
  | 'replaced' 
  | 'not_found';

export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  gasUsed: string;
  effectiveGasPrice: string;
  status: 'success' | 'failure';
  confirmations: number;
  timestamp?: number;
}

export interface TransactionStatusUpdate {
  transactionHash: string;
  status: TransactionStatus;
  receipt?: TransactionReceipt;
  error?: string;
  timestamp: number;
}

export interface WatchTransactionOptions {
  maxRetries?: number;
  retryInterval?: number;
  timeout?: number;
  confirmationsRequired?: number;
}

const DEFAULT_OPTIONS: Required<WatchTransactionOptions> = {
  maxRetries: 100, // 100 * 3s = 5 minutes max
  retryInterval: 3000, // 3 seconds
  timeout: 300000, // 5 minutes
  confirmationsRequired: 1,
};

export class TransactionStatusService {
  private client: ThirdwebClient;
  private activeWatchers: Map<string, { abort: AbortController; promise: Promise<TransactionStatusUpdate> }> = new Map();

  constructor(client: ThirdwebClient) {
    this.client = client;
  }

  /**
   * Watch a transaction until it's confirmed or fails
   */
  async watchTransaction(
    transactionHash: string,
    chain: Chain,
    options: WatchTransactionOptions = {}
  ): Promise<TransactionStatusUpdate> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const watcherKey = `${chain.id}-${transactionHash}`;

    // If already watching this transaction, return the existing promise
    if (this.activeWatchers.has(watcherKey)) {
      return this.activeWatchers.get(watcherKey)!.promise;
    }

    const abortController = new AbortController();
    
    const promise = this._watchTransactionInternal(
      transactionHash,
      chain,
      opts,
      abortController.signal
    );

    // Store the watcher
    this.activeWatchers.set(watcherKey, {
      abort: abortController,
      promise
    });

    // Clean up when done
    promise.finally(() => {
      this.activeWatchers.delete(watcherKey);
    });

    return promise;
  }

  /**
   * Watch a transaction with callback for real-time updates
   */
  async watchTransactionWithCallback(
    transactionHash: string,
    chain: Chain,
    onUpdate: (update: TransactionStatusUpdate) => void,
    options: WatchTransactionOptions = {}
  ): Promise<TransactionStatusUpdate> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    let retries = 0;
    const startTime = Date.now();

    const poll = async (): Promise<TransactionStatusUpdate> => {
      try {
        // Check for timeout
        if (Date.now() - startTime > opts.timeout) {
          const update: TransactionStatusUpdate = {
            transactionHash,
            status: 'failed',
            error: 'Transaction monitoring timeout',
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }

        // Get transaction receipt
        const receipt = await this.getTransactionReceipt(transactionHash, chain);
        
        if (receipt) {
          const status: TransactionStatus = receipt.status === 'success' ? 'confirmed' : 'failed';
          const update: TransactionStatusUpdate = {
            transactionHash,
            status,
            receipt,
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }

        // Transaction not mined yet
        if (retries < opts.maxRetries) {
          const update: TransactionStatusUpdate = {
            transactionHash,
            status: 'pending',
            timestamp: Date.now()
          };
          onUpdate(update);
          
          retries++;
          await new Promise(resolve => setTimeout(resolve, opts.retryInterval));
          return poll();
        } else {
          const update: TransactionStatusUpdate = {
            transactionHash,
            status: 'failed',
            error: 'Transaction not found after maximum retries',
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }
      } catch (error) {
        retries++;
        if (retries >= opts.maxRetries) {
          const update: TransactionStatusUpdate = {
            transactionHash,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now()
          };
          onUpdate(update);
          return update;
        }
        
        // Continue polling on error
        await new Promise(resolve => setTimeout(resolve, opts.retryInterval));
        return poll();
      }
    };

    return poll();
  }

  /**
   * Get transaction receipt (simplified implementation)
   */
  async getTransactionReceipt(
    transactionHash: string,
    chain: Chain
  ): Promise<TransactionReceipt | null> {
    try {
      // Use a simplified approach that works with thirdweb's public RPC
      const response = await fetch(`https://${chain.id}.rpc.thirdweb.com`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [transactionHash],
          id: 1
        })
      });

      const data = await response.json();
      const receipt = data.result;

      if (!receipt) {
        return null;
      }

      // Get current block for confirmations (simplified)
      let confirmations = 1; // Assume at least 1 confirmation if receipt exists

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: parseInt(receipt.blockNumber, 16),
        blockHash: receipt.blockHash,
        gasUsed: parseInt(receipt.gasUsed, 16).toString(),
        effectiveGasPrice: receipt.effectiveGasPrice ? parseInt(receipt.effectiveGasPrice, 16).toString() : '0',
        status: receipt.status === '0x1' ? 'success' : 'failure',
        confirmations,
        timestamp: Date.now() // Use current timestamp as approximation
      };
    } catch (error) {
      console.error('Error fetching transaction receipt:', error);
      return null;
    }
  }

  /**
   * Check if a transaction exists in the mempool or blockchain
   */
  async getTransactionStatus(
    transactionHash: string,
    chain: Chain
  ): Promise<TransactionStatus> {
    try {
      const receipt = await this.getTransactionReceipt(transactionHash, chain);
      
      if (receipt) {
        return receipt.status === 'success' ? 'confirmed' : 'failed';
      }

      // Check if transaction exists in mempool (simplified)
      try {
        const response = await fetch(`https://${chain.id}.rpc.thirdweb.com`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getTransactionByHash',
            params: [transactionHash],
            id: 1
          })
        });

        const data = await response.json();
        if (data.result) {
          return 'pending';
        }
      } catch (error) {
        console.warn('Error checking mempool:', error);
      }

      return 'not_found';
    } catch (error) {
      console.error('Error checking transaction status:', error);
      return 'not_found';
    }
  }

  /**
   * Cancel watching a specific transaction
   */
  cancelWatch(transactionHash: string, chainId: number): void {
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
  cancelAllWatches(): void {
    for (const watcher of this.activeWatchers.values()) {
      watcher.abort.abort();
    }
    this.activeWatchers.clear();
  }

  /**
   * Get the number of active watchers
   */
  getActiveWatchersCount(): number {
    return this.activeWatchers.size;
  }

  /**
   * Internal implementation for watching transactions
   */
  private async _watchTransactionInternal(
    transactionHash: string,
    chain: Chain,
    options: Required<WatchTransactionOptions>,
    signal: AbortSignal
  ): Promise<TransactionStatusUpdate> {
    let retries = 0;
    const startTime = Date.now();

    const poll = async (): Promise<TransactionStatusUpdate> => {
      if (signal.aborted) {
        throw new Error('Transaction watching was cancelled');
      }

      try {
        // Check for timeout
        if (Date.now() - startTime > options.timeout) {
          return {
            transactionHash,
            status: 'failed',
            error: 'Transaction monitoring timeout',
            timestamp: Date.now()
          };
        }

        // Get transaction receipt
        const receipt = await this.getTransactionReceipt(transactionHash, chain);
        
        if (receipt) {
          // Check if we have enough confirmations
          if (receipt.confirmations >= options.confirmationsRequired) {
            return {
              transactionHash,
              status: receipt.status === 'success' ? 'confirmed' : 'failed',
              receipt,
              timestamp: Date.now()
            };
          } else {
            // Transaction mined but not enough confirmations
            if (retries < options.maxRetries) {
              retries++;
              await new Promise(resolve => setTimeout(resolve, options.retryInterval));
              return poll();
            }
          }
        }

        // Transaction not mined yet
        if (retries < options.maxRetries) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, options.retryInterval));
          return poll();
        } else {
          return {
            transactionHash,
            status: 'failed',
            error: 'Transaction not found after maximum retries',
            timestamp: Date.now()
          };
        }
      } catch (error) {
        if (signal.aborted) {
          throw new Error('Transaction watching was cancelled');
        }
        
        retries++;
        if (retries >= options.maxRetries) {
          return {
            transactionHash,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now()
          };
        }
        
        // Continue polling on error
        await new Promise(resolve => setTimeout(resolve, options.retryInterval));
        return poll();
      }
    };

    return poll();
  }
}