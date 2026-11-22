# secured Crypto Lending Pool — Tutorial

**Contact:** fireworksblockchaintech@gmail.com

This tutorial demonstrates a single-token lending pool for compatible EVM chains and TRON (TRC-20). It is for local and public-testnet education only. It has not been audited and must not be used with real funds.

## Rules in this example

- Borrower collateral: **none**. The contract does not take, escrow, or liquidate borrower assets.
- Wallet qualification: at the time of borrowing, the borrower must hold at least **10% of the requested amount** of the pool's same token on the same chain. This is only a point-in-time check. The borrower can transfer those tokens immediately; the check does not secure repayment.
- Interest: **0.10% simple APR** (10 basis points per year), accrued by elapsed seconds up to the selected maturity. There is no compounding and no late-interest charge.
- Terms: 1 to 365 days, with a 30-day grace period after maturity before anyone can record a default.
- At most one active loan per borrower at a time. This limits repeated borrowing but does not secure repayment.
- Lenders receive non-transferable accounting shares. Pool assets include available tokens plus active principal and accrued interest; withdrawals can only be paid from available liquid tokens.
- If a loan is recorded as defaulted, its remaining debt is removed from pool assets. Lenders bear that loss pro rata. The owner cannot withdraw user deposits or change the rate.

The 10% condition is measured in the configured pool token. A Solidity contract cannot tell whether an address is controlled by Trust Wallet. It can only read the token balance for the address on the chain where that pool is deployed. It cannot see balances on another chain or in another asset.

## Contract

[`contracts/UnsecuredLendingPool.sol`](contracts/UnsecuredLendingPool.sol) holds one ERC-20/TRC-20-shaped asset. Deploy one pool per token per network. EVM and TRON balances are separate; this is not a bridge or a cross-chain pool.

Core tutorial flow:

1. A lender approves the pool to spend tokens, then calls `deposit(amount)`.
2. A borrower approves no collateral; they call `borrow(amount, termSeconds)` after holding the 10% token balance. The pool transfers the loan amount to them.
3. The borrower calls `repay(loanId)` for the full principal plus accrued simple interest.
4. Lenders call `withdraw(shares)` when the pool has enough liquid tokens.
5. After maturity plus the grace period, anyone may call `recordDefault(loanId)` to recognize the unsecured loss.

## EVM and TRON deployment notes

The Solidity source pins `0.8.20` and avoids chain-specific address formats and token extensions. TRON's TVM is broadly EVM-compatible, but compiler distribution, opcodes, resource costs, deployment tools, and address display differ. TRON requires the TRON Solidity compiler distribution and should be built and verified with TRON tooling; do not assume an EVM build artifact is valid on TVM. [TRON migration guidance](https://developers.tron.network/docs/migrating-eth-contracts-to-tron), [TVM vs EVM](https://developers.tron.network/docs/tvm-vs-evm).

For an EVM tutorial, compile with the exact Solidity 0.8.20 compiler and deploy to a local chain or an EVM testnet using a test token. For TRON, use TronBox/TronIDE with the matching TRON compiler build and deploy to Nile or Shasta with test tokens only. Save compiler version and optimizer settings so the verified source matches the deployed bytecode. [TRON compiler instructions](https://developers.tron.network/docs/creating-and-compiling), [TRON testnet tokens](https://developers.tron.network/docs/getting-testnet-tokens-on-tron).

The contract expects a conventional token with `balanceOf`, `transfer`, and `transferFrom` behavior. Use a test token you control first. Fee-on-transfer tokens are rejected. Review each chain's token contract, compiler output, and execution costs independently.

## Local review checklist

- Confirm the token address, chain, token decimals, and testnet selector before deployment.
- Use test accounts and test tokens; never enter a recovery phrase or private key into this tutorial.
- Review the 10% wallet check, maturity, interest calculation, default write-off, share accounting, pause authority, and withdrawal liquidity limits.
- Run a full security review and independent audit before any real deployment. Test adversarial tokens, rounding, reentrancy, defaulted loans, paused withdrawals, and low-liquidity withdrawals.
- Obtain legal, tax, consumer-protection, and licensing advice for every jurisdiction before offering loans or taking deposits.

## Important limitations

This is a compact educational contract, not a production lending protocol. It has no identity or credit assessment, collateral, insurance, oracle, liquidation, governance, transferable share token, partial repayment, reserve fund, or automated collections. Unsecured borrowers may never repay. The 0.10% rate does not make deposits safe or guarantee lender returns. Smart contract and token failures can permanently lose funds.

