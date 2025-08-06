import {
  ApeChainTippingSDK,
  ApeChainRelayService,
  SUPPORTED_CHAINS,
  DEFAULT_CONFIG,
  CHAIN_CONFIGS,
} from '../index';

describe('SDK Exports', () => {
  it('should export main classes', () => {
    expect(ApeChainTippingSDK).toBeDefined();
    expect(ApeChainRelayService).toBeDefined();
  });

  it('should export constants', () => {
    expect(SUPPORTED_CHAINS).toBeDefined();
    expect(DEFAULT_CONFIG).toBeDefined();
    expect(CHAIN_CONFIGS).toBeDefined();
  });

  it('should have correct chain IDs', () => {
    expect(SUPPORTED_CHAINS.ETHEREUM).toBe(1);
    expect(SUPPORTED_CHAINS.POLYGON).toBe(137);
    expect(SUPPORTED_CHAINS.OPTIMISM).toBe(10);
    expect(SUPPORTED_CHAINS.BSC).toBe(56);
    expect(SUPPORTED_CHAINS.APECHAIN).toBe(33139);
  });

  it('should have correct default configuration', () => {
    expect(DEFAULT_CONFIG.environment).toBe('production');
    expect(DEFAULT_CONFIG.feeRates.creator).toBe(7000); // 70%
    expect(DEFAULT_CONFIG.feeRates.business).toBe(3000); // 30%
    expect(DEFAULT_CONFIG.minTipAmount).toBe('1000');
  });

  it('should have chain configurations', () => {
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.ETHEREUM].name).toBe('Ethereum');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.POLYGON].name).toBe('Polygon');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.OPTIMISM].name).toBe('Optimism');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.BSC].name).toBe('BSC');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.APECHAIN].name).toBe('ApeChain');
  });

  it('should have block explorer URLs', () => {
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.ETHEREUM].blockExplorer).toContain('etherscan.io');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.POLYGON].blockExplorer).toContain('polygonscan.com');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.APECHAIN].blockExplorer).toContain('apechain.calderaexplorer.xyz');
  });

  it('should have native currencies', () => {
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.ETHEREUM].nativeCurrency).toBe('ETH');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.POLYGON].nativeCurrency).toBe('MATIC');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.BSC].nativeCurrency).toBe('BNB');
    expect(CHAIN_CONFIGS[SUPPORTED_CHAINS.APECHAIN].nativeCurrency).toBe('APE');
  });
});