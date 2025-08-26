# @tippingchain/sdk

TypeScript SDK for TippingChain v2.6 - a unified multi-chain tipping platform with integrated Relay.link bridging, creator registry, and viewer rewards. Enable users to tip content creators using creator IDs from 9 source chains with automatic USDC payouts on ApeChain.

## Version 2.6 Updates

- ✨ **Updated Testnet Support**: Complete migration from deprecated Holesky/Curtis to active Arbitrum Sepolia (421614) and Base Sepolia (84532)
- 🌐 **Enhanced Chain Definitions**: Updated all chain configurations with current testnet networks and proper RPC endpoints
- 🔧 **Improved Contract Integration**: Enhanced thirdweb SDK integration with full function signature resolution for contract methods
- 📊 **Updated Fee Calculations**: Accurate 5% platform fee for tips, 1% for viewer rewards with tier-based creator splits
- 🧪 **Production-Ready Testnet**: Full end-to-end cross-chain testing flow with real Relay.link bridging Arbitrum Sepolia → Base Sepolia
- 📦 **Package Alignment**: Compatible with @tippingchain/contracts-interface v1.6.0 and ui-react v2.6.0
- 🔗 **Enhanced Relay Service**: Improved ApeChainRelayService with testnet API support and better error handling
- 💰 **Updated Token Support**: Current testnet token addresses and configurations for USDC on supported chains
- 🔒 **Improved Type Safety**: Better TypeScript integration with thirdweb v5 and enhanced method resolution
- 🎯 **Enhanced Error Handling**: Better error messages and debugging support for testnet development

## Features

- 🌐 **Multi-chain support**: 9 source chains (ETH, MATIC, OP, BSC, Abstract, AVAX, Base, Arbitrum, Taiko) → ApeChain
- 🔄 **Integrated bridging**: Built-in Relay.link functionality in smart contracts (no SDK relay needed)
- 💰 **Dual fee structure**: 5% for creator tips, 1% for viewer rewards
- 💵 **USDC Payouts**: All tips and rewards converted to stable USDC on ApeChain
- 🆔 **Creator Registry**: Simple creator ID system with wallet recovery
- 🎁 **Viewer Rewards**: Creators can reward audience members with batch support
- 🔑 **Thirdweb Integration**: Full support for thirdweb account IDs and smart accounts
- 🚀 **Easy integration**: Simple TypeScript SDK with React support
- 🔒 **Type-safe**: Full TypeScript support with comprehensive types

## Installation

```bash
npm install @tippingchain/sdk thirdweb
```

## Quick Start

### 1. Initialize the SDK

```typescript
import { ApeChainTippingSDK, SUPPORTED_CHAINS, SUPPORTED_TESTNETS } from '@tippingchain/sdk';

// Production/Mainnet
const sdk = new ApeChainTippingSDK({
  clientId: 'your-thirdweb-client-id',
  environment: 'production',
  // Contract addresses are automatically loaded from @tippingchain/contracts-interface
  // Only specify streamingPlatformAddresses if using custom deployments
});

// Testnet
const testnetSdk = new ApeChainTippingSDK({
  clientId: 'your-thirdweb-client-id',
  environment: 'development',
  useTestnet: true // Uses Arbitrum Sepolia (421614) and Base Sepolia (84532) for cross-chain testing
});
```

### 2. Add a Creator (Platform Admin or Designated Admin)

```typescript
// Register a new creator on all chains and get their ID (requires admin permissions)
const creatorId = await sdk.addCreator({
  creatorWallet: '0x1234567890123456789012345678901234567890',
  tier: 0, // TIER_1 (60/40 split)
  // chainId is optional - if not specified, registers on all deployed chains
});

console.log(`Creator registered with ID: ${creatorId}`);

// Register with thirdweb account ID
const creatorId = await sdk.addCreator({
  creatorWallet: '0x1234567890123456789012345678901234567890',
  thirdwebId: 'user_abcdef123456',
  tier: 0
});

// Or register on a specific chain only
const creatorId = await sdk.addCreator({
  creatorWallet: '0x1234567890123456789012345678901234567890',
  tier: 0,
  chainId: SUPPORTED_CHAINS.POLYGON // Only register on Polygon
});
```

### 3. Send a Tip

```typescript
// Send native token tip using creator ID (testnet example)
const result = await sdk.sendTip({
  sourceChainId: 421614, // Arbitrum Sepolia testnet
  creatorId: 1, // Use creator ID instead of wallet address
  token: 'native',
  amount: '10000000000000000', // 0.01 ETH in wei (testnet amount)
});

if (result.success) {
  console.log(`🎉 Tip sent! TX: ${result.sourceTransactionHash}`);
  console.log(`   Creator ID: ${result.creatorId}`);
  console.log(`   Estimated USDC: ${result.estimatedUsdcAmount}`);
}
```

### 4. Creator Management

```typescript
// Get creator info by ID (testnet example)
const creator = await sdk.getCreator(1, 421614); // Arbitrum Sepolia
console.log(`Creator: ${creator.wallet}, Tips: ${creator.totalTips}`);

// Find creator by wallet address
const creator2 = await sdk.getCreatorByWallet('0x479945d7931baC3343967bD0f839f8691E54a66e', 421614);

// Update creator wallet (for lost wallet recovery) - requires admin permissions
await sdk.updateCreatorWallet(1, '0xNewWalletAddress', 421614);

// Admin management functions (contract owner only) - testnet examples
await sdk.grantAdmin('0x29aE0362FcF55cc646fD83B6E0DeB433FF7e019b', 421614); // Testnet admin
await sdk.revokeAdmin('0xAdminWalletAddress', 421614);
const isAdmin = await sdk.isAdmin('0x29aE0362FcF55cc646fD83B6E0DeB433FF7e019b', 421614);

// Get platform statistics
const stats = await sdk.getPlatformStats(421614); // Arbitrum Sepolia
console.log(`Active Creators: ${stats.activeCreators}`);
console.log(`Total Tips: ${stats.totalTips}`);

// Get top creators leaderboard
const topCreators = await sdk.getTopCreators(10, 421614);
```

### 5. Viewer Rewards

```typescript
// Send a reward to a viewer (creators only) - testnet example
const rewardResult = await sdk.rewardViewer({
  viewerAddress: '0x65dF34504D2a5D96f4478544D5279B12b3fbEA87', // Test tipper wallet
  amount: '10000000000000000', // 0.01 ETH in wei (testnet amount)
  reason: 'Great question during the stream!',
  token: 'native',
  chainId: 421614 // Arbitrum Sepolia testnet
});

if (rewardResult.success) {
  console.log(`🎁 Reward sent! TX: ${rewardResult.transactionHash}`);
  console.log(`   Viewer receives: ${rewardResult.viewerAmount}`);
  console.log(`   Platform fee (1%): ${rewardResult.platformFee}`);
  console.log(`   Estimated USDC on ApeChain: ${rewardResult.estimatedUsdcAmount}`);
}

// Reward using viewer ID (for registered viewers)
const rewardByIdResult = await sdk.rewardViewer({
  viewerId: 123, // Use viewer ID instead of address
  amount: '100000000000000000',
  reason: 'Active participant!'
});

// Reward using thirdweb ID
const rewardByThirdwebId = await sdk.rewardViewer({
  thirdwebId: 'user_xyz789', // Thirdweb account ID
  amount: '100000000000000000',
  reason: 'Great contribution!'
});

// Batch reward multiple viewers (gas efficient) - testnet example
const batchResult = await sdk.batchRewardViewers({
  viewers: [
    { address: '0x65dF34504D2a5D96f4478544D5279B12b3fbEA87', amount: '5000000000000000', reason: 'Active participant' },
    { address: '0x29aE0362FcF55cc646fD83B6E0DeB433FF7e019b', amount: '10000000000000000', reason: 'Best question' },
    { address: '0x479945d7931baC3343967bD0f839f8691E54a66e', amount: '7500000000000000', reason: 'Helpful feedback' }
  ],
  chainId: 421614 // Arbitrum Sepolia testnet
});

// Check viewer reward stats
const stats = await sdk.getViewerRewardStats('0x65dF34504D2a5D96f4478544D5279B12b3fbEA87', 421614);
console.log(`Total rewards given: ${stats.totalRewardsGiven}`);
console.log(`Total rewards received: ${stats.totalRewardsReceived}`);
console.log(`Number of rewards sent: ${stats.rewardCount}`);

// Check if viewer rewards are enabled
const enabled = await sdk.areViewerRewardsEnabled(421614); // Arbitrum Sepolia
console.log(`Viewer rewards enabled: ${enabled}`);

// Enable or disable viewer rewards (admin only)
await sdk.setViewerRewardsEnabled(true, 421614);

// Check viewer's USDC balance on Base Sepolia (testnet destination)
const usdcBalance = await sdk.getViewerUsdcBalanceOnApeChain('0x65dF34504D2a5D96f4478544D5279B12b3fbEA87');
console.log(`USDC Balance on Base Sepolia: ${(parseFloat(usdcBalance) / 1e6).toFixed(2)} USDC`);
```

### 6. Token Balance and Approval Methods

```typescript
// Get native token balance for a wallet (testnet example)
const balance = await sdk.getNativeBalance('0x65dF34504D2a5D96f4478544D5279B12b3fbEA87', 421614);
console.log(`Balance: ${(parseFloat(balance) / 1e18).toFixed(4)} ETH`);

// Get ERC20 token balance (testnet USDC)
const tokenBalance = await sdk.getTokenBalance(
  '0x65dF34504D2a5D96f4478544D5279B12b3fbEA87', // test wallet address
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC on Arbitrum Sepolia
  421614 // Arbitrum Sepolia
);
console.log(`USDC Balance: ${(parseFloat(tokenBalance) / 1e6).toFixed(2)} USDC`);

// Get multiple token balances at once
const balances = await sdk.getMultipleTokenBalances(
  '0x65dF34504D2a5D96f4478544D5279B12b3fbEA87', 
  ['native', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'], // Native + USDC on Arbitrum Sepolia
  421614
);
console.log(`Balances:`, balances);

// Check if token approval is needed (testnet example)
const needsApproval = await sdk.needsApproval(
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC on Arbitrum Sepolia
  '0x65dF34504D2a5D96f4478544D5279B12b3fbEA87',
  '0x2b50C16877a3E262e0D5B9a4B9f7517634Ba27d8', // TippingChain contract
  '1000000', // 1 USDC in smallest units
  421614 // Arbitrum Sepolia
);

// Approve token spending
const approval = await sdk.approveToken(
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC on Arbitrum Sepolia
  '0x2b50C16877a3E262e0D5B9a4B9f7517634Ba27d8', // TippingChain contract
  '1000000', // 1 USDC
  421614
);

// Approve unlimited token spending
const maxApproval = await sdk.approveTokenMax(
  '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC on Arbitrum Sepolia
  '0x2b50C16877a3E262e0D5B9a4B9f7517634Ba27d8', // TippingChain contract
  421614
);
```

### 7. Advanced Admin and Relay Management (NEW!)

```typescript
// Add an authorized relayer for cross-chain operations (admin only) - testnet example
await sdk.addAuthorizedRelayer('0x29aE0362FcF55cc646fD83B6E0DeB433FF7e019b', 421614);

// Remove an authorized relayer (admin only)
await sdk.removeAuthorizedRelayer('0xRelayerAddress', 421614);

// Manually relay pending ETH to Base Sepolia (admin only)
await sdk.manualRelayETH(421614); // Arbitrum Sepolia

// Manually relay pending token to Base Sepolia (admin only)
await sdk.manualRelayToken('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', 421614); // USDC

// Set auto-relay mode for cross-chain operations (admin only)
await sdk.setAutoRelay(true, 421614);
```

### 8. Contract State Management (NEW!)

```typescript
// Pause contract operations (admin only) - testnet example
await sdk.pause(421614); // Arbitrum Sepolia

// Unpause contract operations (admin only)
await sdk.unpause(421614);

// Perform an emergency withdrawal of funds (admin only)
await sdk.emergencyWithdraw(421614);
```

### 9. Advanced Stats and Queries (NEW!)

```typescript
// Get Base Sepolia-specific statistics (testnet destination)
const destStats = await sdk.getApeChainStats(84532); // Base Sepolia
console.log(`Total USDC on Base Sepolia: ${destStats.totalUsdc}`);
console.log(`Total from Chain: ${destStats.totalFromChain}`);

// Get all active creators with pagination (testnet example)
const activeCreators = await sdk.getAllActiveCreators(0, 10, 421614); // Arbitrum Sepolia
console.log(`Total Active Creators: ${activeCreators.totalActive}`);
console.log(`Creator IDs: ${activeCreators.creatorIds}`);
console.log(`Wallets: ${activeCreators.wallets}`);
console.log(`Tip Amounts: ${activeCreators.tipAmounts}`);

// Get information for multiple creators by IDs
const creatorsInfo = await sdk.getCreatorsByIds([1], 421614); // Creator #1 on testnet
console.log(`Tip Amounts: ${creatorsInfo.tipAmounts}`);
console.log(`Wallets: ${creatorsInfo.wallets}`);
console.log(`Active Status: ${creatorsInfo.activeStatus}`);
```

## Supported Chains

### Mainnet Chains
| Chain | Chain ID | Native Token | Type |
|-------|----------|--------------|------|
| Ethereum | 1 | ETH | Source |
| Polygon | 137 | MATIC | Source |
| Optimism | 10 | ETH | Source |
| BSC | 56 | BNB | Source |
| Abstract | 2741 | ETH | Source |
| Avalanche | 43114 | AVAX | Source |
| Base | 8453 | ETH | Source |
| Arbitrum | 42161 | ETH | Source |
| Taiko | 167000 | ETH | Source |
| **ApeChain** | **33139** | **APE** | **Destination** |

### Testnet Chains

**Active Testnet Configuration:**

| Chain | Chain ID | Native Token | Type | Contract Address |
|-------|----------|--------------|------|-----------------|
| **Arbitrum Sepolia** | **421614** | **ETH** | **Source** | `0x2b50C16877a3E262e0D5B9a4B9f7517634Ba27d8` |
| **Base Sepolia** | **84532** | **ETH** | **Destination** | `0x2b50C16877a3E262e0D5B9a4B9f7517634Ba27d8` |
| Polygon Amoy | 80002 | MATIC | Source (additional) | Available |

**Testnet Network Details:**

**Arbitrum Sepolia:**
- RPC: https://sepolia-rollup.arbitrum.io/rpc
- Explorer: https://sepolia.arbiscan.io
- Faucet: https://faucet.quicknode.com/arbitrum/sepolia
- USDC: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`

**Base Sepolia:**
- RPC: https://sepolia.base.org
- Explorer: https://sepolia.basescan.org
- Faucet: https://faucet.quicknode.com/base/sepolia
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

*Note: Current testnet setup uses Arbitrum Sepolia → Base Sepolia for end-to-end cross-chain testing with real Relay.link bridging.*

## Fee Structure

### Creator Tips
- **Platform Fee**: 5% to TippingChain Treasury
- **Remaining 95%** split based on creator's membership tier:
  - **Tier 1**: 60/40 (creator/business)
  - **Tier 2**: 70/30 (creator/business)
  - **Tier 3**: 80/20 (creator/business)
  - **Tier 4**: 90/10 (creator/business)

### Viewer Rewards
- **Platform Fee**: 1% to TippingChain Treasury
- **Viewer receives**: 99% of reward amount
- All rewards are automatically converted to USDC and sent to ApeChain

## Architecture Overview

### Integrated Relay.link (v2.0+)

TippingChain v2.0+ features **integrated Relay.link functionality** directly in the TippingChain smart contracts:

- ✅ **No separate bridge contracts** needed (50% reduction in complexity)
- ✅ **Automatic cross-chain bridging** on every tip and viewer reward
- ✅ **Direct USDC conversion** and payout to ApeChain
- ✅ **Simplified deployment** - one contract per chain instead of two
- ✅ **Gas efficient** - single transaction handles tip + relay

#### How it works:
1. User sends tip/reward on source chain (e.g., Polygon)
2. Contract automatically deducts platform fee
3. **Built-in relay integration** bridges remaining tokens to ApeChain
4. Tokens are **automatically converted to USDC** on ApeChain
5. Recipients receive stable USDC payouts

## Support

- **Documentation**: See the [docs](../docs) folder for detailed guides
- **Examples**: Check `examples/` for usage patterns
- **Contract Interface**: `@tippingchain/contracts-interface` package

## License

MIT License - see LICENSE file for details.
