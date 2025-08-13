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
}

export class ApeChainRelayService {
  private readonly APECHAIN_ID = SUPPORTED_CHAINS.APECHAIN;
  private readonly USDC_TOKEN_ADDRESS = CONTRACT_CONSTANTS.APECHAIN_USDC;
  private readonly baseUrl: string = 'https://api.relay.link';

  /**
   * Get a quote for relaying tokens to ApeChain (for estimation purposes)
   * Note: The actual relay is now handled by the integrated contract
   */
  async getQuote(params: QuoteRequestParams): Promise<RelayQuote> {
    try {
      const response = await this.makeRequest('POST', '/quote', {
        originChainId: params.fromChainId,
        destinationChainId: params.toChainId,
        originCurrency: params.fromToken === 'native' ? '0x0000000000000000000000000000000000000000' : params.fromToken,
        destinationCurrency: params.toToken,
        amount: params.amount,
      });

      return {
        id: (response as any).id || '',
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amount: params.amount,
        estimatedOutput: (response as any).destinationAmount || '0',
        fees: (response as any).fees || '0',
        estimatedTime: (response as any).estimatedTime || 300, // 5 minutes default
        route: (response as any).route,
      };
    } catch (error) {
      throw new Error(`Failed to get relay quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    targetToken?: string;
  }): Promise<RelayResult> {
    try {
      const quote = await this.getQuote({
        fromChainId: params.fromChainId,
        fromToken: params.fromToken,
        toChainId: this.APECHAIN_ID,
        toToken: this.USDC_TOKEN_ADDRESS,
        amount: params.amount,
      });

      return {
        success: true,
        relayId: quote.id,
        destinationChain: this.APECHAIN_ID,
        estimatedUsdcAmount: quote.estimatedOutput,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        destinationChain: this.APECHAIN_ID,
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
        },
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}