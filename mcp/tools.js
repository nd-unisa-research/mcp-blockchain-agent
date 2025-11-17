import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listContracts, buildContractsResourceData, CONTRACTS_FILE_PATH, describeContracts } from "./contracts.js";
import { prepareContractInteraction } from "./contractInteraction.js";
import { ethers } from "ethers";
import { supportedChains } from "../supportedChains.js";
import { fetchTransactionHistory } from "./transactionHistory.js";
import { fetchCryptoPrice } from "./priceUtils.js";
import { prepareTransaction } from "./prepareTransaction.js";
import { deploySC } from "./deployContract.js";
import { scanVulnerabilitiesApi } from "./scanContractsApi.js";
import { writeContract } from "./contractWriter.js";

// Create an MCP server
const server = new McpServer({
  name: "BlockchainAgentMCPServer",
  version: "1.0.0"
});

server.registerResource(
  'deployedContracts',
  {
    title: 'Deployed Contracts Registry',
    description: 'Read-only JSON snapshot of all deployed contracts.',
    mimeType: 'application/json'
  },
  async () => {
    const data = buildContractsResourceData();
    return {
      contents: [
        {
          uri: CONTRACTS_FILE_PATH,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }
);


server.registerTool(
  "ping",
  { inputSchema: {} },
  async () => {
    return { content: [{ type: "text", text: "pong" }] };
  }
);

server.registerTool(
  "getBalance",
  {
    title: "Get Balance of User Address",
    description: "Returns the balance of the native token (e.g., ETH, MATIC, BNB) for the given wallet address on the specified blockchain RPC endpoint",
    inputSchema: {
      address: z.string(),
      networkName: z.string()
    }
  }, 
  async ({ address, networkName }) => {
    try {
      const userAddress = ethers.utils.getAddress(address);
      const chain = supportedChains[networkName.toLowerCase()];
      if (!chain) throw new Error(`Unknown network: ${networkName}`);
      const symbol = chain.symbol || "NATIVE";

      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
      const balanceWei = await provider.getBalance(userAddress);
      const balanceEth = ethers.utils.formatEther(balanceWei);

      const text = `Current balance of ${userAddress} on ${networkName} ( chainId: ${chain.chainId}): ${parseFloat(balanceEth).toFixed(6)} ${symbol}`;

      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `getBalance error: ${msg}` }] };
    }
  }
  
);

server.registerTool(
  "showAddress",
  {
    title: "Show Wallet Address",
    description: "Displays the user's wallet address",
    inputSchema: {
      address: z.string(),
    }
  },
  async ({ address, networkName }) => {
    try {
      const userAddress = address ? ethers.utils.getAddress(address) : "Unknown";
      const text = `Your wallet address is:<br><code>${userAddress}</code>`;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `showAddress error: ${msg}` }] };
    }
  }
);

server.registerTool(
  "getTransactions",
  {
    title: "Get Last Transactions of an Address",
    description: "Returns the last 5 transactions of the specified address on the chosen blockchain network.",
    inputSchema: {
      address: z.string(),
      networkName: z.string()
    }
  },
  async ({ address, networkName }) => {
    return fetchTransactionHistory(address, networkName);
  }
);

server.registerTool(
  "getPrice",
  {
    title: "Get Cryptocurrency Price",
    description: "Returns the price of a given cryptocurrency in one or more fiat currencies",
    inputSchema: {
      crypto: z.string(),
      currencies: z.string().optional()
    }
  },
  async ({ crypto, currencies }) => {
    return await fetchCryptoPrice({ crypto, currencies });
  }
);

server.registerTool(
  "getTransactionDetails",
  {
    title: "Get Transaction Details",
    description: "Fetches detailed information about a transaction given its hash on the specified blockchain",
    inputSchema: {
      hash: z.string(),
      networkName: z.string()
    }
  },
  async ({ hash, networkName }) => {
    try {

      // Hash Validation
      if (!hash || !/^0x([A-Fa-f0-9]{64})$/.test(hash)) {
        return {
          isError: true,
          content: [{ type: "text", text: "⚠️ Invalid or missing transaction hash." }]
        };
      }

      const chain = supportedChains[networkName.toLowerCase()];
      if (!chain) throw new Error(`Unknown network: ${networkName}`);

      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);

      const tx = await provider.getTransaction(hash);
      if (!tx) {
        return {
          isError: true,
          content: [{ type: "text", text: `❌ No transaction found with hash: <code>${hash}</code> on ${networkName}` }]
        };
      }
      const receipt = await provider.getTransactionReceipt(hash);

      let details = `
      <strong>Transaction Details on ${networkName}</strong><br>
      Hash: <code>${tx.hash}</code><br>
      From: <code>${tx.from}</code><br>
      To: <code>${tx.to || 'Contract creation'}</code><br>
      Value: ${ethers.utils.formatEther(tx.value)} ${chain.symbol}<br>
      Gas Price: ${ethers.utils.formatUnits(tx.gasPrice, 'gwei')} Gwei<br>
      Gas Limit: ${tx.gasLimit.toString()}<br>
      Gas Used: ${receipt ? receipt.gasUsed.toString() : 'N/A'}<br>
      Block: ${tx.blockNumber || 'Pending'}<br>
      Status: ${receipt ? (receipt.status === 1 ? 'Success' : 'Failed') : 'Pending'}<br>
      `;

      return { content: [{ type: "text", text: details }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("getTransactionDetails error:", err);
      return { isError: true, content: [{ type: "text", text: `❌ Error fetching transaction details: ${msg}` }] };
    }
  }
);

server.registerTool(
  "getGasPrice",
  {
    title: "Get Current Gas Price",
    description: "Fetches the current gas price for the specified blockchain network, in Gwei and native token",
    inputSchema: {
      networkName: z.string(),
    }
  },
  async ({ networkName }) => {
    try {
      const chain = supportedChains[networkName.toLowerCase()];
      if (!chain) throw new Error(`Unknown network: ${networkName}`);

      const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);
      const gasPrice = await provider.getGasPrice();

      const gwei = ethers.utils.formatUnits(gasPrice, "gwei");
      const native = ethers.utils.formatEther(gasPrice);
      let text = `Current gas price on <strong>${networkName}</strong>:<br>` +
                 `- ${parseFloat(gwei).toFixed(2)} Gwei<br>` +
                 `- ${native} ${chain.symbol}`;

      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `getGasPrice error: ${msg}` }]
      };
    }
  }
);

server.registerTool(
  "prepareTransaction",
  {
    title: "Prepare a transaction to send native cryptocurrency",
    description:
      "Validates and prepares transaction data for sending native tokens. Returns transaction info and a gas cost estimation.",
    inputSchema: {
      address: z.string(),
      to: z.string(),
      amount: z.string(),
      networkName: z.string()
    }
  },
  async ({ address, to, amount, networkName }) => {
    return await prepareTransaction({ address, to, amount, networkName });
  }
);

server.registerTool(
  "deploySC",
  {
    title: "Deploy Smart Contract",
    description: "Compiles a Solidity smart contract and prepares data for deployment.",
    inputSchema: {
      userAddress: z.string().optional(),
      fileName: z.string(),
      source: z.string(),
      contractName: z.string().optional(),
      constructorArgs: z.string().optional(),
      networkName: z.string()
    }
  },
  async ({ userAddress, fileName, source, contractName, constructorArgs, networkName }) => {
    return await deploySC({ userAddress, fileName, source, contractName, constructorArgs, networkName });
  }
);

/*
server.registerTool(
  "scanVulnerabilities",
  {
    title: "Scan Smart Contract for Vulnerabilities",
    description: "Analyzes a Solidity contract source to detect potential vulnerabilities.",
    inputSchema: {
      contractName: z.string().optional(),
      source: z.string()
    }
  },
  async ({ contractName, source }) => {
    return await scanVulnerabilities({ contractName, source });
  }
);
*/

server.registerTool(
  "scanVulnerabilitiesApi",
  {
    title: "Scan Smart Contract via External API",
    description: "Analyzes a Solidity contract by calling an external vulnerability scanning API (ChainGPT).",
    inputSchema: {
      contractName: z.string().optional(),
      source: z.string()
    }
  },
  async ({ contractName, source }) => {
    return await scanVulnerabilitiesApi({ contractName, source });
  }
);

server.registerTool(
  "listDeployedContracts",
  {
    title: "List Deployed Contracts",
    description: "Returns deployed contracts optionally filtered by user address and/or network name.",
    inputSchema: {
      userAddress: z.string().optional(),
      networkName: z.string().optional()
    }
  },
  async ({ userAddress, networkName }) => {
    try {
      const list = await listContracts({ userAddress, networkName });
      if (!list.length) {
        return { content: [{ type: 'text', text: 'No deployed contracts found for the specified filters.' }] };
      }
      const lines = list.map(c => `• ${c.contractName || '(Unnamed)'} @ ${c.contractAddress} [${c.networkName}] (tx: ${c.deployTxHash})`).join('<br>');
      return { content: [{ type: 'text', text: `Deployed Contracts:<br>${lines}` }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `listDeployedContracts error: ${e.message}` }] };
    }
  }
);

server.registerTool(
  "describeContracts",
  {
    title: "Describe Contracts Functions and Parameters",
    description: "Shows contracts' functions and parameters.",
    inputSchema: {
      contractAddress: z.string().nullable().optional(),
      contractName: z.string().nullable().optional(),
      networkName: z.string().optional(),
      userAddress: z.string().optional(),
    }
  },
  async (args) => {
    const clean = { ...args };
    [ 'contractAddress','contractName','networkName','userAddress' ].forEach(k => { if (clean[k] === null) delete clean[k]; });
    return await describeContracts(clean);
  }
);

server.registerTool(
  "prepareContractInteraction",
  {
    title: "Prepare Smart Contract Interaction",
    description: "Prepares data to read or execute a smart contract function (returns encoded call and gas estimation; front-end must send).",
    inputSchema: {
      contractAddress: z.string().nullable().optional(),
      contractName: z.string().nullable().optional(),
      networkName: z.string(),
      userAddress: z.string().nullable().optional(),
      functionName: z.string(),
      functionArgs: z.string().nullable().optional(),
      valueEth: z.string().nullable().optional()
    }
  },
  async (args) => {
    const clean = { ...args };
    ['contractAddress','contractName','userAddress','functionArgs','valueEth'].forEach(k => { if (clean[k] === null) delete clean[k]; });
    return await prepareContractInteraction(clean);
  }
);

server.registerTool(
  "writeContract",
  {
    title: "Write Smart Contract",
    description: "Takes the user's natural language requirements and returns a generated smart contract.",
    inputSchema: {
      userMessage: z.string()
    }
  },
  async ({ userMessage }) => {
    return await writeContract(userMessage);
  }
);


// Stdin/Stdout Transport
const transport = new StdioServerTransport();
await server.connect(transport);
