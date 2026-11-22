const { TronWeb } = require('tronweb');
const fs = require('fs');
const path = require('path');

const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io'
});

async function main() {
    loadDotEnv();
    const compromised = process.env.TRON_TARGET_ADDRESS;
    const safeWallet = process.env.TRON_NEW_OWNER_ADDRESS;
    if (!TronWeb.isAddress(compromised) || !TronWeb.isAddress(safeWallet)) {
        throw new Error('Set valid TRON_TARGET_ADDRESS and TRON_NEW_OWNER_ADDRESS values in .env.');
    }

    const ownerPermission = {
        type: 0,
        permission_name: 'owner',
        threshold: 1,
        keys: [
            { address: safeWallet, weight: 1 }
        ]
    };

    const activePermission = {
        type: 2,
        permission_name: 'active',
        threshold: 1,
        operations:
          '7fff1fc0033ec30f000000000000000000000000000000000000000000000000',
        keys: [
            { address: safeWallet, weight: 1 }
        ]
    };

    const transaction =
        await tronWeb.transactionBuilder.updateAccountPermissions(
            compromised,
            ownerPermission,
            null,
            [activePermission]
        );

    fs.writeFileSync(
        'unsigned-takeover.json',
        JSON.stringify(transaction, null, 2)
    );

    console.log('Unsigned transaction created.');
    console.log('Transaction ID:', transaction.txID);
}

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

main().catch(console.error);
