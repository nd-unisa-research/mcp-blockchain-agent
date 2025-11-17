import { ethers } from "ethers";
import { supportedChains } from "../supportedChains.js";

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

function buildV2Url(chainId, params) {
  const usp = new URLSearchParams({ chainid: String(chainId), ...params });
  const key = process.env.ETHERSCAN_API_KEY;
  if (key) usp.append("apikey", key);
  return `${ETHERSCAN_V2_BASE}?${usp.toString()}`;
}

async function fetchV2(chainId, params) {
  const url = buildV2Url(chainId, params);
  const res = await fetch(url);
  const data = await res.json();
  return { data, url };
}

export async function fetchTransactionHistory(address, networkName) {
  try {
    const userAddress = ethers.utils.getAddress(address);
    const chain = supportedChains[networkName.toLowerCase()];
    if (!chain) throw new Error(`Unknown network: ${networkName}`);

    if (!chain.apiUrl) {
      return { content: [{ type: "text", text: `⚠️ Transaction history not supported on ${networkName}.` }] };
    }

    const { data: normalData } = await fetchV2(chain.chainId, {
      module: "account",
      action: "txlist",
      address: userAddress,
      startblock: "0",
      endblock: "99999999",
      page: "1",
      offset: "5",
      sort: "desc"
    });

    let results = Array.isArray(normalData?.result) ? normalData.result : [];
    let source = "normal";

    const normalOk = normalData?.status === "1" && results.length > 0;

    let internalData;
    if (!normalOk) {
      ({ data: internalData } = await fetchV2(chain.chainId, {
        module: "account",
        action: "txlistinternal",
        address: userAddress,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "5",
        sort: "desc"
      }));
      if (internalData?.status === "1" && Array.isArray(internalData.result) && internalData.result.length) {
        results = internalData.result;
        source = "internal";
      }
    }

    if (!results || results.length === 0) {
      const apiMsg = normalData?.message || internalData?.message || "No transactions found";
      const apiResultMsg = typeof normalData?.result === "string" ? normalData.result : (typeof internalData?.result === "string" ? internalData.result : "");

  const hints = [];
  if (/invalid api key/i.test(apiMsg) || /invalid api key/i.test(apiResultMsg)) hints.push("Invalid or missing ETHERSCAN_API_KEY.");
  if (/rate limit/i.test(apiMsg) || /rate limit/i.test(apiResultMsg)) hints.push("Explorer rate limit reached. Try again later or add ETHERSCAN_API_KEY.");

      const addrLink = chain.explorerUrl ? `${chain.explorerUrl}/address/${userAddress}` : null;
      const baseText = ` No transactions returned by the explorer for ${userAddress} on ${networkName}.`;
      const detail = apiMsg && apiMsg !== "No transactions found" ? ` Explorer message: ${apiMsg}.` : "";
      const extra = apiResultMsg && apiResultMsg !== "No transactions found" ? ` Details: ${apiResultMsg}.` : "";
      const hintText = hints.length ? `\n ${hints.join(" ")}` : "";
      const linkText = addrLink ? `\n Check on explorer: <a href="${addrLink}" target="_blank">${addrLink}</a>` : "";

      return { content: [{ type: "text", text: `${baseText}${detail}${extra}${hintText}${linkText}` }] };
    }

    let msg = ` Last ${Math.min(5, results.length)} ${source === "internal" ? "internal " : ""}transactions of <code>${userAddress}</code> on <strong>${networkName}</strong>:<br><ul>`;
    for (const tx of results) {
      const valueWei = tx.value ?? "0";
      const ethValue = (() => { try { return ethers.utils.formatEther(valueWei); } catch { return "0"; } })();
      const ts = Number(tx.timeStamp) || 0;
      const date = ts ? new Date(ts * 1000).toLocaleString() : "Unknown time";
      const status = (tx.isError === "0" || tx.isError === 0 || tx.isError === undefined) ? "Success" : "Failed";
      const txHash = tx.hash || tx.transactionHash;
      const to = tx.to || tx.contractAddress || "Contract creation";
      const link = chain.explorerUrl && txHash ? `${chain.explorerUrl}/tx/${txHash}` : null;
      msg += `<li>[${date}] → <strong>${ethValue} ${chain.symbol}</strong> → <code>${to}</code> | ${status}${link ? ` | <a href="${link}" target="_blank">Details</a>` : ''}</li>`;
    }
    msg += "</ul>";

    return { content: [{ type: "text", text: msg }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `getTransactions error: ${msg}` }] };
  }
}
