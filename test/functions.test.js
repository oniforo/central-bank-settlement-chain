'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');

chai.use(chaiAsPromised);
const { expect } = chai;

const AssetTransfer = require('../functions.js');

/**
 * Minimal in-memory stand-in for ctx.stub, covering just what functions.js
 * actually calls: putState/getState (a Map-backed key/value store),
 * getStateByRange (iterates the whole store, since InitLedger/GetAllAssets
 * only ever query the full range), and getTxID (overridable per test).
 */
class FakeChaincodeStub {
    constructor() {
        this.states = new Map();
        this.txId = 'tx1';
    }

    async putState(key, value) {
        this.states.set(key, Buffer.from(value));
    }

    async getState(key) {
        return this.states.get(key) || Buffer.alloc(0);
    }

    async getStateByRange() {
        const entries = Array.from(this.states.values());
        let index = 0;
        return {
            async next() {
                if (index >= entries.length) {
                    return { value: undefined, done: true };
                }
                const value = entries[index++];
                return { value: { value }, done: false };
            },
            async close() {},
        };
    }

    getTxID() {
        return this.txId;
    }
}

function newContext() {
    return { stub: new FakeChaincodeStub() };
}

describe('AssetTransfer', () => {
    let contract;
    let ctx;

    beforeEach(() => {
        contract = new AssetTransfer();
        ctx = newContext();
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('InitLedger', () => {
        it('seeds the ledger with six assets', async () => {
            await contract.InitLedger(ctx);
            const result = JSON.parse(await contract.GetAllAssets(ctx));
            expect(result).to.have.lengthOf(6);
            expect(result[0]).to.deep.include({ ID: 'asset1', Owner: 'Tomoko', AppraisedValue: 300 });
        });
    });

    describe('AssetExists', () => {
        it('returns false for an asset that was never created', async () => {
            expect(await contract.AssetExists(ctx, 'asset1')).to.equal(false);
        });

        it('returns true once the asset has been created', async () => {
            await contract.CreateAsset(ctx, 'asset1', 'Alice', 100);
            expect(await contract.AssetExists(ctx, 'asset1')).to.equal(true);
        });
    });

    describe('ReadAsset', () => {
        it('throws when the asset does not exist', async () => {
            await expect(contract.ReadAsset(ctx, 'missing'))
                .to.be.rejectedWith('The asset missing does not exist');
        });

        it('returns the stored asset as JSON', async () => {
            await contract.CreateAsset(ctx, 'asset1', 'Alice', 100);
            const result = JSON.parse(await contract.ReadAsset(ctx, 'asset1'));
            expect(result).to.deep.include({ ID: 'asset1', Owner: 'Alice', AppraisedValue: 100 });
        });
    });

    describe('CreateAsset', () => {
        it('creates a new asset and returns it', async () => {
            const result = JSON.parse(await contract.CreateAsset(ctx, 'asset1', 'Alice', 100));
            expect(result).to.deep.equal({ ID: 'asset1', Owner: 'Alice', AppraisedValue: 100 });
        });

        it('throws if the asset already exists', async () => {
            await contract.CreateAsset(ctx, 'asset1', 'Alice', 100);
            await expect(contract.CreateAsset(ctx, 'asset1', 'Bob', 50))
                .to.be.rejectedWith('The asset asset1 already exists');
        });
    });

    describe('TransferAsset', () => {
        beforeEach(async () => {
            await contract.CreateAsset(ctx, 'asset1', 'Alice', 100);
        });

        it('records a debit and a credit entry derived from the transaction ID', async () => {
            const result = JSON.parse(await contract.TransferAsset(ctx, 'asset1', 'Bob', 40));

            expect(result).to.deep.equal({
                from: 'Alice',
                to: 'Bob',
                value: 40,
                debitId: 'tx1-debit',
                creditId: 'tx1-credit',
            });

            const debit = JSON.parse(await contract.ReadAsset(ctx, 'tx1-debit'));
            expect(debit).to.deep.include({ Owner: 'Alice', AppraisedValue: -40 });

            const credit = JSON.parse(await contract.ReadAsset(ctx, 'tx1-credit'));
            expect(credit).to.deep.include({ Owner: 'Bob', AppraisedValue: 40 });
        });

        it('throws if the transfer value exceeds the asset value', async () => {
            await expect(contract.TransferAsset(ctx, 'asset1', 'Bob', 1000))
                .to.be.rejectedWith('The value to transfer exceeds that of asset asset1');
        });

        it('does not collide across repeated transfers, since each uses a distinct transaction ID', async () => {
            await contract.TransferAsset(ctx, 'asset1', 'Bob', 10);

            ctx.stub.txId = 'tx2';
            await expect(contract.TransferAsset(ctx, 'asset1', 'Carol', 10)).to.not.be.rejected;

            const secondCredit = JSON.parse(await contract.ReadAsset(ctx, 'tx2-credit'));
            expect(secondCredit).to.deep.include({ Owner: 'Carol', AppraisedValue: 10 });
        });
    });

    describe('GetAllAssets', () => {
        it('returns an empty array when the ledger is empty', async () => {
            const result = JSON.parse(await contract.GetAllAssets(ctx));
            expect(result).to.deep.equal([]);
        });

        it('returns every asset currently on the ledger', async () => {
            await contract.CreateAsset(ctx, 'asset1', 'Alice', 100);
            await contract.CreateAsset(ctx, 'asset2', 'Bob', 200);
            const result = JSON.parse(await contract.GetAllAssets(ctx));
            expect(result).to.have.lengthOf(2);
        });
    });
});
