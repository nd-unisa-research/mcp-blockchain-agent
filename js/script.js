import { getChainInfoById, supportedNetworkNames } from './chainsClient.js';
import { sendTransaction, sendDeploy, interactWithContract } from './walletInteraction.js';

let provider, signer, userAccount;
let conversationHistory = [];
let pendingTransaction = null;

export function checkMetaMask() {
  return typeof window.ethereum !== 'undefined';
}

export async function connectMetaMask() {
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
  signer = provider.getSigner();
  userAccount = await signer.getAddress();
  return { provider, signer, userAccount };
}

export function refreshProvider() {
  provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
  signer = provider.getSigner();
  return { provider, signer };
}

export function setUserAccount(addr) {
  userAccount = addr;
}

export async function getWalletInfo() {
  if (!provider || !userAccount) throw new Error('Wallet not connected');
  const balance = await provider.getBalance(userAccount);
  const network = await provider.getNetwork();
  return {
    account: userAccount,
    balanceEth: parseFloat(ethers.utils.formatEther(balance)).toFixed(6),
    networkName: network.name,
    chainId: network.chainId
  };
}

  function extractResponses(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    try {
      const direct = JSON.parse(trimmed);
      if (direct && Array.isArray(direct.responses)) return direct;
    } catch {}
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try {
        const fenced = JSON.parse(fence[1].trim());
        if (fenced && Array.isArray(fenced.responses)) return fenced;
      } catch {}
    }
    const firstBrace = trimmed.indexOf('{');
    if (firstBrace !== -1) {
      const candidate = trimmed.slice(firstBrace);
      if (candidate.includes('"responses"')) {
        const lastBrace = candidate.lastIndexOf('}');
        if (lastBrace !== -1) {
          const jsonSlice = candidate.slice(0, lastBrace + 1);
          try {
            const sliced = JSON.parse(jsonSlice);
            if (sliced && Array.isArray(sliced.responses)) return sliced;
          } catch {}
        }
      }
    }
    const messageMatches = [...trimmed.matchAll(/"message"\s*:\s*"([\s\S]*?)"/g)].map(m => m[1]);
    if (messageMatches.length) {
      return { responses: messageMatches.map(m => ({ message: m, action: null, params: {} })) };
    }
    return null;
  }

// Call to the proxy for Claude API
export async function analyzeCommandWithClaude(userMessage) {
  const network = await provider.getNetwork();
  const systemPrompt = `I am an AI assistant specializing exclusively in blockchain operations. The user has a MetaMask wallet connected with the address: ${userAccount}, currently connected on chain ${network.name}.

  Supported blockchains are strictly limited to: 
  ['ethereum-mainnet', 'ethereum-sepolia', 'arbitrum-one', 'arbitrum-sepolia', 'avalanche-c-chain', 'avalanche-fuji', 'base-mainnet', 'base-sepolia', 'polygon-mainnet', 'polygon-amoy', 'optimism-mainnet', 'optimism-sepolia', 'bsc-mainnet', 'bsc-testnet', 'ganache'].

  Supported fiat currencies are strictly limited to:
  [usd, eur, jpy, gbp, aud, cad, chf, cny, inr].

  Your task is to analyze the user's message and determine if they want to:
    1. Check their wallet balance (action: "getBalance", params: { address: <address mentioned by the user, or userAccount if none mentioned>, networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported)})
    2. Show their wallet address (action: "showAddress", params: { address: userAccount }).
    3. Show the last transactions of an address (action: "getTransactions", params: { address: <address mentioned by the user, or userAccount if none mentioned>, networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported)})
    4. Get the price of a cryptocurrency in one or more fiat currencies (action: "getPrice", params: { crypto: <crypto specified by the user ("error" if not explicitly specified)>, currencies: <comma-separated list of fiat currencies, default to "usd,eur" if not specified ("error" if unsupported)> })
    5. Get the details of a transaction given its hash (action: "getTransactionDetails", params: { hash: <transaction hash specified by the user ("error" if not explicitly specified)>, networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported)})
    6. Get the current gas price of a blockchain (action: "getGasPrice", params: { networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported)> })
    7. Prepare or simulate a transaction to send native cryptocurrency (action: "prepareTransaction", params: { address: null, to: <recipient address specified by the user ("error" if not explicitly specified)>, amount: <amount specified by the user ("error" if not explicitly specified)>, networkName: null })
      Transactions can only be prepared and executed on the network the wallet is currently connected to. 
      If the user asks to send on a different network, you must NOT prepare the transaction. 
      Instead, reply with a message telling them that they need to switch the network manually in MetaMask before trying again.
    8. Confirm a pending transaction (e.g. "yes", "confirm", "y") (action: "confirmTransaction", params: {})
    9. Deny a pending transaction (e.g. "no", "n", "deny") (action: "denyTransaction", params: {})
    10. Deploy a smart contract, tell the user to click on the "Deploy Smart Contract" button in the interface and follow the instructions. The action must be null in this case.
    11. Scan a smart contract for vulnerabilities, tell the user to click on the "Smart Contract Audit" button in the interface and follow the instructions. The action must be null in this case.
    12. List or Show smart contracts previously deployed/registered (action: "listDeployedContracts", params: { userAddress: <address mentioned or userAccount if none>, networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported) })
    13. Describe/List the functions/methods/parameters of a previously deployed smart contract (action: "describeContracts", params: { contractAddress: <address mentioned by the user or null>, contractName: <contract name mentioned by the user or null>, networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported), userAddress: userAccount })
    14. Interact with a deployed smart contract function, invoking one of its functions (action: "prepareContractInteraction", params: { contractAddress: <address mentioned by the user or null>, contractName: <contract name mentioned by the user or null>, networkName: <one of the supported blockchains> (null if not explicitly specified, "error" if unsupported), userAddress: userAccount, functionName: <explicit function name or null if not provided>, functionArgs: <JSON array string of ordered args or null if none>, valueEth: <string amount if user explicitly wants to send native value and function is payable else null> })
    15. Generate a new smart contract from the user's requirements (action: "writeContract", params: { userMessage: <the user's last message EXACTLY as written> })
    16. Receive an explanation about the system, its supported chains, its components (in this case respond with message only and action=null).

  If the network is not explicitly specified by the user, it means that the action should be executed on the currently connected network.

  Action selection clarifications:
    - Use "describeContracts" when the user asks what functions/methods exist, wants the ABI, parameters, or how to call but WITHOUT actually executing now.
    - Use "prepareContractInteraction" when the user wants to run/call/invoke/execute a function or asks directly for a function result (e.g. "what is totalSupply?", "call balanceOf for my address").
    - If the user wants to call but doesn't specify the function name, respond with action=null asking them to provide the function name.
    - functionArgs: generate a JSON array string in the exact order provided by the ABI. If the user lists arguments naturally, map them positionally.
    - If argument count is ambiguous or insufficient data, respond with action=null requesting clarification.
    - Only set valueEth if the user explicitly mentions sending / transferring native currency along with the call AND the function is plausibly payable (keywords: send, with eth, with value, deposit, payable).
    - Never guess function names or arguments; ask instead (action=null) if uncertain.

  Respond ALWAYS and ONLY in this JSON format:
  {
    "responses": [
      {
        "message": "Friendly response to the user",
        "action": action to be executed or null,
        "params": {parameters for the action or {}}
      }
    ]
  }

  - If the user asks for multiple things in one message, return multiple objects in "responses".
  - The value of "message" must be a valid JSON string (double quotes, properly escaped).
  - For readability, the "message" MUST be HTML-formatted using ONLY this safe subset of tags: <p>, <br>, <strong>, <b>, <code>, <ul>, <ol>, <li>, <em>. No other tags. Do NOT wrap the whole text in a single <div>. Use:
      * <p> blocks for paragraphs
      * <ul><li> or <ol><li> for lists of features / steps
      * <strong> for emphasis / headings
      * <code> for addresses, function names, parameter names, JSON snippets, hashes
    NEVER output raw markdown like **bold**; convert it to HTML. Do NOT include any script/style tags or on* attributes.
  - If you are asking the user for clarification, still format politely with <p> and possibly a short <ul> of what you need.
  `;

  conversationHistory.push({ role: 'user', content: userMessage });

  if (conversationHistory.length > 7) {
    conversationHistory = conversationHistory.slice(-7);
  }

  const response = await fetch('http://localhost:3000/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: conversationHistory
    })
  });

  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  if (!data.content?.[0]) throw new Error(JSON.stringify(data));

  const rawText = data.content[0].text;

  const extracted = extractResponses(rawText);
  if (extracted) {
    conversationHistory.push({ role: 'assistant', content: rawText });
    if (conversationHistory.length > 7) conversationHistory = conversationHistory.slice(-7);
    return extracted.responses;
  }

  conversationHistory.push({ role: 'assistant', content: rawText });
  if (conversationHistory.length > 7) conversationHistory = conversationHistory.slice(-7);
  return [{ message: rawText, action: null, params: {} }];
}

// Actions Execution
export async function executeAction(action, params, addMessage, updateWalletInfo, logToPanel, metrics) {
  try {
    const log = typeof logToPanel === 'function' ? logToPanel : () => {};
    // Validate and normalize parameters
    params = await checkParams(params);

    console.log("Parameters for action", action, params);
    log('mcp.request', { action, params });

    if (action === "confirmTransaction") {
      if (!pendingTransaction) {
        addMessage("ai", "⚠️ No pending transaction to confirm.");
        return;
      }
      if (pendingTransaction.type === 'contractWrite') {
        metrics?.onConfirmStart?.('contractWrite');
        await interactWithContract(pendingTransaction, { provider, userAccount, addMessage, updateWalletInfo, onBeforeOpen: () => metrics?.onConfirmOpen?.('contractWrite'), onSent: () => metrics?.onMetaMaskSent?.('contractWrite') });
      } else {
        metrics?.onConfirmStart?.('nativeTransfer');
        await sendTransaction(pendingTransaction, { provider, addMessage, updateWalletInfo, onBeforeOpen: () => metrics?.onConfirmOpen?.('nativeTransfer'), onSent: () => metrics?.onMetaMaskSent?.('nativeTransfer') });
      }
      pendingTransaction = null;
      return;
    }

    if (action === "denyTransaction") {
      metrics?.onLocalStart?.('denyTransaction');
      if (!pendingTransaction) {
        addMessage("ai", "⚠️ No pending transaction to cancel.");
        metrics?.onLocalDisplayed?.('denyTransaction');
        return;
      }
      pendingTransaction = null;
      addMessage("ai", "❌ Transaction cancelled.");
      metrics?.onLocalDisplayed?.('denyTransaction');
      return;
    }

    if (pendingTransaction) {
      console.log("Clearing stale pendingTransaction due to new action:", action);
      pendingTransaction = null;
    }

  // Call the backend to invoke the MCP tool
  metrics?.onMcpStart?.(action);
    const response = await fetch("http://localhost:3000/api/invokeMCPTool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...params })
    });
  
    const data = await response.json();
    log('mcp.response', data);

    if (data.error) throw new Error(data.error);
    const toolMessage = data.content?.[0]?.text || "⚠️ No response from the tool";
    addMessage("ai", toolMessage);
    conversationHistory.push({ role: 'assistant', content: `(MCP ${action}) ${toolMessage}` });
    if (conversationHistory.length > 7) conversationHistory = conversationHistory.slice(-7);
    metrics?.onMcpDisplayed?.(action);

    if (action === "deploySC") {
      const deployText = data.content?.find(
        c => c.type === "text" && c.text.startsWith("__DEPLOYDATA__")
      )?.text;
      if (!deployText) throw new Error("No deploy data returned from MCP Tool");

      const deployData = JSON.parse(deployText.replace("__DEPLOYDATA__", ""));
      log('mcp.deployData', deployData);
      metrics?.onMetaMaskStart?.('deploy');
      await sendDeploy(deployData, { addMessage, updateWalletInfo, onBeforeOpen: () => metrics?.onMetaMaskStart?.('deploy'), onSent: () => metrics?.onMetaMaskSent?.('deploy') });
      return;
    }

    if (action === "prepareTransaction") {
      const txText = data.content?.find(c => c.type === "text" && c.text.startsWith("__TXDATA__"))?.text;
      if (!txText) throw new Error("No transaction data returned from MCP Tool");

      const txData = JSON.parse(txText.replace("__TXDATA__", ""));
      log('mcp.txData', txData);
      pendingTransaction = { type: 'nativeTransfer', ...txData, from: userAccount };

      addMessage("ai", "Do you want to confirm this transaction?");
    }

    if (action === "prepareContractInteraction") {
      const callMarker = data.content?.find(c => c.type === 'text' && c.text.startsWith('__CONTRACTCALL__'))?.text;
      if (!callMarker) {
        return;
      }
      const callData = JSON.parse(callMarker.replace('__CONTRACTCALL__',''));
      log('mcp.contractCall', callData);
      if (callData.readOnly) {
        addMessage('ai', 'Read-only call completed.');
        return;
      }
      pendingTransaction = {
        type: 'contractWrite',
        chainId: callData.chainId,
        to: callData.contractAddress,
        data: callData.data,
        functionName: callData.function,
        valueWei: callData.valueWei && callData.valueWei !== '0' ? callData.valueWei : null,
        gasEstimate: callData.gasEstimate,
        gasPriceWei: callData.gasPriceWei
      };
      addMessage('ai', ' Do you want to confirm this contract function transaction?');
      return;
    }

    return;

  } catch (error) {
    console.error("executeAction error:", error);
    addMessage("ai", `❌ Error: ${error.message}`);
  }
}

// Parameter validation and normalization
async function checkParams(params) {
  const normalized = { ...params };

  // Address Validation
  if (!normalized.address) {
    normalized.address = userAccount;
  }

  // Unsupported Network
  if (normalized.networkName === "error") {
    throw new Error(`Unsupported network specified. Supported networks are: ${supportedNetworkNames.join(', ')}`);
  }

  // Null/unspecified Network -> infer from connected provider
  if (!normalized.networkName) {
    const network = await provider.getNetwork();
    const chainId = network.chainId;
    const info = getChainInfoById(chainId);
    if (info?.name) {
      normalized.networkName = info.name;
    } else {
      throw new Error(`Unsupported chainId ${chainId}, please specify a supported network`);
    }
  }

  // Crypto not specified
  if (normalized.crypto === "error") {
    throw new Error("No cryptocurrency specified for price check.");
  }

  // Currencies not supported
  if (normalized.currencies === "error") {
    throw new Error(`Unsupported fiat currencies specified. Supported fiat currencies are: [usd, eur, jpy, gbp, aud, cad, chf, cny, inr]`);
  }

  // Hash not specified
  if (normalized.hash === "error") {
    throw new Error("No transaction hash specified for transaction details.");
  }

  // To address not specified
  if (normalized.to === "error") {
    throw new Error("No recipient address specified for the transaction.");
  }

  // Amount not specified
  if (normalized.amount === "error") {
    throw new Error("No amount specified for the transaction.");
  }

  return normalized;
}

console.log('Logic module loaded');