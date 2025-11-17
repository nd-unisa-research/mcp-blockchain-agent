const chainsById = {
  1: { name: 'ethereum-mainnet', symbol: 'ETH', explorerUrl: 'https://etherscan.io' },
  11155111: { name: 'ethereum-sepolia', symbol: 'ETH', explorerUrl: 'https://sepolia.etherscan.io' },

  42161: { name: 'arbitrum-one', symbol: 'ETH', explorerUrl: 'https://arbiscan.io' },
  421614: { name: 'arbitrum-sepolia', symbol: 'ETH', explorerUrl: 'https://sepolia.arbiscan.io' },

  43114: { name: 'avalanche-c-chain', symbol: 'AVAX', explorerUrl: 'https://snowtrace.io' },
  43113: { name: 'avalanche-fuji', symbol: 'AVAX', explorerUrl: 'https://testnet.snowtrace.io' },

  8453: { name: 'base-mainnet', symbol: 'ETH', explorerUrl: 'https://basescan.org' },
  84532: { name: 'base-sepolia', symbol: 'ETH', explorerUrl: 'https://sepolia.basescan.org' },

  137: { name: 'polygon-mainnet', symbol: 'MATIC', explorerUrl: 'https://polygonscan.com' },
  80002: { name: 'polygon-amoy', symbol: 'MATIC', explorerUrl: 'https://amoy.polygonscan.com' },

  10: { name: 'optimism-mainnet', symbol: 'ETH', explorerUrl: 'https://optimistic.etherscan.io' },
  11155420: { name: 'optimism-sepolia', symbol: 'ETH', explorerUrl: 'https://sepolia-optimistic.etherscan.io' },

  56: { name: 'bsc-mainnet', symbol: 'BNB', explorerUrl: 'https://bscscan.com' },
  97: { name: 'bsc-testnet', symbol: 'tBNB', explorerUrl: 'https://testnet.bscscan.com' },

  1337: { name: 'ganache', symbol: 'ETH', explorerUrl: null }
};

export function getChainInfoById(chainId) {
  return chainsById[Number(chainId)] || null;
}

export const supportedNetworkNames = Object.values(chainsById).map(c => c.name);
