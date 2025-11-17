export async function isRelevant(userMessage) {

  const systemPrompt = `You are a relevance classifier. 
  Decide if the user's message is relevant to agent's operations or related system components.

  The context includes:
  - Actions the agent can perform:
      Supported actions: balances, transactions, gas prices, cryptocurrencies prices in fiat currencies, preparing/confirming/denying transactions, deploying contracts, list deployed contracts, ask for functions/parameters of those contracts, interact with contracts, write a smart contract, do a smart contract audit
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

  try {
    const response = await fetch("http://localhost:3000/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 20,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const text = (data.content?.[0]?.text || "{}").trim();

    try {
      const parsed = JSON.parse(text);
      console.log("Relevance classifier output:", parsed.relevant);
      return parsed.relevant === true;
    } catch (parseError) {
      return false;
    }
  } catch (err) {
    return false;
  }
}
