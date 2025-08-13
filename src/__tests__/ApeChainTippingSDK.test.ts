import { ApeChainTippingSDK, SUPPORTED_CHAINS } from '../index';

describe('ApeChainTippingSDK', () => {
  let sdk: ApeChainTippingSDK;
  const mockConfig = {
    clientId: 'test-client-id',
    environment: 'development' as const,
    streamingPlatformAddresses: {
      [SUPPORTED_CHAINS.POLYGON]: '0x1234567890123456789012345678901234567890',
      [SUPPORTED_CHAINS.APECHAIN]: '0x0987654321098765432109876543210987654321',
    },
  };

  beforeEach(() => {
    sdk = new ApeChainTippingSDK(mockConfig);
  });

  describe('Constructor', () => {
    it('should initialize correctly', () => {
      expect(sdk).toBeInstanceOf(ApeChainTippingSDK);
    });

    it('should throw error for invalid config', () => {
      expect(() => {
        new ApeChainTippingSDK({
          ...mockConfig,
          clientId: '',
        });
      }).toThrow();
    });
  });

  describe('sendTip', () => {
    const tipParams = {
      sourceChainId: SUPPORTED_CHAINS.POLYGON,
      creatorId: 1,
      token: 'native',
      amount: '1000000000000000000',
    };

    it('should send native token tip successfully', async () => {
      // Mock the getCreator method to return an active creator
      jest.spyOn(sdk, 'getCreator').mockResolvedValue({
        id: 1,
        wallet: '0x1234567890123456789012345678901234567890',
        active: true,
        totalTips: '0',
        tipCount: 0
      });

      const result = await sdk.sendTip(tipParams);
      
      expect(result.success).toBe(true);
      expect(result.sourceTransactionHash).toBeDefined();
      expect(result.relayId).toBeDefined();
      expect(result.creatorId).toBe(1);
      expect(result.estimatedUsdcAmount).toBeDefined();
    });

    it('should send ERC20 token tip successfully', async () => {
      // Mock the getCreator method
      jest.spyOn(sdk, 'getCreator').mockResolvedValue({
        id: 1,
        wallet: '0x1234567890123456789012345678901234567890',
        active: true,
        totalTips: '0',
        tipCount: 0
      });

      const erc20Params = {
        ...tipParams,
        token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
      };

      const result = await sdk.sendTip(erc20Params);
      
      expect(result.success).toBe(true);
      expect(result.sourceTransactionHash).toBeDefined();
    });

    it('should handle unsupported chain', async () => {
      const unsupportedParams = {
        ...tipParams,
        sourceChainId: 999, // Unsupported chain
      };

      const result = await sdk.sendTip(unsupportedParams);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle invalid amount', async () => {
      const invalidParams = {
        ...tipParams,
        amount: '-1',
      };

      const result = await sdk.sendTip(invalidParams);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Creator Management', () => {
    it('should add a new creator', async () => {
      const creatorId = await sdk.addCreator({
        creatorWallet: '0x1234567890123456789012345678901234567890',
        chainId: SUPPORTED_CHAINS.POLYGON
      });

      expect(creatorId).toBeGreaterThan(0);
    });

    it('should get creator by ID', async () => {
      const creator = await sdk.getCreator(1, SUPPORTED_CHAINS.POLYGON);
      
      expect(creator).toHaveProperty('id');
      expect(creator).toHaveProperty('wallet');
      expect(creator).toHaveProperty('active');
      expect(creator).toHaveProperty('totalTips');
      expect(creator).toHaveProperty('tipCount');
    });

    it('should update creator wallet', async () => {
      const success = await sdk.updateCreatorWallet(
        1,
        '0x0987654321098765432109876543210987654321',
        SUPPORTED_CHAINS.POLYGON
      );

      expect(success).toBe(true);
    });
  });

  describe('getCreatorUsdcBalanceOnApeChain', () => {
    it('should return creator USDC balance', async () => {
      const balance = await sdk.getCreatorUsdcBalanceOnApeChain(
        '0x1234567890123456789012345678901234567890'
      );

      expect(typeof balance).toBe('string');
      expect(balance).toMatch(/^\d+$/);
    });

    it('should handle invalid address', async () => {
      await expect(
        sdk.getCreatorUsdcBalanceOnApeChain('invalid-address')
      ).rejects.toThrow();
    });
  });

  describe('Platform Analytics', () => {
    it('should get platform stats', async () => {
      const stats = await sdk.getPlatformStats(SUPPORTED_CHAINS.POLYGON);
      
      expect(stats).toHaveProperty('totalTips');
      expect(stats).toHaveProperty('totalCount');
      expect(stats).toHaveProperty('totalRelayed');
      expect(stats).toHaveProperty('activeCreators');
      expect(stats).toHaveProperty('autoRelayEnabled');
    });

    it('should get top creators', async () => {
      const topCreators = await sdk.getTopCreators(10, SUPPORTED_CHAINS.POLYGON);
      
      expect(Array.isArray(topCreators)).toBe(true);
      expect(topCreators.length).toBeLessThanOrEqual(10);
      
      // Verify sorting
      for (let i = 1; i < topCreators.length; i++) {
        const prevTips = parseFloat(topCreators[i-1].totalTips);
        const currTips = parseFloat(topCreators[i].totalTips);
        expect(prevTips).toBeGreaterThanOrEqual(currTips);
      }
    });
  });
});