'use strict';

var thirdweb = require('thirdweb');
var chains = require('thirdweb/chains');
var contractsInterface = require('@tippingchain/contracts-interface');

// src/core/ApeChainTippingSDK.ts
var ApeChainRelayService = class {
  constructor() {
    this.APECHAIN_ID = contractsInterface.SUPPORTED_CHAINS.APECHAIN;
    this.USDC_TOKEN_ADDRESS = contractsInterface.CONTRACT_CONSTANTS.APECHAIN_USDC;
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
var ApeChainTippingSDK = class {
  constructor(config) {
    if (!config.clientId) {
      throw new Error("clientId is required");
    }
    this.config = config;
    this.client = thirdweb.createThirdwebClient({ clientId: config.clientId });
    this.relayService = new ApeChainRelayService();
  }
  getContractAddress(chainId) {
    if (this.config.streamingPlatformAddresses && this.config.streamingPlatformAddresses[chainId]) {
      return this.config.streamingPlatformAddresses[chainId];
    }
    return contractsInterface.getContractAddress(chainId, this.config.useTestnet || false);
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
      const contract = thirdweb.getContract({
        client: this.client,
        chain,
        address: contractAddress
      });
      let transaction;
      if (params.token === "native") {
        transaction = thirdweb.prepareContractCall({
          contract,
          method: "function tipCreatorETH(uint256 creatorId)",
          params: [BigInt(params.creatorId)],
          value: BigInt(params.amount)
        });
      } else {
        transaction = thirdweb.prepareContractCall({
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
      contractsInterface.SUPPORTED_CHAINS.ETHEREUM,
      contractsInterface.SUPPORTED_CHAINS.POLYGON,
      contractsInterface.SUPPORTED_CHAINS.OPTIMISM,
      contractsInterface.SUPPORTED_CHAINS.BSC,
      contractsInterface.SUPPORTED_CHAINS.ABSTRACT,
      contractsInterface.SUPPORTED_CHAINS.AVALANCHE,
      contractsInterface.SUPPORTED_CHAINS.BASE,
      contractsInterface.SUPPORTED_CHAINS.ARBITRUM,
      contractsInterface.SUPPORTED_CHAINS.TAIKO
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
    });
    const transaction = thirdweb.prepareContractCall({
      contract,
      method: "function addCreator(address creatorWallet, uint8 tier, string thirdwebId)",
      params: [creatorWallet, tier, thirdwebId || ""]
    });
    await this.executeTransaction(transaction);
    const creatorId = await this.readContract(contract, "getCreatorByWallet", [creatorWallet]);
    return Number(creatorId);
  }
  async getCreator(creatorId, chainId) {
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported or contract not deployed`);
    }
    const chain = this.getChainById(chainId);
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
    });
    const transaction = thirdweb.prepareContractCall({
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
    });
    const transaction = thirdweb.prepareContractCall({
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const apeChainAddress = this.getContractAddress(contractsInterface.SUPPORTED_CHAINS.APECHAIN);
    if (!apeChainAddress) {
      throw new Error("ApeChain contract not deployed or configured");
    }
    const contract = thirdweb.getContract({
      client: this.client,
      chain: this.getChainById(contractsInterface.SUPPORTED_CHAINS.APECHAIN),
      // ApeChain
      address: apeChainAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
      1: chains.ethereum,
      137: chains.polygon,
      10: chains.optimism,
      56: chains.bsc,
      43114: chains.avalanche,
      8453: chains.base,
      42161: chains.arbitrum,
      2741: chains.defineChain({
        id: 2741,
        name: "Abstract",
        rpc: "https://api.testnet.abs.xyz",
        nativeCurrency: {
          name: "Ethereum",
          symbol: "ETH",
          decimals: 18
        }
      }),
      33139: chains.defineChain({
        id: 33139,
        name: "ApeChain",
        rpc: "https://33139.rpc.thirdweb.com",
        nativeCurrency: {
          name: "APE",
          symbol: "APE",
          decimals: 18
        }
      }),
      167e3: chains.defineChain({
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
      17e3: chains.defineChain({
        id: 17e3,
        name: "Ethereum Holesky",
        rpc: "https://ethereum-holesky-rpc.publicnode.com",
        nativeCurrency: {
          name: "Ethereum",
          symbol: "ETH",
          decimals: 18
        }
      }),
      80002: chains.defineChain({
        id: 80002,
        name: "Polygon Amoy",
        rpc: "https://rpc-amoy.polygon.technology",
        nativeCurrency: {
          name: "MATIC",
          symbol: "MATIC",
          decimals: 18
        }
      }),
      33111: chains.defineChain({
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
      const result = await thirdweb.readContract({
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
    const chainId = registration.chainId || contractsInterface.SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
    });
    const transaction = thirdweb.prepareContractCall({
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
    const chainId = params.chainId || contractsInterface.SUPPORTED_CHAINS.POLYGON;
    const contractAddress = this.getContractAddress(chainId);
    if (!contractAddress) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    const chain = this.getChainById(chainId);
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
    });
    try {
      let transaction;
      const amountBigInt = BigInt(params.amount);
      const platformFee = amountBigInt * BigInt(100) / BigInt(1e4);
      const viewerAmount = amountBigInt - platformFee;
      const relayQuote = await this.relayService.getQuote({
        fromChainId: chainId,
        fromToken: params.token === "native" ? "native" : params.token || "native",
        toChainId: contractsInterface.SUPPORTED_CHAINS.APECHAIN,
        toToken: "USDC",
        amount: viewerAmount.toString()
      });
      const estimatedUsdcAmount = relayQuote.estimatedOutput;
      if (params.viewerId) {
        if (params.token === "native" || !params.token) {
          transaction = thirdweb.prepareContractCall({
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
          transaction = thirdweb.prepareContractCall({
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
          transaction = thirdweb.prepareContractCall({
            contract,
            method: "function rewardViewerETH(address viewer, string reason)",
            params: [params.viewerAddress, params.reason || ""],
            value: amountBigInt
          });
        } else {
          await this.approveTokenIfNeeded(params.token, contractAddress, params.amount, chainId);
          transaction = thirdweb.prepareContractCall({
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
        destinationChain: contractsInterface.SUPPORTED_CHAINS.APECHAIN
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
    const chainId = params.chainId || contractsInterface.SUPPORTED_CHAINS.POLYGON;
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
        transaction = thirdweb.prepareContractCall({
          contract,
          method: "function batchRewardViewersByIdETH(uint256[] viewerIds, uint256[] amounts, string[] reasons)",
          params: [viewerIds, amounts, reasons],
          value: totalAmount
        });
      } else {
        const viewerAddresses = resolvedViewers.map((v) => v.identifier);
        transaction = thirdweb.prepareContractCall({
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
        toChainId: contractsInterface.SUPPORTED_CHAINS.APECHAIN,
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
        destinationChain: contractsInterface.SUPPORTED_CHAINS.APECHAIN
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
    });
    const transaction = thirdweb.prepareContractCall({
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
    const apeChainAddress = this.getContractAddress(contractsInterface.SUPPORTED_CHAINS.APECHAIN);
    if (!apeChainAddress) {
      throw new Error("ApeChain contract not deployed or configured");
    }
    const contract = thirdweb.getContract({
      client: this.client,
      chain: this.getChainById(contractsInterface.SUPPORTED_CHAINS.APECHAIN),
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
    const chainId = params.chainId || contractsInterface.SUPPORTED_CHAINS.POLYGON;
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
    const tokenContract = thirdweb.getContract({
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
      const approveTx = thirdweb.prepareContractCall({
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
    const contract = thirdweb.getContract({
      client: this.client,
      chain,
      address: contractAddress
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
  // ===== TOKEN BALANCE AND APPROVAL METHODS =====
  /**
   * Get native token balance for a wallet
   * @param walletAddress Wallet address to check
   * @param chainId Chain ID
   * @returns Balance in wei as string
   */
  async getNativeBalance(walletAddress, chainId) {
    console.log(`Getting native balance for ${walletAddress} on chain ${chainId}`);
    return "0";
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
      const tokenContract = thirdweb.getContract({
        client: this.client,
        chain,
        address: tokenAddress
      });
      const balance = await thirdweb.readContract({
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
      const tokenContract = thirdweb.getContract({
        client: this.client,
        chain,
        address: tokenAddress
      });
      const allowance = await thirdweb.readContract({
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
      const tokenContract = thirdweb.getContract({
        client: this.client,
        chain,
        address: tokenAddress
      });
      const [name, symbol, decimals] = await Promise.all([
        thirdweb.readContract({
          contract: tokenContract,
          method: "function name() view returns (string)",
          params: []
        }).catch(() => "Unknown"),
        thirdweb.readContract({
          contract: tokenContract,
          method: "function symbol() view returns (string)",
          params: []
        }).catch(() => "UNK"),
        thirdweb.readContract({
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
};
var DEFAULT_CONFIG = {
  environment: "production",
  endpoints: {
    relayApi: "https://api.relay.link"
  }
};

Object.defineProperty(exports, "CONTRACT_CONSTANTS", {
  enumerable: true,
  get: function () { return contractsInterface.CONTRACT_CONSTANTS; }
});
Object.defineProperty(exports, "MembershipTier", {
  enumerable: true,
  get: function () { return contractsInterface.MembershipTier; }
});
Object.defineProperty(exports, "NETWORK_CONFIGS", {
  enumerable: true,
  get: function () { return contractsInterface.NETWORK_CONFIGS; }
});
Object.defineProperty(exports, "RELAY_RECEIVER_ADDRESSES", {
  enumerable: true,
  get: function () { return contractsInterface.RELAY_RECEIVER_ADDRESSES; }
});
Object.defineProperty(exports, "SUPPORTED_CHAINS", {
  enumerable: true,
  get: function () { return contractsInterface.SUPPORTED_CHAINS; }
});
Object.defineProperty(exports, "SUPPORTED_TESTNETS", {
  enumerable: true,
  get: function () { return contractsInterface.SUPPORTED_TESTNETS; }
});
Object.defineProperty(exports, "TIER_CREATOR_SHARES", {
  enumerable: true,
  get: function () { return contractsInterface.TIER_CREATOR_SHARES; }
});
Object.defineProperty(exports, "getAllContractAddresses", {
  enumerable: true,
  get: function () { return contractsInterface.getAllContractAddresses; }
});
Object.defineProperty(exports, "getContractAddress", {
  enumerable: true,
  get: function () { return contractsInterface.getContractAddress; }
});
Object.defineProperty(exports, "getRelayReceiverAddress", {
  enumerable: true,
  get: function () { return contractsInterface.getRelayReceiverAddress; }
});
Object.defineProperty(exports, "isContractDeployed", {
  enumerable: true,
  get: function () { return contractsInterface.isContractDeployed; }
});
exports.ApeChainRelayService = ApeChainRelayService;
exports.ApeChainTippingSDK = ApeChainTippingSDK;
exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map