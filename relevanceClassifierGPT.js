import OpenAI from "openai";

const systemPrompt = `You are a relevance classifier. 
  Decide if the user's message is relevant to agent's operations or related system components.

  The context includes:
  - Actions the agent can perform:
      Supported actions: check balances, get transactions of an address, get details about a transaction, gas prices, cryptocurrencies prices in fiat currencies, preparing/confirming/denying transactions, deploying contracts, list deployed contracts, ask for functions/parameters of those contracts, interact with contracts, write a smart contract, do a smart contract audit
  - Information about the system itself (what it can do, supported chains, supported currencies, how it interacts with MetaMask, what components are used and how they work)
  - Explanations about wallets, blockchains, gas fees, only if related to the system's operations
  - User responses in the transaction confirmation flow (e.g., yes, confirm, approve, no, deny, reject, cancel)

  If the command is not strictly related to the above context, classify it as irrelevant.

  Relevant examples:
  - "Show my balance on Ethereum"
  - "How much gas will this transaction cost?"
  - "Deploy a contract"
  - "What is the price of Bitcoin in USD?"
  - "What chains are supported?"
  - "How does MetaMask connect to this system?"
  - "What can I do with this assistant?"
  - "yes"
  - "confirm"
  - "approve"
  - "no"
  - "deny"
  - "reject"
  - "cancel"

  Irrelevant examples:
  - "tell me a joke"
  - "what’s the weather?"
  - "who won the match?"
  - general knowledge questions not related to blockchain wallets or the system above
  - general chit-chat not related to the context above

  Rules:
  - Answer ONLY with strict JSON.
  - Do NOT add text before or after.
  - Do NOT explain your reasoning.

  Valid output:
  {
    "relevant": true
  }

  or

  {
    "relevant": false
  }`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const userMessage = "write a contract for me: Make DAO voting contract";

async function sendMessage(systemPrompt, userMessage) {
  const startTime = Date.now();

  const response = await openai.responses.create({
    model: "gpt-5-nano",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const endTime = Date.now();
  const elapsedMs = endTime - startTime;

  console.log("🧠 Risposta del modello:");
  console.log(response.output_text);

  console.log(`⏱️ Tempo risposta: ${elapsedMs} ms`);
}

sendMessage(systemPrompt, userMessage);
