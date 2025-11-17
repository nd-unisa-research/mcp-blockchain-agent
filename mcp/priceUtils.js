// Mapping currencies with corresponding flags
export const currencyFlags = {
  usd: '🇺🇸',
  eur: '🇪🇺',
  jpy: '🇯🇵',
  gbp: '🇬🇧',
  aud: '🇦🇺',
  cad: '🇨🇦',
  chf: '🇨🇭',
  cny: '🇨🇳',
  inr: '🇮🇳'
};

// Mapping symbols with corresponding currencies
export const currencySymbols = {
  usd: '$',
  eur: '€',
  jpy: '¥',
  gbp: '£',
  aud: 'A$',
  cad: 'C$',
  chf: 'CHF',
  cny: '¥',
  inr: '₹'
};

// Common alias -> CoinGecko ID mapping
const CRYPTO_ALIASES = {
  eth: 'ethereum', ether: 'ethereum', ethereum: 'ethereum',
  btc: 'bitcoin', xbt: 'bitcoin', bitcoin: 'bitcoin',
  bnb: 'binancecoin', binance: 'binancecoin',
  matic: 'matic-network', polygon: 'matic-network',
  pol: 'polygon-ecosystem-token',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  op: 'optimism', optimism: 'optimism',
  link: 'chainlink', chainlink: 'chainlink',
  dai: 'dai', usdc: 'usd-coin', 'usd-coin': 'usd-coin', usdt: 'tether', tether: 'tether'
};

function normalizeCrypto(raw) {
  if (!raw) return { id: 'ethereum', input: raw };
  const key = raw.toLowerCase().trim();
  const id = CRYPTO_ALIASES[key] || key;
  return { id, input: key };
}

// Retrieves the price of a crypto in one or more fiat currencies.
export async function fetchCryptoPrice(params) {
  try {
    const { id: cryptoId, input: originalInput } = normalizeCrypto(params?.crypto);

    const currencies = params?.currencies
      ? params.currencies.split(",").map(c => c.trim().toLowerCase())
      : ["usd", "eur"];

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=${currencies.join(",")}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch price: ${response.status}`);
    }

    const data = await response.json();

    if (!data[cryptoId]) {
      const suggestions = [];
      if (originalInput === 'polygon' || originalInput === 'matic') suggestions.push('Try: "matic" or "polygon"');
      if (originalInput === 'pol') suggestions.push('POL mapped internally to polygon-ecosystem-token');
      if (!suggestions.length) suggestions.push('Verify the token id on CoinGecko');
      return { content: [{ type: "text", text: `❌ Unsupported cryptocurrency: ${originalInput || '(empty)'}<br>${suggestions.join('<br>')}` }] };
    }

    const priceLines = currencies.map(cur => {
      const price = data[cryptoId]?.[cur];
      if (price === undefined) return null;
      const flag = currencyFlags[cur] || '';
      const symbol = currencySymbols[cur] || '';
      return `${flag} <strong>${cur.toUpperCase()}</strong>: ${symbol}${price.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    }).filter(line => line !== null);

    if (priceLines.length === 0) {
      return { content: [{ type: "text", text: "❌ No valid currency found for this request." }] };
    }

    return { content: [{ type: "text", text: `Current ${cryptoId.toUpperCase()} Price:<br>${priceLines.join("<br>")}` }] };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: `getPrice error: ${msg}` }] };
  }
}
