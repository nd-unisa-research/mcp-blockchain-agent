import pathModule from 'path';
import fsModule from 'fs';

const DATA_DIR = pathModule.resolve(process.cwd(), '.data');
const DATA_FILE_PATH = pathModule.resolve(DATA_DIR, 'contracts.storage.json');
let cache = null;
let lastMtimeMs = 0; // Tracks last modification time

function ensureDataDir() {
  try {
    if (!fsModule.existsSync(DATA_DIR)) fsModule.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('ensureDataDir error:', e);
  }
}

function readFile() {
  try {
    ensureDataDir();
    if (!fsModule.existsSync(DATA_FILE_PATH)) return [];
    const raw = fsModule.readFileSync(DATA_FILE_PATH, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('readFile error:', e);
    return [];
  }
}

function writeFile(data) {
  try {
    ensureDataDir();
    const tmpPath = DATA_FILE_PATH + '.tmp';
    fsModule.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fsModule.renameSync(tmpPath, DATA_FILE_PATH);
  } catch (e) {
    console.error('writeFile error:', e);
  }
}

export function buildContractsResourceData() {
  let records = [];
  try {
    records = readFile();
  } catch {}
  let updatedAt = null;
  try {
    const stats = fsModule.statSync(DATA_FILE_PATH);
    updatedAt = stats.mtime.toISOString();
  } catch {}
  return {
    schemaVersion: 1,
    updatedAt,
    count: records.length,
    records
  };
}

// Load contracts from file (call at server startup)
export function loadContracts() {
  cache = readFile();
  return cache;
}

function getFileMtimeMs() {
  try {
    const stats = fsModule.statSync(DATA_FILE_PATH);
    return stats.mtimeMs || 0;
  } catch {
    return 0;
  }
}

async function ensureCache(force = false) {
  const fileExists = fsModule.existsSync(DATA_FILE_PATH);
  // If file was deleted, reset cache to empty array
  if (!fileExists) {
    cache = [];
    lastMtimeMs = 0;
  }
  if (!cache || force) {
    cache = fileExists ? readFile() : [];
    lastMtimeMs = getFileMtimeMs();
    return cache;
  }
  const currentMtime = getFileMtimeMs();
  if (fileExists && currentMtime && currentMtime > lastMtimeMs) {
    cache = readFile();
    lastMtimeMs = currentMtime;
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  writeFile(cache);
}

export async function saveContractInfo({
  userAddress,
  networkName,
  fileName,
  contractName,
  abi,
  bytecode,
  constructorArgs = [],
  contractAddress = null,
  deployTxHash = null,
}) {
  try {
    await ensureCache();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const record = {
      id,
      savedAt: new Date().toISOString(),
      userAddress: userAddress ? userAddress.trim() : null,
      networkName: networkName ? networkName.trim().toLowerCase() : null,
      fileName,
      contractName,
      abi,
      bytecodeHash: bytecode ? `0x${(bytecode.slice(0, 16) || '').toLowerCase()}...` : null,
      bytecodeLength: bytecode ? bytecode.length : 0,
      constructorArgs,
      contractAddress,
      deployTxHash
    };
    cache.push(record);
    await persist();
    return record;
  } catch (e) {
    console.error('saveContractInfo Error:', e);
    return null;
  }
}

export async function listContracts({ userAddress, networkName } = {}) {
  await ensureCache();
  const ua = userAddress ? userAddress.trim().toLowerCase() : null;
  const nn = networkName ? networkName.trim().toLowerCase() : null;
  return cache.filter(c => {
    if (ua && c.userAddress?.toLowerCase() !== ua) return false;
    if (nn && c.networkName?.toLowerCase() !== nn) return false;
    return true;
  });
}

export async function getContractById(id) {
  await ensureCache();
  return cache.find(c => c.id === id) || null;
}

export async function describeContracts({ contractAddress, contractName, networkName, userAddress, limit } = {}) {
  try {
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
      return { content: [{ type: 'text', text: 'No contract has been found.' }] };
    }

    if (records.length > 1) {
      const listPreview = records.map(r => `• ${r.contractName || '(Unnamed)'} @ ${r.contractAddress || 'N/A'} [${r.networkName}]`).join('<br>');
      return { content: [{ type: 'text', text: `⚠️ More contracts fullfil the requests (${records.length}). Specify the contract address.<br>${listPreview}` }] };
    }

    const contract = records[0];
    const abi = Array.isArray(contract.abi) ? contract.abi : [];
    if (!abi.length) {
      return { content: [{ type: 'text', text: '⚠️ No ABI found for this contract.' }] };
    }

    const max = 10;
    const fns = abi.filter(e => e.type === 'function');

    let text = `<strong>${contract.contractName || '(Unnamed Contract)'}</strong><br>` +
      `Address: <code>${contract.contractAddress || 'N/A'}</code><br>` +
      `Network: ${contract.networkName || 'N/A'}<br>` +
      `Owner/User: ${contract.userAddress || 'N/A'}<br>` +
      `Functions: ${fns.length}${fns.length > max ? ` (shown first ${max})` : ''}<br>`;

    text += '<br>⚠️ <strong>Arguments must be provided in strict positional order</strong> when calling functions (e.g. ["valueForParam1", 123, "0xabc..."]).';

    if (!fns.length) {
      text += '<br>No public functions found.';
    } else {
      text += '<br><br>🔧 <strong>Functions</strong>:<ul>';
      for (const fn of fns.slice(0, max)) {
        const sig = `${fn.name}(${(fn.inputs || []).map(i => i.type).join(',')})`;
        const mut = fn.stateMutability || (fn.constant ? 'view' : 'nonpayable');
        const io = formatInputs(fn.inputs) || '—';
        const outputs = (fn.outputs || []).map(o => o.type).join(', ') || '—';
        const readonly = ['view', 'pure'].includes(mut);
        const pay = mut === 'payable';
        const positionalOrder = (fn.inputs || []).map(i => i.name || '_').join(', ') || '—';
        text += `<li><code>${sig}</code><br>` +
          `Parameters ${io}<br>` +
          `Returns: ${outputs}<br>` +
          `Mutability: ${mut}${readonly ? ' (read-only)' : ''}${pay ? ' (value needed)' : ''}<br>` +
          `Template parameters: <code>${buildParamTemplate(fn.inputs)}</code><br>` +
          `Positional order: (<code>${positionalOrder}</code>)` +
          `</li>`;
      }
      text += '</ul>';
    }

    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `describeContracts error: ${e.message}` }] };
  }
}

// Helper functions to describe contracts
function formatInputs(inputs = []) {
  return inputs.map(i => `${i.name || '_'}:${i.type}`).join(', ');
}
function buildParamTemplate(inputs = []) {
  const obj = {};
  inputs.forEach(i => { obj[i.name || i.type] = i.type; });
  return JSON.stringify(obj);
}

// Dumping function for debugging
export async function _debugDumpContracts() {
  await ensureCache();
  return JSON.parse(JSON.stringify(cache));
}

// Exporting file path
export const CONTRACTS_FILE_PATH = DATA_FILE_PATH;
