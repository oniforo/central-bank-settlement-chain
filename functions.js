'use strict';

const stringify  = require('json-stringify-deterministic');
const sortKeysRecursive  = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class AssetTransfer extends Contract {

async InitLedger(ctx) {
    const assets = [
        { ID: 'asset1', Owner: 'Tomoko', AppraisedValue: 300 },
        { ID: 'asset2', Owner: 'Brad', AppraisedValue: 400 },
        { ID: 'asset3', Owner: 'Jin Soo', AppraisedValue: 500 },
        { ID: 'asset4', Owner: 'Max', AppraisedValue: 600 },
        { ID: 'asset5', Owner: 'Adriana', AppraisedValue: 700 },
        { ID: 'asset6', Owner: 'Michel', AppraisedValue: 800 },
    ];
    for (const asset of assets) {
        asset.docType = 'asset';
        await ctx.stub.putState(asset.ID, Buffer.from(stringify(sortKeysRecursive(asset))));
    }
}

async CreateAsset(ctx, id, owner, appraisedValue) {
    const exists = await this.AssetExists(ctx, id);
    if (exists) {
        throw new Error(`The asset ${id} already exists`);
    }
    const asset = { ID: id, Owner: owner, AppraisedValue: appraisedValue };
    await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
    return JSON.stringify(asset);
}

async TransferAsset(ctx, id, newOwner, value) {        
    const assetString = await this.ReadAsset(ctx, id);
    const asset = JSON.parse(assetString);
    if (asset.AppraisedValue < value) {
        throw new Error(`The value to transfer exceeds that of asset ${id}`);
    }        
    await this.CreateAsset(ctx, 'e0162780-2afc-46c8-8662-54a156c456da', asset.Owner, -value)
    await this.CreateAsset(ctx, '43b6d8d5-a347-4521-b1e0-11e6ae8c040a', newOwner, value)
    return oldOwner;
}

async GetAllAssets(ctx) {
    const allResults = [];
    const iterator = await ctx.stub.getStateByRange('', '');
    let result = await iterator.next();
    while (!result.done) {
        const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
        let record;
        try {
            record = JSON.parse(strValue);
        } catch (err) {
            console.log(err);
            record = strValue;
        }
        allResults.push(record);
        result = await iterator.next();
    }
    return JSON.stringify(allResults);
}

}

module.exports = AssetTransfer;
