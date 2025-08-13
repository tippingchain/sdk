import { ThirdwebClient } from 'thirdweb';
import { Chain } from 'thirdweb/chains';
import { MembershipTier } from '@tippingchain/contracts-interface';
export { CONTRACT_CONSTANTS, MembershipTier, NETWORK_CONFIGS, RELAY_RECEIVER_ADDRESSES, SUPPORTED_CHAINS, SUPPORTED_TESTNETS, TIER_CREATOR_SHARES, getAllContractAddresses, getContractAddress, getRelayReceiverAddress, isContractDeployed } from '@tippingchain/contracts-interface';

type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'dropped' | 'replaced' | 'not_found';
interface TransactionReceipt {
    transactionHash: string;
    blockNumber: number;
    blockHash: string;
    gasUsed: string;
    effectiveGasPrice: string;
    status: 'success' | 'failure';
    confirmations: number;
    timestamp?: number;
}
interface TransactionStatusUpdate {
    transactionHash: string;
    status: TransactionStatus;
    receipt?: TransactionReceipt;
    error?: string;
    timestamp: number;
}
interface WatchTransactionOptions {
    maxRetries?: number;
    retryInterval?: number;
    timeout?: number;
    confirmationsRequired?: number;
}
declare class TransactionStatusService {
    private client;
    private activeWatchers;
    constructor(client: ThirdwebClient);
    /**
     * Watch a transaction until it's confirmed or fails
     */
    watchTransaction(transactionHash: string, chain: Chain, options?: WatchTransactionOptions): Promise<TransactionStatusUpdate>;
    /**
     * Watch a transaction with callback for real-time updates
     */
    watchTransactionWithCallback(transactionHash: string, chain: Chain, onUpdate: (update: TransactionStatusUpdate) => void, options?: WatchTransactionOptions): Promise<TransactionStatusUpdate>;
    /**
     * Get transaction receipt (simplified implementation)
     */
    getTransactionReceipt(transactionHash: string, chain: Chain): Promise<TransactionReceipt | null>;
    /**
     * Check if a transaction exists in the mempool or blockchain
     */
    getTransactionStatus(transactionHash: string, chain: Chain): Promise<TransactionStatus>;
    /**
     * Cancel watching a specific transaction
     */
    cancelWatch(transactionHash: string, chainId: number): void;
    /**
     * Cancel all active watchers
     */
    cancelAllWatches(): void;
    /**
     * Get the number of active watchers
     */
    getActiveWatchersCount(): number;
    /**
     * Internal implementation for watching transactions
     */
    private _watchTransactionInternal;
}

interface BalanceUpdate {
    address: string;
    tokenAddress?: string;
    balance: string;
    previousBalance?: string;
    chainId: number;
    timestamp: number;
}
interface ChainBalanceMap {
    [chainId: number]: {
        native: string;
        tokens: {
            [tokenAddress: string]: string;
        };
    };
}
interface BalanceWatchOptions {
    pollInterval?: number;
    enableOptimisticUpdates?: boolean;
    refreshAfterTransaction?: boolean;
    maxRetries?: number;
}
declare class BalanceWatcherService {
    private client;
    private activeWatchers;
    private balanceCache;
    private readonly CACHE_DURATION;
    constructor(client: ThirdwebClient);
    /**
     * Watch balance changes for an address
     */
    watchBalance(address: string, chain: Chain, tokenAddress: string | undefined, onBalanceChange: (update: BalanceUpdate) => void, options?: BalanceWatchOptions): string;
    /**
     * Get current balance for an address
     */
    getBalance(address: string, chain: Chain, tokenAddress?: string, useCache?: boolean): Promise<string>;
    /**
     * Refresh balance after a transaction
     */
    refreshBalanceAfterTransaction(transactionHash: string, address: string, chain: Chain, tokenAddress?: string, maxWaitTime?: number): Promise<BalanceUpdate>;
    /**
     * Get balances across multiple chains
     */
    getMultiChainBalances(address: string, chains: Chain[], tokenAddresses?: {
        [chainId: number]: string[];
    }): Promise<ChainBalanceMap>;
    /**
     * Force refresh all cached balances
     */
    refreshAllBalances(): Promise<void>;
    /**
     * Cancel a specific balance watch
     */
    cancelBalanceWatch(watcherKey: string): void;
    /**
     * Cancel balance watch by parameters
     */
    cancelBalanceWatchFor(address: string, chainId: number, tokenAddress?: string): void;
    /**
     * Cancel all balance watchers
     */
    cancelAllBalanceWatches(): void;
    /**
     * Get active watchers count
     */
    getActiveWatchersCount(): number;
    /**
     * Clear balance cache
     */
    clearCache(): void;
    /**
     * Get cached balance if available
     */
    getCachedBalance(address: string, chainId: number, tokenAddress?: string): string | null;
}

interface RelayStatus {
    relayId: string;
    sourceChain: number;
    destinationChain: number;
    sourceTransactionHash: string;
    destinationTransactionHash?: string;
    status: 'initiated' | 'pending' | 'relaying' | 'completed' | 'failed';
    estimatedCompletionTime?: number;
    actualCompletionTime?: number;
    error?: string;
    progress: number;
    sourceAmount: string;
    destinationAmount?: string;
    tokenSymbol: string;
}
interface RelayUpdate {
    relayId: string;
    status: RelayStatus['status'];
    progress: number;
    error?: string;
    timestamp: number;
    destinationTransactionHash?: string;
}
interface RelayWatchOptions {
    maxWaitTime?: number;
    pollInterval?: number;
    enableProgressUpdates?: boolean;
}
declare class RelayStatusService {
    private client;
    private transactionStatusService;
    private activeRelayWatchers;
    private readonly RELAY_API_BASE;
    constructor(client: ThirdwebClient);
    /**
     * Track a relay transaction from source to destination
     */
    trackRelay(relayId: string, sourceChain: Chain, destinationChain: Chain, sourceTransactionHash: string, options?: RelayWatchOptions): Promise<RelayStatus>;
    /**
     * Track relay with callback for real-time updates
     */
    trackRelayWithCallback(relayId: string, sourceChain: Chain, destinationChain: Chain, sourceTransactionHash: string, onUpdate: (update: RelayUpdate) => void, options?: RelayWatchOptions): Promise<RelayStatus>;
    /**
     * Get current relay status
     */
    getRelayStatus(relayId: string, sourceChain: Chain, destinationChain: Chain, sourceTransactionHash: string): Promise<RelayStatus>;
    /**
     * Cancel relay tracking
     */
    cancelRelayTracking(relayId: string): void;
    /**
     * Cancel all relay tracking
     */
    cancelAllRelayTracking(): void;
    /**
     * Get estimated relay time between chains
     */
    private getEstimatedRelayTime;
    /**
     * Try to get relay status from Relay.link API
     */
    private getRelayStatusFromAPI;
    /**
     * Map API status to our RelayStatus
     */
    private mapApiStatusToRelayStatus;
    /**
     * Try to find the destination transaction by looking for patterns
     */
    private findDestinationTransaction;
    /**
     * Generate a unique relay ID based on transaction hash and timestamp
     */
    static generateRelayId(transactionHash: string, timestamp?: number): string;
    /**
     * Internal tracking implementation
     */
    private _trackRelayInternal;
}

/**
 * Types for viewer rewards functionality
 */
/**
 * Represents a viewer reward transaction
 */
interface ViewerReward {
    creator: string;
    viewer: string;
    token: string;
    amount: string;
    platformFee: string;
    reason: string;
    timestamp: number;
    transactionHash: string;
}
/**
 * Parameters for rewarding a single viewer
 */
interface ViewerRewardParams {
    viewerId?: number;
    viewerAddress?: string;
    thirdwebId?: string;
    amount: string;
    reason?: string;
    token?: string;
    chainId?: number;
}
/**
 * Parameters for batch rewarding multiple viewers
 */
interface BatchViewerRewardParams {
    viewers: Array<{
        viewerId?: number;
        address?: string;
        thirdwebId?: string;
        amount: string;
        reason?: string;
    }>;
    token?: string;
    chainId?: number;
}
/**
 * Viewer reward statistics for an address
 */
interface ViewerRewardStats {
    totalRewardsGiven: string;
    totalRewardsReceived: string;
    rewardCount: number;
}
/**
 * Platform-wide viewer rewards statistics
 */
interface ViewerRewardsPlatformStats {
    totalRewards: string;
    rewardsEnabled: boolean;
    platformFeeRate: number;
}
/**
 * Result of a viewer reward transaction
 */
interface ViewerRewardResult {
    success: boolean;
    transactionHash?: string;
    chainId?: number;
    error?: string;
    viewerAmount?: string;
    platformFee?: string;
    estimatedUsdcAmount?: string;
    destinationChain?: number;
}
/**
 * Viewer information
 */
interface ViewerInfo {
    id: number;
    wallet: string;
    totalReceived: string;
    thirdwebId?: string;
}
/**
 * Parameters for registering a viewer
 */
interface ViewerRegistration {
    walletAddress: string;
    thirdwebId?: string;
    chainId?: number;
}
/**
 * Parameters for creating a reward pool
 */
interface RewardPoolParams {
    totalAmount: string;
    viewerAddresses: string[];
    reason?: string;
    chainId?: number;
}
/**
 * Result of creating a reward pool
 */
interface RewardPoolResult {
    success: boolean;
    totalDistributed: string;
    platformFee: string;
    perViewerAmount: string;
    viewerCount: number;
    transactions: string[];
    estimatedUsdcPerViewer?: string;
    error?: string;
}
/**
 * Distribution calculation for preview
 */
interface RewardPoolCalculation {
    totalAmount: string;
    platformFee: string;
    distributableAmount: string;
    perViewerAmount: string;
    viewerCount: number;
    batchCount: number;
    estimatedGasCost?: string;
}

interface ApeChainTippingConfig {
    clientId: string;
    environment: 'development' | 'production';
    streamingPlatformAddresses?: Record<number, string>;
    useTestnet?: boolean;
}

interface Creator {
    id: number;
    wallet: string;
    active: boolean;
    totalTips: string;
    tipCount: number;
    tier?: MembershipTier;
    creatorShareBps?: number;
}
interface TipParams {
    sourceChainId: number;
    creatorId: number;
    token: string;
    amount: string;
}
interface TipResult {
    success: boolean;
    sourceTransactionHash?: string;
    relayId?: string;
    estimatedUsdcAmount?: string;
    creatorId?: number;
    error?: string;
}
interface CreatorRegistration {
    creatorWallet: string;
    tier: MembershipTier;
    thirdwebId?: string;
    chainId?: number;
}
interface TipSplits {
    platformFee: string;
    creatorAmount: string;
    businessAmount: string;
}
interface PlatformStats {
    totalTips: string;
    totalCount: number;
    totalRelayed: string;
    activeCreators: number;
    autoRelayEnabled: boolean;
}
declare class ApeChainTippingSDK {
    private client;
    private config;
    private relayService;
    readonly transactionStatus: TransactionStatusService;
    readonly balanceWatcher: BalanceWatcherService;
    readonly relayStatus: RelayStatusService;
    constructor(config: ApeChainTippingConfig);
    private getContractAddress;
    sendTip(params: TipParams): Promise<TipResult>;
    addCreator(registration: CreatorRegistration): Promise<number>;
    private addCreatorToChain;
    /**
     * Prepare a creator addition transaction for external execution
     * This method returns the prepared transaction without executing it,
     * allowing the calling application to handle wallet interaction
     */
    prepareAddCreatorTransaction(registration: CreatorRegistration): Promise<{
        transaction: any;
        contractAddress: string;
        chainId: number;
    }>;
    getCreator(creatorId: number, chainId: number): Promise<Creator>;
    getCreatorByWallet(walletAddress: string, chainId: number): Promise<Creator | null>;
    /**
     * Get creator by thirdweb account ID
     * @param thirdwebId Thirdweb account ID
     * @param chainId Chain ID
     * @returns Creator information or null if not found
     */
    getCreatorByThirdwebId(thirdwebId: string, chainId: number): Promise<Creator | null>;
    updateCreatorWallet(creatorId: number, newWallet: string, chainId: number): Promise<boolean>;
    updateCreatorTier(creatorId: number, newTier: MembershipTier, chainId: number): Promise<boolean>;
    calculateTipSplits(creatorId: number, tipAmount: string, chainId: number): Promise<TipSplits>;
    getCreatorUsdcBalanceOnApeChain(creatorAddress: string): Promise<string>;
    getPlatformStats(chainId: number): Promise<PlatformStats>;
    getTopCreators(limit: number | undefined, chainId: number): Promise<Creator[]>;
    private getChainById;
    private executeTransaction;
    private readContract;
    /**
     * Register a new viewer with optional thirdweb ID
     * @param registration Viewer registration parameters
     * @returns The assigned viewer ID
     */
    registerViewer(registration: ViewerRegistration): Promise<number>;
    /**
     * Send a reward to a viewer
     * @param params Viewer reward parameters
     * @returns Transaction result
     */
    rewardViewer(params: ViewerRewardParams): Promise<ViewerRewardResult>;
    /**
     * Batch reward multiple viewers (gas efficient)
     * @param params Batch viewer reward parameters
     * @returns Transaction result
     */
    batchRewardViewers(params: BatchViewerRewardParams): Promise<ViewerRewardResult>;
    /**
     * Get viewer reward statistics for an address
     * @param address Address to check (can be creator or viewer)
     * @param chainId Chain ID
     * @returns Viewer reward statistics
     */
    getViewerRewardStats(address: string, chainId: number): Promise<ViewerRewardStats>;
    /**
     * Check if viewer rewards are enabled on a chain
     * @param chainId Chain ID
     * @returns Whether viewer rewards are enabled
     */
    areViewerRewardsEnabled(chainId: number): Promise<boolean>;
    /**
     * Get platform-wide viewer rewards statistics
     * @param chainId Chain ID
     * @returns Platform viewer rewards statistics
     */
    getViewerRewardsPlatformStats(chainId: number): Promise<ViewerRewardsPlatformStats>;
    /**
     * Get viewer information by ID
     * @param viewerId Viewer's unique ID
     * @param chainId Chain ID
     * @returns Viewer information
     */
    getViewer(viewerId: number, chainId: number): Promise<ViewerInfo | null>;
    /**
     * Get viewer by wallet address
     * @param walletAddress Wallet address
     * @param chainId Chain ID
     * @returns Viewer information or null if not found
     */
    getViewerByWallet(walletAddress: string, chainId: number): Promise<ViewerInfo | null>;
    /**
     * Get viewer by thirdweb ID
     * @param thirdwebId Thirdweb account ID
     * @param chainId Chain ID
     * @returns Viewer information or null if not found
     */
    getViewerByThirdwebId(thirdwebId: string, chainId: number): Promise<ViewerInfo | null>;
    /**
     * Update viewer wallet address
     * @param viewerId Viewer's unique ID
     * @param newWallet New wallet address
     * @param chainId Chain ID
     * @returns Success status
     */
    updateViewerWallet(viewerId: number, newWallet: string, chainId: number): Promise<boolean>;
    /**
     * Get viewer's USDC balance on ApeChain
     * @param viewerAddress Address of the viewer
     * @returns USDC balance on ApeChain
     */
    getViewerUsdcBalanceOnApeChain(viewerAddress: string): Promise<string>;
    /**
     * Helper method to approve token spending if needed
     * @private
     */
    /**
     * Create a reward pool and distribute equally among viewers
     * @param params Pool parameters
     * @returns Pool distribution result
     */
    createRewardPool(params: RewardPoolParams): Promise<RewardPoolResult>;
    /**
     * Calculate reward pool distribution
     * @param totalAmount Total amount to distribute
     * @param viewerCount Number of viewers
     * @returns Distribution calculation
     */
    calculateRewardPoolDistribution(totalAmount: string, viewerCount: number): RewardPoolCalculation;
    /**
     * Estimate USDC amount for a given native token amount
     * This is a rough estimate - actual conversion depends on current rates
     */
    private estimateUsdcAmount;
    private approveTokenIfNeeded;
    /**
     * Get contract owner address
     */
    getOwner(chainId: number): Promise<string>;
    /**
     * Get business owner address
     */
    getBusinessOwner(chainId: number): Promise<string>;
    /**
     * Check if address is the contract owner
     */
    isOwner(chainId: number, address: string): Promise<boolean>;
    /**
     * Grant admin privileges to an address on a specific chain
     * @param adminAddress Address to grant admin role
     * @param chainId Chain ID
     * @returns True if successful
     */
    grantAdmin(adminAddress: string, chainId: number): Promise<boolean>;
    /**
     * Revoke admin privileges from an address on a specific chain
     * @param adminAddress Address to revoke admin role
     * @param chainId Chain ID
     * @returns True if successful
     */
    revokeAdmin(adminAddress: string, chainId: number): Promise<boolean>;
    /**
     * Check if an address has admin privileges on a specific chain
     * @param adminAddress Address to check
     * @param chainId Chain ID
     * @returns True if address is admin
     */
    isAdmin(adminAddress: string, chainId: number): Promise<boolean>;
    /**
     * Add an authorized relayer for cross-chain operations
     * @param relayerAddress Address of the relayer to authorize
     * @param chainId Chain ID
     * @returns True if successful
     */
    addAuthorizedRelayer(relayerAddress: string, chainId: number): Promise<boolean>;
    /**
     * Remove an authorized relayer for cross-chain operations
     * @param relayerAddress Address of the relayer to remove
     * @param chainId Chain ID
     * @returns True if successful
     */
    removeAuthorizedRelayer(relayerAddress: string, chainId: number): Promise<boolean>;
    /**
     * Set whether viewer rewards are enabled on a chain
     * @param enabled True to enable viewer rewards, false to disable
     * @param chainId Chain ID
     * @returns True if successful
     */
    setViewerRewardsEnabled(enabled: boolean, chainId: number): Promise<boolean>;
    /**
     * Pause the contract operations (admin only)
     * @param chainId Chain ID
     * @returns True if successful
     */
    pause(chainId: number): Promise<boolean>;
    /**
     * Unpause the contract operations (admin only)
     * @param chainId Chain ID
     * @returns True if successful
     */
    unpause(chainId: number): Promise<boolean>;
    /**
     * Perform an emergency withdrawal of funds (admin only)
     * @param chainId Chain ID
     * @returns True if successful
     */
    emergencyWithdraw(chainId: number): Promise<boolean>;
    /**
     * Get statistics for ApeChain (total USDC and amount from chain)
     * @param chainId Chain ID (typically ApeChain)
     * @returns Object with total USDC and total from chain
     */
    getApeChainStats(chainId: number): Promise<{
        totalUsdc: string;
        totalFromChain: string;
    }>;
    /**
     * Get all active creators with pagination
     * @param offset Starting index for pagination
     * @param limit Number of creators to return
     * @param chainId Chain ID
     * @returns Object with creator IDs, wallets, tip amounts, and total active count
     */
    getAllActiveCreators(offset: number, limit: number, chainId: number): Promise<{
        creatorIds: number[];
        wallets: string[];
        tipAmounts: string[];
        totalActive: number;
    }>;
    /**
     * Get information for multiple creators by their IDs
     * @param creatorIds Array of creator IDs
     * @param chainId Chain ID
     * @returns Object with tip amounts, wallets, and active status for each creator
     */
    getCreatorsByIds(creatorIds: number[], chainId: number): Promise<{
        tipAmounts: string[];
        wallets: string[];
        activeStatus: boolean[];
    }>;
    /**
     * Manually relay pending ETH to ApeChain
     * @param chainId Source chain ID
     * @returns True if successful
     */
    manualRelayETH(chainId: number): Promise<boolean>;
    /**
     * Manually relay pending token to ApeChain
     * @param token Token address
     * @param chainId Source chain ID
     * @returns True if successful
     */
    manualRelayToken(token: string, chainId: number): Promise<boolean>;
    /**
     * Get native token balance for a wallet
     * @param walletAddress Wallet address to check
     * @param chainId Chain ID
     * @returns Balance in wei as string
     */
    getNativeBalance(walletAddress: string, chainId: number): Promise<string>;
    /**
     * Get ERC20 token balance for a wallet
     * @param walletAddress Wallet address to check
     * @param tokenAddress Token contract address
     * @param chainId Chain ID
     * @returns Balance in token units as string
     */
    getTokenBalance(walletAddress: string, tokenAddress: string, chainId: number): Promise<string>;
    /**
     * Get balances for multiple tokens
     * @param walletAddress Wallet address to check
     * @param tokenAddresses Array of token addresses ('native' for native token)
     * @param chainId Chain ID
     * @returns Object mapping token addresses to balance strings
     */
    getMultipleTokenBalances(walletAddress: string, tokenAddresses: string[], chainId: number): Promise<Record<string, string>>;
    /**
     * Check ERC20 token allowance
     * @param tokenAddress Token contract address
     * @param ownerAddress Owner wallet address
     * @param spenderAddress Spender contract address
     * @param chainId Chain ID
     * @returns Allowance amount as string
     */
    checkAllowance(tokenAddress: string, ownerAddress: string, spenderAddress: string, chainId: number): Promise<string>;
    /**
     * Check if token needs approval for spending
     * @param tokenAddress Token contract address
     * @param ownerAddress Owner wallet address
     * @param spenderAddress Spender contract address
     * @param amount Amount to spend
     * @param chainId Chain ID
     * @returns True if approval is needed
     */
    needsApproval(tokenAddress: string, ownerAddress: string, spenderAddress: string, amount: string, chainId: number): Promise<boolean>;
    /**
     * Get token information (name, symbol, decimals)
     * @param tokenAddress Token contract address
     * @param chainId Chain ID
     * @returns Token info object
     */
    getTokenInfo(tokenAddress: string, chainId: number): Promise<{
        name: string;
        symbol: string;
        decimals: number;
    }>;
    /**
     * Approve token spending for a spender contract
     * @param tokenAddress Token contract address
     * @param spenderAddress Spender contract address (e.g., TippingChain contract)
     * @param amount Amount to approve (in token units, not wei)
     * @param chainId Chain ID
     * @returns Approval transaction result
     */
    approveToken(tokenAddress: string, spenderAddress: string, amount: string, chainId: number): Promise<{
        success: boolean;
        transactionHash?: string;
        error?: string;
    }>;
    /**
     * Approve unlimited token spending for a spender contract (max approval)
     * @param tokenAddress Token contract address
     * @param spenderAddress Spender contract address
     * @param chainId Chain ID
     * @returns Approval transaction result
     */
    approveTokenMax(tokenAddress: string, spenderAddress: string, chainId: number): Promise<{
        success: boolean;
        transactionHash?: string;
        error?: string;
    }>;
}

interface RelayQuote {
    id: string;
    fromChainId: number;
    toChainId: number;
    fromToken: string;
    toToken: string | null;
    amount: string;
    estimatedOutput: string;
    fees: string;
    estimatedTime: number;
    route?: unknown;
}
interface RelayResult {
    success: boolean;
    relayId?: string;
    destinationChain: number;
    estimatedUsdcAmount?: string;
    error?: string;
}
interface QuoteRequestParams {
    fromChainId: number;
    fromToken: string;
    toChainId: number;
    toToken: string;
    amount: string;
}
declare class ApeChainRelayService {
    private readonly APECHAIN_ID;
    private readonly USDC_TOKEN_ADDRESS;
    private readonly baseUrl;
    /**
     * Get a quote for relaying tokens to ApeChain (for estimation purposes)
     * Note: The actual relay is now handled by the integrated contract
     */
    getQuote(params: QuoteRequestParams): Promise<RelayQuote>;
    /**
     * Estimate USDC output for a tip (deprecated - contracts handle relay automatically)
     * @deprecated Use getQuote directly instead
     */
    relayTipToApeChain(params: {
        fromChainId: number;
        fromToken: string;
        amount: string;
        creatorAddress: string;
        targetToken?: string;
    }): Promise<RelayResult>;
    private makeRequest;
}

interface TokenInfo {
    name: string;
    symbol: string;
    decimals: number;
}
interface TokenBalance {
    tokenAddress: string;
    balance: string;
    symbol: string;
    decimals: number;
}
interface ApprovalStatus {
    isApproved: boolean;
    currentAllowance: string;
    requiredAmount: string;
}
interface ApprovalResult {
    success: boolean;
    transactionHash?: string;
    error?: string;
}
interface MultiTokenBalanceResponse {
    [tokenAddress: string]: string;
}

declare const DEFAULT_CONFIG: {
    readonly environment: "production";
    readonly endpoints: {
        readonly relayApi: "https://api.relay.link";
    };
};

export { ApeChainRelayService, type ApeChainTippingConfig, ApeChainTippingSDK, type ApprovalResult, type ApprovalStatus, type BalanceUpdate, type BalanceWatchOptions, BalanceWatcherService, type BatchViewerRewardParams, type ChainBalanceMap, type Creator, type CreatorRegistration, DEFAULT_CONFIG, type MultiTokenBalanceResponse, type PlatformStats, type RelayQuote, type RelayResult, type RelayStatus, RelayStatusService, type RelayUpdate, type RelayWatchOptions, type RewardPoolCalculation, type RewardPoolParams, type RewardPoolResult, type TipParams, type TipResult, type TokenBalance, type TokenInfo, type TransactionReceipt, type TransactionStatus, TransactionStatusService, type TransactionStatusUpdate, type ViewerInfo, type ViewerRegistration, type ViewerReward, type ViewerRewardParams, type ViewerRewardResult, type ViewerRewardStats, type ViewerRewardsPlatformStats, type WatchTransactionOptions };
