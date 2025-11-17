import { fileURLToPath } from 'url';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY;

// Docs: https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk/smart-contracts-auditor-api-and-sdk/javascript/api-reference

const CHAINGPT_API_URL = 'https://api.chaingpt.org/chat/stream';
const REQUEST_TIMEOUT_MS = 120000;

export async function scanVulnerabilitiesApi({ contractName, source }) {
  try {
    if (!source || typeof source !== 'string') {
      return { isError: true, content: [{ type: 'text', text: '❌ Missing or invalid source code' }] };
    }

    if (!CHAINGPT_API_KEY) {
      return { isError: true, content: [{ type: 'text', text: '❌ Missing ChainGPT API key.' }] };
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CHAINGPT_API_KEY}`
    };

    const safeName = sanitizeName(contractName) || 'Contract';
    const question = buildAuditPrompt(safeName, source);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, REQUEST_TIMEOUT_MS));

    let resp;
    try {
      resp = await fetch(CHAINGPT_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'smart_contract_auditor',
          question,
          chatHistory: 'off'
        }),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      const msg = e?.name === 'AbortError' ? 'Request timed out' : (e?.message || String(e));
      return { isError: true, content: [{ type: 'text', text: `❌ Failed to contact ChainGPT API: ${msg}` }] };
    }
    clearTimeout(timeout);

    const textBody = await safeReadBody(resp);
    if (!resp.ok) {
      const shortBody = truncate(textBody, 2000);
      return { isError: true, content: [{ type: 'text', text: `❌ ChainGPT API error (${resp.status}): ${shortBody}` }] };
    }

    let data = null;
    let rawReport = textBody || '';
    try {
      const parsed = JSON.parse(textBody);
      data = parsed;
      if (parsed && parsed.data && typeof parsed.data.bot === 'string') {
        rawReport = String(parsed.data.bot);
      }
    } catch {
    }

    const { htmlSummary } = buildSummaryFromChainGptReport(rawReport);

    let reportUrl = null;
    let reportFilename = null;
    try {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      const projectRoot = path.resolve(moduleDir, '..');
      const reportsDir = path.join(projectRoot, '.reports');
      await fs.mkdir(reportsDir, { recursive: true });
      const ts = new Date();
      const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}_` +
                    `${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
      reportFilename = `api-scan-report-${safeName}-${stamp}.txt`;
      const reportPath = path.join(reportsDir, reportFilename);
      await fs.writeFile(reportPath, rawReport, 'utf-8');
      reportUrl = `/reports/${encodeURIComponent(reportFilename)}`;
    } catch {}

    const headerHtml = `<p><strong>Vulnerability scanning for contract:</strong> <code>${escapeHtml(safeName)}</code></p>`;
    const apiNote = `<p><em>Scanning performed via <strong>ChainGPT</strong>.</em></p>`;
    const downloadNote = reportUrl && reportFilename
      ? `<p>You can open the <strong>detailed API report</strong> here: <a href="${escapeHtml(fullUrl(reportUrl))}" target="_blank" rel="noopener">${escapeHtml(reportFilename)}</a></p>`
      : '';

    const text = `${headerHtml}${htmlSummary}${apiNote}${downloadNote}`;
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: 'text', text: `❌ scanVulnerabilitiesApi error: ${msg}` }] };
  }
}

function buildSummaryFromChainGptReport(rawReport) {
  const report = String(rawReport || '').replace(/\r\n/g, '\n');
  const lines = report.split('\n');
  const picked = lines.filter(l => l.trim().length).slice(0, 20);
  const html = `<pre style="white-space:pre-wrap">${escapeHtml(picked.join('\n'))}${lines.length > picked.length ? '\n…' : ''}</pre>`;
  return { htmlSummary: html };
}

function buildAuditPrompt(contractName, source) {
  const code = String(source || '');
  return `Audit the following Solidity smart contract named "${contractName}".
Please identify vulnerabilities grouped by severity (High/Medium/Low/Info), explain each finding, and provide remediation steps.
Also include any best-practice improvements. Here is the code:
\n\n\u0060\u0060\u0060solidity\n${code}\n\u0060\u0060\u0060`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeName(name) {
  if (!name) return '';
  return String(name).replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 60) || '';
}

function truncate(s, n) { return (s || '').length > n ? s.slice(0, n) + '…' : (s || ''); }

function fullUrl(rel) {
  if (!rel) return '';
  return rel.startsWith('http') ? rel : `http://localhost:3000${rel}`;
}

async function safeReadBody(resp) {
  try { return await resp.text(); } catch { return ''; }
}
