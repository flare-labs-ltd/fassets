import { expectRevert } from "@openzeppelin/test-helpers";
import { artifacts, contract } from "hardhat";
import { getTestFile } from "../../../utils/test-helpers";
import { MerkleTreeMockInstance } from "../../../../typechain-truffle";
import { MerkleTree } from "@flarenetwork/state-connector-protocol/dist/libs/ts/MerkleTree";

const MerkleTreeMock = artifacts.require("MerkleTreeMock");

contract(`MerkleTree.sol; ${getTestFile(__filename)}`, async () => {

    let merkleTreeMock: MerkleTreeMockInstance;

    before(async () => {
        merkleTreeMock = await MerkleTreeMock.new();
    });

    it("Should revert if no leaves", async () => {
        await expectRevert(merkleTreeMock.calculateMerkleRoot([]), "Must have at least one leaf");
    });

    it("Generate the same Merkle root", async () => {
        const n = 16;
        for (let len = 1; len <= n; len++) {
            const leaves = Array.from({ length: len }, () => web3.utils.keccak256(Math.random().toString()));
            leaves.sort();
            const root = await merkleTreeMock.calculateMerkleRoot(leaves);
            const root2 = calculateMerkleRoot(leaves);
            const tree = new MerkleTree(leaves);
            const root3 = tree.root;
            expect(root).to.equal(root2);
            expect(root).to.equal(root3);
        }
    });

    function calculateMerkleRoot(hashes: string[]): string {
        let n = hashes.length;
        if (n == 0) {
            throw Error("Must have at least one leaf");
        }
        if (n == 1) {
            return hashes[0];
        }
        let merkleTree: string[] = [];
        hashes.map((v, i) => merkleTree[n - 1 + i] = v);
        for (let i = n - 2; i >= 0; i--) {
            if (merkleTree[i * 2 + 1] <= (merkleTree[i * 2 + 2])) {
                merkleTree[i] = web3.utils.soliditySha3(merkleTree[i * 2 + 1], merkleTree[i * 2 + 2])!;
            } else {
                merkleTree[i] = web3.utils.soliditySha3(merkleTree[i * 2 + 2], merkleTree[i * 2 + 1])!;
            }
        }
        return merkleTree[0];
    }
});
