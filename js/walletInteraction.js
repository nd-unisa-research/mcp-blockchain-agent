import { createPendingTransferCardAndWatch, createPendingDeployCardAndWatch, createPendingContractInteractionCardAndWatch } from './confirmation.js';
const ethers = window?.ethers;
if (!ethers) {
  console.warn('walletInteraction error: module ethers not found.');
}

// Send native cryptocurrency transaction
export async function sendTransaction(txData, { provider, addMessage, updateWalletInfo, onBeforeOpen, onSent } = {}) {
  try {
    if (!window.ethereum) throw new Error("MetaMask not connected");

    const txParams = {
      from: txData.from,
      to: txData.to,
      value: ethers.utils.parseEther(txData.amount).toHexString(),
      chainId: txData.chainId
    };

    addMessage("ai", "Sending transaction via MetaMask...");

    try { onBeforeOpen?.('nativeTransfer'); } catch {}
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [txParams]
    });

    addMessage("ai", `Transaction sent! Hash: <code>${txHash}</code>`);
    try { onSent?.(txHash); } catch {}

    createPendingTransferCardAndWatch({
      provider,
      chainId: txData.chainId,
      txHash,
      onSettled: async () => { try { await updateWalletInfo?.(); } catch {} }
    });

    await updateWalletInfo?.();
  } catch (err) {
    console.error("sendTransaction error:", err);
    addMessage("ai", `❌ Error sending transaction: ${err.message}`);
  }
}

// Deploy a compiled smart contract
export async function sendDeploy(deployData, { addMessage, updateWalletInfo, onBeforeOpen, onSent } = {}) {
  try {
    if (!window.ethereum) throw new Error("MetaMask not connected");
  const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();

    addMessage("ai", "Sending contract deployment transaction via MetaMask...");
  const factory = new ethers.ContractFactory(deployData.abi, deployData.bytecode, signer);
  // Notify right before opening MetaMask for contract deployment
  try { onBeforeOpen?.('deploy'); } catch {}
  const contract = await factory.deploy(...(deployData.constructorArgs || []));

  const txHash = contract.deployTransaction.hash;
    addMessage("ai", `Deployment tx sent! Hash: <code>${txHash}</code>`);
    try { onSent?.(txHash); } catch {}

    createPendingDeployCardAndWatch({
      provider,
      contractName: deployData.contractName,
      contract,
      deployData,
      onSettled: async () => { try { await updateWalletInfo?.(); } catch {} }
    });
  } catch (err) {
    console.error("sendDeploy error:", err);
    let errMsg = "Unexpected error during deployment.";
    if (err.code === "ACTION_REJECTED" || err.message?.includes("user rejected")) {
      errMsg = "❌ Transaction rejected by the user.";
    } else if (err.code === "INSUFFICIENT_FUNDS") {
      errMsg = "❌ Not enough funds to deploy the contract.";
    } else if (err.code === "NETWORK_ERROR") {
      errMsg = "❌ Network error, please check your connection.";
    } else if (err.reason) {
      errMsg = `❌ ${err.reason}`;
    }
    addMessage("ai", errMsg);
  }
}

// Interact with a smart contract
export async function interactWithContract(callTx, { provider, userAccount, addMessage, updateWalletInfo, onBeforeOpen, onSent } = {}) {
  try {
    if (!window.ethereum) throw new Error('MetaMask not connected');
    const net = await provider.getNetwork();
    if (callTx.chainId && callTx.chainId !== net.chainId) {
      throw new Error(`Connected chainId ${net.chainId} does not match prepared call chainId ${callTx.chainId}. Switch network in MetaMask.`);
    }
    try {
      await provider.call({
        to: callTx.to,
        from: userAccount,
        data: callTx.data,
        value: callTx.valueWei && callTx.valueWei !== '0' ? callTx.valueWei : undefined
      });
    } catch (simErr) {
      const reason = extractRevertReason(simErr);
      if (reason) {
        addMessage('ai', `❌ Contract call would revert: <code>${escapeHtml(reason)}</code>`);
        return;
      } else {
        addMessage('ai', '❌ Contract call simulation failed (possible revert). Please check function arguments and contract state.');
        console.warn('interactWithContract error :', simErr);
        return;
      }
    }
    const txParams = {
      from: userAccount,
      to: callTx.to,
      data: callTx.data,
      value: callTx.valueWei ? callTx.valueWei : undefined,
    };
  addMessage('ai', 'Sending contract function transaction via MetaMask...');
  // Notify right before opening MetaMask for contract write
  try { onBeforeOpen?.('contractWrite'); } catch {}
  const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [txParams] });
    addMessage('ai', `Contract function tx sent! Hash: <code>${txHash}</code>`);
    try { onSent?.(txHash); } catch {}
    createPendingContractInteractionCardAndWatch({
      provider,
      chainId: net.chainId,
      txHash,
      functionName: callTx.functionName,
      contractAddress: callTx.to,
      onSettled: async () => { try { await updateWalletInfo?.(); } catch {} }
    });
  } catch (err) {
    console.error('interactWithContract error:', err);
    if (err?.code === 'ACTION_REJECTED' || /user rejected/i.test(err?.message || '')) {
      addMessage('ai', 'Transaction rejected by the user.');
      return;
    }
    const revert = extractRevertReason(err);
    if (revert) {
      addMessage('ai', `❌ Contract execution reverted: <code>${escapeHtml(revert)}</code>`);
    } else {
      const msg = err?.message || 'Unknown error';
      addMessage('ai', `❌ Error interacting with contract: ${escapeHtml(msg)}`);
    }
  }
}

function extractRevertReason(error) {
  if (!error) return null;
  const candidates = [
    error?.data?.message,
    error?.error?.data?.message,
    error?.error?.message,
    error?.message
  ].filter(Boolean);
  for (const msg of candidates) {
    const m = /execution reverted(?::\s*)(.*)?$/i.exec(msg);
    if (m) {
      const reason = (m[1] || '').trim();
      return reason || 'Execution reverted';
    }
    const m2 = /reverted with reason string "([^"]+)"/i.exec(msg);
    if (m2) return m2[1];
    const m3 = /revert(?:ed)?(?:\s+with)?(?:\s+reason)?\s+string:?\s+"([^"]+)"/i.exec(msg);
    if (m3) return m3[1];
  }
  const raw = error?.data?.data || error?.error?.data?.data;
  if (typeof raw === 'string' && raw.startsWith('0x08c379a0') && raw.length > 10) {
    try {
      if (ethers?.utils?.Interface) {
        const iface = new ethers.utils.Interface(['function Error(string)']);
        const decoded = iface.decodeFunctionData('Error', raw);
        if (decoded && decoded.length) return decoded[0];
      }
    } catch {}
  }
  return null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
