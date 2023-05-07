const { ethers, utils, BigNumber } = require("ethers");
const {
  calcOptimalSandwichAmount,
  calcSandwichStates,
} = require("./src/calculation.js");

const UniswapV2PairAbi = require("./abi/UniswapV2Pair.json");
const sandwichABI = require("./abi/sandwichABI.json");
const WSS = "wss://mainnet.infura.io/ws/v3/7ccfe552bbd74cdf83adf65cae5fdbbd";
const provider = new ethers.providers.WebSocketProvider(WSS);
const SwapRouter02Abi = require("./abi/SwapRouter02.json");
const UNISWAPV2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const uniswapv2ABI = require("./abi/uniswapV2.json");
const erc20ABI = require("./abi/erc20ABI.json");


const provider1 = new ethers.providers.getDefaultProvider('http://127.0.0.1:8545/')
const account1 = new ethers.Wallet(''); // use private key of wallet.
const wallet = account1.connect(provider1);
let sandwichContract;

const router = new ethers.Contract(UNISWAPV2_ROUTER, uniswapv2ABI, wallet);
const wethContract = new ethers.Contract(WETH, ['function deposit() payable', 'function balanceOf(address account) external view returns (uint256)', 'function approve(address spender, uint256 amount) external returns (bool)','function allowance(address owner, address spender) external view returns (uint256)'], wallet);
const amountInEth = 10; // amount of ETH to convert to WETH
const amountInWei = ethers.utils.parseEther(amountInEth.toString());



// Set up your Uniswap v2 instance
const uniswapRouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Replace with Uniswap Router v2 address
const uniswapRouterABI = ['function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory)','function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)']; // Replace with Uniswap Router v2 ABI
const uniswapRouter = new ethers.Contract(uniswapRouterAddress, uniswapRouterABI, provider1);
const uniswapRouterHandler = new utils.Interface(uniswapv2ABI);

// Set up your ERC20 token instances
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // Replace with WETH address
const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // Replace with DAI address
const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Replace with USDC address
const wethABI = ['function deposit() public payable','function approve(address spender, uint amount) external returns (bool)','function balanceOf(address account) external view returns (uint256)'];
const daiABI = ['function approve(address spender, uint amount) external returns (bool)','function balanceOf(address account) external view returns (uint256)']; // Replace with DAI ABI
const usdcABI = ['function approve(address spender, uint amount) external returns (bool)','function balanceOf(address account) external view returns (uint256)']; // Replace with USDC ABI
const weth = new ethers.Contract(wethAddress, wethABI, wallet);
const dai = new ethers.Contract(daiAddress, daiABI, wallet);
const usdc = new ethers.Contract(usdcAddress, usdcABI, wallet);

const iface = new ethers.utils.Interface(SwapRouter02Abi);

const getUniv2Reserves = async (pair, tokenA, tokenB) => {
  const [token0] = sortTokens(tokenA, tokenB);
  let { reserve0, reserve1 } = await getReserves(pair, tokenA);

  if (tokenA.toLowerCase() === token0.toLowerCase()) {
    return [reserve0, reserve1];
  }
  return [reserve1, reserve0];
};

const getReserves = async (pairAddress, tokenA) => {

  const pairContract = new ethers.Contract(
    pairAddress,
    [
      'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      `function token0() external view returns (address)`,
    ],
    provider
  );

  let reserve0, reserve1;
  try {
    [reserve0, reserve1] = await pairContract.getReserves();
  } catch (error) {
    console.error('Error getting reserves:', error);
  }

  const token = await pairContract.token0();
  return {
    reserve0: tokenA === token ? reserve0 : reserve1,
    reserve1: tokenA === token ? reserve1 : reserve0,
  };
};

const getUniv2PairAddress = (tokenA, tokenB) => {
  const [token0, token1] = sortTokens(tokenA, tokenB);

  const salt = ethers.utils.keccak256(token0 + token1.replace("0x", ""));
  const address = ethers.utils.getCreate2Address(
    "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Factory address (contract creator)
    salt,
    "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f" // init code hash
  );

  return address;
};

const sortTokens = (tokenA, tokenB) => {
  if (ethers.BigNumber.from(tokenA).lt(ethers.BigNumber.from(tokenB))) {
    return [tokenA, tokenB];
  }
  return [tokenB, tokenA];
};

async function filterTx(tx) {
  const { to, data, maxFeePerGas, maxPriorityFeePerGas, gasPrice, gasLimit, type } = tx;
  // decode tx data
  let txData = uniswapRouterHandler.parseTransaction({ data });
  let { args } = txData;
  let { deadline } = args;

  let amountIn, amountOutMin, path, token0, token1, hash;

  if (to == UNISWAPV2_ROUTER) {
    const sigHash = data.slice(0, 10);
    // swapExactETHForTokens(uint256,address[],address,uint256)
    if (sigHash.toLowerCase() == "0x7ff36ab5") {
      [amountOutMin, path] = ethers.utils.defaultAbiCoder.decode(
        ["uint256", "address[]", "address", "uint256"],
        ethers.utils.hexDataSlice(data, 4)
      );
      amountIn = tx.value;
      token0 = WETH;
      token1 = path[1];
      hash = tx.hash;
    }
    // swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
    if (sigHash.toLowerCase() == "0x38ed1739") {
      [amountIn, amountOutMin, path] = ethers.utils.defaultAbiCoder.decode(
        ["uint256", "uint256", "address[]", "address", "uint256"],
        ethers.utils.hexDataSlice(data, 4)
      );
      token0 = path[0];
      token1 = path[path.length - 1];
      hash = tx.hash;
    }
  }

  if (
    amountIn == undefined ||
    amountOutMin == undefined ||
    token1 == undefined ||
    token0 == undefined
  ) {
    return;
  }
  
  amountInCheck =  ethers.utils.formatEther(amountIn.toString())
  try {
    if(amountInCheck <= 10) {
      token1 = path[path.length - 1];
  
      console.log("\nTransaction found to make sandwich...");
      console.log(
        JSON.stringify(
          {
            hash: hash,
            swap: token0,
            target: token1,
            amountIn: ethers.utils.formatEther(amountIn.toString()),
            amountOutMin: ethers.utils.formatEther(amountOutMin),
          },
          null,
          "\t"
        )
      );
  
      // if tx deadline has passed, skip it as we can't sandwich it
      if (deadline.lte(BigNumber.from(Math.floor(Date.now() / 1000)))) {
        console.info(`Transaction deadline has passed`, { hash });
        return;
      }
  
      const pairAddress = getUniv2PairAddress(WETH, token1);
      const [reserveWETH, reserveToken] = await getUniv2Reserves(
        pairAddress,
        WETH,
        token1
      );
  
      console.log(reserveWETH.toString(), reserveToken.toString(),"reserveWETH  ------- reserveToken")
      const optimalSandwichAmount = calcOptimalSandwichAmount(
        amountIn,
        amountOutMin,
        reserveWETH,
        reserveToken
      );
      console.log(
        "Optimal AmountIn for Sandwich: ",
        ethers.utils.formatEther(optimalSandwichAmount.toString())
      );
  
      const sandwichStates = calcSandwichStates(
        amountIn,
        amountOutMin,
        reserveWETH,
        reserveToken,
        optimalSandwichAmount
      );
  
      if (sandwichStates === null) {
        console.log("Victim is not applicable for sandwich as it receiving less amount");
        return;
      }
  
      /* First profitability check */
      const rawProfits = sandwichStates.backrunState.amountOut.sub(
        optimalSandwichAmount
      );
      console.log(
        "Profits obtained: ",
        ethers.utils.formatEther(rawProfits).toString()
      );
  
      if (rawProfits < 0) {
      console.log("Not profitable to sandwich before transaction costs \n");
      return;
      }
  
      const path1 = [WETH, token1];
      console.log(path1, "path1??????????????????????")
      const value1 = sandwichStates.optimalSandwichAmount;
      console.log(value1.toString(), "value1??????????????????????")
      const deadline1 = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
  
  
    // Sandwich (x3 Gas multiplier for front run)
      const block = await provider.getBlock();
      const baseFeePerGas = block.baseFeePerGas; // wei
      const nonce = await provider.getTransactionCount(wallet.address, 'latest');
  
      const frontrunMaxPriorityFeePerGas =
        type === 2 ? maxPriorityFeePerGas.mul(3) : gasPrice.mul(3);
      const frontrunMaxFeePerGas = frontrunMaxPriorityFeePerGas.add(baseFeePerGas);
      console.log(frontrunMaxPriorityFeePerGas.toString(), "frontrunMaxPriorityFeePerGas..............")
      console.log(frontrunMaxFeePerGas.toString(), "frontrunMaxFeePerGas..............")
  
      const amoutOutMinNew = await router.getAmountsOut(value1.toString(), path1);
      console.log(amoutOutMinNew[1].toString(), "amoutOutMinNew..............")
  
      let TokenBalance  = await erc20(wallet, token1).balanceOf(wallet.address);
      console.log(`Token balance: ${TokenBalance.toString()}`);
  
      const gasLimitCheck = await uniswapRouter.estimateGas.swapExactETHForTokens(
        amoutOutMinNew[1],
        path1,
        wallet.address,
        deadline1,
        { value: value1 }
      );
      console.log(gasLimitCheck.toString(), "gasLimitCheck??????????????????????")
      const totalETH = (value1.add(gasLimitCheck));
      console.log(totalETH.toString(), "totalETH??????????????????????")
  
      const txOptions = {
        value: totalETH,
        maxPriorityFeePerGas: frontrunMaxPriorityFeePerGas,
        maxFeePerGas: frontrunMaxFeePerGas,
      };

      const frontrunGasEstimate = await simulateFrontRunTransaction(
        amoutOutMinNew[1],
        path1,
        wallet.address,
        deadline1,
        value1,
        txOptions 
      );
      if (frontrunGasEstimate == undefined) {
        console.log("Frontrun simulation failed");
        return;
      }
  
      const wethBalanceBefore = await wethContract.balanceOf(wallet.address);
      console.log(`WETH balance before: ${wethBalanceBefore.toString()}`);
  
      const frontrunTx = await uniswapRouter.connect(wallet).swapExactETHForTokens(amoutOutMinNew[1], path1, wallet.address, deadline1, txOptions);
      let frontrunReceipt = await frontrunTx.wait();
      
      let frontrunTxCost;
      try {
        const frontrunGasUsed = frontrunReceipt.gasUsed;
        const frontrunGasPrice = frontrunReceipt.effectiveGasPrice;
        frontrunTxCost = frontrunGasUsed.mul(frontrunGasPrice);
        const frontrunTxHash = frontrunReceipt.transactionHash;
        console.log(
          `Frontrun Transaction: https://mainnetFork.etherscan.io/tx/${frontrunTxHash}`
        );
      } catch (e) {
        if (e.code == ethers.errors.CALL_EXCEPTION) {
          console.log("Frontrun Swap failed.");
        }
        return;
      }
      let SwappedTokenBalance  = await erc20(wallet, token1).balanceOf(wallet.address);
      console.log(`Swapped Token balance: ${SwappedTokenBalance.toString()}`);
  
      console.log(frontrunTxCost.toString(), "frontrunTxCost>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
  
      const amountInToken = SwappedTokenBalance.sub(TokenBalance);
      console.log(amountInToken.toString(), "amountInToken>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
  
      // Get amount out estimate
      const path2 = [token1, WETH];
      console.log(path2, "path2>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
      const amountsOutNew = await router.getAmountsOut(amountInToken.toString(), path2);
      const amountsOutETH = amountsOutNew[1];
      console.log(amountsOutETH.toString(), "amountsOutETH>>>>>>>>>>>>>>>>>>>>>>>>>>>>");
  
      await erc20(wallet, token1).approve(UNISWAPV2_ROUTER, SwappedTokenBalance);
      const allowance = await erc20(wallet, token1).allowance(wallet.address, UNISWAPV2_ROUTER);
      console.log(`Amount allowed to router to spend: ${allowance.toString()}`)
      
  
      // Set up transaction options
      const txOptionsOut = {
        value: 0,
        gasPrice: gasPrice,
        gasLimit: gasLimit,
      };
  
      console.log(txOptionsOut, "txOptionsOut>>>>>>>>>>>>>>>>>>>>>>>>>>>>");

      const backrunGasEstimate = await simulateBackRunTransaction(
        amountInToken,
        amountsOutETH,
        path2,
        wallet.address,
        deadline1,
        gasLimit, 
      );
      if (backrunGasEstimate == undefined) {
        console.log("backrun simulation failed");
        return;
      }
  
      // Execute swap
      const backrunTx = await uniswapRouter.connect(wallet).swapExactTokensForETH(
        amountInToken,
        amountsOutETH,
        path2,
        wallet.address,
        deadline1,
        txOptionsOut
      );
      let backrunReceipt = await backrunTx.wait();
  
      let backrunTxCost;
      try {
        const backrunGasUsed = backrunReceipt.gasUsed;
        const backrunGasPrice = backrunReceipt.effectiveGasPrice;
        backrunTxCost = backrunGasUsed.mul(backrunGasPrice);
        const backrunTxHash = backrunReceipt.transactionHash;
        console.log(
          `Backrun Transaction: https://mainnetFork.etherscan.io/tx/${backrunTxHash}`
        );
        const netProfits = rawProfits.sub(frontrunTxCost).sub(backrunTxCost);
        // const wethBalanceAfter = await wethContract.balanceOf(wallet.address);
        // console.log(`WETH balance after: ${wethBalanceAfter.toString()}`);
        
        // console.log(
        //   "Net Profits Obtained: ",
        //   (wethBalanceAfter.sub(wethBalanceBefore)).toString()
        // );
  
        console.log(
          "Net Profits: ",
          ethers.utils.formatEther(netProfits).toString()
        );
      } catch (e) {
        if (e.code == ethers.errors.CALL_EXCEPTION) {
          console.log("Backrun Swap failed.");
        }
        return;
      }
    } else {
      console.info(`Skipped: Amount ${ethers.utils.formatEther(amountIn.toString())}ETH is more 0.1ETH`);
    } 
  } catch (error) {
    console.info(`failed to make sandwich`)
  }
  setTimeout(() => {}, "10");
}

async function main() {
  console.info(`Setting up defaults`);
  console.info(`- - - `);
  console.info(`Monitoring mempool... ✔️\n`);
  console.info(`Processing transactions ✔️\n`);
 // Deposit your ETH into WETH
await wethContract.deposit({ value: amountInWei });
await wethContract.approve(UNISWAPV2_ROUTER, "10000000000000000000000000");
const allowanceForRouter = await wethContract.allowance(wallet.address, UNISWAPV2_ROUTER);
console.log(`Allowance for uniswap router v2 contract: ${allowanceForRouter.toString()}`);
const wethBalance = await wethContract.balanceOf(wallet.address);
  console.log(`WETH balance: ${wethBalance.toString()}`);

  provider.on("pending", function (hash) {
    provider.getTransaction(hash).then(function (tx) {
      if (tx == null) return;
      if (tx.to == UNISWAPV2_ROUTER && (tx['data'].includes("0x7ff36ab5"))){
        filterTx(tx);
      } 
    });
  });
}


const simulateFrontRunTransaction = async (
  amountsOutToken,
  path1,
  wallet,
  deadline1,
  value1,
  txOptions 
) => {
  try {
    const result = await uniswapRouter.callStatic.swapExactETHForTokens(
      amountsOutToken,
      path1,
      wallet,
      deadline1,
      txOptions
    );
console.log(result.toString(), "front tak aa raha hai na bhai");

    const gasEstimate = await uniswapRouter.estimateGas.swapExactETHForTokens(
      amountsOutToken,
      path1,
      wallet,
      deadline1,
      { value: value1 }
    );

    return gasEstimate;
  } catch (e) {
    if (e.code == ethers.errors.CALL_EXCEPTION) {
      console.log("Simulation failed for swapExactETHForTokens.");
      return;
    }
  }
};


const simulateBackRunTransaction = async (
  amountInToken,
  amountsOutETH,
  path2,
  wallet,
  deadline1,
  gasLimit,  
) => {
  try {
    const result = await uniswapRouter.callStatic.swapExactTokensForETH(
      amountInToken,
      amountsOutETH,
      path2,
      wallet,
      deadline1,
      {gasLimit: gasLimit}
    );

    console.info(result.toString(), `bhai tu aa raha hai na ayaa tak`);

    const gasEstimate = await uniswapRouter.estimateGas.swapExactTokensForETH(
      amountInToken,
      amountsOutETH,
      path2,
      wallet,
      deadline1,
      { value: 0 }
    );

    console.info(gasEstimate.toString(), `gasEstimate`);

    return gasEstimate;
  } catch (e) {
    if (e.code == ethers.errors.CALL_EXCEPTION) {
      console.log("Simulation failed for swapExactTokensForETH.");
      return;
    }
  }
};



// Function to interact with the ERC20
function erc20(wallet, tokenAddress) {
  return new ethers.Contract(tokenAddress, [
    'function balanceOf(address account) external view returns (uint256)', 
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)'
  ], wallet);
}

main();
