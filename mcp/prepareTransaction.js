export async function prepareTransaction({ address, to, amount, networkName }) {
  try {
    const { ethers } = await import('ethers');
    const { supportedChains } = await import('../supportedChains.js');

    // Address Validation
    if (!ethers.utils.isAddress(address)) {
      throw new Error('Invalid sender address');
    }
    if (!ethers.utils.isAddress(to)) {
      throw new Error('Invalid recipient address');
    }

    // Amount Validation
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new Error('Invalid amount');
    }
    const valueWei = ethers.utils.parseEther(amount);

    // Chain Validation
    const chain = supportedChains[networkName.toLowerCase()];
    if (!chain) throw new Error(`Unknown network: ${networkName}`);

    const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);

    // Build transaction for estimation (use 'to' and 'value')
    const txForEstimation = {
      to,
      value: valueWei
    };

    // Gas Simulation
    const gasEstimate = await provider.estimateGas(txForEstimation);
    const gasPrice = await provider.getGasPrice();
    const gasCostWei = gasEstimate.mul(gasPrice);

    const gasCostEth = ethers.utils.formatEther(gasCostWei);
    const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');

    const transactionData = {
      address,
      to,
      amount,
      networkName,
      chainId: chain.chainId,
      symbol: chain.symbol,
      rpcUrl: chain.rpcUrl,
      gasEstimate: gasEstimate.toString(),
      gasPriceGwei,
      estimatedFeeEth: gasCostEth
    };

    const message = `Transaction prepared:<br>Send ${amount} ${chain.symbol} from ${address} to ${to} on ${networkName}.<br><br> Estimated Gas: ${gasEstimate.toString()} units<br> Gas Price: ${gasPriceGwei} Gwei<br>≈ Fee: ${gasCostEth} ${chain.symbol}<br><br>MetaMask will be used to sign and confirm it.`;

    return {
      content: [
        { type: 'text', text: message },
        { type: 'text', text: `__TXDATA__${JSON.stringify(transactionData)}` }
      ]
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text', text: `prepareTransaction error: ${msg}` }]
    };
  }
}
