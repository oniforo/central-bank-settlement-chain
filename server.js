'use strict';

const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const os = require('os');
const fs = require('fs');

const channelName = 'canal-str';
const chaincodeName = 'basico';
const mspOrg1 = 'Org1MSP';
const orgUserId = 'appUser';

const testNetworkHome = process.env.TEST_NETWORK_HOME
    || path.join(os.homedir(), 'src', 'fabric', 'fabric-samples', 'test-network');
const ccpPath = path.join(
    testNetworkHome, 'organizations', 'peerOrganizations',
    'org1.example.com', 'connection-org1.json'
);
const walletPath = path.join(__dirname, 'wallet');
const asLocalhost = process.env.AS_LOCALHOST !== 'false';

function buildCCP() {
    if (!fs.existsSync(ccpPath)) {
        throw new Error(`Connection profile not found at ${ccpPath}. Set TEST_NETWORK_HOME or bring up the test network via entrypoint.sh first.`);
    }
    return JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
}

function buildCAClient(ccp, caHostName) {
    const caInfo = ccp.certificateAuthorities[caHostName];
    const caTLSCACerts = caInfo.tlsCACerts.pem;
    return new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);
}

async function enrollAdmin(caClient, wallet, orgMspId) {
    const identity = await wallet.get('admin');
    if (identity) {
        return;
    }
    const enrollment = await caClient.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
    const x509Identity = {
        credentials: {
            certificate: enrollment.certificate,
            privateKey: enrollment.key.toBytes(),
        },
        mspId: orgMspId,
        type: 'X.509',
    };
    await wallet.put('admin', x509Identity);
}

async function registerAndEnrollUser(caClient, wallet, orgMspId, userId, affiliation) {
    const userIdentity = await wallet.get(userId);
    if (userIdentity) {
        return;
    }
    const adminIdentity = await wallet.get('admin');
    if (!adminIdentity) {
        throw new Error('An admin identity must be enrolled before registering a new user.');
    }

    const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
    const adminUser = await provider.getUserContext(adminIdentity, 'admin');

    const secret = await caClient.register({
        affiliation,
        enrollmentID: userId,
        role: 'client',
    }, adminUser);
    const enrollment = await caClient.enroll({ enrollmentID: userId, enrollmentSecret: secret });
    const x509Identity = {
        credentials: {
            certificate: enrollment.certificate,
            privateKey: enrollment.key.toBytes(),
        },
        mspId: orgMspId,
        type: 'X.509',
    };
    await wallet.put(userId, x509Identity);
}

async function main() {
    const ccp = buildCCP();
    const caClient = buildCAClient(ccp, 'ca.org1.example.com');
    const wallet = await Wallets.newFileSystemWallet(walletPath);

    await enrollAdmin(caClient, wallet, mspOrg1);
    await registerAndEnrollUser(caClient, wallet, mspOrg1, orgUserId, 'org1.department1');

    const gateway = new Gateway();
    try {
        await gateway.connect(ccp, {
            wallet,
            identity: orgUserId,
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
