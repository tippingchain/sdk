/**
 * Types for viewer rewards functionality
 */

/**
 * Represents a viewer reward transaction
 */
export interface ViewerReward {
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
export interface ViewerRewardParams {
  // Viewer identification - provide one of these
  viewerId?: number;          // TippingChain viewer ID
  viewerAddress?: string;      // Direct wallet address
  thirdwebId?: string;        // Thirdweb account ID
  
  amount: string;
  reason?: string;
  token?: string; // 'native' or token address
  chainId?: number;
}

/**
 * Parameters for batch rewarding multiple viewers
 */
export interface BatchViewerRewardParams {
  viewers: Array<{
    // Viewer identification - provide one of these
    viewerId?: number;
    address?: string;
    thirdwebId?: string;
    
    amount: string;
    reason?: string;
  }>;
  token?: string; // Only supports native tokens in batch for gas efficiency
  chainId?: number;
}

/**
 * Viewer reward statistics for an address
 */
export interface ViewerRewardStats {
  totalRewardsGiven: string;
  totalRewardsReceived: string;
  rewardCount: number;
}

/**
 * Platform-wide viewer rewards statistics
 */
export interface ViewerRewardsPlatformStats {
  totalRewards: string;
  rewardsEnabled: boolean;
  platformFeeRate: number; // in basis points
}

/**
 * Result of a viewer reward transaction
 */
export interface ViewerRewardResult {
  success: boolean;
  transactionHash?: string;
  chainId?: number;
  error?: string;
  viewerAmount?: string; // Amount viewer receives after fees (in native token)
  platformFee?: string;
  estimatedUsdcAmount?: string; // Estimated USDC amount on ApeChain
  destinationChain?: number; // ApeChain ID (33139)
}

/**
 * Viewer information
 */
export interface ViewerInfo {
  id: number;
  wallet: string;
  totalReceived: string;
  thirdwebId?: string;
}

/**
 * Parameters for registering a viewer
 */
export interface ViewerRegistration {
  walletAddress: string;
  thirdwebId?: string;
  chainId?: number;
}

/**
 * Parameters for creating a reward pool
 */
export interface RewardPoolParams {
  totalAmount: string;        // Total amount to distribute (in wei)
  viewerAddresses: string[];  // List of viewer wallet addresses
  reason?: string;            // Optional reason for the distribution
  chainId?: number;
}

/**
 * Result of creating a reward pool
 */
export interface RewardPoolResult {
  success: boolean;
  totalDistributed: string;   // Amount distributed after platform fee
  platformFee: string;        // Platform fee taken (1%)
  perViewerAmount: string;    // Amount each viewer receives
  viewerCount: number;
  transactions: string[];     // Transaction hashes (may be multiple due to batch limits)
  estimatedUsdcPerViewer?: string; // Estimated USDC each viewer gets on ApeChain
  error?: string;
}

/**
 * Distribution calculation for preview
 */
export interface RewardPoolCalculation {
  totalAmount: string;
  platformFee: string;
  distributableAmount: string;
  perViewerAmount: string;
  viewerCount: number;
  batchCount: number;         // Number of transactions needed (50 viewer limit per batch)
  estimatedGasCost?: string;
}