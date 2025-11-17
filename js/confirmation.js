import { getChainInfoById } from './chainsClient.js';

const pendingSidebar = document.getElementById('pendingTxSidebar');
const pendingCards = new Map(); //key: hash

function shorten(str, head = 6, tail = 4) {
  if (!str || str.length <= head + tail + 3) return str || '';
  return `${str.slice(0, head)}...${str.slice(-tail)}`;
}

function chainInfoByChainId(chainId) {
  return getChainInfoById(chainId);
}

function makeExplorerTxUrl(chainId, hash) {
  const info = chainInfoByChainId(chainId);
  if (!info?.explorerUrl) return null;
  return `${info.explorerUrl}/tx/${hash}`;
}

export function addPendingCard({ hash, kind, title, subtitle, chainId }) {
  if (!pendingSidebar) return null;

  const card = document.createElement('div');
  card.className = 'pending-card';
  if (kind === 'contract') {
    card.classList.add('contract-call');
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'title';
  let kindEmoji = '🔁';
  if (kind === 'deploy') kindEmoji = '🧱';
  else if (kind === 'contract') kindEmoji = '⚙️';
  titleRow.innerHTML = `${kindEmoji} ${title || 'Transaction pending'}`;

  const hashRow = document.createElement('div');
  hashRow.className = 'hash';
  const explorer = makeExplorerTxUrl(chainId, hash);
  hashRow.innerHTML = explorer
    ? `Hash: <a href="${explorer}" target="_blank" rel="noopener noreferrer">${shorten(hash, 10, 8)}</a>`
    : `Hash: <code>${shorten(hash, 10, 8)}</code>`;

  const subtitleRow = document.createElement('div');
  subtitleRow.style.marginTop = '4px';
  subtitleRow.textContent = subtitle || 'Waiting for confirmation...';

  const statusRow = document.createElement('div');
  statusRow.className = 'status-row';

  const badge = document.createElement('div');
  badge.className = 'badge-waiting';
  badge.innerHTML = '<span>⏳</span><span>Waiting</span>';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = 'Close';
  closeBtn.style.display = 'none';
  closeBtn.addEventListener('click', () => {
    card.remove();
    pendingCards.delete(hash);
  });
  actions.appendChild(closeBtn);

  statusRow.appendChild(badge);
  statusRow.appendChild(actions);

  card.appendChild(titleRow);
  card.appendChild(hashRow);
  card.appendChild(subtitleRow);
  card.appendChild(statusRow);

  // Add newest on top
  pendingSidebar.insertBefore(card, pendingSidebar.firstChild);

  function setStatus(state, extra) {
    if (state === 'confirmed') {
      badge.className = 'badge-confirmed';
      badge.innerHTML = '<span>✅</span><span>Confirmed</span>';
      // Allow custom renderer or HTML/text for flexible confirmed UI
      if (typeof extra?.render === 'function') {
        subtitleRow.innerHTML = '';
        try { extra.render(subtitleRow); } catch {}
      } else if (typeof extra?.html === 'string') {
        subtitleRow.innerHTML = extra.html;
      } else {
        subtitleRow.textContent = extra?.text || 'Transaction Confirmed';
      }
      closeBtn.style.display = 'inline-block';
    } else if (state === 'failed') {
      badge.className = 'badge-failed';
      badge.innerHTML = '<span>❌</span><span>Failed</span>';
      subtitleRow.textContent = extra?.text || 'Transaction Failed';
      closeBtn.style.display = 'inline-block';
    } else {
      badge.className = 'badge-waiting';
      badge.innerHTML = '<span>⏳</span><span>Waiting</span>';
      subtitleRow.textContent = extra?.text || 'Waiting for confirmation...';
      closeBtn.style.display = 'none';
    }
  }

  const api = { el: card, setStatus, close: () => closeBtn.click() };
  pendingCards.set(hash, api);
  return api;
}

async function watchTxConfirmation(provider, txHash, onStatus) {
  try {
    const receipt = await provider.waitForTransaction(txHash);
    if (receipt && receipt.status === 1) {
      onStatus?.('confirmed');
    } else {
      onStatus?.('failed');
    }
  } catch (e) {
    console.error('watchTxConfirmation error:', e);
    onStatus?.('failed');
  }
}

export function createPendingTransferCardAndWatch({ provider, chainId, txHash, onSettled }) {
  const card = addPendingCard({
    hash: txHash,
    kind: 'transfer',
    title: 'Transaction pending',
    subtitle: 'Waiting for confirmation...',
    chainId
  });

  (async () => {
    await watchTxConfirmation(provider, txHash, (state) => card?.setStatus(state));
    try { await onSettled?.(); } catch {}
  })();

  return card;
}

export function createPendingContractInteractionCardAndWatch({ provider, chainId, txHash, functionName, contractAddress, onSettled }) {
  const fnLabel = functionName ? `${functionName}()` : 'Contract call';
  const card = addPendingCard({
    hash: txHash,
    kind: 'contract',
    title: 'Invoking ' + fnLabel + ' function',
    subtitle: contractAddress ? `Waiting confirmation on ${contractAddress.slice(0,10)}...` : 'Waiting for confirmation...',
    chainId
  });

  (async () => {
    await watchTxConfirmation(provider, txHash, (state) => card?.setStatus(state));
    try { await onSettled?.(); } catch {}
  })();
  return card;
}

export function createPendingDeployCardAndWatch({ provider, contractName, contract, deployData, onSettled }) {
  const txHash = contract?.deployTransaction?.hash;
  if (!txHash) return null;

  (async () => {
    const network = await provider.getNetwork();
    const card = addPendingCard({
      hash: txHash,
      kind: 'deploy',
      title: `Deploy ${contractName || 'Contract'}`,
      subtitle: 'Waiting for confirmation...',
      chainId: network.chainId
    });

    try {
      await contract.deployed();
      const addr = contract.address;
      
      // Save deployed contract info
      try {
        const net = await provider.getNetwork();
        const userAddr = await provider.getSigner().getAddress();
        const chainEntry = chainInfoByChainId(net.chainId);

        try {
          const resp = await fetch('http://localhost:3000/api/registerDeployedContract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: userAddr,
              networkName: chainEntry?.name,
              fileName: deployData?.fileName,
              contractName: contractName,
              abi: deployData?.abi,
              bytecode: deployData?.bytecode,
              constructorArgs: deployData?.constructorArgs,
              contractAddress: addr,
              deployTxHash: contract.deployTransaction?.hash
            })
          });
          if (!resp.ok) {
            console.error('registerDeployedContract error status', resp.status, await resp.text());
          } else {
            const json = await resp.json().catch(() => null);
            console.log('registerDeployedContract response', json);
          }
        } catch (e) {
          console.error('Error calling registerDeployedContract:', e);
        }
      } catch (e) {
        console.error('Error saving the contract:', e);
      }

      card?.setStatus('confirmed', {
        render: (container) => {
          const label = document.createElement('span');
          label.textContent = 'Contract deployed at ';

          const code = document.createElement('code');
          code.textContent = shorten(addr, 10, 8);

          const btn = document.createElement('button');
          btn.className = 'close-btn';
          btn.textContent = 'Copy';
          btn.style.marginLeft = '8px';
          btn.addEventListener('click', async () => {
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(addr);
              } else {
                const ta = document.createElement('textarea');
                ta.value = addr;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
              }
              const old = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => (btn.textContent = old), 1200);
            } catch (e) {
              const old = btn.textContent;
              btn.textContent = 'Error';
              setTimeout(() => (btn.textContent = old), 1200);
            }
          });

          container.appendChild(label);
          container.appendChild(code);
          container.appendChild(btn);
        }
      });
    } catch (e) {
      console.error('createPendingDeployCardAndWatch error:', e);
      card?.setStatus('failed', { text: 'Deployment failed' });
    } finally {
      try { await onSettled?.(); } catch {}
    }
  })();
}
