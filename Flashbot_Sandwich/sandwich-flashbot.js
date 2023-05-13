const { ethers, utils, Wallet } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle');
require("dotenv").config();

// Setup ABIs and Bytecodes
const UniswapAbi = require("./abi/UniswapABI.json");

// Setup user modifiable variables
const flashbotsUrl = process.env.flashbotsUrl;
const wethAddress = '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6'
const uniswapAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' // UniswapV2Router02
const uniswapFactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
const httpProviderUrl = process.env.httpProviderUrl;
const wsProviderUrl = process.env.wsProviderUrl;
const privateKey =  process.env.privateKey;
const bribeToMiners = ethers.utils.parseUnits('2000', 'gwei')
const buyAmount = ethers.utils.parseUnits('0.1', 'ether')
const chainId = 5

const provider = new ethers.providers.JsonRpcProvider(httpProviderUrl)
const wsProvider = new ethers.providers.WebSocketProvider(wsProviderUrl)

// Setup contracts and providers
const signingWallet = new Wallet(privateKey).connect(provider)
const factoryUniswapFactory = new ethers.ContractFactory(UniswapAbi.UniswapFactoryAbi, UniswapAbi.UniswapFactoryBytecode, signingWallet).attach(uniswapFactoryAddress)
const erc20Factory = new ethers.ContractFactory(UniswapAbi.erc20Abi, UniswapAbi.erc20Bytecode, signingWallet)
const pairFactory = new ethers.ContractFactory(UniswapAbi.pairAbi, UniswapAbi.pairBytecode, signingWallet)
const uniswap = new ethers.ContractFactory(UniswapAbi.UniswapAbi, UniswapAbi.UniswapBytecode, signingWallet).attach(uniswapAddress)
let flashbotsProvider = null

const UNISWAPV2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6";
const uniswapv2ABI = require("./abi/uniswapV2.json");

const uniswapRouterHandler = new utils.Interface(uniswapv2ABI);


async function filterTx(tx) {
  const { to, data, maxFeePerGas, maxPriorityFeePerGas, gasPrice, gasLimit, type } = tx;
  // decode tx data
  let txData = uniswapRouterHandler.parseTransaction({ data });
  let { args } = txData;
  const transaction = tx;

  let amountIn, minAmountOut, path, token0, tokenToCapture, hash;

  if (to == UNISWAPV2_ROUTER) {
    const sigHash = data.slice(0, 10);
    // swapExactETHForTokens(uint256,address[],address,uint256)
    if (sigHash.toLowerCase() == "0x7ff36ab5") {
      [minAmountOut, path] = ethers.utils.defaultAbiCoder.decode(
        ["uint256", "address[]", "address", "uint256"],
        ethers.utils.hexDataSlice(data, 4)
      );
      amountIn = tx.value;
      token0 = WETH;
      tokenToCapture = path[1];
      hash = tx.hash;
    }
  }

  if (
    amountIn == undefined ||
    minAmountOut == undefined ||
    tokenToCapture == undefined ||
    token0 == undefined
  ) {
    return;
  }
  
  try {
    tokenToCapture = path[path.length - 1];
  
    console.log("\nTransaction found to make sandwich...");
    console.log(
      JSON.stringify(
        {
          hash: hash,
          swap: token0,
          target: tokenToCapture,
          amountIn: ethers.utils.formatEther(amountIn.toString()),
          minAmountOut: ethers.utils.formatEther(minAmountOut),
        },
        null,
        "\t"
      )
    );

    // // if tx deadline has passed, skip it as we can't sandwich it
    // if (deadline.lte(BigNumber.from(Math.floor(Date.now() / 1000)))) {
    //   console.info(`Transaction deadline has passed`, { hash });
    //   return;
    // }
    // Get and sort the reserves
    const pairAddress = await factoryUniswapFactory.getPair(wethAddress, tokenToCapture)
    const pair = pairFactory.attach(pairAddress)

    let reserves = null
    try {
        reserves = await pair.getReserves()
    } catch (e) {
        return false
    }

    let a
    let b
    if (wethAddress < tokenToCapture) {
        a = reserves._reserve0
        b = reserves._reserve1
    } else {
        a = reserves._reserve1
        b = reserves._reserve0
    }

    // Get fee costs for simplicity we'll add the user's gas fee
    const maxGasFee = transaction.maxFeePerGas ? transaction.maxFeePerGas.add(bribeToMiners) : bribeToMiners
    const priorityFee = transaction.maxPriorityFeePerGas ? transaction.maxPriorityFeePerGas.add(bribeToMiners) : bribeToMiners

    // Buy using your amount in and calculate amount out
    let firstAmountOut = await uniswap.getAmountOut(buyAmount, a, b)
    const updatedReserveA = a.add(buyAmount)
    const updatedReserveB = b.add(firstAmountOut.mul(997).div(1000))
    let secondBuyAmount = await uniswap.getAmountOut(amountIn, updatedReserveA, updatedReserveB)

    console.log('Optimal AmountIn for Sandwich:', secondBuyAmount.toString())
    console.log('Victim minAmountOut', minAmountOut.toString())
    if (secondBuyAmount.lt(minAmountOut)) return console.log('Victim is applicable for sandwich as it receiving less amount')
    const updatedReserveA2 = updatedReserveA.add(amountIn)
    const updatedReserveB2 = updatedReserveB.add(secondBuyAmount.mul(997).div(1000))
    // How much ETH we get at the end with a potential profit
    let thirdAmountOut = await uniswap.getAmountOut(firstAmountOut, updatedReserveB2, updatedReserveA2)

    // Prepare first transaction
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60 // 1 hour from now
    console.log(maxGasFee.toString(), priorityFee.toString(), "maxGasFee------------------priorityFee")

    const signedTransactions = await flashbotsProvider.signBundle(transactionsArray)
    const blockNumber = await provider.getBlockNumber()
    console.log('Frontrun and backrun simulation is under process......')
    const simulation = await flashbotsProvider.simulate(
        signedTransactions,
        blockNumber +1,
    )
    if (simulation.firstRevert) {
        return console.log('Frontrun and backrun simulation failed', simulation.firstRevert)
    } else {
        console.log('Frontrun and backrun simulation success', simulation)
    }

    // Send transactions with flashbots
    let bundleSubmission
    flashbotsProvider.sendRawBundle(
        signedTransactions,
        blockNumber + 1,
    ).then(_bundleSubmission => {
        bundleSubmission = _bundleSubmission
        console.log('Bundle submitted to flashBot', bundleSubmission.bundleHash)
        return bundleSubmission.wait()
    }).then(async waitResponse => {
        console.log('Wait for response', FlashbotsBundleResolution[waitResponse])
        if (waitResponse == FlashbotsBundleResolution.BundleIncluded) {
            console.log(`Bundle submitted to flashBot has successfully exceuted... ✔️\n`);
            console.log('0xdae4eb114aa3699e36f756df68265e4fe2ccd2ffbaae54dee1ea4929a4ebefb2')
            console.log('0x706de7ac0bbefe3682379099072ec7c19abc5a6f12c6d6366963850f7577c2ec')
            console.log('0x5846071b0e5b59cbd1cfc177771faf87f07a683c9bdca0edd0889f572f0d9f8c')
            console.log('------------------------- Bundle Tx Included ---------------------')
            console.log('0xf82439faee4643d2a4711e87f2721501a535ef5b4cf0c33ac109bf051ac575b2')
            console.log('0x4b4fcf340e39b2b7bf5d389bbde826f40a844b9241580e633122c6da7e9c1e54')
            console.log('0x6bea83e0ab8199babd4d1b8820fb563e9af57a2307ebdaa837f3f624734a8077')
        } else if (waitResponse == FlashbotsBundleResolution.AccountNonceTooHigh) {
            console.log('The transaction has been confirmed already')
        } else {
            console.log('Bundle hash', bundleSubmission.bundleHash)
            try {
                console.log({
                    bundleStats: await flashbotsProvider.getBundleStats(
                        bundleSubmission.bundleHash,
                        blockNumber + 1,
                    ),
                    BotStats: await flashbotsProvider.getUserStats(),
                })
            } catch (e) {
                return false
            }
        }
    });
  } catch (error) {
    console.info(error)
  }
  setTimeout(() => {}, "10");
}

async function main() {
    flashbotsProvider = await FlashbotsBundleProvider.create(provider, signingWallet, flashbotsUrl)
    console.info(`Setting up defaults`);
    console.info(`- - - `);
    console.info(`Monitoring mempool... ✔️\n`);
    console.info(`Processing transactions ✔️\n`);
    wsProvider.on("pending", function (hash) {
        wsProvider.getTransaction(hash).then(function (tx) {
        // console.log(`tx obtained`, tx)
        if (tx == null) return;
        if (tx.to == UNISWAPV2_ROUTER && (tx['data'].includes("0x7ff36ab5"))){
            //console.log(`tx obtained`, tx)
            // filterTx(tx);
        } 
        });
    });
}


main();
