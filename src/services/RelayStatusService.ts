// packages/sdk/src/services/RelayStatusService.ts
import { ThirdwebClient } from 'thirdweb';
import { Chain } from 'thirdweb/chains';
import { TransactionStatusService, TransactionStatus, TransactionReceipt } from './TransactionStatusService';

export interface RelayStatus {
  relayId: string;
  sourceChain: number;
  destinationChain: number;
  sourceTransactionHash: string;
  destinationTransactionHash?: string;
  status: 'initiated' | 'pending' | 'relaying' | 'completed' | 'failed';
  estimatedCompletionTime?: number;
  actualCompletionTime?: number;
  error?: string;
  progress: number; // 0-100
  sourceAmount: string;
  destinationAmount?: string;
  tokenSymbol: string;
}

export interface RelayUpdate {
  relayId: string;
  status: RelayStatus['status'];
  progress: number;
  error?: string;
  timestamp: number;
  destinationTransactionHash?: string;
}

export interface RelayWatchOptions {
  maxWaitTime?: number;
  pollInterval?: number;
  enableProgressUpdates?: boolean;
}

const DEFAULT_RELAY_OPTIONS: Required<RelayWatchOptions> = {
  maxWaitTime: 600000, // 10 minutes
  pollInterval: 5000, // 5 seconds
  enableProgressUpdates: true,
};

export class RelayStatusService {
  private client: ThirdwebClient;
  private transactionStatusService: TransactionStatusService;
  private activeRelayWatchers: Map<string, { 
    abort: AbortController; 
    promise: Promise<RelayStatus> 
  }> = new Map();
  
  // Relay.link API endpoints (if available)
  private readonly RELAY_API_BASE = 'https://api.relay.link';

  constructor(client: ThirdwebClient) {
    this.client = client;
    this.transactionStatusService = new TransactionStatusService(client);
  }

  /**
   * Track a relay transaction from source to destination
   */
  async trackRelay(
    relayId: string,
    sourceChain: Chain,
    destinationChain: Chain,
    sourceTransactionHash: string,
    options: RelayWatchOptions = {}
  ): Promise<RelayStatus> {
    const opts = { ...DEFAULT_RELAY_OPTIONS, ...options };

    // If already tracking this relay, return existing promise
    if (this.activeRelayWatchers.has(relayId)) {
      return this.activeRelayWatchers.get(relayId)!.promise;
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

    // Clean up when done
    promise.finally(() => {
      this.activeRelayWatchers.delete(relayId);
    });

    return promise;
  }

  /**
   * Track relay with callback for real-time updates
   */
  async trackRelayWithCallback(
    relayId: string,
    sourceChain: Chain,
    destinationChain: Chain,
    sourceTransactionHash: string,
    onUpdate: (update: RelayUpdate) => void,
    options: RelayWatchOptions = {}
  ): Promise<RelayStatus> {
    const opts = { ...DEFAULT_RELAY_OPTIONS, ...options };
    const startTime = Date.now();
    let lastProgress = 0;

    const poll = async (): Promise<RelayStatus> => {
      try {
        // Check timeout
        if (Date.now() - startTime > opts.maxWaitTime) {
          const update: RelayUpdate = {
            relayId,
            status: 'failed',
            progress: lastProgress,
            error: 'Relay tracking timeout',
            timestamp: Date.now()
          };
          onUpdate(update);
          
          return {
            relayId,
            sourceChain: sourceChain.id,
            destinationChain: destinationChain.id,
            sourceTransactionHash,
            status: 'failed',
            progress: lastProgress,
            error: 'Relay tracking timeout',
            sourceAmount: '0',
            tokenSymbol: 'UNKNOWN'
          };
        }

        // Get current relay status
        const relayStatus = await this.getRelayStatus(
          relayId,
          sourceChain,
          destinationChain,
          sourceTransactionHash
        );

        // Send update if status or progress changed
        if (relayStatus.progress !== lastProgress || opts.enableProgressUpdates) {
          const update: RelayUpdate = {
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

        // Continue polling if not complete
        if (relayStatus.status === 'completed' || relayStatus.status === 'failed') {
          return relayStatus;
        }

        // Wait and poll again
        await new Promise(resolve => setTimeout(resolve, opts.pollInterval));
        return poll();

      } catch (error) {
        const update: RelayUpdate = {
          relayId,
          status: 'failed',
          progress: lastProgress,
          error: error instanceof Error ? error.message : 'Unknown error',
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
  async getRelayStatus(
    relayId: string,
    sourceChain: Chain,
    destinationChain: Chain,
    sourceTransactionHash: string
  ): Promise<RelayStatus> {
    try {
      // Step 1: Check source transaction status
      const sourceStatus = await this.transactionStatusService.getTransactionStatus(
        sourceTransactionHash,
        sourceChain
      );

      if (sourceStatus === 'not_found' || sourceStatus === 'failed') {
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status: 'failed',
          progress: 0,
          error: sourceStatus === 'not_found' ? 'Source transaction not found' : 'Source transaction failed',
          sourceAmount: '0',
          tokenSymbol: 'UNKNOWN'
        };
      }

      if (sourceStatus === 'pending') {
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status: 'pending',
          progress: 25,
          sourceAmount: '0',
          tokenSymbol: 'UNKNOWN'
        };
      }

      // Step 2: Source transaction confirmed, now check relay progress
      // Try to get relay information from Relay.link API (if available)
      try {
        const apiStatus = await this.getRelayStatusFromAPI(relayId);
        if (apiStatus) {
          return apiStatus;
        }
      } catch (apiError) {
        console.warn('Relay API unavailable, using fallback method:', apiError);
      }

      // Step 3: Fallback method - estimate progress based on time
      const sourceReceipt = await this.transactionStatusService.getTransactionReceipt(
        sourceTransactionHash,
        sourceChain
      );

      if (sourceReceipt) {
        const elapsedTime = Date.now() - (sourceReceipt.timestamp || Date.now());
        const estimatedRelayTime = this.getEstimatedRelayTime(sourceChain.id, destinationChain.id);
        
        let progress = 50; // Source confirmed
        let status: RelayStatus['status'] = 'relaying';

        if (elapsedTime > estimatedRelayTime) {
          // Should be complete by now, try to find destination transaction
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

            if (destStatus === 'confirmed') {
              progress = 100;
              status = 'completed';
            } else if (destStatus === 'failed') {
              status = 'failed';
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
              sourceAmount: '0',
              tokenSymbol: 'USDC'
            };
          }
        } else {
          // Still in progress, estimate based on elapsed time
          progress = Math.min(95, 50 + (elapsedTime / estimatedRelayTime) * 45);
        }

        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status,
          progress,
          sourceAmount: '0',
          tokenSymbol: 'USDC',
          estimatedCompletionTime: (sourceReceipt.timestamp || Date.now()) + estimatedRelayTime
        };
      }

      // Default status if we can't determine anything
      return {
        relayId,
        sourceChain: sourceChain.id,
        destinationChain: destinationChain.id,
        sourceTransactionHash,
        status: 'initiated',
        progress: 10,
        sourceAmount: '0',
        tokenSymbol: 'UNKNOWN'
      };

    } catch (error) {
      console.error('Error getting relay status:', error);
      return {
        relayId,
        sourceChain: sourceChain.id,
        destinationChain: destinationChain.id,
        sourceTransactionHash,
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        sourceAmount: '0',
        tokenSymbol: 'UNKNOWN'
      };
    }
  }

  /**
   * Cancel relay tracking
   */
  cancelRelayTracking(relayId: string): void {
    const watcher = this.activeRelayWatchers.get(relayId);
    if (watcher) {
      watcher.abort.abort();
      this.activeRelayWatchers.delete(relayId);
    }
  }

  /**
   * Cancel all relay tracking
   */
  cancelAllRelayTracking(): void {
    for (const watcher of this.activeRelayWatchers.values()) {
      watcher.abort.abort();
    }
    this.activeRelayWatchers.clear();
  }

  /**
   * Get estimated relay time between chains
   */
  private getEstimatedRelayTime(sourceChainId: number, destinationChainId: number): number {
    // Base relay time (2 minutes)
    let baseTime = 120000;

    // Add extra time for specific chains
    const slowChains = [1, 137, 10]; // Ethereum, Polygon, Optimism
    if (slowChains.includes(sourceChainId)) {
      baseTime += 60000; // Add 1 minute
    }

    // Destination is always ApeChain, which is fast
    if (destinationChainId === 33139) {
      baseTime -= 30000; // Subtract 30 seconds
    }

    return Math.max(60000, baseTime); // Minimum 1 minute
  }

  /**
   * Try to get relay status from Relay.link API
   */
  private async getRelayStatusFromAPI(relayId: string): Promise<RelayStatus | null> {
    try {
      // This would be the actual API call to Relay.link
      // For now, return null as API might not be publicly available
      const response = await fetch(`${this.RELAY_API_BASE}/status/${relayId}`);
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      // Transform API response to our RelayStatus format
      return {
        relayId,
        sourceChain: data.sourceChain,
        destinationChain: data.destinationChain,
        sourceTransactionHash: data.sourceTx,
        destinationTransactionHash: data.destTx,
        status: this.mapApiStatusToRelayStatus(data.status),
        progress: data.progress || 0,
        sourceAmount: data.sourceAmount || '0',
        destinationAmount: data.destAmount,
        tokenSymbol: data.token || 'USDC',
        estimatedCompletionTime: data.eta,
        actualCompletionTime: data.completedAt
      };
    } catch (error) {
      console.warn('Failed to fetch from Relay API:', error);
      return null;
    }
  }

  /**
   * Map API status to our RelayStatus
   */
  private mapApiStatusToRelayStatus(apiStatus: string): RelayStatus['status'] {
    switch (apiStatus?.toLowerCase()) {
      case 'pending':
        return 'pending';
      case 'processing':
      case 'bridging':
        return 'relaying';
      case 'completed':
      case 'success':
        return 'completed';
      case 'failed':
      case 'error':
        return 'failed';
      default:
        return 'initiated';
    }
  }

  /**
   * Try to find the destination transaction by looking for patterns
   */
  private async findDestinationTransaction(
    sourceTransactionHash: string,
    destinationChain: Chain,
    relayId: string
  ): Promise<string | null> {
    try {
      // This is a simplified approach - in reality, you might need to:
      // 1. Look at relay bridge contract events
      // 2. Search for transactions with specific patterns
      // 3. Use indexing services to find related transactions
      
      // For now, return null as this requires more sophisticated tracking
      // In a production environment, you'd use:
      // - Event logs from bridge contracts
      // - Graph Protocol or similar indexing
      // - Relay.link API if available
      
      return null;
    } catch (error) {
      console.error('Error finding destination transaction:', error);
      return null;
    }
  }

  /**
   * Generate a unique relay ID based on transaction hash and timestamp
   */
  static generateRelayId(transactionHash: string, timestamp?: number): string {
    const ts = timestamp || Date.now();
    return `relay_${transactionHash.slice(2, 10)}_${ts}`;
  }

  /**
   * Internal tracking implementation
   */
  private async _trackRelayInternal(
    relayId: string,
    sourceChain: Chain,
    destinationChain: Chain,
    sourceTransactionHash: string,
    options: Required<RelayWatchOptions>,
    signal: AbortSignal
  ): Promise<RelayStatus> {
    const startTime = Date.now();

    const poll = async (): Promise<RelayStatus> => {
      if (signal.aborted) {
        throw new Error('Relay tracking was cancelled');
      }

      // Check timeout
      if (Date.now() - startTime > options.maxWaitTime) {
        return {
          relayId,
          sourceChain: sourceChain.id,
          destinationChain: destinationChain.id,
          sourceTransactionHash,
          status: 'failed',
          progress: 0,
          error: 'Relay tracking timeout',
          sourceAmount: '0',
          tokenSymbol: 'UNKNOWN'
        };
      }

      const relayStatus = await this.getRelayStatus(
        relayId,
        sourceChain,
        destinationChain,
        sourceTransactionHash
      );

      if (relayStatus.status === 'completed' || relayStatus.status === 'failed') {
        return relayStatus;
      }

      // Continue polling
      await new Promise(resolve => setTimeout(resolve, options.pollInterval));
      return poll();
    };

    return poll();
  }
}