const { ethers, utils, Wallet, BigNumber } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle')

// import dynamic parameters from config
const config = require("./config.json");
// Setup ABIs and Bytecodes
const UniswapAbi = require("./abi/UniswapABI.json");

// Setup user modifiable variables
const flashbotsUrl = 'https://relay.flashbots.net'
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const uniswapAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' // UniswapV2Router02
const uniswapFactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
const httpProviderUrl = config.httpProviderUrl
const wsProviderUrl = config.wsProviderUrl
const privateKey = config.privateKey
const bribeParam = config.bribeToMiners
const bribeToMiners = ethers.utils.parseUnits(bribeParam, 'gwei')
const buyInput = config.buyAmount
const buyAmount = ethers.utils.parseUnits(buyInput, 'ether')
const chainId = 1
const MIN_SLIPPAGE_THRESHOLD = config.MIN_SLIPPAGE_THRESHOLD

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
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const uniswapv2ABI = require("./abi/uniswapV2.json");

const uniswapRouterHandler = new utils.Interface(uniswapv2ABI);

async function getAmountsOut(amountIn, path) {
    try {
        const amoutOutMinNew = await uniswap.getAmountsOut(amountIn, path);
        return amoutOutMinNew[1];
    } catch (e) {
        if (e.code == ethers.errors.CALL_EXCEPTION) {
            console.log("getAmountsOut failed");  //"getAmountsOut failed."
        }
        return;
    }
}

async function filterTx(tx) {
    const { to, data, maxFeePerGas, maxPriorityFeePerGas, gasPrice, gasLimit, type } = tx;
    // decode tx data
    let txData = uniswapRouterHandler.parseTransaction({ data });
    let { args } = txData
    const deadline1 = args.deadline;
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
        // if (deadline1.lte(BigNumber.from(Math.floor(Date.now() / 1000)))) { 
        //     console.info(`Transaction deadline has passed`, { hash }); 
        //     return; 
        // }

        if (
            maxFeePerGas == undefined ||
            maxPriorityFeePerGas == undefined
        ) {
            console.info(`Type 0 Transaction is not feasible for MEV.`, { hash });
            return;
        }

        let executionPrice;
        if (amountIn != 0) {
            executionPrice = await getAmountsOut(
                amountIn,
                path
            );
        }

        // calc target slippage
        let slippage = 0;
        slippage = executionPrice.sub(minAmountOut);

        slippage = (slippage / executionPrice) * 100;
        console.log("\nSlippage Targetting :", slippage);


        if (
            slippage <
            MIN_SLIPPAGE_THRESHOLD //~ 20%
        ) {
            console.log(
                `Skipping: Tx ${hash} Target slippage ${slippage} is < ${MIN_SLIPPAGE_THRESHOLD}%`
            );
            return;
        }

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
        const maxGasFee1 = transaction.maxFeePerGas 
        const priorityFee1 = transaction.maxPriorityFeePerGas

        console.info(`\nmaximum gas fee: ${(transaction.maxFeePerGas)}`);
        console.info(`\nmaximum priority per gas fee: ${(transaction.maxPriorityFeePerGas)}`);
        console.info(`\ngas limit: ${gasLimit}`);
        console.info(`\nbribe to flashbot miner: ${bribeToMiners}`);
        console.info(`\nmaxGasFee given to flashbot including bribe: ${maxGasFee}`);
        console.info(`\npriorityFee given to flashbot including bribe: ${priorityFee}`);

        // Buy using your amount in and calculate amount out
        let firstAmountOut = await uniswap.getAmountOut(buyAmount, a, b)
        const updatedReserveA = a.add(buyAmount)
        const updatedReserveB = b.add(firstAmountOut.mul(997).div(1000))
        let secondBuyAmount = await uniswap.getAmountOut(amountIn, updatedReserveA, updatedReserveB)

        console.log('\nOptimal AmountIn for Sandwich:', secondBuyAmount.toString())
        console.log('Victim minAmountOut', minAmountOut.toString())
        if (secondBuyAmount.lt(minAmountOut)) return console.log('Victim is applicable for sandwich as it receiving less amount')
        const updatedReserveA2 = updatedReserveA.add(amountIn)
        const updatedReserveB2 = updatedReserveB.add(secondBuyAmount.mul(997).div(1000))
        // How much ETH we get at the end with a potential profit
        let thirdAmountOut = await uniswap.getAmountOut(firstAmountOut, updatedReserveB2, updatedReserveA2)

        // Prepare first transaction
        const deadline = Math.floor(Date.now() / 1000) + 60 * 60 // 1 hour from now
        let firstTransaction = {
            signer: signingWallet,
            transaction: await uniswap.populateTransaction.swapExactETHForTokens(
                firstAmountOut,
                [
                    wethAddress,
                    tokenToCapture,
                ],
                signingWallet.address,
                deadline,
                {
                    value: buyAmount,
                    type: 2,
                    maxFeePerGas: maxGasFee,
                    maxPriorityFeePerGas: priorityFee,
                    gasLimit: gasLimit,
                }
            )
        }
        firstTransaction.transaction = {
            ...firstTransaction.transaction,
            chainId,
        }

        // Prepare second transaction
        const victimsTransactionWithChainId = {
            chainId,
            ...transaction,
        }
        
        const signedMiddleTransaction = {
            signedTransaction: ethers.utils.serializeTransaction(victimsTransactionWithChainId, {
                r: victimsTransactionWithChainId.r,
                s: victimsTransactionWithChainId.s,
                v: victimsTransactionWithChainId.v,
            })
        }

        // Prepare third transaction for the approval
        const erc20 = erc20Factory.attach(tokenToCapture)
        let thirdTransaction = {
            signer: signingWallet,
            transaction: await erc20.populateTransaction.approve(
                uniswapAddress,
                firstAmountOut,
                {
                    value: '0',
                    type: 2,
                    maxFeePerGas: maxGasFee1,
                    maxPriorityFeePerGas: priorityFee1,
                    gasLimit: gasLimit,
                }
            ),
        }
        thirdTransaction.transaction = {
            ...thirdTransaction.transaction,
            chainId,
        }

        // Prepare the last transaction to get the final eth
        let fourthTransaction = {
            signer: signingWallet,
            transaction: await uniswap.populateTransaction.swapExactTokensForETH(
                firstAmountOut,
                thirdAmountOut,
                [
                    tokenToCapture,
                    wethAddress,
                ],
                signingWallet.address,
                deadline,
                {
                    value: '0',
                    type: 2,
                    maxFeePerGas: maxGasFee,
                    maxPriorityFeePerGas: priorityFee,
                    gasLimit: gasLimit,
                }
            )
        }
        fourthTransaction.transaction = {
            ...fourthTransaction.transaction,
            chainId,
        }
        const transactionsArray = [
            firstTransaction,
            signedMiddleTransaction,
            thirdTransaction,
            fourthTransaction,
        ]
        const signedTransactions = await flashbotsProvider.signBundle(transactionsArray)
        const blockNumber = await provider.getBlockNumber()
        console.log('\nFrontrun and backrun simulation is under process......')
        const simulation = await flashbotsProvider.simulate(
            signedTransactions,
            blockNumber + 1,
        )
        if (simulation.firstRevert) {
            return console.log('\nFrontrun and backrun simulation failed', simulation.firstRevert)
        } else {
            console.log('\nFrontrun and backrun simulation success', simulation)
        }

        //Send transactions with flashbots
        /**
         * 
         * complete code is not pushed
         * 
         * 
         */
    } catch (error) {
        console.info(error) //"MEV sandwich flashbot failed"
    }
    setTimeout(() => { }, "10");
}

async function main() {
    flashbotsProvider = await FlashbotsBundleProvider.create(provider, signingWallet, flashbotsUrl)
    console.info(`Setting up defaults`);
    console.info(`- - - `);
    console.info(`Monitoring mempool... ✔️\n`);
    console.info(`Processing transactions ✔️\n`);
    wsProvider.on("pending", function (hash) {
        wsProvider.getTransaction(hash).then(function (tx) {
            if (tx == null) return;
            if (tx.to == UNISWAPV2_ROUTER && (tx['data'].includes("0x7ff36ab5"))) {
               // console.log(`tx obtained`, tx)
                filterTx(tx);
            }
        });
    });
}


main();
