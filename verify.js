const fs = require('fs');
const tx = JSON.parse(
    fs.readFileSync('unsigned-takeover.json', 'utf8')
);

const value = tx.raw_data.contract[0].parameter.value;

console.log('TRANSACTION:', tx.txID);
console.log('CONTRACT:', tx.raw_data.contract[0].type);
console.log('TARGET:', value.owner_address);

console.log('\nNEW OWNER:');
console.log(JSON.stringify(value.owner, null, 2));

console.log('\nNEW ACTIVE PERMISSIONS:');
console.log(JSON.stringify(value.actives, null, 2));

console.log('\nEXPIRATION:', new Date(tx.raw_data.expiration));