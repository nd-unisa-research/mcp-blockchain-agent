import { listContracts } from './contracts.js';
import { supportedChains } from '../supportedChains.js';
import { ethers } from 'ethers';

// Helper: parse args (stringified JSON array or already array)
function parseArgs(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Args must be a JSON array');
      return parsed;
    } catch (e) {
      throw new Error(`Invalid functionArgs: ${e.message}`);
    }
  }
  throw new Error('functionArgs must be an array or JSON string array');
}

export async function prepareContractInteraction({
  contractAddress,
  contractName,
  networkName,
  userAddress,
  functionName,
  functionArgs,
  valueEth
}) {
  try {
    if (!functionName) throw new Error('Missing functionName');
    if (!networkName) throw new Error('Missing networkName');

    const chain = supportedChains[networkName.toLowerCase()];
    if (!chain) throw new Error(`Unknown network: ${networkName}`);

    const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);

    // Filter contracts
    let records = await listContracts({ userAddress, networkName });
    if (contractAddress) {
      const ca = contractAddress.trim().toLowerCase();
      records = records.filter(r => (r.contractAddress || '').toLowerCase() === ca);
    }
    if (contractName) {
      const cn = contractName.trim().toLowerCase();
      records = records.filter(r => (r.contractName || '').toLowerCase() === cn);
    }

    if (!records.length) {
      return { content: [{ type: 'text', text: 'No contract matching the provided filters.' }] };
    }
    if (records.length > 1) {
      const preview = records.map(r => `• ${r.contractName || '(Unnamed)'} @ ${r.contractAddress} [${r.networkName}]`).join('<br>');
      return { content: [{ type: 'text', text: `⚠️ More than one contract matches. Please specify a unique contractAddress.<br>${preview}` }] };
    }

    const contract = records[0];
    if (!contract.contractAddress) {
      return { content: [{ type: 'text', text: '⚠️ Selected contract has no on-chain address saved.' }] };
    }
    const abi = Array.isArray(contract.abi) ? contract.abi : [];
    if (!abi.length) {
      return { content: [{ type: 'text', text: '⚠️ ABI not available for this contract.' }] };
    }

    const iface = new ethers.utils.Interface(abi);
    const fragment = iface.getFunction(functionName);
    if (!fragment) {
      return { content: [{ type: 'text', text: `❌ Function '${functionName}' not found in contract ABI.` }] };
    }

    const args = parseArgs(functionArgs);
    if (fragment.inputs.length !== args.length) {
      return { content: [{ type: 'text', text: `❌ Function '${functionName}' expects ${fragment.inputs.length} arguments, received ${args.length}.` }] };
    }

    // Value handling
    let valueWei = ethers.BigNumber.from(0);
    if (fragment.stateMutability === 'payable') {
      if (valueEth) {
        try { valueWei = ethers.utils.parseEther(String(valueEth)); } catch { throw new Error('Invalid valueEth (must be numeric/parseable)'); }
      }
    } else if (valueEth) {
      return { content: [{ type: 'text', text: `⚠️ Function '${functionName}' is not payable; omit valueEth.` }] };
    }

    const isReadOnly = ['view', 'pure'].includes(fragment.stateMutability);
    const data = iface.encodeFunctionData(fragment, args);

    // Build explicit parameter order info
    const orderedParams = fragment.inputs.map((inp, idx) => `${idx}. ${inp.name || '_'}:${inp.type}`);
    const baseSummary = `Preparing call to <strong>${functionName}</strong> on contract <code>${contract.contractAddress}</code><br>` +
      `Network: ${networkName} | Mutability: ${fragment.stateMutability}${fragment.stateMutability === 'payable' ? ' (payable)' : ''}<br>` +
      `Args (${args.length}): ${args.map((a,i) => `<code>${fragment.inputs[i]?.name || i}=${a}</code>`).join(', ') || '—'}<br>` +
      `Expected order: ${orderedParams.join(' | ')}<br>` +
      `⚠️ Arguments must be provided in strict positional order.<br>` +
      (valueWei.gt(0) ? `Value: ${ethers.utils.formatEther(valueWei)} ${chain.symbol}<br>` : '');

  if (isReadOnly) {
      let decoded = null;
      try {
        const raw = await provider.call({ to: contract.contractAddress, data });
        const out = iface.decodeFunctionResult(fragment, raw);
        decoded = Array.from(out).map(x => (typeof x === 'object' && x?._isBigNumber) ? x.toString() : x);
      } catch (e) {
        return { content: [{ type: 'text', text: baseSummary + `❌ Static call failed: ${e.message}` }] };
      }
      const resultText = decoded && decoded.length ? decoded.map((v, i) => `[#${i}] ${v}`).join('<br>') : '—';
      const jsonMarker = {
        type: 'contractRead',
        contractAddress: contract.contractAddress,
        networkName,
        function: functionName,
        args,
        data,
        outputs: decoded,
        readOnly: true
      };
      return {
        content: [
          { type: 'text', text: baseSummary + 'Read-only function executed.<br>Result:<br>' + resultText },
          { type: 'text', text: `__CONTRACTCALL__${JSON.stringify(jsonMarker)}` }
        ]
      };
    }

    let gasEstimate = null; let gasPrice = null; let costWei = null;
    try {
      gasEstimate = await provider.estimateGas({
        to: contract.contractAddress,
        from: userAddress,
        data,
        value: valueWei.gt(0) ? valueWei : undefined
      });
    } catch (e) {
      // Continue, but not failure
    }
    try { gasPrice = await provider.getGasPrice(); } catch {}
    if (gasEstimate && gasPrice) {
      try { costWei = gasEstimate.mul(gasPrice); } catch {}
    }

    const summary = baseSummary +
      (gasEstimate ? `Estimated Gas: ${gasEstimate.toString()}<br>` : 'Estimated Gas: n/a<br>') +
      (gasPrice ? `Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei<br>` : '') +
      (costWei ? `~ Cost: ${ethers.utils.formatEther(costWei)} ${chain.symbol}<br>` : '') +
      'MetaMask will be required to sign and send the transaction.';

    const chainId = chain.chainId;
    const jsonMarker = {
      type: 'contractWrite',
      contractAddress: contract.contractAddress,
      networkName,
      chainId,
      function: functionName,
      args,
      data,
      valueWei: valueWei.toString(),
      gasEstimate: gasEstimate ? gasEstimate.toString() : null,
      gasPriceWei: gasPrice ? gasPrice.toString() : null,
      readOnly: false
    };

    return {
      content: [
        { type: 'text', text: summary },
        { type: 'text', text: `__CONTRACTCALL__${JSON.stringify(jsonMarker)}` }
      ]
    };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `prepareContractInteraction error: ${e.message}` }] };
  }
}
