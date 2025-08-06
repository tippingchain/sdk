# @tippingchain/sdk

TypeScript SDK for TippingChain v2.0 - a unified multi-chain tipping platform with integrated Relay.link bridging, creator registry, and viewer rewards. Enable users to tip content creators using creator IDs from 9 source chains with automatic USDC payouts on ApeChain.

## Version 2.0 Updates

- ✨ **Integrated Relay.link**: Direct contract integration - no separate bridge contracts needed
- 🧪 **Updated Testnets**: Holesky (Ethereum) and Amoy (Polygon) replace deprecated networks
- 📱 **Enhanced Viewer Rewards**: Full support for batch rewards and viewer registration
- 🔗 **Improved Thirdweb**: Better thirdweb account ID integration throughout
- 🎯 **Simplified Architecture**: 50% reduction in contract complexity with unified design

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
  useTestnet: true // Uses Holesky, Amoy, and Curtis testnet addresses
});
```

### 2. Add a Creator (Platform Admin)

```typescript
// Register a new creator on all chains and get their ID
const creatorId = await sdk.addCreator({
  creatorWallet: '0x1234567890123456789012345678901234567890',
  tier: 0, // TIER_1 (60/40 split)
  // chainId is optional - if not specified, registers on all deployed chains
});

console.log(`Creator registered with ID: ${creatorId}`);

// Register with thirdweb account ID
const creatorId = await sdk.addCreatorWithThirdwebId({
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
// Send native token tip using creator ID
const result = await sdk.sendTip({
  sourceChainId: SUPPORTED_CHAINS.POLYGON,
  creatorId: 1, // Use creator ID instead of wallet address
  token: 'native',
  amount: '1000000000000000000', // 1 MATIC in wei
});

if (result.success) {
  console.log(`🎉 Tip sent! TX: ${result.sourceTransactionHash}`);
  console.log(`   Creator ID: ${result.creatorId}`);
  console.log(`   Estimated USDC: ${result.estimatedUsdcAmount}`);
}
```

### 4. Creator Management

```typescript
// Get creator info by ID
const creator = await sdk.getCreator(1, SUPPORTED_CHAINS.POLYGON);
console.log(`Creator: ${creator.wallet}, Tips: ${creator.totalTips}`);

// Find creator by wallet address
const creator2 = await sdk.getCreatorByWallet('0x...', SUPPORTED_CHAINS.POLYGON);

// Update creator wallet (for lost wallet recovery)
await sdk.updateCreatorWallet(1, '0xNewWalletAddress', SUPPORTED_CHAINS.POLYGON);

// Get platform statistics
const stats = await sdk.getPlatformStats(SUPPORTED_CHAINS.POLYGON);
console.log(`Active Creators: ${stats.activeCreators}`);
console.log(`Total Tips: ${stats.totalTips}`);

// Get top creators leaderboard
const topCreators = await sdk.getTopCreators(10, SUPPORTED_CHAINS.POLYGON);
```

### 5. Viewer Rewards (NEW!)

```typescript
// Send a reward to a viewer (creators only)
const rewardResult = await sdk.rewardViewer({
  viewerAddress: '0x1234567890123456789012345678901234567890',
  amount: '100000000000000000', // 0.1 MATIC in wei
  reason: 'Great question during the stream!',
  token: 'native', // or ERC20 token address
  chainId: SUPPORTED_CHAINS.POLYGON
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
})

// Batch reward multiple viewers (gas efficient)
const batchResult = await sdk.batchRewardViewers({
  viewers: [
    { address: '0x...', amount: '50000000000000000', reason: 'Active participant' },
    { address: '0x...', amount: '100000000000000000', reason: 'Best question' },
    { address: '0x...', amount: '75000000000000000', reason: 'Helpful feedback' }
  ],
  chainId: SUPPORTED_CHAINS.POLYGON
});

// Check viewer reward stats
const stats = await sdk.getViewerRewardStats('0x...', SUPPORTED_CHAINS.POLYGON);
console.log(`Total rewards given: ${stats.totalRewardsGiven}`);
console.log(`Total rewards received: ${stats.totalRewardsReceived}`);
console.log(`Number of rewards sent: ${stats.rewardCount}`);

// Check if viewer rewards are enabled
const enabled = await sdk.areViewerRewardsEnabled(SUPPORTED_CHAINS.POLYGON);
console.log(`Viewer rewards enabled: ${enabled}`);

// Check viewer's USDC balance on ApeChain
const usdcBalance = await sdk.getViewerUsdcBalanceOnApeChain('0x...');
console.log(`USDC Balance on ApeChain: ${(parseFloat(usdcBalance) / 1e6).toFixed(2)} USDC`);
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
| Chain | Chain ID | Native Token | Type |
|-------|----------|--------------|------|
| Ethereum Holesky | 17000 | ETH | Source |
| Polygon Amoy | 80002 | MATIC | Source |
| **ApeChain Curtis** | **33111** | **APE** | **Destination** |

*Note: Testnet support replaces deprecated Sepolia (11155111) and Mumbai (80001) networks.*

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

### Integrated Relay.link (v2.0)

TippingChain v2.0 features **integrated Relay.link functionality** directly in the TippingChain smart contracts:

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