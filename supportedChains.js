const INFURA_API_KEY = process.env.INFURA_API_KEY;

export const supportedChains = {
  // ---------------- ETHEREUM ----------------
  "ethereum-mainnet": {
    chainId: 1,
    symbol: "ETH",
    rpcUrl: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://etherscan.io",
    apiUrl: "https://api.etherscan.io/api"
  },
  "ethereum-sepolia": {
    chainId: 11155111,
    symbol: "ETH",
    rpcUrl: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://sepolia.etherscan.io",
    apiUrl: "https://api-sepolia.etherscan.io/api"
  },

  // ---------------- ARBITRUM ----------------
  "arbitrum-one": {
    chainId: 42161,
    symbol: "ETH",
    rpcUrl: `https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://arbiscan.io",
    apiUrl: "https://api.arbiscan.io/api"
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    symbol: "ETH",
    rpcUrl: `https://arbitrum-sepolia.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://sepolia.arbiscan.io",
    apiUrl: "https://api-sepolia.arbiscan.io/api"
  },

  // ---------------- AVALANCHE ----------------
  "avalanche-c-chain": {
    chainId: 43114,
    symbol: "AVAX",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorerUrl: "https://snowtrace.io",
    apiUrl: "https://api.snowtrace.io/api"
  },
  "avalanche-fuji": {
    chainId: 43113,
    symbol: "AVAX",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    explorerUrl: "https://testnet.snowtrace.io",
    apiUrl: "https://api-testnet.snowtrace.io/api"
  },

  // ---------------- BASE ----------------
  "base-mainnet": {
    chainId: 8453,
    symbol: "ETH",
    rpcUrl: `https://base-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://basescan.org",
    apiUrl: "https://api.basescan.org/api"
  },
  "base-sepolia": {
    chainId: 84532,
    symbol: "ETH",
    rpcUrl: `https://base-sepolia.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://sepolia.basescan.org",
    apiUrl: "https://api-sepolia.basescan.org/api"
  },

  // ---------------- POLYGON ----------------
  "polygon-mainnet": {
    chainId: 137,
    symbol: "MATIC",
    rpcUrl: `https://polygon-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://polygonscan.com",
    apiUrl: "https://api.polygonscan.com/api"
  },
  "polygon-amoy": {
    chainId: 80002,
    symbol: "MATIC",
    rpcUrl: `https://polygon-amoy.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://amoy.polygonscan.com",
    apiUrl: "https://api-amoy.polygonscan.com/api"
  },

  // ---------------- OPTIMISM ----------------
  "optimism-mainnet": {
    chainId: 10,
    symbol: "ETH",
    rpcUrl: `https://optimism-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://optimistic.etherscan.io",
    apiUrl: "https://api-optimistic.etherscan.io/api"
  },
  "optimism-sepolia": {
    chainId: 11155420,
    symbol: "ETH",
    rpcUrl: `https://optimism-sepolia.infura.io/v3/${INFURA_API_KEY}`,
    explorerUrl: "https://sepolia-optimistic.etherscan.io",
    apiUrl: "https://api-sepolia-optimistic.etherscan.io/api"
  },

  // ---------------- BSC ----------------
  "bsc-mainnet": {
    chainId: 56,
    symbol: "BNB",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
    apiUrl: "https://api.bscscan.com/api"
  },
  "bsc-testnet": {
    chainId: 97,
    symbol: "tBNB",
    rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
    explorerUrl: "https://testnet.bscscan.com",
    apiUrl: "https://api-testnet.bscscan.com/api"
  },

  // ---------------- GANACHE ----------------
  "ganache": {
    chainId: 1337,
    symbol: "ETH",
    rpcUrl: "http://127.0.0.1:7545",
    explorerUrl: null,
    apiUrl: null
  }
};
