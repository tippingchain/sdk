// packages/sdk/src/core/ApeChainTippingSDK.ts
import { createThirdwebClient, getContract, prepareContractCall, readContract, ThirdwebClient } from 'thirdweb';
import { 
  Chain, 
  ethereum, 
  polygon, 
  optimism, 
  bsc, 
  avalanche, 
  base, 
  arbitrum, 
  defineChain 
} from 'thirdweb/chains';
import { ApeChainRelayService } from '../services/ApeChainRelayService';
import { TransactionStatusService } from '../services/TransactionStatusService';
import { BalanceWatcherService } from '../services/BalanceWatcherService';
import { RelayStatusService } from '../services/RelayStatusService';
import { 
  MembershipTier,
  STREAMING_PLATFORM_TIPPING_ABI as ABI,
  CONTRACT_CONSTANTS,
  SUPPORTED_CHAINS,
  SUPPORTED_TESTNETS,
  getContractAddress,
  isContractDeployed
} from '@tippingchain/contracts-interface';

const TypedABI = ABI as any;
import type { 
  ViewerRewardParams, 
  BatchViewerRewardParams, 
  ViewerRewardResult, 
  ViewerRewardStats, 
  ViewerRewardsPlatformStats,
  ViewerInfo,
  ViewerRegistration,
  RewardPoolParams,
  RewardPoolResult,
  RewardPoolCalculation
} from '../types/viewer-rewards';

export interface ApeChainTippingConfig {
  clientId: string;
  environment: 'development' | 'production';
  streamingPlatformAddresses?: Record<number, string>; // Optional - can use default addresses from interface
  useTestnet?: boolean; // Use testnet addresses
}

// Re-export MembershipTier from contracts-interface
export { MembershipTier } from '@tippingchain/contracts-interface';

export interface Creator {
  id: number;
  wallet: string;
  active: boolean;
  totalTips: string;
  tipCount: number;
  tier?: MembershipTier;
  creatorShareBps?: number; // Creator share in basis points
}

export interface TipParams {
  sourceChainId: number;
  creatorId: number; // NEW: Use creator ID instead of address
  token: string; // address or 'native'
  amount: string;
}

export interface TipResult {
  success: boolean;
  sourceTransactionHash?: string;
  relayId?: string;
  estimatedUsdcAmount?: string;
  creatorId?: number;
  error?: string;
}

export interface CreatorRegistration {
  creatorWallet: string;
  tier: MembershipTier;
  thirdwebId?: string; // Optional thirdweb account ID
  chainId?: number; // Optional - if not specified, registers on all deployed chains
}

export interface TipSplits {
  platformFee: string;
  creatorAmount: string;
  businessAmount: string;
}

export interface PlatformStats {
  totalTips: string;
  totalCount: number;
  totalRelayed: string;
  activeCreators: number;
  autoRelayEnabled: boolean;
}

export class ApeChainTippingSDK {
  private client: ThirdwebClient;
  private config: ApeChainTippingConfig;
  private relayService: ApeChainRelayService;
  
  // Real-time services
  public readonly transactionStatus: TransactionStatusService;
  public readonly balanceWatcher: BalanceWatcherService;
  public readonly relayStatus: RelayStatusService;

  constructor(config: ApeChainTippingConfig) {
    if (!config.clientId) {
      throw new Error('clientId is required');
    }
    // streamingPlatformAddresses is now optional - we can use defaults from contracts-interface
    
    this.config = config;
    this.client = createThirdwebClient({ clientId: config.clientId });
    this.relayService = new ApeChainRelayService(config.useTestnet || false);
    
    // Initialize real-time services
    this.transactionStatus = new TransactionStatusService(this.client);
    this.balanceWatcher = new BalanceWatcherService(this.client);
    this.relayStatus = new RelayStatusService(this.client);
  }

  private getContractAddress(chainId: number): string | undefined {
    // First check if custom addresses were provided in config
    if (this.config.streamingPlatformAddresses && this.config.streamingPlatformAddresses[chainId]) {
      return this.config.streamingPlatformAddresses[chainId];
    }
    // Otherwise use default addresses from contracts-interface
    return getContractAddress(chainId, this.config.useTestnet || false);
  }

  async sendTip(params: TipParams): Promise<TipResult> {
    try {
      // 1. Get unified contract
      const contractAddress = this.getContractAddress(params.sourceChainId);
      if (!contractAddress) {
        throw new Error(`Source chain ${params.sourceChainId} not supported or contract not deployed`);
      }

      // 2. Validate creator exists and is active
      const creator = await this.getCreator(params.creatorId, params.sourceChainId);
      if (!creator.active) {
        throw new Error(`Creator ${params.creatorId} is not active`);
      }

      // 3. Execute tip transaction on unified contract
      const chain = this.getChainById(params.sourceChainId);
      const contract = getContract({
        client: this.client,
        chain,
        address: contractAddress,
        abi: TypedABI,
      });

      let transaction;
      if (params.token === 'native') {
        transaction = prepareContractCall({
          contract,
          method: "function tipCreatorETH(uint256 creatorId)",
          params: [BigInt(params.creatorId)],
          value: BigInt(params.amount),
        });
      } else {
        transaction = prepareContractCall({
          contract,
          method: "function tipCreatorToken(uint256 creatorId, address token, uint256 amount)",
          params: [BigInt(params.creatorId), params.token, BigInt(params.amount)],
        });
      }

      // 4. Execute transaction (this would be done by the connected wallet)
      const result = await this.executeTransaction(transaction);

      // 5. Get relay information for USDC conversion  
      const relayResult = await this.relayService.relayTipToApeChain({
        fromChainId: params.sourceChainId,
        fromToken: params.token,
        amount: params.amount,
        creatorAddress: creator.wallet, // Use actual creator wallet from registry
        targetToken: 'USDC' // Target USDC on ApeChain
      });

      return {
        success: true,
        sourceTransactionHash: (result as any).transactionHash,
        relayId: relayResult.relayId,
        creatorId: params.creatorId,
        estimatedUsdcAmount: relayResult.estimatedUsdcAmount || '0',
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Creator management methods
  async addCreator(registration: CreatorRegistration): Promise<number> {
    // If chainId is specified, only register on that chain
    if (registration.chainId) {
      return this.addCreatorToChain(
        registration.creatorWallet, 
        registration.tier, 
        registration.thirdwebId,
        registration.chainId
      );
    }

    // Otherwise, register on all supported source chains
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

    let creatorId: number | null = null;
    const errors: string[] = [];

    // Register creator on all chains
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
        
        // All chains should return the same creator ID
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
      throw new Error(`Failed to register creator on any chain. Errors: ${errors.join(', ')}`);
    }

    return creatorId;
  }

  private async addCreatorToChain(
    creatorWallet: string, 
    tier: MembershipTier, 
    thirdwebId: string | undefined,
    chainId: number
  ): Promise<number> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported for creator registration or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
      const contract = getContract({
        client: this.client,
        chain,
        address: contractAddress,
        abi: TypedABI,
      });

    const transaction = prepareContractCall({
      contract,
      method: "function addCreator(address creatorWallet, uint8 tier, string thirdwebId)",
      params: [creatorWallet, tier, thirdwebId || ""],
    });

    await this.executeTransaction(transaction);
    
    // In production, you'd parse the CreatorAdded event to get the actual creator ID
    // For now, we'll simulate by reading from contract
    const creatorId = await this.readContract(contract, "getCreatorByWallet", [creatorWallet]);
    return Number(creatorId);
  }

  /**
   * Prepare a creator addition transaction for external execution
   * This method returns the prepared transaction without executing it,
   * allowing the calling application to handle wallet interaction
   */
  async prepareAddCreatorTransaction(registration: CreatorRegistration): Promise<{
    transaction: any;
    contractAddress: string;
    chainId: number;
  }> {
    const chainId = registration.chainId || SUPPORTED_CHAINS.BASE;
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported for creator registration or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function addCreator(address creatorWallet, uint8 tier, string thirdwebId)",
      params: [
        registration.creatorWallet, 
        registration.tier, 
        registration.thirdwebId || ""
      ],
    });

    return {
      transaction,
      contractAddress,
      chainId
    };
  }

  async getCreator(creatorId: number, chainId: number): Promise<Creator> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const creatorInfo = await this.readContract(contract, "function getCreatorInfo(uint256 creatorId) view returns (address wallet, bool active, uint256 totalTips, uint256 tipCount, uint8 tier, uint256 creatorShareBps)", [BigInt(creatorId)]) as [string, boolean, bigint, bigint, number, bigint];
    
    return {
      id: creatorId,
      wallet: creatorInfo[0], // wallet
      active: creatorInfo[1], // active
      totalTips: creatorInfo[2].toString(), // totalTips
      tipCount: Number(creatorInfo[3]), // tipCount
      tier: creatorInfo[4] as MembershipTier, // tier
      creatorShareBps: Number(creatorInfo[5]) // creatorShareBps
    };
  }

  async getCreatorByWallet(walletAddress: string, chainId: number): Promise<Creator | null> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const creatorId = await this.readContract(contract, "getCreatorByWallet", [walletAddress]);
    
    if (Number(creatorId) === 0) {
      return null; // Creator not found
    }

    return this.getCreator(Number(creatorId), chainId);
  }

  /**
   * Get creator by thirdweb account ID
   * @param thirdwebId Thirdweb account ID
   * @param chainId Chain ID
   * @returns Creator information or null if not found
   */
  async getCreatorByThirdwebId(thirdwebId: string, chainId: number): Promise<Creator | null> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const creatorId = await this.readContract(contract, "getCreatorByThirdwebId", [thirdwebId]);
    
    if (Number(creatorId) === 0) {
      return null; // Creator not found
    }

    return this.getCreator(Number(creatorId), chainId);
  }

  async updateCreatorWallet(creatorId: number, newWallet: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function updateCreatorWallet(uint256 creatorId, address newWallet)",
      params: [BigInt(creatorId), newWallet],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  async updateCreatorTier(creatorId: number, newTier: MembershipTier, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function updateCreatorTier(uint256 creatorId, uint8 newTier)",
      params: [BigInt(creatorId), newTier],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  async calculateTipSplits(creatorId: number, tipAmount: string, chainId: number): Promise<TipSplits> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const result = await this.readContract(
      contract, 
      "function calculateTipSplits(uint256 creatorId, uint256 tipAmount) view returns (uint256 platformFee, uint256 creatorAmount, uint256 businessAmount)", 
      [BigInt(creatorId), BigInt(tipAmount)]
    ) as [bigint, bigint, bigint];

    return {
      platformFee: result[0].toString(),
      creatorAmount: result[1].toString(),
      businessAmount: result[2].toString()
    };
  }

  async getCreatorUsdcBalanceOnApeChain(creatorAddress: string): Promise<string> {
    const apeChainAddress = this.getContractAddress(SUPPORTED_CHAINS.APECHAIN);
    if (!apeChainAddress) {
      throw new Error('ApeChain contract not deployed or configured');
    }

      const chain = this.getChainById(SUPPORTED_CHAINS.APECHAIN);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: apeChainAddress,
      abi: TypedABI,
    });

    const balances = await this.readContract(contract, "getBalances", [creatorAddress]) as [bigint, bigint];
    return balances[1].toString(); // usdcBalance is the second return value
  }

  async getPlatformStats(chainId: number): Promise<PlatformStats> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const stats = await this.readContract(contract, "getPlatformStats", []) as [bigint, bigint, bigint, bigint, boolean];
    
    return {
      totalTips: stats[0].toString(),
      totalCount: Number(stats[1]),
      totalRelayed: stats[2].toString(),
      activeCreators: Number(stats[3]),
      autoRelayEnabled: stats[4]
    };
  }

  async getTopCreators(limit: number = 10, chainId: number): Promise<Creator[]> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    // Fetch all active creators (limit to reasonable number for performance)
    const maxCreators = Math.max(limit * 2, 100); // Get more than requested to enable proper sorting
    const result = await this.readContract(
      contract, 
      "getAllActiveCreators", 
      [BigInt(maxCreators)]
    ) as [bigint[], string[]];
    
    const [creatorIds, wallets] = result;
    const allCreators: Creator[] = [];
    
    // Create creator objects - we'll fetch tip data for sorting below
    for (let i = 0; i < creatorIds.length; i++) {
      allCreators.push({
        id: Number(creatorIds[i]),
        wallet: wallets[i],
        active: true, // getAllActiveCreators only returns active creators
        totalTips: "0", // Will be fetched below
        tipCount: 0 // Will be fetched below
      });
    }
    
    // Fetch tip data for proper sorting (for first few creators only to optimize performance)
    const creatorsToEnrich = allCreators.slice(0, Math.min(limit * 3, allCreators.length));
    
    for (const creator of creatorsToEnrich) {
      try {
        // Try to get creator info for totalTips
        const creatorInfo = await this.readContract(
          contract,
          "function getCreatorInfo(uint256 creatorId) view returns (address wallet, bool active, uint256 totalTips, uint256 tipCount, uint8 tier, uint256 creatorShareBps)", 
          [BigInt(creator.id)]
        ) as [string, boolean, bigint, bigint, number, bigint];
        
        creator.totalTips = creatorInfo[2].toString(); // Total tips received
        creator.tipCount = Number(creatorInfo[3]); // Tip count
      } catch (error) {
        // If getCreatorInfo is not available, keep defaults
        console.warn(`Failed to get creator info for ID ${creator.id}:`, error);
      }
    }
    
    // Sort by totalTips descending (using bigint comparison for accuracy)
    allCreators.sort((a, b) => {
      const aTips = BigInt(a.totalTips);
      const bTips = BigInt(b.totalTips);
      
      if (bTips > aTips) return 1;
      if (bTips < aTips) return -1;
      return 0;
    });
    
    // Take top N creators
    const topCreators = allCreators.slice(0, limit);
    
    return topCreators;
  }

  private getChainById(chainId: number): Chain {
    // Chain objects are now imported at the top of the file
    
    const chainMap: Record<number, Chain> = {
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
        name: 'Abstract',
        rpc: 'https://api.testnet.abs.xyz',
        nativeCurrency: {
          name: 'Ethereum',
          symbol: 'ETH',
          decimals: 18,
        },
      }),
      33139: defineChain({
        id: 33139,
        name: 'ApeChain',
        rpc: 'https://33139.rpc.thirdweb.com',
        nativeCurrency: {
          name: 'APE',
          symbol: 'APE',
          decimals: 18,
        },
      }),
      167000: defineChain({
        id: 167000,
        name: 'Taiko',
        rpc: 'https://rpc.mainnet.taiko.xyz',
        nativeCurrency: {
          name: 'Ethereum',
          symbol: 'ETH',
          decimals: 18,
        },
      }),
      // Testnets
      421614: defineChain({
        id: 421614,
        name: 'Arbitrum Sepolia',
        rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
        nativeCurrency: {
          name: 'Ethereum',
          symbol: 'ETH',
          decimals: 18,
        },
      }),
      80002: defineChain({
        id: 80002,
        name: 'Polygon Amoy',
        rpc: 'https://rpc-amoy.polygon.technology',
        nativeCurrency: {
          name: 'MATIC',
          symbol: 'MATIC',
          decimals: 18,
        },
      }),
      84532: defineChain({
        id: 84532,
        name: 'Base Sepolia',
        rpc: 'https://sepolia.base.org',
        nativeCurrency: {
          name: 'Ethereum',
          symbol: 'ETH',
          decimals: 18,
        },
      }),
    };
    
    const chain = chainMap[chainId];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    
    return chain;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async executeTransaction(_transaction: unknown): Promise<Record<string, unknown>> {
    // This method should be called with a connected wallet
    // For now, we'll return a mock response indicating the transaction needs to be executed
    // In a real implementation, this would use the thirdweb SDK to execute the transaction
    return {
      transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
      blockNumber: Math.floor(Math.random() * 1000000),
      success: true,
    };
  }

  private async readContract(contract: unknown, method: string, params: unknown[]): Promise<unknown> {
    try {
      // Use thirdweb's readContract function
      const result = await readContract({
        contract: contract as any,
        method,
        params,
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to read contract: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============ Viewer Rewards Methods ============
  
  /**
   * Register a new viewer with optional thirdweb ID
   * @param registration Viewer registration parameters
   * @returns The assigned viewer ID
   */
  async registerViewer(registration: ViewerRegistration): Promise<number> {
    const chainId = registration.chainId || SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function registerViewer(address viewerWallet, string thirdwebId)",
      params: [registration.walletAddress, registration.thirdwebId || ""],
    });

    const result = await this.executeTransaction(transaction);
    
    // In production, parse the ViewerRegistered event to get the actual viewer ID
    // For now, we'll simulate by reading from contract
    const viewerId = await this.readContract(contract, "getViewerByWallet", [registration.walletAddress]);
    return Number(viewerId);
  }

  /**
   * Send a reward to a viewer
   * @param params Viewer reward parameters
   * @returns Transaction result
   */
  async rewardViewer(params: ViewerRewardParams): Promise<ViewerRewardResult> {
    const chainId = params.chainId || SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    try {
      let transaction;
      const amountBigInt = BigInt(params.amount);
      
      // Calculate fees
      const platformFee = (amountBigInt * BigInt(100)) / BigInt(10000); // 1%
      const viewerAmount = amountBigInt - platformFee;
      
      // Get USDC conversion estimate via relay service
      const relayQuote = await this.relayService.getQuote({
        fromChainId: chainId,
        fromToken: params.token === 'native' ? 'native' : (params.token || 'native'),
        toChainId: SUPPORTED_CHAINS.APECHAIN,
        toToken: 'USDC',
        amount: viewerAmount.toString()
      });
      
      const estimatedUsdcAmount = relayQuote.estimatedOutput;
      
      // Determine which reward method to use based on identifier type
      if (params.viewerId) {
        // Use viewer ID directly
        if (params.token === 'native' || !params.token) {
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
        // Resolve thirdweb ID to viewer ID first
        const viewerId = await this.readContract(contract, "getViewerByThirdwebId", [params.thirdwebId]);
        if (Number(viewerId) === 0) {
          throw new Error(`No viewer found for thirdweb ID: ${params.thirdwebId}`);
        }
        
        if (params.token === 'native' || !params.token) {
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
        // Direct address (existing flow)
        if (params.token === 'native' || !params.token) {
          transaction = prepareContractCall({
            contract,
            method: "function rewardViewerETH(address viewer, string reason)",
            params: [params.viewerAddress, params.reason || ""],
            value: amountBigInt
          });
        } else {
          // ERC20 token reward
          await this.approveTokenIfNeeded(params.token, contractAddress, params.amount, chainId);
          
          transaction = prepareContractCall({
            contract,
            method: "function rewardViewerToken(address viewer, address token, uint256 amount, string reason)",
            params: [params.viewerAddress, params.token, amountBigInt, params.reason || ""]
          });
        }
      } else {
        throw new Error('Must provide viewerId, thirdwebId, or viewerAddress');
      }

      const result = await this.executeTransaction(transaction);
      
      return {
        success: true,
        transactionHash: result.transactionHash as string,
        chainId,
        viewerAmount: viewerAmount.toString(),
        platformFee: platformFee.toString(),
        estimatedUsdcAmount,
        destinationChain: SUPPORTED_CHAINS.APECHAIN
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Batch reward multiple viewers (gas efficient)
   * @param params Batch viewer reward parameters
   * @returns Transaction result
   */
  async batchRewardViewers(params: BatchViewerRewardParams): Promise<ViewerRewardResult> {
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
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    // Resolve all viewer identifiers to IDs or addresses
    const resolvedViewers: Array<{ isId: boolean; identifier: string | bigint }> = [];
    const amounts = params.viewers.map(v => BigInt(v.amount));
    const reasons = params.viewers.map(v => v.reason || "");
    const totalAmount = amounts.reduce((sum, amount) => sum + amount, BigInt(0));
    
    // Resolve each viewer to either an ID or address
    for (const viewer of params.viewers) {
      if (viewer.viewerId) {
        resolvedViewers.push({ isId: true, identifier: BigInt(viewer.viewerId) });
      } else if (viewer.thirdwebId) {
        const viewerId = await this.readContract(
          contract,
          "getViewerByThirdwebId",
          [viewer.thirdwebId]
        ) as bigint;
        if (viewerId === BigInt(0)) {
          throw new Error(`No viewer found for thirdweb ID: ${viewer.thirdwebId}`);
        }
        resolvedViewers.push({ isId: true, identifier: viewerId });
      } else if (viewer.address) {
        resolvedViewers.push({ isId: false, identifier: viewer.address });
      } else {
        throw new Error('Each viewer must have viewerId, thirdwebId, or address');
      }
    }
    
    // Check if all are IDs or all are addresses
    const allIds = resolvedViewers.every(v => v.isId);
    const allAddresses = resolvedViewers.every(v => !v.isId);
    
    if (!allIds && !allAddresses) {
      throw new Error('Cannot mix viewer IDs and addresses in batch rewards');
    }

    try {
      let transaction;
      
      if (allIds) {
        // Use batch reward by IDs
        const viewerIds = resolvedViewers.map(v => v.identifier as bigint);
        transaction = prepareContractCall({
          contract,
          method: "function batchRewardViewersByIdETH(uint256[] viewerIds, uint256[] amounts, string[] reasons)",
          params: [viewerIds, amounts, reasons],
          value: totalAmount
        });
      } else {
        // Use batch reward by addresses
        const viewerAddresses = resolvedViewers.map(v => v.identifier as string);
        transaction = prepareContractCall({
          contract,
          method: "function batchRewardViewersETH(address[] viewers, uint256[] amounts, string[] reasons)",
          params: [viewerAddresses, amounts, reasons],
          value: totalAmount
        });
      }

      const result = await this.executeTransaction(transaction);
      
      // Calculate total fees
      const totalFee = (totalAmount * BigInt(100)) / BigInt(10000); // 1%
      const totalToViewers = totalAmount - totalFee;
      
      // Get USDC conversion estimate for batch
      const relayQuote = await this.relayService.getQuote({
        fromChainId: chainId,
        fromToken: 'native',
        toChainId: SUPPORTED_CHAINS.APECHAIN,
        toToken: 'USDC',
        amount: totalToViewers.toString()
      });
      
      const estimatedUsdcAmount = relayQuote.estimatedOutput;
      
      return {
        success: true,
        transactionHash: result.transactionHash as string,
        chainId,
        viewerAmount: totalToViewers.toString(),
        platformFee: totalFee.toString(),
        estimatedUsdcAmount,
        destinationChain: SUPPORTED_CHAINS.APECHAIN
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get viewer reward statistics for an address
   * @param address Address to check (can be creator or viewer)
   * @param chainId Chain ID
   * @returns Viewer reward statistics
   */
  async getViewerRewardStats(address: string, chainId: number): Promise<ViewerRewardStats> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const result = await this.readContract(contract, "getViewerRewardStats", [address]) as [bigint, bigint, bigint];

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
  async areViewerRewardsEnabled(chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    return await this.readContract(contract, "viewerRewardsEnabled", []) as boolean;
  }

  /**
   * Get platform-wide viewer rewards statistics
   * @param chainId Chain ID
   * @returns Platform viewer rewards statistics
   */
  async getViewerRewardsPlatformStats(chainId: number): Promise<ViewerRewardsPlatformStats> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const result = await this.readContract(contract, "getViewerRewardsPlatformStats", []) as [bigint, boolean, bigint];

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
  async getViewer(viewerId: number, chainId: number): Promise<ViewerInfo | null> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const result = await this.readContract(contract, "getViewerInfo", [BigInt(viewerId)]) as [string, bigint];
    const [wallet, totalReceived] = result;
    
    if (wallet === '0x0000000000000000000000000000000000000000') {
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
  async getViewerByWallet(walletAddress: string, chainId: number): Promise<ViewerInfo | null> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const viewerId = await this.readContract(contract, "getViewerByWallet", [walletAddress]) as bigint;
    
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
  async getViewerByThirdwebId(thirdwebId: string, chainId: number): Promise<ViewerInfo | null> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const viewerId = await this.readContract(contract, "getViewerByThirdwebId", [thirdwebId]) as bigint;
    
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
  async updateViewerWallet(viewerId: number, newWallet: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function updateViewerWallet(uint256 viewerId, address newWallet)",
      params: [BigInt(viewerId), newWallet],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Get viewer's USDC balance on ApeChain
   * @param viewerAddress Address of the viewer
   * @returns USDC balance on ApeChain
   */
  async getViewerUsdcBalanceOnApeChain(viewerAddress: string): Promise<string> {
    const apeChainAddress = this.getContractAddress(SUPPORTED_CHAINS.APECHAIN);
    if (!apeChainAddress) {
      throw new Error('ApeChain contract not deployed or configured');
    }

    const contract = getContract({
      client: this.client,
      chain: this.getChainById(SUPPORTED_CHAINS.APECHAIN),
      address: apeChainAddress,
    });

    // On ApeChain, check USDC balance for viewer
    const balances = await this.readContract(contract, "getBalances", [viewerAddress]) as [bigint, bigint];
    return balances[1].toString(); // usdcBalance is the second return value
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
  async createRewardPool(params: RewardPoolParams): Promise<RewardPoolResult> {
    const chainId = params.chainId || SUPPORTED_CHAINS.POLYGON;
    const { totalAmount, viewerAddresses, reason = "Reward pool distribution" } = params;

    // Validate inputs
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

    // Remove duplicates and validate addresses
    const uniqueViewers = [...new Set(viewerAddresses)].filter((addr): addr is string => 
      typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42
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
      // Calculate distribution
      const calculation = this.calculateRewardPoolDistribution(totalAmount, uniqueViewers.length);
      
      // Create viewer reward params
      const viewers = uniqueViewers.map(address => ({
        address,
        amount: calculation.perViewerAmount,
        reason
      }));

      // Split into batches of 50 (contract limit)
      const batches: Array<typeof viewers> = [];
      for (let i = 0; i < viewers.length; i += 50) {
        batches.push(viewers.slice(i, i + 50));
      }

      // Execute all batches
      const transactions: string[] = [];
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

      // Estimate USDC per viewer (rough estimate - actual may vary based on exchange rates)
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
        error: allSuccess ? undefined : "Some batches failed to process"
      };
    } catch (error: any) {
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
  calculateRewardPoolDistribution(totalAmount: string, viewerCount: number): RewardPoolCalculation {
    const total = BigInt(totalAmount);
    const platformFee = total * 100n / 10000n; // 1% platform fee
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
  private async estimateUsdcAmount(nativeAmount: string, chainId: number): Promise<string> {
    // Rough estimates based on typical rates (in production, use price oracles)
    const estimateRates: Record<number, number> = {
      1: 2000,      // ETH ~$2000
      137: 0.8,     // MATIC ~$0.80
      10: 2000,     // ETH on Optimism
      56: 300,      // BNB ~$300
      2741: 2000,   // ETH on Abstract
      43114: 30,    // AVAX ~$30
      8453: 2000,   // ETH on Base
      42161: 2000,  // ETH on Arbitrum
      167000: 2000, // ETH on Taiko
      // Testnets (same rates as mainnet for estimation)
      421614: 2000, // ETH on Arbitrum Sepolia
      80002: 0.8,   // MATIC on Amoy
      84532: 2000   // ETH on Base Sepolia
    };

    const rate = estimateRates[chainId] || 1;
    const amount = parseFloat(nativeAmount) / 1e18; // Convert from wei
    const usdcAmount = (amount * rate * 1e6).toFixed(0); // Convert to USDC decimals (6)
    
    return usdcAmount;
  }

  private async approveTokenIfNeeded(
    tokenAddress: string,
    spenderAddress: string,
    amount: string,
    chainId: number
  ): Promise<void> {
    const chain = this.getChainById(chainId);
    const tokenContract = getContract({
      client: this.client,
      chain,
      address: tokenAddress,
    });

    // Check current allowance
    const allowance = await this.readContract(
      tokenContract,
      "allowance",
      [/* owner address would go here */, spenderAddress]
    ) as bigint;

    if (allowance < BigInt(amount)) {
      // Approve the required amount
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
  async getOwner(chainId: number): Promise<string> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`No contract address for chain ${chainId}`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    return await this.readContract(contract, "owner", []) as string;
  }

  /**
   * Get business owner address
   */
  async getBusinessOwner(chainId: number): Promise<string> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`No contract address for chain ${chainId}`);
    }

    const chain = this.getChainById(chainId);
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    return await this.readContract(contract, "businessOwner", []) as string;
  }

  /**
   * Check if address is the contract owner
   */
  async isOwner(chainId: number, address: string): Promise<boolean> {
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
  async grantAdmin(adminAddress: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function grantAdmin(address admin)",
      params: [adminAddress],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Revoke admin privileges from an address on a specific chain
   * @param adminAddress Address to revoke admin role
   * @param chainId Chain ID
   * @returns True if successful
   */
  async revokeAdmin(adminAddress: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function revokeAdmin(address admin)",
      params: [adminAddress],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Check if an address has admin privileges on a specific chain
   * @param adminAddress Address to check
   * @param chainId Chain ID
   * @returns True if address is admin
   */
  async isAdmin(adminAddress: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    return await this.readContract(contract, "isAdmin", [adminAddress]) as boolean;
  }

  /**
   * Add an authorized relayer for cross-chain operations
   * @param relayerAddress Address of the relayer to authorize
   * @param chainId Chain ID
   * @returns True if successful
   */
  async addAuthorizedRelayer(relayerAddress: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function addAuthorizedRelayer(address relayer)",
      params: [relayerAddress],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Remove an authorized relayer for cross-chain operations
   * @param relayerAddress Address of the relayer to remove
   * @param chainId Chain ID
   * @returns True if successful
   */
  async removeAuthorizedRelayer(relayerAddress: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function removeAuthorizedRelayer(address relayer)",
      params: [relayerAddress],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Set whether viewer rewards are enabled on a chain
   * @param enabled True to enable viewer rewards, false to disable
   * @param chainId Chain ID
   * @returns True if successful
   */
  async setViewerRewardsEnabled(enabled: boolean, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function setViewerRewardsEnabled(bool enabled)",
      params: [enabled],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  // ============ Contract State Management ============

  /**
   * Pause the contract operations (admin only)
   * @param chainId Chain ID
   * @returns True if successful
   */
  async pause(chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function pause()",
      params: [],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Unpause the contract operations (admin only)
   * @param chainId Chain ID
   * @returns True if successful
   */
  async unpause(chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function unpause()",
      params: [],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  // ============ Emergency Withdrawal ============

  /**
   * Perform an emergency withdrawal of funds (admin only)
   * @param chainId Chain ID
   * @returns True if successful
   */
  async emergencyWithdraw(chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function emergencyWithdraw()",
      params: [],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  // ============ Advanced Stats and Queries ============

  /**
   * Get statistics for ApeChain (total USDC and amount from chain)
   * @param chainId Chain ID (typically ApeChain)
   * @returns Object with total USDC and total from chain
   */
  async getApeChainStats(chainId: number): Promise<{ totalUsdc: string; totalFromChain: string }> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const result = await this.readContract(contract, "getApeChainStats", []) as [bigint, bigint];
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
  async getAllActiveCreators(offset: number, limit: number, chainId: number): Promise<{
    creatorIds: number[];
    wallets: string[];
    tipAmounts: string[];
    totalActive: number;
  }> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const result = await this.readContract(contract, "getAllActiveCreators", [BigInt(offset), BigInt(limit)]) as [bigint[], string[], bigint[], bigint];
    return {
      creatorIds: result[0].map(id => Number(id)),
      wallets: result[1],
      tipAmounts: result[2].map(amount => amount.toString()),
      totalActive: Number(result[3])
    };
  }

  /**
   * Get information for multiple creators by their IDs
   * @param creatorIds Array of creator IDs
   * @param chainId Chain ID
   * @returns Object with tip amounts, wallets, and active status for each creator
   */
  async getCreatorsByIds(creatorIds: number[], chainId: number): Promise<{
    tipAmounts: string[];
    wallets: string[];
    activeStatus: boolean[];
  }> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const bigIntIds = creatorIds.map(id => BigInt(id));
    const result = await this.readContract(contract, "getCreatorsByIds", [bigIntIds]) as [bigint[], string[], boolean[]];
    return {
      tipAmounts: result[0].map(amount => amount.toString()),
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
  async manualRelayETH(chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function manualRelayETH()",
      params: [],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  /**
   * Manually relay pending token to ApeChain
   * @param token Token address
   * @param chainId Source chain ID
   * @returns True if successful
   */
  async manualRelayToken(token: string, chainId: number): Promise<boolean> {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }

    const chain = this.getChainById(chainId);
    // @ts-ignore: Suppress type mismatch for ABI
    const contract = getContract({
      client: this.client,
      chain,
      address: contractAddress,
      abi: TypedABI,
    });

    const transaction = prepareContractCall({
      contract,
      method: "function manualRelayToken(address token)",
      params: [token],
    });

    const result = await this.executeTransaction(transaction);
    return (result as any).success;
  }

  // ===== TOKEN BALANCE AND APPROVAL METHODS =====

  /**
   * Get native token balance for a wallet
   * @param walletAddress Wallet address to check
   * @param chainId Chain ID
   * @returns Balance in wei as string
   */
  async getNativeBalance(walletAddress: string, chainId: number): Promise<string> {
    const chain = this.getChainById(chainId);
    
    try {
      // Use thirdweb's built-in balance checking
      const { getRpcClient } = await import('thirdweb/rpc');
      const rpcRequest = getRpcClient({ client: this.client, chain });
      
      // Make eth_getBalance RPC call
      const balance = await rpcRequest({
        method: 'eth_getBalance',
        params: [walletAddress, 'latest']
      });
      
      // Convert hex balance to decimal string
      return BigInt(balance as string).toString();
    } catch (error) {
      console.error(`Failed to get native balance for ${walletAddress} on chain ${chainId}:`, error);
      return '0';
    }
  }

  /**
   * Get ERC20 token balance for a wallet
   * @param walletAddress Wallet address to check
   * @param tokenAddress Token contract address
   * @param chainId Chain ID
   * @returns Balance in token units as string
   */
  async getTokenBalance(walletAddress: string, tokenAddress: string, chainId: number): Promise<string> {
    if (tokenAddress === 'native') {
      return this.getNativeBalance(walletAddress, chainId);
    }

    const chain = this.getChainById(chainId);
    
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress,
        abi: TypedABI,
      });

      const balance = await readContract({
        contract: tokenContract,
        method: 'function balanceOf(address) view returns (uint256)',
        params: [walletAddress],
      });

      return (balance as bigint).toString();
    } catch (error) {
      console.error(`Failed to get token balance for ${walletAddress} on chain ${chainId}:`, error);
      return '0';
    }
  }

  /**
   * Get balances for multiple tokens
   * @param walletAddress Wallet address to check
   * @param tokenAddresses Array of token addresses ('native' for native token)
   * @param chainId Chain ID
   * @returns Object mapping token addresses to balance strings
   */
  async getMultipleTokenBalances(
    walletAddress: string, 
    tokenAddresses: string[], 
    chainId: number
  ): Promise<Record<string, string>> {
    const balances: Record<string, string> = {};

    // Fetch all balances in parallel for better performance
    const balancePromises = tokenAddresses.map(async (tokenAddress) => {
      const balance = await this.getTokenBalance(walletAddress, tokenAddress, chainId);
      return { tokenAddress, balance };
    });

    const results = await Promise.allSettled(balancePromises);
    
    results.forEach((result, index) => {
      const tokenAddress = tokenAddresses[index];
      if (result.status === 'fulfilled') {
        balances[tokenAddress] = result.value.balance;
      } else {
        console.warn(`Failed to get balance for token ${tokenAddress}:`, result.reason);
        balances[tokenAddress] = '0';
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
  async checkAllowance(
    tokenAddress: string, 
    ownerAddress: string, 
    spenderAddress: string, 
    chainId: number
  ): Promise<string> {
    if (tokenAddress === 'native') {
      return '0'; // Native tokens don't need approval
    }

    const chain = this.getChainById(chainId);
    
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress,
      });

      const allowance = await readContract({
        contract: tokenContract,
        method: 'function allowance(address owner, address spender) view returns (uint256)',
        params: [ownerAddress, spenderAddress],
      });

      return (allowance as bigint).toString();
    } catch (error) {
      console.error(`Failed to check allowance for ${tokenAddress}:`, error);
      return '0';
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
  async needsApproval(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    amount: string,
    chainId: number
  ): Promise<boolean> {
    if (tokenAddress === 'native') {
      return false; // Native tokens don't need approval
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
  async getTokenInfo(tokenAddress: string, chainId: number): Promise<{
    name: string;
    symbol: string;
    decimals: number;
  }> {
    if (tokenAddress === 'native') {
      const chain = this.getChainById(chainId);
      return {
        name: chain.nativeCurrency?.name || 'Ether',
        symbol: chain.nativeCurrency?.symbol || 'ETH',
        decimals: chain.nativeCurrency?.decimals || 18,
      };
    }

    const chain = this.getChainById(chainId);
    
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress,
      });

      const [name, symbol, decimals] = await Promise.all([
        readContract({
          contract: tokenContract,
          method: 'function name() view returns (string)',
          params: [],
        }).catch(() => 'Unknown'),
        readContract({
          contract: tokenContract,
          method: 'function symbol() view returns (string)',
          params: [],
        }).catch(() => 'UNK'),
        readContract({
          contract: tokenContract,
          method: 'function decimals() view returns (uint8)',
          params: [],
        }).catch(() => 18),
      ]);

      return {
        name: name as string,
        symbol: symbol as string,
        decimals: Number(decimals),
      };
    } catch (error) {
      console.error(`Failed to get token info for ${tokenAddress}:`, error);
      return {
        name: 'Unknown',
        symbol: 'UNK',
        decimals: 18,
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
  async approveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: string,
    chainId: number
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    error?: string;
  }> {
    if (tokenAddress === 'native') {
      return {
        success: true,
        // Native tokens don't need approval
      };
    }

    const chain = this.getChainById(chainId);
    
    try {
      const tokenContract = getContract({
        client: this.client,
        chain,
        address: tokenAddress,
      });

      // Prepare approval transaction
      const approveTx = prepareContractCall({
        contract: tokenContract,
        method: 'function approve(address spender, uint256 amount) returns (bool)',
        params: [spenderAddress, BigInt(amount)],
      });

      // Execute the approval transaction
      const result = await this.executeTransaction(approveTx);
      
      return {
        success: true,
        transactionHash: (result as any).transactionHash,
      };
    } catch (error) {
      console.error(`Failed to approve token ${tokenAddress}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
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
  async approveTokenMax(
    tokenAddress: string,
    spenderAddress: string,
    chainId: number
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    error?: string;
  }> {
    // Use max uint256 value for unlimited approval
    const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    
    return this.approveToken(tokenAddress, spenderAddress, MAX_UINT256, chainId);
  }
}
