// Main SDK exports
export { ApeChainTippingSDK } from './core/ApeChainTippingSDK';
export { ApeChainRelayService } from './services/ApeChainRelayService';

// Type exports
export type {
  ApeChainTippingConfig,
  TipParams,
  TipResult,
  Creator,
  CreatorRegistration,
  PlatformStats,
} from './core/ApeChainTippingSDK';

export type {
  RelayQuote,
  RelayResult,
} from './services/ApeChainRelayService';

export type {
  ViewerReward,
  ViewerRewardParams,
  BatchViewerRewardParams,
  ViewerRewardStats,
  ViewerRewardsPlatformStats,
  ViewerRewardResult,
  ViewerInfo,
  ViewerRegistration,
  RewardPoolParams,
  RewardPoolResult,
  RewardPoolCalculation,
} from './types/viewer-rewards';

// Re-export from contracts-interface
export { 
  MembershipTier,
  SUPPORTED_CHAINS,
  SUPPORTED_TESTNETS,
  NETWORK_CONFIGS,
  CONTRACT_CONSTANTS,
  TIER_CREATOR_SHARES,
  RELAY_RECEIVER_ADDRESSES,
  getContractAddress,
  getAllContractAddresses,
  isContractDeployed,
  getRelayReceiverAddress
} from '@tippingchain/contracts-interface';

export const DEFAULT_CONFIG = {
  environment: 'production' as const,
  endpoints: {
    relayApi: 'https://api.relay.link',
  },
} as const;