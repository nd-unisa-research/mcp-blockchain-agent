import dotenv from "dotenv";
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env'),
  override: true
});

import express from "express";
import fetch from "node-fetch";
import cors from "cors";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveContractInfo, loadContracts } from './mcp/contracts.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.dirname(fileURLToPath(import.meta.url))));
// Serve generated reports for vulnerability scanning
app.use('/reports', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '.reports')));
// Serve generated contracts
app.use('/generated', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '.generated-contracts')));

// MCP Client Configuration
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolPath = path.resolve(__dirname, "mcp", "tools.js");

const client = new Client({
  name: "BlockchainAgentMCPClient",
  version: "1.0.0"
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [toolPath],
  env: {
    ...process.env
  }
});
await client.connect(transport);

// Load previously saved contracts
loadContracts();

console.log("MCP Client connected to the Server");
try {
  const toolsList = await client.listTools();
  const names = Array.isArray(toolsList?.tools) ? toolsList.tools.map(t => t.name) : [];
  console.log("MCP tools available:", names.join(", "));
} catch (e) {
  console.warn("⚠️ Unable to list MCP tools:", e?.message || e);
}

/*
const resp = await client.callTool({
  name: "ping",
  arguments: {}
});
console.log(resp);

const resp2 = await client.callTool({
  name: "getBalance",
  arguments: { address: "0x15648f643037121a4066Cb4921e9F3E6b02b2F93", networkName: "ganache" }
});
console.log(resp2);
*/

// Read Claude API key from environment
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
if (!CLAUDE_API_KEY) {
  console.warn("⚠️ CLAUDE_API_KEY is not set in the environment. The /api/claude endpoint will fail until it is configured.");
}

// Endpoint proxy to Claude
app.post("/api/claude", async (req, res) => {
  try {
    if (!CLAUDE_API_KEY) {
      return res.status(500).json({ error: "Missing CLAUDE_API_KEY environment variable on server" });
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error proxy:", err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint proxy to OpenAI
app.post('/api/gpt-relevance', async (req, res) => {
  try {
    const { model = 'gpt-5-nano', max_tokens = 50, messages = [] } = req.body || {};

    const input = (Array.isArray(messages) ? messages : []).map(m => ({
      role: m?.role || 'user',
      content: [{ type: 'input_text', text: String(m?.content ?? '') }]
    }));

    const response = await openai.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input }
      ],
    });

    return res.json({ output_text: response?.output_text ?? '' });
  } catch (err) {
    console.error('Error in /api/gpt-relevance:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// Invoking MCP Tool
app.post("/api/invokeMCPTool", async (req, res) => {
  const { action, ...args } = req.body || {};
  if (!action) return res.status(400).json({ error: "Missing 'action'" });

  try {
    const response = await client.callTool({
      name: action,
      arguments: args
    });
    return res.json(response);
  } catch (err) {
    console.error(`MCP ${action} error:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint to register deployed contract info
app.post('/api/registerDeployedContract', async (req, res) => {
  try {
    const { userAddress, networkName, fileName, contractName, abi, bytecode, constructorArgs, contractAddress, deployTxHash } = req.body || {};
    if (!contractAddress || !deployTxHash || !abi) {
      return res.status(400).json({ error: 'Missing required fields (contractAddress, deployTxHash, abi)' });
    }
    const record = await saveContractInfo({
      userAddress,
      networkName,
      fileName,
      contractName,
      abi,
      bytecode,
      constructorArgs,
      contractAddress,
      deployTxHash
    });
    return res.json({ ok: true, record });
  } catch (e) {
    console.error('registerDeployedContract error:', e);
    res.status(500).json({ error: e.message });
  }
});


// Server Start
const PORT = 3000;
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
