// Offline signer for unsigned TRON transactions. This script signs locally and
// never broadcasts. Keep the signing machine disconnected from the network.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { TronWeb } = require('tronweb');

const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });

function hiddenPrompt(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive terminal so the key can be entered without echo.');
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    process.stdout.write(label);

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(Boolean(wasRaw));
      process.stdout.write('\n');
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Cancelled.'));
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(value);
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (!key.ctrl && !key.meta && character) {
        value += character;
      }
    };
    stdin.on('keypress', onKeypress);
  });
}

function visiblePrompt(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(label, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function getPermissionDetails(tx) {
  const contracts = tx?.raw_data?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1) {
    throw new Error('Expected exactly one contract in the unsigned transaction.');
  }
  const contract = contracts[0];
  if (contract.type !== 'AccountPermissionUpdateContract') {
    throw new Error(`Refusing to sign unsupported contract type: ${contract.type}`);
  }
  const value = contract.parameter?.value;
  if (!value?.owner_address || !value?.owner || !Array.isArray(value.actives)) {
    throw new Error('Account permission update is missing required permission fields.');
  }
  const addresses = [value.owner_address, ...(value.owner.keys || []).map((key) => key.address),
    ...value.actives.flatMap((permission) => (permission.keys || []).map((key) => key.address))];
  if (addresses.some((address) => !address || !TronWeb.isAddress(address))) {
    throw new Error('Transaction contains a missing or invalid address.');
  }
  return { contract, value };
}

async function main() {
  const input = path.resolve(process.argv[2] || 'unsigned-takeover.json');
  const output = path.resolve(process.argv[3] || `signed-${path.basename(input)}`);
  if (input === output) throw new Error('Input and output paths must be different.');

  const tx = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (tx.signature?.length) throw new Error('Transaction already has a signature.');
  if (!/^[0-9a-f]{64}$/i.test(tx.txID || '')) throw new Error('Transaction has no valid txID.');
  if (!tx.raw_data?.expiration || tx.raw_data.expiration <= Date.now()) {
    throw new Error('Transaction has expired. Build a fresh unsigned transaction first.');
  }
  const { value } = getPermissionDetails(tx);
  const ownerAddress = TronWeb.address.fromHex(value.owner_address);
  const newOwner = value.owner.keys.map((key) => ({
    address: TronWeb.address.fromHex(key.address), weight: key.weight,
  }));
  const newActives = value.actives.map((permission) => ({
    name: permission.permission_name,
    threshold: permission.threshold,
    operations: permission.operations,
    keys: permission.keys.map((key) => ({
      address: TronWeb.address.fromHex(key.address), weight: key.weight,
    })),
  }));

  console.log('\nReview before signing:');
  console.log('Transaction ID:', tx.txID);
  console.log('Contract: AccountPermissionUpdateContract');
  console.log('Account being changed:', ownerAddress);
  console.log('New owner permission:', JSON.stringify({
    threshold: value.owner.threshold, keys: newOwner,
  }, null, 2));
  console.log('New active permissions:', JSON.stringify(newActives, null, 2));
  console.log('Expires:', new Date(tx.raw_data.expiration).toISOString());
  const confirmation = await visiblePrompt(`Type SIGN ${tx.txID.slice(0, 12)} to continue: `);
  if (confirmation !== `SIGN ${tx.txID.slice(0, 12)}`) throw new Error('Confirmation did not match.');

  let privateKey = await hiddenPrompt('Current owner private key (input is hidden): ');
  try {
    const signerAddress = TronWeb.address.fromPrivateKey(privateKey);
    if (!signerAddress) throw new Error('Private key is invalid.');
    console.log('Signer address:', signerAddress);
    const signerConfirmation = await visiblePrompt(
      `Confirm this key is authorized by the target account's current owner permission. Type USE ${signerAddress.slice(-6)}: `,
    );
    if (signerConfirmation !== `USE ${signerAddress.slice(-6)}`) {
      throw new Error('Signer confirmation did not match.');
    }
    const signed = await tronWeb.trx.multiSign(tx, privateKey, 0);
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL;
    fs.writeFileSync(output, `${JSON.stringify(signed, null, 2)}\n`, { flag: flags, mode: 0o600 });
    console.log('Signed transaction saved:', output);
    console.log('It was not broadcast.');
  } finally {
    privateKey = '';
  }
}

main().catch((error) => {
  console.error('Signing failed:', error.message);
  process.exitCode = 1;
});
