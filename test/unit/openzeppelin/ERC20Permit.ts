import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { expect } from 'chai';
import { abiEncodeCall, toBN } from '../../../lib/utils/helpers';
import { ERC20PermitMockInstance } from '../../../typechain-truffle';
import { getChainId } from '../../utils/contract-test-helpers';
import { assertWeb3DeepEqual, assertWeb3Equal } from '../../utils/web3assertions';
import { domainSeparator, getDomain } from '../../utils/eip712';
import { Permit, signPermit } from '../../utils/erc20permits';

const ERC20UpgradableToken = artifacts.require('ERC20UpgradableTokenMock');
const ERC20PermitToken = artifacts.require('ERC20PermitMock');
const ERC1967Proxy = artifacts.require('ERC1967Proxy');

contract('ERC20Permit', function (accounts) {
    const [initialHolder, spender, receiver] = accounts;

    const name = 'My Token';
    const symbol = 'MTKN';
    const version = '1';

    describe('permit', function () {
        const initialSupply = toBN(100);

        let chainId: number;
        let token: ERC20PermitMockInstance;

        const wallet = web3.eth.accounts.create();

        const owner = wallet.address;
        const value = toBN(42);
        const nonce = toBN(0);
        const maxDeadline = constants.MAX_UINT256;

        const testPermit: Permit = { owner, spender, value, nonce, deadline: maxDeadline };

        beforeEach(async function () {
            chainId = await getChainId();

            token = await ERC20PermitToken.new(name, symbol);
            await token.mint(initialHolder, initialSupply);
        });

        it('initial nonce is 0', async function () {
            assertWeb3Equal(await token.nonces(initialHolder), 0);
        });

        it('domain separator', async function () {
            expect(await token.DOMAIN_SEPARATOR()).to.equal(await getDomain(token).then(domainSeparator));
        });

        it('accepts owner signature', async function () {
            const { v, r, s } = await signPermit(token, wallet, testPermit);

            await token.permit(owner, spender, value, maxDeadline, v, r, s);

            assertWeb3Equal(await token.nonces(owner), 1);
            assertWeb3Equal(await token.allowance(owner, spender), value);
        });

        it('rejects reused signature', async function () {
            const { v, r, s } = await signPermit(token, wallet, testPermit);

            await token.permit(owner, spender, value, maxDeadline, v, r, s);

            await expectRevert(
                token.permit(owner, spender, value, maxDeadline, v, r, s),
                'ERC20Permit: invalid signature',
            );
        });

        it('rejects other signature', async function () {
            const otherWallet = web3.eth.accounts.create();

            const { v, r, s } = await signPermit(token, otherWallet, testPermit);

            await expectRevert(
                token.permit(owner, spender, value, maxDeadline, v, r, s),
                'ERC20Permit: invalid signature',
            );
        });

        it('rejects expired permit', async function () {
            const deadline = (await time.latest()).sub(time.duration.weeks(1));

            const { v, r, s } = await signPermit(token, wallet, { ...testPermit, deadline });

            // check that deadline is the signed one
            await expectRevert(token.permit(owner, spender, value, maxDeadline, v, r, s),
                'ERC20Permit: invalid signature');

            await expectRevert(token.permit(owner, spender, value, deadline, v, r, s),
                'ERC20Permit: expired deadline');
        });
    });

    describe("upgrading to ERC20Permit", () => {
        const wallet = web3.eth.accounts.create();

        it("upgrade should preserve data", async () => {
            // create token as proxy
            const tokenImpl = await ERC20UpgradableToken.new("", "");
            const tokenProxy = await ERC1967Proxy.new(tokenImpl.address, abiEncodeCall(tokenImpl, impl => impl.initialize("TokenOne", "TOK1")));
            const token = await ERC20PermitToken.at(tokenProxy.address);
            // do some minting and transfers
            await token.mint(initialHolder, 1000);
            const block1 = await time.latestBlock();
            const amounts1 = { initialHolder: await token.balanceOf(initialHolder), wallet: await token.balanceOf(wallet.address), supply: await token.totalSupply() };
            await token.transfer(wallet.address, 500, { from: initialHolder });
            const amounts2 = { initialHolder: await token.balanceOf(initialHolder), wallet: await token.balanceOf(wallet.address), supply: await token.totalSupply() };
            // erc20 permit is not enabled now
            const value = toBN(200);
            const permit: Permit = { owner: wallet.address, spender, value, nonce: toBN(0), deadline: constants.MAX_UINT256 };
            await expectRevert(signPermit(token, wallet, permit), "function selector was not recognized and there's no fallback function");
            // upgrade to ERC20Permit
            const tokenImpl2 = await ERC20PermitToken.new("", "");
            await token.upgradeToAndCall(tokenImpl2.address, abiEncodeCall(tokenImpl2, tok => tok.initializeV1r1()));
            // the balances should not change
            const amounts2new = { initialHolder: await token.balanceOf(initialHolder), wallet: await token.balanceOf(wallet.address), supply: await token.totalSupply() };
            assertWeb3DeepEqual(amounts2, amounts2new);
            // permit works now
            const { v, r, s } = await signPermit(token, wallet, permit);
            await token.permit(wallet.address, spender, value, permit.deadline, v, r, s, { from: spender });
            await token.transferFrom(wallet.address, receiver, value, { from: spender });
            assertWeb3Equal(await token.balanceOf(wallet.address), 300);
            assertWeb3Equal(await token.balanceOf(receiver), 200);
        });
    });
});
