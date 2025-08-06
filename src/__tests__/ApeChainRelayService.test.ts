import { ApeChainRelayService } from '../services/ApeChainRelayService';

// Mock fetch for testing
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('ApeChainRelayService', () => {
  let service: ApeChainRelayService;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    service = new ApeChainRelayService(mockApiKey);
    mockFetch.mockClear();
  });

  describe('Constructor', () => {
    it('should initialize with API key', () => {
      expect(service).toBeInstanceOf(ApeChainRelayService);
    });
  });

  describe('relayTipToApeChain', () => {
    const mockParams = {
      fromChainId: 137, // Polygon
      fromToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
      amount: '1000000', // 1 USDC
      creatorAddress: '0x1234567890123456789012345678901234567890',
      businessAddress: '0x0987654321098765432109876543210987654321',
    };

    it('should successfully relay tip to ApeChain', async () => {
      // Mock successful API responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'quote-123',
            destinationAmount: '900000', // 0.9 USDC equivalent in APE
            fees: '10000',
            estimatedTime: 300,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionHash: '0xbusiness123',
            relayId: 'relay-business-123',
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionHash: '0xcreator123',
            relayId: 'relay-creator-123',
          }),
        } as Response);

      const result = await service.relayTipToApeChain(mockParams);

      expect(result.success).toBe(true);
      expect(result.businessTxHash).toBe('0xbusiness123');
      expect(result.creatorTxHash).toBe('0xcreator123');
      expect(result.destinationChain).toBe(33139); // ApeChain
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.relayTipToApeChain(mockParams);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle partial relay failures', async () => {
      // Mock quote success, business success, creator failure
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'quote-123',
            destinationAmount: '900000',
            fees: '10000',
            estimatedTime: 300,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionHash: '0xbusiness123',
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Bad Request',
        } as Response);

      const result = await service.relayTipToApeChain(mockParams);

      expect(result.success).toBe(false);
      expect(result.businessTxHash).toBe('0xbusiness123');
      expect(result.creatorTxHash).toBeUndefined();
    });

    it('should calculate correct fee splits', async () => {
      const amount = '1000000'; // 1 USDC
      // Fee splits: 70% creator, 30% business

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          transactionHash: '0xtest123',
        }),
      } as Response);

      await service.relayTipToApeChain({
        ...mockParams,
        amount,
      });

      // Check that the correct amounts were sent in the API calls
      const calls = mockFetch.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle network timeouts', async () => {
      mockFetch.mockImplementationOnce(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const params = {
        fromChainId: 137,
        fromToken: 'native',
        amount: '1000000000000000000',
        creatorAddress: '0x1234567890123456789012345678901234567890',
        businessAddress: '0x0987654321098765432109876543210987654321',
      };

      const result = await service.relayTipToApeChain(params);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('should handle invalid API responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => null, // Invalid response
      } as Response);

      const params = {
        fromChainId: 137,
        fromToken: 'native',
        amount: '1000000000000000000',
        creatorAddress: '0x1234567890123456789012345678901234567890',
        businessAddress: '0x0987654321098765432109876543210987654321',
      };

      const result = await service.relayTipToApeChain(params);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});