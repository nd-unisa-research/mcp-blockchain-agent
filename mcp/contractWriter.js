import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';

const SYSTEM_PROMPT = `
  You are an expert blockchain developer specializing in writing, reviewing, and optimizing smart contracts that are secure, efficient, and production-ready.
  Your task is to generate a complete, functional smart contract based on the description provided by the user.

  STRICT CONSTRAINTS (apply even if the user explicitly asks otherwise):
  - Do NOT include any import statements.
  - Do NOT use any external libraries or packages (including OpenZeppelin), even if the user requests them.
  - If typical functionality would normally rely on external libraries (e.g., ERC-20/721 base contracts, Ownable, Pausable, ReentrancyGuard), provide minimal, safe inline implementations directly within the single contract file.

  General Instructions:
  1. Goal:
    Write a smart contract that implements the user’s requested functionality in a clear, secure, and standards-compliant way.
  2. Language:
    If the user specifies a programming language, use that one (e.g., Solidity, Vyper, Rust, Move, Cairo, etc.).
    If no language is specified, default to Solidity.
  3. Compiler Version:
    If the user does not specify a version, use the latest stable compiler version (e.g., pragma solidity ^0.8.26; or the most recent available).
  4. Contract Structure:
    Always include:
      - A pragma statement defining the compiler version
      - An SPDX-License-Identifier (MIT if none is specified)
      - A clear and meaningful contract name
      - No external imports or libraries; inline minimal safe implementations when needed
      - Clear NatSpec-style comments (///)
    If appropriate, include simple usage examples or test scaffolds (as comments)
  5. Security and Best Practices:
    Avoid common vulnerabilities (reentrancy, integer overflow/underflow, missing access control, etc.)
    Apply known patterns like Ownable, ReentrancyGuard, and Checks-Effects-Interactions using inline minimal implementations
    Do NOT reference or depend on external libraries (e.g., OpenZeppelin)
    Comment on all critical sections to explain the logic and security reasoning
  6. Output Format:
    Return only code, cleanly formatted and ready to compile, in a single \`\`\`solidity fenced code block.
    If needed, include a brief technical explanation after the code block (never inside it).
    Do not include greetings, filler text, or non-technical commentary.
  7. Tone and Style:
    Professional, concise, and technical
    Clean indentation, consistent naming, and well-structured code
`;

export async function writeContract(userMessage) {
    try {
        const message = typeof userMessage === 'string' ? userMessage : '';
        if (!message.trim()) {
        return { isError: true, content: [{ type: 'text', text: '❌ No requirements found.' }] };
        }

        const body = {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
            { role: 'user', content: message }
        ]
        };

        const resp = await fetch('http://localhost:3000/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
        });

        if (!resp.ok) {
        const errText = await safeText(resp);
        return { isError: true, content: [{ type: 'text', text: `❌ Error calling the model: ${resp.status} ${resp.statusText} ${errText}` }] };
        }

        const data = await resp.json();
        const rawOutput = extractTextFromResponse(data);
        const solidity = extractSolidity(rawOutput);
        if (!solidity || !/pragma\s+solidity/i.test(solidity)) {
        return { isError: true, content: [{ type: 'text', text: '❌ The model didn\'t give any valid contract as an output.' }] };
        }

        const contractName = guessContractName(solidity) || 'Contract';
        const safeName = sanitizeName(contractName) || 'Contract';

        const moduleDir = path.dirname(fileURLToPath(import.meta.url));
        const projectRoot = path.resolve(moduleDir, '..');
        const generatedDir = path.join(projectRoot, '.generated-contracts');
        await fs.mkdir(generatedDir, { recursive: true });

        const ts = new Date();
        const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}_` +
                    `${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
        const fileName = `generated-${safeName}-${stamp}.sol`;
        const filePath = path.join(generatedDir, fileName);
        await fs.writeFile(filePath, solidity, 'utf-8');

        const link = `http://localhost:3000/generated/${encodeURIComponent(fileName)}`;
        const disclaimer = "Disclaimer: Do not rely on this automatically generated code. It must be reviewed by a qualified expert, and a thorough security audit is strongly recommended before any deployment.";
        const text = `Generated and saved contract: <a href="${link}" target="_blank" rel="noopener">${fileName}</a><br><br>${disclaimer}`;
        return { content: [{ type: 'text', text }] };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text', text: `❌ Error during contract generation: ${msg}` }] };
    }
}

async function safeText(resp) {
  try { return await resp.text(); } catch { return ''; }
}

function extractTextFromResponse(apiResponse) {
  const blocks = Array.isArray(apiResponse?.content) ? apiResponse.content : [];
  const text = blocks
    .filter(b => typeof b?.text === 'string')
    .map(b => b.text)
    .join('\n');
  return text || apiResponse?.output_text || '';
}

function extractSolidity(text) {
  if (!text) return '';
  const src = String(text);

  const fenceRegexes = [
    /```solidity\n([\s\S]*?)```/i,
    /```sol\n([\s\S]*?)```/i,
    /```\n([\s\S]*?)```/i
  ];
  for (const re of fenceRegexes) {
    const m = src.match(re);
    if (m && m[1] && /pragma\s+solidity/i.test(m[1])) return m[1].trim();
  }

  const pragmaIdx = src.search(/pragma\s+solidity[^;]*;/i);
  if (pragmaIdx >= 0) {
    return src.slice(pragmaIdx).trim();
  }
  return '';
}

function guessContractName(solidity) {
  const m = String(solidity).match(/\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return m ? m[1] : '';
}

function sanitizeName(name) {
  if (!name) return '';
  return String(name).replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 60) || '';
}
