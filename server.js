'use strict';

const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const os = require('os');
const fs = require('fs');

const channelName = 'canal-str';
const chaincodeName = 'basico';
const mspOrg1 = 'Org1MSP';
const identityLabel = 'admin';

const testNetworkHome = process.env.TEST_NETWORK_HOME
    || path.join(os.homedir(), 'src', 'fabric', 'fabric-samples', 'test-network');
const ccpPath = path.join(
    testNetworkHome, 'organizations', 'peerOrganizations',
    'org1.example.com', 'connection-org1.json'
);
// entrypoint.sh brings the network up without `-ca`, so identities come
// from cryptogen's static MSP material (the same material CORE_PEER_MSPCONFIGPATH
// points at for the native `peer` CLI) rather than from a running Fabric CA.
const adminMspPath = path.join(
    testNetworkHome, 'organizations', 'peerOrganizations',
    'org1.example.com', 'users', 'Admin@org1.example.com', 'msp'
);
const walletPath = path.join(__dirname, 'wallet');
const asLocalhost = process.env.AS_LOCALHOST !== 'false';

function buildCCP() {
    if (!fs.existsSync(ccpPath)) {
        throw new Error(`Connection profile not found at ${ccpPath}. Set TEST_NETWORK_HOME or bring up the test network via entrypoint.sh first.`);
    }
    return JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
}

function readSingleFile(dir) {
    const [fileName] = fs.readdirSync(dir);
    return fs.readFileSync(path.join(dir, fileName), 'utf8');
}

async function importAdminIdentity(wallet, mspId) {
    const existing = await wallet.get(identityLabel);
    if (existing) {
        return;
    }
    const certificate = readSingleFile(path.join(adminMspPath, 'signcerts'));
    const privateKey = readSingleFile(path.join(adminMspPath, 'keystore'));
    await wallet.put(identityLabel, {
        credentials: { certificate, privateKey },
        mspId,
        type: 'X.509',
    });
}

async function main() {
    const ccp = buildCCP();
    const wallet = await Wallets.newFileSystemWallet(walletPath);
    await importAdminIdentity(wallet, mspOrg1);

    const gateway = new Gateway();
    try {
        await gateway.connect(ccp, {
            wallet,
            identity: identityLabel,
            discovery: { enabled: true, asLocalhost },
        });

        const network = await gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);

        console.log('--- InitLedger ---');
        await contract.submitTransaction('InitLedger');
        console.log('Ledger initialized.');

        console.log('--- GetAllAssets ---');
        let result = await contract.evaluateTransaction('GetAllAssets');
        console.log(result.toString());

        console.log('--- TransferAsset (asset5 -> Michel, 100) ---');
        result = await contract.submitTransaction('TransferAsset', 'asset5', 'Michel', '100');
        console.log(result.toString());

        console.log('--- GetAllAssets ---');
        result = await contract.evaluateTransaction('GetAllAssets');
        console.log(result.toString());
    } finally {
        gateway.disconnect();
    }
}

main().catch((error) => {
    console.error(`Failed to run the demo: ${error}`);
    process.exit(1);
});
