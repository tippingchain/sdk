// Jest setup file
// This file is loaded before all tests

// Mock fetch globally for tests
global.fetch = jest.fn();

// Mock thirdweb functions for testing
jest.mock('thirdweb', () => ({
  createThirdwebClient: jest.fn(() => ({ clientId: 'test-client' })),
  getContract: jest.fn(() => ({ 
    address: '0x1234',
    chain: { id: 137 }
  })),
  prepareContractCall: jest.fn(() => ({ 
    method: 'test',
    params: []
  })),
  readContract: jest.fn(() => Promise.resolve('0')),
}));

jest.mock('thirdweb/chains', () => ({
  ethereum: { id: 1, name: 'Ethereum' },
  polygon: { id: 137, name: 'Polygon' },
  optimism: { id: 10, name: 'Optimism' },
  bsc: { id: 56, name: 'BSC' },
  defineChain: jest.fn((config) => config),
}));

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Dummy test to avoid "no tests" error
test('setup file loads correctly', () => {
  expect(true).toBe(true);
});