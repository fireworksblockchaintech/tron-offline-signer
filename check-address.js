const { TronWeb } = require('tronweb');
const fs = require('fs');

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io'
});

const tx = JSON.parse(
  fs.readFileSync('unsigned-takeover.json', 'utf8')
);

const value = tx.raw_data.contract[0].parameter.value;

console.log('TARGET WALLET:',
  tronWeb.address.fromHex(value.owner_address));

console.log('NEW OWNER:',
  tronWeb.address.fromHex(value.owner.keys[0].address));

console.log('NEW ACTIVE:',
  tronWeb.address.fromHex(value.actives[0].keys[0].address));