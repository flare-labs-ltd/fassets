import { AttestationClientMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/helpers";
import { MerkleTree } from "../../../utils/MerkleTree";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const AttestationClient = artifacts.require('AttestationClientMock');

contract(`AttestationClientMock.sol; ${getTestFile(__filename)}; AttestationClientMock basic tests`, async accounts => {
    let attestationClient: AttestationClientMockInstance;

    describe("create and set", () => {
        it("should create", async () => {
            attestationClient = await AttestationClient.new();
        });
        it("should set merkle root", async () => {
            attestationClient = await AttestationClient.new();
            const hashes = [web3.utils.soliditySha3("test1")!, web3.utils.soliditySha3("test2")!];
            const tree = new MerkleTree(hashes);
            await attestationClient.setMerkleRootForStateConnectorRound(tree.root!, 5);
            const root = await attestationClient.merkleRootForRound(5);
            assertWeb3Equal(tree.root, root);
        });
    });
});