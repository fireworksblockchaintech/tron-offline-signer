// Builds, signs, and broadcasts a 1-of-1 permission transfer in one run.
// Supports a read-only resource preflight before any signing attempt.
const fs = require('node:fs');
const path = require('node:path');
const { TronWeb } = require('tronweb');

const OPERATIONS = '7fff1fc0033ec30f000000000000000000000000000000000000000000000000';
const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });

function loadDotEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith('#')) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

async function checkResources(target) {
  const targetHex = TronWeb.address.toHex(target);
  const [account, resources, chainParameters] = await Promise.all([
    tronWeb.fullNode.request('wallet/getaccount', { address: targetHex }, 'post'),
    tronWeb.fullNode.request('wallet/getaccountresource', { address: targetHex }, 'post'),
    tronWeb.fullNode.request('wallet/getchainparameters', {}, 'post'),
  ]);
  const parameters = chainParameters?.chainParameter || [];
  const parameterValue = (key) => Number(parameters.find((entry) => entry.key === key)?.value);
  const permissionFee = parameterValue('getUpdateAccountPermissionFee');
  const bandwidthPrice = parameterValue('getTransactionFee');
  if (!Number.isFinite(permissionFee) || !Number.isFinite(bandwidthPrice)) {
    throw new Error('Could not read current permission and Bandwidth fees from the node.');
  }
  const availableBandwidth = Math.max(
    Math.max(0, Number(resources?.freeNetLimit || 0) - Number(resources?.freeNetUsed || 0)),
    Math.max(0, Number(resources?.NetLimit || 0) - Number(resources?.NetUsed || 0)),
  );
  // Conservative estimate for the serialized permission update and signature.
  const estimatedBandwidth = 1000;
  const estimatedBandwidthFee = Math.max(0, estimatedBandwidth - availableBandwidth) * bandwidthPrice;
  const balance = Number(account?.balance || 0);
  const required = permissionFee + estimatedBandwidthFee;
  console.log('Target balance:', `${balance / 1e6} TRX`);
  console.log('Permission update fee:', `${permissionFee / 1e6} TRX`);
  console.log('Estimated Bandwidth fee:', `${estimatedBandwidthFee / 1e6} TRX`);
  console.log('Estimated minimum balance:', `${required / 1e6} TRX`);
  return { balance, required };
}

async function main() {
  loadDotEnv();
  const target = process.env.TRON_TARGET_ADDRESS;
  const newOwner = process.env.TRON_NEW_OWNER_ADDRESS;
  let privateKey = process.env.TRON_CURRENT_OWNER_PRIVATE_KEY;
  delete process.env.TRON_CURRENT_OWNER_PRIVATE_KEY;
  const execute = process.argv.includes('--execute');
  const preflight = process.argv.includes('--preflight');
  if (!TronWeb.isAddress(target) || !TronWeb.isAddress(newOwner)) {
    throw new Error('Target and new owner must be valid TRON addresses.');
  }
  const ownerPermission = {
    type: 0,
    permission_name: 'owner',
    threshold: 1,
    keys: [{ address: newOwner, weight: 1 }],
  };
  const activePermission = {
    type: 2,
    permission_name: 'active',
    threshold: 1,
    operations: OPERATIONS,
    keys: [{ address: newOwner, weight: 1 }],
  };

  console.log('Preparing a 1-of-1 permission update:');
  console.log('Target account:', target);
  console.log('New owner and active key:', newOwner);
  console.log('This is not multisig. It grants this one address control.');
  if (!execute) {
    if (preflight) {
      const { balance, required } = await checkResources(target);
      if (balance < required) {
        console.log('Preflight result: insufficient funds for the estimated permission update. Nothing was signed or broadcast.');
        process.exitCode = 2;
      } else {
        console.log('Preflight result: estimated fee resources appear available. Nothing was signed or broadcast.');
      }
      return;
    }
    console.log('Preview only. Run with --preflight to check fees and resources; --execute signs and broadcasts.');
    return;
  }
  if (!privateKey) throw new Error('Set TRON_CURRENT_OWNER_PRIVATE_KEY in .env first.');

  const signer = TronWeb.address.fromPrivateKey(privateKey);
  if (!signer) throw new Error('Private key in .env is invalid.');
  console.log('Signing address:', signer);

  const { balance, required } = await checkResources(target);
  if (balance < required) {
    throw new Error(
      `Target account lacks estimated funds: ${balance / 1e6} TRX available; ${required / 1e6} TRX estimated. No transaction was built or broadcast.`,
    );
  }

  // Build only after configuration and key validation, so no time is spent
  // entering secrets during the transaction's short expiration window.
  const unsigned = await tronWeb.transactionBuilder.updateAccountPermissions(
    target, ownerPermission, null, [activePermission],
  );
  if (!unsigned?.raw_data?.expiration || unsigned.raw_data.expiration <= Date.now()) {
    throw new Error('Node returned an expired transaction. Retry with a working node.');
  }
  console.log('Transaction ID:', unsigned.txID);
  console.log('Expires:', new Date(unsigned.raw_data.expiration).toISOString());

  const signed = await tronWeb.trx.multiSign(unsigned, privateKey, 0);
  if (unsigned.raw_data.expiration <= Date.now()) {
    throw new Error('Transaction expired while signing. Nothing was broadcast; retry.');
  }

  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result?.result) {
    throw new Error(`Node rejected the broadcast: ${result?.code || 'unknown error'} ${result?.message || ''}`.trim());
  }
  console.log('Broadcast accepted. Transaction ID:', result.txid || unsigned.txID);
  console.log('Check the transaction on a trusted TRON explorer for confirmation.');
  privateKey = '';
}

main().catch((error) => {
  console.error('Recovery failed:', error.message);
  process.exitCode = 1;
});
