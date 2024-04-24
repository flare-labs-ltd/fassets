import { expectRevert } from '@openzeppelin/test-helpers';
import { assertWeb3Equal } from "../../utils/web3assertions";

const ReentrancyMock = artifacts.require('ReentrancyMock');
const ReentrancyAttackMock = artifacts.require('ReentrancyAttackMock');

contract('ReentrancyGuard', function () {
    for (const initialize of [true, false]) {
        describe(`run with initialize=${initialize}`, function() {
            beforeEach(async function () {
                this.reentrancyMock = await ReentrancyMock.new(initialize);
                assertWeb3Equal(await this.reentrancyMock.counter(), 0);
            });

            it('nonReentrant function can be called', async function () {
                assertWeb3Equal(await this.reentrancyMock.counter(), 0);
                await this.reentrancyMock.callback();
                assertWeb3Equal(await this.reentrancyMock.counter(), 1);
            });

            it('does not allow remote callback', async function () {
                const attacker = await ReentrancyAttackMock.new();
                await expectRevert(this.reentrancyMock.countAndCall(attacker.address), 'ReentrancyAttack: failed call');
            });

            it('_reentrancyGuardEntered should be true when guarded', async function () {
                await this.reentrancyMock.guardedCheckEntered();
            });

            it('_reentrancyGuardEntered should be false when unguarded', async function () {
                await this.reentrancyMock.unguardedCheckNotEntered();
            });

            // The following are more side-effects than intended behavior:
            // I put them here as documentation, and to monitor any changes
            // in the side-effects.
            it('does not allow local recursion', async function () {
                await expectRevert(this.reentrancyMock.countLocalRecursive(10), 'ReentrancyGuard: reentrant call');
            });

            it('does not allow indirect local recursion', async function () {
                await expectRevert(this.reentrancyMock.countThisRecursive(10), 'ReentrancyMock: failed call');
            });
        });
    }
});
