// Token balance and approval related types

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
}

export interface TokenBalance {
  tokenAddress: string;
  balance: string;
  symbol: string;
  decimals: number;
}

export interface ApprovalStatus {
  isApproved: boolean;
  currentAllowance: string;
  requiredAmount: string;
}

export interface ApprovalResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

export interface MultiTokenBalanceResponse {
  [tokenAddress: string]: string;
}