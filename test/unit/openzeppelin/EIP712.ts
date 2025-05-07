import { signTypedMessage } from 'eth-sig-util';
import { objectMap } from '../../../lib/utils/helpers';
import { EIP712DomainMockInstance } from '../../../typechain-truffle';
import { getChainId } from '../../utils/contract-test-helpers';
import { domainSeparator, domainType, EIP712Domain, EIP712DomainType, getDomain, hashTypedData, hexStringToBuffer } from '../../utils/eip712';

const EIP712Verifier = artifacts.require('EIP712DomainMock');

contract('EIP712', function (accounts) {
    const [mailTo] = accounts;

    const name = 'A Name';
    const version = '1';

    let eip712: EIP712DomainMockInstance;
    let mailDomain: EIP712Domain;
    let mailDomainType: EIP712DomainType;

    beforeEach('deploying', async function () {
        eip712 = await EIP712Verifier.new(name, version);

        mailDomain = {
            name,
            version,
            chainId: await getChainId(),
            verifyingContract: eip712.address,
        };
        mailDomainType = domainType(mailDomain);
    });

    describe('domain separator', function () {
        it('is internally available', async function () {
            const expected = domainSeparator(mailDomain);

            expect(await eip712.domainSeparatorV4()).to.equal(expected);
        });

        it("can be rebuilt using EIP-5267's eip712Domain", async function () {
            const rebuildDomain = await getDomain(eip712);
            expect(objectMap(rebuildDomain, String)).to.be.deep.equal(objectMap(mailDomain, String));
        });
    });

    it('hash digest', async function () {
        const structhash = web3.utils.randomHex(32);
        expect(await eip712.hashTypedDataV4(structhash)).to.be.equal(hashTypedData(mailDomain, structhash));
    });

    it('digest', async function () {
        const message = {
            to: mailTo,
            contents: 'very interesting',
        };

        const data = {
            types: {
                EIP712Domain: mailDomainType,
                Mail: [
                    { name: 'to', type: 'address' },
                    { name: 'contents', type: 'string' },
                ],
            },
            domain: mailDomain,
            primaryType: 'Mail' as const,
            message,
        };

        const wallet = web3.eth.accounts.create();
        const signature = signTypedMessage(hexStringToBuffer(wallet.privateKey), { data });

        await eip712.verify(signature, wallet.address, message.to, message.contents);
    });
});
