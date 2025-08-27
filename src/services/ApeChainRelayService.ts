// packages/sdk/src/services/ApeChainRelayService.ts
import { SUPPORTED_CHAINS, CONTRACT_CONSTANTS } from '@tippingchain/contracts-interface';

export interface RelayQuote {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string | null;
  amount: string;
  estimatedOutput: string;
  fees: string;
  estimatedTime: number; // in seconds
  route?: unknown; // Optional route information
}

export interface RelayResult {
  success: boolean;
  relayId?: string;
  destinationChain: number;
  estimatedUsdcAmount?: string;
  error?: string;
}

export interface QuoteRequestParams {
  fromChainId: number;
  fromToken: string;
  toChainId: number;
  toToken: string;
  amount: string;
  user?: string; // User's wallet address (optional for fallback)
  recipient?: string; // Recipient address for the funds
}

export class ApeChainRelayService {
  private readonly APECHAIN_ID = SUPPORTED_CHAINS.APECHAIN;
  private readonly BASE_SEPOLIA_ID = 84532; // Base Sepolia for testnet
  private readonly USDC_TOKEN_ADDRESS = CONTRACT_CONSTANTS.APECHAIN_USDC;
  private readonly BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia USDC
  private readonly baseUrl: string;
  private readonly isTestnet: boolean;

  constructor(isTestnet: boolean = true) {
    // Note: API calls disabled due to 400 Bad Request errors
    // The actual relay is handled automatically by StreamingPlatformTipping contracts
    // via integrated Relay.link functionality (see CLAUDE.md for details)
    this.baseUrl = isTestnet ? 'https://api.testnets.relay.link' : 'https://api.relay.link';
    this.isTestnet = isTestnet;
  }

  /**
   * Get a quote for relaying tokens to ApeChain
   * Makes actual API call to Relay.link for accurate pricing
   */
  async getQuote(params: QuoteRequestParams): Promise<RelayQuote> {
    try {
      // Use Base Sepolia for testnet, ApeChain for mainnet
      const destinationChainId = this.isTestnet ? this.BASE_SEPOLIA_ID : this.APECHAIN_ID;
      const destinationToken = this.isTestnet ? this.BASE_SEPOLIA_USDC : this.USDC_TOKEN_ADDRESS;
      
      // Normalize token addresses for API (native -> zero address)
      const normalizeTokenForAPI = (token: string) => {
        return token === 'native' ? '0x0000000000000000000000000000000000000000' : token;
      };
      
      // Prepare the API request payload
      const quoteRequest = {
        user: params.user || '0x0000000000000000000000000000000000000000',
        recipient: params.recipient, // Optional recipient address
        originChainId: params.fromChainId,
        destinationChainId: destinationChainId,
        originCurrency: normalizeTokenForAPI(params.fromToken),
        destinationCurrency: normalizeTokenForAPI(destinationToken),
        amount: params.amount,
        tradeType: 'EXACT_INPUT'
      };

      // Make the API call
      const response = await this.makeRequest('POST', '/quote', quoteRequest);
      
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid API response format');
      }

      const apiResponse = response as any;

      // Transform the API response to our interface
      return {
        id: apiResponse.id || `quote-${Date.now()}`,
        fromChainId: params.fromChainId,
        toChainId: destinationChainId,
        fromToken: params.fromToken,
        toToken: destinationToken,
        amount: params.amount,
        estimatedOutput: apiResponse.destinationAmount || apiResponse.outputAmount || '0',
        fees: apiResponse.fees?.toString() || apiResponse.fee?.toString() || '0',
        estimatedTime: apiResponse.estimatedTime || apiResponse.duration || 300,
        route: apiResponse.route || apiResponse.steps || { source: 'Relay.link API' },
      };
    } catch (error) {
      console.warn('Relay.link API call failed, falling back to estimates:', error);
      
      // Use Base Sepolia for testnet, ApeChain for mainnet (same logic as above)
      const destinationChainId = this.isTestnet ? this.BASE_SEPOLIA_ID : this.APECHAIN_ID;
      const destinationToken = this.isTestnet ? this.BASE_SEPOLIA_USDC : this.USDC_TOKEN_ADDRESS;
      
      // Fallback to mock estimates if API fails
      const amountBigInt = BigInt(params.amount);
      const estimatedOutput = ((amountBigInt * BigInt(95)) / BigInt(100)).toString();
      
      return {
        id: `fallback-quote-${Date.now()}`,
        fromChainId: params.fromChainId,
        toChainId: destinationChainId,
        fromToken: params.fromToken,
        toToken: destinationToken,
        amount: params.amount,
        estimatedOutput: estimatedOutput,
        fees: ((amountBigInt * BigInt(5)) / BigInt(100)).toString(),
        estimatedTime: 300,
        route: { note: 'Fallback estimate (API unavailable)' },
      };
    }
  }

  /**
   * Estimate USDC output for a tip (deprecated - contracts handle relay automatically)
   * @deprecated Use getQuote directly instead
   */
  async relayTipToApeChain(params: {
    fromChainId: number;
    fromToken: string;
    amount: string;
    creatorAddress: string;
    userAddress?: string; // User's wallet address (optional for fallback)
    targetToken?: string;
  }): Promise<RelayResult> {
    try {
      // Use Base Sepolia for testnet, ApeChain for mainnet
      const destinationChainId = this.isTestnet ? this.BASE_SEPOLIA_ID : this.APECHAIN_ID;
      const destinationToken = this.isTestnet ? this.BASE_SEPOLIA_USDC : this.USDC_TOKEN_ADDRESS;
      
      const quote = await this.getQuote({
        fromChainId: params.fromChainId,
        fromToken: params.fromToken,
        toChainId: destinationChainId,
        toToken: destinationToken,
        amount: params.amount,
        user: params.userAddress,
        recipient: params.creatorAddress, // Pass creator address as recipient
      });

      return {
        success: true,
        relayId: quote.id,
        destinationChain: destinationChainId,
        estimatedUsdcAmount: quote.estimatedOutput,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        destinationChain: this.isTestnet ? this.BASE_SEPOLIA_ID : this.APECHAIN_ID,
      };
    }
  }

  private async makeRequest(method: string, endpoint: string, data?: unknown): Promise<unknown> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'TippingChain-SDK/2.0.0',
        },
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
      }

      console.log(`Making ${method} request to ${url}`);
      console.log('Request payload:', data);

      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error ${response.status}:`, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}. Response: ${errorText}`);
      }

      const responseData = await response.json();
      console.log('API Response:', responseData);
      return responseData;
    } catch (error) {
      console.error('Request failed:', error);
      throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}