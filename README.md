# TRON offline permission signer

Contact: fireworksblockchaintech@gmail.com

This project separates online transaction creation from offline signing. The
signing command is deliberately limited to a single
`AccountPermissionUpdateContract`, checks the transaction expiration and
addresses, asks for an explicit transaction ID confirmation, and writes a
signed JSON file. It does not broadcast.

## Workflow

1. On an online preparation machine, copy `.env.example` to `.env`, set and
   verify the target and replacement permission addresses, then run
   `node build.js`. This contacts
   TronGrid for the reference block and creates `unsigned-takeover.json`.
2. Transfer that unsigned JSON file to a dedicated offline signing machine.
   Install the project dependencies there before disconnecting it from the
   network. Do not transfer any private key to the online machine.
3. In an interactive terminal on the offline machine, run
   `node sign.js unsigned-takeover.json signed-takeover.json`.
4. Review the displayed transaction details. Enter the exact confirmation
   phrase, then enter the **current owner key authorized to update the target
   account**. The key is not echoed or written to a file. The key must be
   authorized by that account's current owner permission; the offline tool
   cannot check the current on-chain permission set. Verify the signer address
   against a trusted source before proceeding. This flow adds one owner
   permission signature and does not collect multiple signatures.
5. Transfer the signed JSON to a separate broadcast machine and inspect it
   before broadcasting with a trusted TRON tool. The saved transaction expires
   quickly, so build and sign close together.

`check-address.js` and `verify.js` only inspect the unsigned JSON. Keep the
signing computer physically offline while running `sign.js`; this script
constructs TronWeb with its API URL for library configuration but makes no
network calls.

The target and replacement addresses are read from `.env` and are account
configuration, not the signing key. Verify every address and permission mask
against a trusted source before preparing a real permission update.

## One-command emergency transfer

Copy `.env.example` to `.env`, set `TRON_CURRENT_OWNER_PRIVATE_KEY`, and review
the target and replacement addresses. The private key must be the current
owner-authorized key; the new wallet's private key is not needed. `node
rescue.js` prints a preview. `node rescue.js --preflight` checks estimated
fees and resources without signing or broadcasting. `node rescue.js --execute` checks the target's
balance and current fees, then signs and broadcasts a fresh 1-of-1 permission
update without further prompts. It uses TronGrid and is not an offline
workflow. `.env` is plaintext secret storage: use only on a trusted machine,
never commit or share it, and remove it after use. Do not use this command if
you want multisig: it assigns all owner and active authority to one address.
It cannot guarantee inclusion before another transaction from a sweeper.
