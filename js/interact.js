import { checkMetaMask, connectMetaMask, getWalletInfo, analyzeCommandWithClaude, executeAction, refreshProvider, setUserAccount } from './script.js';
import { getChainInfoById } from './chainsClient.js';
import { isRelevant } from "../relevanceClassifier.js";
import { isRelevant as isRelevantGemini } from "../relevanceClassifierGemini.js";

let provider, signer, userAccount, networkName;
let lastWalletInfo = null;

const statusDiv = document.getElementById('status');
const mmStatusIcon = document.getElementById('mmStatusIcon');
const connectBtn = document.getElementById('connectBtn');
const walletInfo = document.getElementById('walletInfo');
const mmIconWrap = document.querySelector('.mm-icon-wrap');
const mmTooltip = document.getElementById('mmTooltip');
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const deployContractBtn = document.getElementById('deployContractBtn');
const scanContractBtn = document.getElementById('scanContractBtn');
const infoPanel = document.getElementById('infoPanel');
const infoPanelBody = document.getElementById('infoPanelBody');
const infoToggleIcon = document.getElementById('infoToggleIcon');
let isProcessingMessage = false;

// Metrics timers
let chatStartAt = null;
let guiActionStartAt = null;
let guiActionKind = null;
const mcpStart = new Map();
const metaStart = new Map();
const confirmStart = new Map();
const localStart = new Map();

const metrics = {
  onMcpStart: (action) => {
    mcpStart.set(action, performance.now());
  },
  onMcpDisplayed: (action) => {
    const base = chatStartAt != null ? chatStartAt : mcpStart.get(action);
    if (base != null) {
      const ms = performance.now() - base;
      console.log(`[METRICS] MCP action '${action}' displayed in ${ms.toFixed(0)} ms`);
      if (base !== chatStartAt) mcpStart.delete(action);
    }
    if (guiActionKind === 'Scan' && guiActionStartAt != null) {
      const msGui = performance.now() - guiActionStartAt;
      console.log(`[METRICS] Scan (GUI) completed in ${msGui.toFixed(0)} ms`);
      guiActionStartAt = null;
      guiActionKind = null;
    }
  },
  onMetaMaskStart: (kind) => {
    metaStart.set(kind, performance.now());
    if (guiActionKind === 'Deploy' && guiActionStartAt != null && (kind === 'deploy')) {
      const msGui = performance.now() - guiActionStartAt;
      console.log(`[METRICS] Deploy (GUI) ready for MetaMask in ${msGui.toFixed(0)} ms`);
      guiActionStartAt = null;
      guiActionKind = null;
    }
  },
  onMetaMaskSent: (kind) => {
    const t0 = metaStart.get(kind);
    if (t0 != null) {
      const ms = performance.now() - t0;
      console.log(`[METRICS] MetaMask(${kind}) sent in ${ms.toFixed(0)} ms`);
      metaStart.delete(kind);
    }
  }
};

metrics.onConfirmStart = (kind) => {
  confirmStart.set(kind, performance.now());
};
metrics.onConfirmOpen = (kind) => {
  const base = chatStartAt != null ? chatStartAt : confirmStart.get(kind);
  if (base != null) {
    const ms = performance.now() - base;
    console.log(`[METRICS] confirmTransaction(${kind}) ready for MetaMask in ${ms.toFixed(0)} ms`);
    if (chatStartAt != null) chatStartAt = null;
    confirmStart.delete(kind);
  }
};

// Helper to escape attribute values
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Sanitizer for HTML messages
function formatAiMessage(raw) {
  if (raw == null) return '';
  const str = String(raw).trim();
  const hasHtmlTag = /<\/?(p|strong|b|code|ul|ol|li|em|br|a)\b/i.test(str);
  const containsOtherTags = /<\/?(script|style|iframe|object|embed|link|meta)/i.test(str);
  if (hasHtmlTag && !containsOtherTags) {
    let safeHtml = str.replace(/<\/?(script|style)[^>]*>/gi,'');
    safeHtml = safeHtml.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (m, attrs, inner) => {
      const hrefMatch = /href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(attrs || '');
      if (!hrefMatch) return inner;
      let href = hrefMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (!/^https?:\/\//i.test(href) && !href.startsWith('/')) return inner;
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    });
    return safeHtml;
  }
  const escape = (s) => s
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
  let safe = escape(str);

  safe = safe.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');

  const lines = safe.split(/\r?\n+/);
  let currentList = [];
  const paras = [];
  const flushList = () => {
    if (currentList.length) {
      paras.push('<ul>' + currentList.map(li => `<li>${li}</li>`).join('') + '</ul>');
      currentList = [];
    }
  };
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (!trimmed) { flushList(); continue; }
    if (/^(?:[-*•])\s+/.test(trimmed)) {
      currentList.push(trimmed.replace(/^(?:[-*•])\s+/,''));
    } else {
      flushList();
      paras.push(`<p>${trimmed}</p>`);
    }
  }
  flushList();
  const html = paras.join('\n');
  return html;
}

// Function to add a new message in the chat
function addMessage(sender, message) {
  const div = document.createElement('div');
  div.className = `message ${sender}-message`;
  if (sender === 'ai') {
    div.innerHTML = formatAiMessage(message);
  } else {
    div.textContent = message;
  }
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Remove last "I'm analyzing..." message if still present
function removeLastLoadingMessage() {
  const messages = chatContainer.querySelectorAll('.message');
  const last = messages[messages.length - 1];
  if (last?.textContent.includes("I'm analyzing")) last.remove();
}

// Append a JSON log item to the info panel
function logToInfoPanel(label, payload) {
  if (!infoPanelBody) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'info-item';
  const pre = document.createElement('pre');
  const content = { label, timestamp: new Date().toISOString(), data: payload };
  pre.textContent = JSON.stringify(content, null, 2);
  wrapper.appendChild(pre);
  infoPanelBody.appendChild(wrapper);
  infoPanelBody.scrollTop = infoPanelBody.scrollHeight;
}

function positionInfoPanel() {
  if (!infoPanel || infoPanel.classList.contains('hidden')) return;
  const container = document.querySelector('.container');
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const top = rect.top;
  const left = rect.right + 16;
  const availableWidth = Math.max(0, window.innerWidth - left - 20);
  if (availableWidth < 200) {
    infoPanel.classList.add('hidden');
    const icon = document.getElementById('infoToggleIcon');
    if (icon) { icon.src = './img/visible-eye.svg'; icon.alt = 'Show Info Panel'; icon.title = 'Show Info Panel'; }
    return;
  }
  const height = rect.height;
  infoPanel.style.top = `${top}px`;
  infoPanel.style.left = `${left}px`;
  infoPanel.style.width = `${availableWidth}px`;
  infoPanel.style.height = `${height}px`;
}

if (infoToggleIcon && infoPanel) {
  infoToggleIcon.addEventListener('click', () => {
    const isHidden = infoPanel.classList.toggle('hidden');
    if (isHidden) {
      infoToggleIcon.src = './img/visible-eye.svg';
      infoToggleIcon.alt = 'Show Info Panel';
      infoToggleIcon.title = 'Show Info Panel';
    } else {
      infoToggleIcon.src = './img/eye-off-2.png';
      infoToggleIcon.alt = 'Hide Info Panel';
      infoToggleIcon.title = 'Hide Info Panel';
      requestAnimationFrame(positionInfoPanel);
    }
  });
}

window.addEventListener('resize', positionInfoPanel);
window.addEventListener('scroll', positionInfoPanel);

async function updateWalletInfoUI() {
  const info = await getWalletInfo();
  networkName = info.networkName;
  lastWalletInfo = info;
  return info;
}

metrics.onLocalStart = (action) => {
  localStart.set(action, performance.now());
};
metrics.onLocalDisplayed = (action) => {
  const base = chatStartAt != null ? chatStartAt : localStart.get(action);
  if (base != null) {
    const ms = performance.now() - base;
    console.log(`[METRICS] Local action '${action}' completed in ${ms.toFixed(0)} ms`);
    if (chatStartAt != null) chatStartAt = null;
    localStart.delete(action);
  }
};

function renderWalletTooltip(info) {
  if (!info) return 'Wallet info unavailable';
  const accountShort = `${info.account.slice(0,6)}...${info.account.slice(-4)}`;
  return `
    <div><span class="label">Account:</span> <code>${accountShort}</code></div>
    <div><span class="label">Balance:</span> ${info.balanceEth} ETH</div>
    <div><span class="label">Network:</span> ${info.networkName} (Chain ID: ${info.chainId})</div>
  `;
}

connectBtn.addEventListener('click', async () => {
  if (userAccount) {
    userAccount = undefined;
    provider = undefined;
    signer = undefined;
    if (walletInfo) walletInfo.style.display = 'none';
    userInput.disabled = true;
    sendBtn.disabled = true;
    if (deployContractBtn) deployContractBtn.disabled = true;
    if (scanContractBtn) scanContractBtn.disabled = true;
    const btnLabelEl = connectBtn.querySelector('.label');
    if (btnLabelEl) btnLabelEl.textContent = 'Connect Wallet'; else connectBtn.textContent = 'Connect Wallet';
    if (statusDiv) { statusDiv.className = 'status disconnected'; statusDiv.textContent = ''; }
    if (mmStatusIcon) mmStatusIcon.classList.add('dimmed');
    addMessage('ai', 'Wallet disconnected.');
    return;
  }

  if (!checkMetaMask()) {
    addMessage('ai', '❌ MetaMask is not available.');
  if (deployContractBtn) deployContractBtn.disabled = true;
  if (scanContractBtn) scanContractBtn.disabled = true;
    return;
  }
  try {
    const btnLabelEl = connectBtn.querySelector('.label');
    if (btnLabelEl) btnLabelEl.textContent = 'Connecting...'; else connectBtn.textContent = 'Connecting...';
    connectBtn.classList.add('loading');

    const res = await connectMetaMask();
    logToInfoPanel('connectMetaMask.response', {
      hasProvider: !!res?.provider,
      hasSigner: !!res?.signer,
      userAccount: res?.userAccount
    });
    provider = res.provider; signer = res.signer; userAccount = res.userAccount;

    const info = await updateWalletInfoUI();
    logToInfoPanel('wallet.info', info);

    if (statusDiv) statusDiv.className = 'status connected';
    if (mmStatusIcon) mmStatusIcon.classList.remove('dimmed');
    userInput.disabled = false;
    sendBtn.disabled = false;
    if (deployContractBtn) deployContractBtn.disabled = false;
    if (scanContractBtn) scanContractBtn.disabled = false;

    if (btnLabelEl) btnLabelEl.textContent = 'Disconnect Wallet'; else connectBtn.textContent = 'Disconnect Wallet';

    addMessage('ai', 'MetaMask connected! You can now request transactions on your wallet.');

    userInput.focus();
  } catch (error) {
    addMessage('ai', `❌ Error: ${error.message}`);
  } finally {
    connectBtn.classList.remove('loading');
  }
});

sendBtn.addEventListener('click', processUserCommand);
userInput.addEventListener('keypress', e => { if (e.key === 'Enter') processUserCommand(); });

async function processUserCommand() {
  if (isProcessingMessage) return;
  const command = userInput.value.trim();
  if (!command) return;
  
  isProcessingMessage = true;
  sendBtn.disabled = true;
  userInput.disabled = true;
  const prevSendLabel = sendBtn.textContent;
  sendBtn.textContent = 'Sending...';
  sendBtn.classList.add('loading');

  chatStartAt = performance.now();
  addMessage('user', command);
  userInput.value = '';

  addMessage('ai', "I'm analyzing your request...");
  try {
    // Measure time from user message sent to relevance classifier output
    const relevanceStartAt = chatStartAt != null ? chatStartAt : performance.now();
    let relevant;
    try {
      relevant = await isRelevant(command);
    } finally {
      const ms = performance.now() - relevanceStartAt;
      console.log(`[METRICS] Relevance classifier completed in ${ms.toFixed(0)} ms`);
    }
    if (!relevant) {
      removeLastLoadingMessage();
      addMessage('ai', "⚠️ I can only invoke one of the supported actions.");
      return;
    }
    
    const responses = await analyzeCommandWithClaude(command);
    logToInfoPanel('analyze.responses', responses);
    removeLastLoadingMessage();

    const hasAction = responses.some(r => !!r.action);
    for (const r of responses) {
      addMessage('ai', r.message);
      if (r.action) {
        logToInfoPanel('execute.request', { action: r.action, params: r.params });
          await executeAction(r.action, r.params, addMessage, updateWalletInfoUI, (label, data) => logToInfoPanel(label, data), metrics);
      }
    }
    if (!hasAction && chatStartAt != null) {
      const ms = performance.now() - chatStartAt;
      console.log(`[METRICS] Chat (no tools) answered in ${ms.toFixed(0)} ms`);
      chatStartAt = null;
    }
  } catch (error) {
    removeLastLoadingMessage();
    addMessage('ai', `❌ Error: ${error.message}`);
  } finally {
    isProcessingMessage = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    sendBtn.textContent = prevSendLabel || 'Send';
    sendBtn.classList.remove('loading');

    userInput.focus();
  }
}

// Account/network changes
if (window.ethereum) {
  let chainChangeInProgress = false;

  window.ethereum.on('accountsChanged', async (accounts) => {
    try {
      if (!accounts || !accounts.length) {
        addMessage('ai', '⚠️ All accounts disconnected from MetaMask. Please reconnect.');
        if (statusDiv) statusDiv.className = 'status disconnected';
        if (mmStatusIcon) mmStatusIcon.classList.add('dimmed');
        const btnLabelEl = connectBtn.querySelector('.label');
        if (btnLabelEl) btnLabelEl.textContent = 'Connect Wallet'; else connectBtn.textContent = 'Connect Wallet';
        userInput.disabled = true;
        sendBtn.disabled = true;
        if (deployContractBtn) deployContractBtn.disabled = true;
        if (scanContractBtn) scanContractBtn.disabled = true;
        return;
      }
      const newAccount = accounts[0];
      if (newAccount && newAccount.toLowerCase() !== (userAccount || '').toLowerCase()) {
        userAccount = newAccount;
        setUserAccount(newAccount);
        await updateWalletInfoUI().catch(() => {});
        addMessage('ai', `🔄 Account changed. Using <code>${newAccount.slice(0,6)}...${newAccount.slice(-4)}</code>.`);
      }
    } catch (e) {
      console.error('accountsChanged handler error:', e);
    }
  });

  window.ethereum.on('chainChanged', async (chainIdHex) => {
    if (chainChangeInProgress) return;
    chainChangeInProgress = true;
    try {
      const dec = parseInt(chainIdHex, 16);
      const refreshed = refreshProvider();
      provider = refreshed.provider;
      signer = refreshed.signer;
      await updateWalletInfoUI().catch(() => {});
      addMessage('ai', `🌐 Network changed (chainId: ${dec}).`);
    } catch (e) {
      console.error('chainChanged handler error:', e);
    } finally {
      chainChangeInProgress = false;
    }
  });
}

// --- Deploy/Scan Smart Contract Menu Logic ---
(() => {
  const deployBtn = document.getElementById('deployContractBtn');
  const scanBtn = document.getElementById('scanContractBtn');
  const deployMenu = document.getElementById('deployMenu');
  const closeDeployMenuBtn = document.getElementById('closeDeployMenuBtn');
  const closeScanMenuBtn = document.getElementById('closeScanMenuBtn');
  const solFileInputDeploy = document.getElementById('solFileInputDeploy');
  const solFileStatusDeploy = document.getElementById('solFileStatusDeploy');
  const confirmDeployBtn = document.getElementById('confirmDeployBtn');
  const solFilePreviewDeploy = document.getElementById('solFilePreviewDeploy');
  const constructorArgsInputDeploy = document.getElementById('constructorArgsDeploy');
  const solFileInputScan = document.getElementById('solFileInputScan');
  const solFileStatusScan = document.getElementById('solFileStatusScan');
  const solFilePreviewScan = document.getElementById('solFilePreviewScan');
  const confirmScanBtn = document.getElementById('confirmScanBtn');
  const tabBtnDeploy = document.getElementById('tabBtnDeploy');
  const tabBtnScan = document.getElementById('tabBtnScan');
  const paneDeploy = document.getElementById('paneDeploy');
  const paneScan = document.getElementById('paneScan');
  let uploadedFileName = '';
  let uploadedSource = '';
  let activeTab = 'deploy';
  let isScanBusy = false;
  let isDeployBusy = false;

  // Helpers to toggle busy states and UI locks
  const setScanBusy = (busy) => {
    isScanBusy = !!busy;
    if (closeScanMenuBtn) closeScanMenuBtn.disabled = isScanBusy;
    const uploadLabel = document.getElementById('solUploadBtnScan');
    if (uploadLabel) {
      uploadLabel.style.pointerEvents = isScanBusy ? 'none' : '';
      uploadLabel.style.opacity = isScanBusy ? '0.5' : '';
      uploadLabel.setAttribute('aria-disabled', String(isScanBusy));
    }
    if (solFileInputScan) solFileInputScan.disabled = isScanBusy;
    if (tabBtnDeploy) tabBtnDeploy.disabled = isScanBusy;
    if (tabBtnScan) tabBtnScan.disabled = isScanBusy; // prevent rapid toggling
    if (confirmScanBtn) {
      let note = document.getElementById('scanBusyNote');
      if (isScanBusy) {
        if (!note) {
          note = document.createElement('span');
          note.id = 'scanBusyNote';
          note.textContent = ' It may take a while...';
          note.style.marginLeft = '10px';
          note.style.fontSize = '12px';
          note.style.color = '#666';
          confirmScanBtn.insertAdjacentElement('afterend', note);
        }
      } else {
        if (note) note.remove();
      }
    }
  };

  const setDeployBusy = (busy) => {
    isDeployBusy = !!busy;
    if (closeDeployMenuBtn) closeDeployMenuBtn.disabled = isDeployBusy;
    const uploadLabel = document.getElementById('solUploadBtnDeploy');
    if (uploadLabel) {
      uploadLabel.style.pointerEvents = isDeployBusy ? 'none' : '';
      uploadLabel.style.opacity = isDeployBusy ? '0.5' : '';
      uploadLabel.setAttribute('aria-disabled', String(isDeployBusy));
    }
    if (solFileInputDeploy) solFileInputDeploy.disabled = isDeployBusy;
    if (tabBtnScan) tabBtnScan.disabled = isDeployBusy;
    if (tabBtnDeploy) tabBtnDeploy.disabled = isDeployBusy;
  };

  const extractContractName = (source) => {
    if (typeof source !== 'string') return '';
    const noComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const match = noComments.match(/\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)/);
    return match ? match[1] : '';
  };
  const fileBaseName = (name) => (name || '').replace(/\\/g, '/').split('/').pop().replace(/\.sol$/i, '');

  if (!deployBtn || !deployMenu) return;

  if (confirmDeployBtn) confirmDeployBtn.disabled = true;
  if (confirmScanBtn) confirmScanBtn.disabled = true;
  if (solFileStatusDeploy) {
    solFileStatusDeploy.textContent = solFileStatusDeploy.textContent?.trim() || '📂 No file uploaded';
    solFileStatusDeploy.style.color = '';
  }
  if (solFileStatusScan) {
    solFileStatusScan.textContent = solFileStatusScan.textContent?.trim() || '📂 No file uploaded';
    solFileStatusScan.style.color = '';
  }

  const resetDeployState = () => {
    if (solFileInputDeploy) solFileInputDeploy.value = '';
    if (solFileStatusDeploy) { solFileStatusDeploy.textContent = '📂 No file uploaded'; solFileStatusDeploy.style.color = ''; }
    if (confirmDeployBtn) confirmDeployBtn.disabled = true;
    if (solFilePreviewDeploy) solFilePreviewDeploy.textContent = '';
    if (constructorArgsInputDeploy) constructorArgsInputDeploy.value = '';
    if (constructorArgsInputDeploy) constructorArgsInputDeploy.style.borderColor = '#ddd';
    uploadedFileName = '';
    uploadedSource = '';
  };
  const resetScanState = () => {
    if (solFileInputScan) solFileInputScan.value = '';
    if (solFileStatusScan) { solFileStatusScan.textContent = '📂 No file uploaded'; solFileStatusScan.style.color = ''; }
    if (confirmScanBtn) confirmScanBtn.disabled = true;
    if (solFilePreviewScan) solFilePreviewScan.textContent = '';
  if (confirmScanBtn) confirmScanBtn.textContent = 'Start Auditing';
  };

  const showTab = (name) => {
    if (isScanBusy || isDeployBusy) return;
    activeTab = name;
    const isDeploy = name === 'deploy';
    if (tabBtnDeploy && tabBtnScan) {
      tabBtnDeploy.classList.toggle('active', isDeploy);
      tabBtnDeploy.setAttribute('aria-selected', String(isDeploy));
      tabBtnScan.classList.toggle('active', !isDeploy);
      tabBtnScan.setAttribute('aria-selected', String(!isDeploy));
    }
    if (paneDeploy && paneScan) {
      paneDeploy.classList.toggle('active', isDeploy);
      paneScan.classList.toggle('active', !isDeploy);
    }
  };

  deployBtn.addEventListener('click', () => {
    showTab('deploy');
    deployMenu.classList.remove('hidden');
  });
  if (scanBtn) {
    scanBtn.addEventListener('click', () => {
      showTab('scan');
      deployMenu.classList.remove('hidden');
    });
  }

  if (tabBtnDeploy) tabBtnDeploy.addEventListener('click', () => showTab('deploy'));
  if (tabBtnScan) tabBtnScan.addEventListener('click', () => showTab('scan'));

  const closeModal = () => {
    deployMenu.classList.add('hidden');
    resetDeployState();
    resetScanState();
    showTab('deploy');
    userInput.focus();
  };
  if (closeDeployMenuBtn) closeDeployMenuBtn.addEventListener('click', () => { if (!isDeployBusy && !isScanBusy) closeModal(); });
  if (closeScanMenuBtn) closeScanMenuBtn.addEventListener('click', () => { if (!isDeployBusy && !isScanBusy) closeModal(); });

  if (solFileInputDeploy) {
    solFileInputDeploy.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
       const ok = !!file && /\.sol$/i.test(file.name);
      if (!solFileStatusDeploy || !confirmDeployBtn) return;

      if (ok) {
        solFileStatusDeploy.textContent = `✅ ${file.name} uploaded`;
        solFileStatusDeploy.style.color = '#28a745';
        confirmDeployBtn.disabled = false;
        if (solFilePreviewDeploy) {
          const reader = new FileReader();
          reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            const maxBytes = 20 * 1024;
            const trimmed = text.length > maxBytes ? text.slice(0, maxBytes) + '\n\n... (preview truncated) ...' : text;
            solFilePreviewDeploy.textContent = trimmed;
            uploadedFileName = file.name;
            uploadedSource = text;
          };
          reader.readAsText(file);
        }
      } else {
        solFileStatusDeploy.textContent = '❌ Invalid file. Please upload a .sol file';
        solFileStatusDeploy.style.color = '#c0392b';
        confirmDeployBtn.disabled = true;
        if (solFilePreviewDeploy) solFilePreviewDeploy.textContent = '';
        uploadedFileName = '';
        uploadedSource = '';
      }
    });
  }

  if (solFileInputScan) {
    solFileInputScan.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
       const ok = !!file && /\.sol$/i.test(file.name);
      if (!solFileStatusScan || !confirmScanBtn) return;

      if (ok) {
        solFileStatusScan.textContent = `✅ ${file.name} uploaded`;
        solFileStatusScan.style.color = '#28a745';
        confirmScanBtn.disabled = false;
        if (solFilePreviewScan) {
          const reader = new FileReader();
          reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            const maxBytes = 20 * 1024;
            const trimmed = text.length > maxBytes ? text.slice(0, maxBytes) + '\n\n... (preview truncated) ...' : text;
            solFilePreviewScan.textContent = trimmed;
            uploadedFileName = file.name;
            uploadedSource = text;
          };
          reader.readAsText(file);
        }
      } else {
        solFileStatusScan.textContent = '❌ Invalid file. Please upload a .sol file';
        solFileStatusScan.style.color = '#c0392b';
        confirmScanBtn.disabled = true;
        if (solFilePreviewScan) solFilePreviewScan.textContent = '';
        uploadedFileName = '';
        uploadedSource = '';
      }
    });
  }

  if (confirmDeployBtn) {
    confirmDeployBtn.addEventListener('click', async () => {
      if (!uploadedSource || !uploadedFileName) return;

      const inferredName = extractContractName(uploadedSource) || fileBaseName(uploadedFileName) || 'Unknown';
      addMessage('user', `I would like to deploy contract ${inferredName}`);

      const rawArgs = constructorArgsInputDeploy?.value?.trim() || '';
      if (constructorArgsInputDeploy) constructorArgsInputDeploy.style.borderColor = '#ddd';

      const network = await provider.getNetwork();
      const chainId = network.chainId;
      const info = getChainInfoById(chainId);
      if (info?.name) {
        networkName = info.name;
      } else {
        throw new Error(`There was a problem deploying a contract on this chain`);
      }

      const params = {
        userAddress: userAccount,
        fileName: uploadedFileName,
        source: uploadedSource,
        constructorArgs: rawArgs,
        networkName: networkName
      };

      logToInfoPanel('deploy.request', {
        contractName: inferredName,
        fileName: uploadedFileName,
        networkName,
        constructorArgsRaw: rawArgs || '',
        sourceBytes: uploadedSource.length
      });

      setDeployBusy(true);
      confirmDeployBtn.disabled = true;
      confirmDeployBtn.textContent = 'Deploying...';
      try {
        guiActionStartAt = performance.now();
        guiActionKind = 'Deploy';
        await executeAction("deploySC", params, addMessage, updateWalletInfoUI, (label, data) => logToInfoPanel(label, data), metrics);
      } finally {
        confirmDeployBtn.textContent = 'Deploy';
        confirmDeployBtn.disabled = false;
        setDeployBusy(false);
        deployMenu.classList.add('hidden');
        resetDeployState();
      }
    });
  }

  if (confirmScanBtn) {
    confirmScanBtn.addEventListener('click', async () => {
      if (!uploadedSource || !uploadedFileName) return;
      const inferredName = extractContractName(uploadedSource) || fileBaseName(uploadedFileName) || 'Unknown';
      addMessage('user', `I would like to scan contract ${inferredName} for vulnerabilities`);

      try {
        confirmScanBtn.disabled = true;
        confirmScanBtn.textContent = 'Scanning...';
        setScanBusy(true);
        const params = {
          contractName: inferredName,
          source: uploadedSource
        };
        logToInfoPanel('scan.request', {
          contractName: inferredName,
          fileName: uploadedFileName,
          sourceBytes: uploadedSource.length
        });
        guiActionStartAt = performance.now();
        guiActionKind = 'Scan';
        await executeAction("scanVulnerabilitiesApi", params, addMessage, updateWalletInfoUI, (label, data) => logToInfoPanel(label, data), metrics);
      } finally {
        confirmScanBtn.textContent = 'Start Auditing';
        confirmScanBtn.disabled = false;
        setScanBusy(false);
      }

      deployMenu.classList.add('hidden');
      resetScanState();
      userInput.focus();
    });
  }

})();

console.log('UI interaction module loaded');

if (mmIconWrap && mmTooltip) {
  mmIconWrap.addEventListener('mouseenter', async () => {
    try {
      if (userAccount) {
        const info = await updateWalletInfoUI().catch(() => lastWalletInfo);
        mmTooltip.innerHTML = renderWalletTooltip(info);
      } else {
        mmTooltip.textContent = 'Wallet not connected';
      }
      mmTooltip.classList.remove('hidden');
    } catch {
      mmTooltip.textContent = 'Wallet info unavailable';
      mmTooltip.classList.remove('hidden');
    }
  });
  mmIconWrap.addEventListener('mouseleave', () => {
    mmTooltip.classList.add('hidden');
  });
}
