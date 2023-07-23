import { SCProofVerifierMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";
import { MerkleTree } from "../../../utils/MerkleTree";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const SCProofVerifier = artifacts.require('SCProofVerifierMock');

contract(`SCProofVerifierMock.sol; ${getTestFile(__filename)}; Attestation client mock basic tests`, async accounts => {
    let scProofVerifier: SCProofVerifierMockInstance;

    describe("create and set", () => {
        it("should create", async () => {
            scProofVerifier = await SCProofVerifier.new();
        });
        it("should set merkle root", async () => {
            scProofVerifier = await SCProofVerifier.new();
            const hashes = [web3.utils.soliditySha3Raw("test1")!, web3.utils.soliditySha3Raw("test2")!];
            const tree = new MerkleTree(hashes);
            await scProofVerifier.setMerkleRoot(5, tree.root!);
            const root = await scProofVerifier.merkleRootForRound(5);
            assertWeb3Equal(tree.root, root);
        });
    });
});
