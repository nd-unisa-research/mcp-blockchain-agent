export async function deploySC({ userAddress, fileName, source, contractName, constructorArgs, networkName }) {
  try {
    const { ethers } = await import('ethers');
    const { supportedChains } = await import('../supportedChains.js');
    const solcModule = await import('solc');
    const solc = solcModule.default ?? solcModule;

    const chain = supportedChains[networkName.toLowerCase()];
    if (!chain) throw new Error(`Unknown network: ${networkName}`);
    const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);

    // Compilation
    const input = {
      language: 'Solidity',
      sources: { [fileName]: { content: source } },
      settings: {
        evmVersion: 'paris',
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { '*': { '*': ['*'] } }
      }
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    if (output.errors && output.errors.some(e => e.severity === 'error')) {
      return { isError: true, content: [{ type: 'text', text: '❌ Compilation failed.' }] };
    }

    const fileContracts = output.contracts[fileName];
    const name = contractName || Object.keys(fileContracts)[0];
    const compiled = fileContracts[name];
    if (!compiled) throw new Error(`Contract ${name} not found in ${fileName}`);

    const abi = compiled.abi;
    const bytecode = compiled.evm.bytecode.object;

    // Parsing constructor args and checking
    let ctorArgs = [];
    if (constructorArgs) {
      try {
        const parsed = typeof constructorArgs === 'string' ? JSON.parse(constructorArgs) : constructorArgs;
        if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
        ctorArgs = parsed;
      } catch (e) {
        throw new Error('Invalid constructor arguments format.');
      }
    }

    try {
      const factory = new ethers.ContractFactory(abi, bytecode, provider.getSigner?.() || new ethers.Wallet(ethers.constants.AddressZero));
      factory.getDeployTransaction(...ctorArgs);
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `❌ Constructor error: ${e.message}` }] };
    }

    // Estimate gas
    let gasEstimate = null;
    try {
      const factory = new ethers.ContractFactory(abi, bytecode);
      const deployTx = factory.getDeployTransaction(...ctorArgs);
      gasEstimate = await provider.estimateGas({
        from: userAddress,
        data: deployTx.data
      });
    } catch (e) {
      gasEstimate = null;
    }

    let gasCostEth = 'n/a';
    try {
      const gasPrice = await provider.getGasPrice();
      if (gasEstimate) {
        gasCostEth = ethers.utils.formatEther(gasPrice.mul(gasEstimate));
      }
    } catch (e) {
      gasCostEth = 'n/a';
    }

    const txData = {
      fileName,
      contractName: name,
      abi,
      bytecode,
      constructorArgs: ctorArgs,
      networkName,
      gasEstimate: gasEstimate ? gasEstimate.toString() : null,
      gasCostEth: gasCostEth
    };


    const msg = `Contract <strong>${name}</strong> compiled successfully.<br>
                  Network: ${networkName}<br>
                  Estimated gas: ${gasEstimate?.toString() || 'n/a'} units<br>
                  ~ Cost at current gas price: ${gasCostEth} ETH<br>
                  MetaMask will be used to confirm the deploy.`;

    return {
      content: [
        { type: 'text', text: msg },
        { type: 'text', text: `__DEPLOYDATA__${JSON.stringify(txData)}` }
      ]
    };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `deploySC error: ${err.message}` }] };
  }
}
