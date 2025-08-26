const { ApeChainTippingSDK } = require('./dist/index.cjs');

async function testSDK() {
  console.log('=== SDK FUNCTION TESTING WITH TESTNET CHAINS ===');
  console.log('');

  // Initialize SDK for testnet
  const sdk = new ApeChainTippingSDK({
    clientId: 'test-client-id-12345', 
    environment: 'development',
    useTestnet: true
  });

  console.log('Testing SDK utility functions...');

  // Test price estimation (should work with new testnet chains)
  try {
    const arbSepoliaEstimate = await sdk.estimateUsdValue(421614, '1000000000000000000'); // 1 ETH in wei
    console.log(`✅ Arbitrum Sepolia price estimation: $${arbSepoliaEstimate} USD`);
  } catch (error) {
    console.log(`❌ Arbitrum Sepolia price estimation failed: ${error.message}`);
  }

  try {
    const baseSepoliaEstimate = await sdk.estimateUsdValue(84532, '1000000000000000000'); // 1 ETH in wei  
    console.log(`✅ Base Sepolia price estimation: $${baseSepoliaEstimate} USD`);
  } catch (error) {
    console.log(`❌ Base Sepolia price estimation failed: ${error.message}`);
  }

  console.log('');

  // Test getting contract address for supported chains
  try {
    const arbContract = sdk.getStreamingPlatformAddress(421614);
    console.log(`✅ Arbitrum Sepolia contract: ${arbContract}`);
  } catch (error) {
    console.log(`❌ Arbitrum Sepolia contract lookup failed: ${error.message}`);
  }

  try {
    const baseContract = sdk.getStreamingPlatformAddress(84532);
    console.log(`✅ Base Sepolia contract: ${baseContract}`);
  } catch (error) {
    console.log(`❌ Base Sepolia contract lookup failed: ${error.message}`);
  }

  console.log('');
  console.log('=== SDK TESTNET VERIFICATION COMPLETE ===');
}

testSDK().catch(console.error);
