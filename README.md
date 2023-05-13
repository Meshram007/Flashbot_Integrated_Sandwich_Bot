# Flashbot_Integrated_Sandwich_Bot
The MEV sandwich bot is a tool that leverages the flashbots MEV concept to carry out a sandwich attack. This attack involves placing two transactions around a target transaction, effectively blocking it from being executed by other market participants. By integrating with flashbots, the sandwich bot can send its transactions directly to miners.
To incentivize miners to include its transactions, the sandwich bot offers a bribe in the form of an additional fee. This fee is typically higher than the regular transaction fee and compensates miners for the additional risk they take by including the transaction in their block. By offering a bribe, the sandwich bot increases the probability of its transactions being included in the block and the likelihood of a successful sandwich attack.

## Doc
[Flashbot_Integrated_Sandwich_Bot](https://docs.google.com/document/d/1AhXBM9jTM-cKELirx7YHAX_8OCF8raVEeKWCCByQtg0/edit#)

## Transaction Receipts
FrontRun Tx:- [FrontRun Tx Receipt](https://etherscan.io/tx/0x1d94b94608a46cc42b661a15885c87f8260a4a80c131e6165f693020f765e26b)

BackRun Tx:- [BackRun Tx Receipt](https://etherscan.io/tx/0x193fb4d7ac1bdefa19b557e22802811091f1477489d3735e8431dd280d3758e4)

