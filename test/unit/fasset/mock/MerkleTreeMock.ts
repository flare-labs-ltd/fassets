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

    it("Generate the same Merkle roots from random test cases", async () => {
        const length = testCases.length;
        const testCaseHashes: string[] = [];
        for (let i = 0; i < length; i++) {
            const doubleHash = await merkleTreeMock.doubleHash(testCases[i]);
            expect(doubleHash).to.equal(doubleHashWeb3(testCases[i]));
            testCaseHashes.push(doubleHash);
            const leaves = testCaseHashes.slice(0, i + 1);
            leaves.sort();
            const root = await merkleTreeMock.calculateMerkleRoot(leaves);
            const root2 = calculateMerkleRoot(leaves);
            const tree = new MerkleTree(leaves);
            const root3 = tree.root;
            expect(root).to.equal(root2);
            expect(root).to.equal(root3);
            expect(root).to.equal(testCasesRoots[i]);
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

    function doubleHashWeb3(data: string): string {
        return web3.utils.soliditySha3(web3.utils.soliditySha3(data)!)!;
    }

    const testCases = [
        "r8w3LYVt7K5RYKRUpNfXrqQ1ZzXAvrvPezku0GMcOfa",
        "TCUtQWRHBdcWVdC7JKRWt0nVPxHY4WYBqPppUS3P",
        "934EXhbCZ9D3SZtYfNzfh5AzzuHertkLvM6ddc0tDzR",
        "HEJTk5pWe57AAcqqrDAWN4w1vtC1fbvJrHYXQRpk",
        "LVRDDPcDq8jZuwVpEnzGPz69w1SkpyH5U2Xqvu6g",
        "jX11XHcnEzMaewzgqguDC7xJ0zDHwgAcYRwMZ",
        "yvM5bQNDzt0e2NieQWD1w71gyJkB3mTm0Hax5nWg",
        "40UeuvZ6ZJCAFmXYw9vcrmQTyjPhGmbw13whfe7Y2YP4eJDp",
        "x29jiaRF2MW1et6nzb1iihQRXR5U5D9R3i51pmuJ",
        "2dwn9d8VH27FLmCpx3gBq33bcY4y6h2V6",
        "xCBef6AQC4JMCwjXvEaYineDj3wBEVhkyzPhuMJm",
        "QXRjmiLcYZYRwe6cYVLCq3dD5rnxFDwHW5BBauU",
        "hQdGhWdXPyxhShBnyiupknJPkzbqHcR64bArhQ0P",
        "qLTjwS3Qa6WTFwrvtXd6FNduUTX",
        "rijmqmiwB8xeWvSJSYw0P9DgPMkfmnfFwz02D30x",
        "Kfr84L1uKDGa970rmJzffgBwmx1wBSXCzwDrHt",
        "P7hS7DXaV7zVANbUtnUt5PMxKEKzegECJei",
        "WCqpAahcANYPXpMQ9q4nU0CU69qccWzCniPRPQXY",
        "XjwhY1FD8iz9tDv9hqyJexn7Jt3nrWjYC21tjbWX",
        "4DvnCVZZw1xzIlWYhLDS9zrP1ORMTTAv",
        "l88b2LxsnTgaFA0zgcn8BzvcmNS5tPh5",
        "PRicnsbAWQa0A627S03Qbh1p6pK3N8SzG",
        "yExsdBM4ZkgheawjyrWo3wY9Q0ozkAtt",
        "OCwwqLhc8VnToGqBMqh6h3wXOo5AsimH",
        "OmGA26dcfWq2p192oHzoFBrkGx",
        "xZt9L7w1CShRRSJw3us78P0irfawxt3M",
        "8x4dwYGGvSBQxVf9mnZoRnB8Tep2xoLU",
        "UEg9praoE4JsHqsYtroEYS23Y180UKVn",
        "KJoctDKGrSr4hKMPXyZ6MG8q4WukA",
        "9ZHi3LCHT0CbQST0ht49hFkzEqFW3xBo",
        "C7nncfz4NovbANSXpkUu4r0yh6AcmcS",
        "xmowpfGTx4qbdqP4dEqfhjQFJQBJe2ep",
        "sZvce91uGssCOs0qcTXBI34382CD",
        "Xn7UbDDZrXjWPcBfooT6PPOnbTM0dotU",
        "LyLBcycDaJq8xVlO8PCD1VNjiUpKrvdn",
        "xPxn4y008Z3uI423X68xtc4HeF86lRDC",
        "AJKI5hljDVJ7TbLUdYZf1igYqY5MM",
        "5Tq7SDoC45aFPJ2UbkECEFVQiI6rvjQT",
        "TzUyp9iHoU8Re6uLeISAOEXyafpwNfq2",
        "7LAoEyxf9ob"
    ];

    const testCasesRoots = [
        "0x37e9618c65dc6ef32309ef323588a6fd71ff9340db2c30a36800159ce787fd91",
        "0x3ca1fe050060fbfe200eae1ae7c13667800b026cc58e93695b1c2b1df713f8b0",
        "0x9e0c78406dea262a1f816196f0583d8065ae7bbe2cd489175399ee9e9b8d5c05",
        "0x9c4f2da63e5e49d2b6daf7c72e3cb36cc9a544d1f276058a05b2ddebca02aaf3",
        "0xb4bfce170a45483e50189abbc59d39ce74bee64532cfa5df51b43ff5124d93b2",
        "0x6fe9f43fe2e27e02a71fee9529dc9ce5c60a584b49b42562583331afb79df899",
        "0x6418110a1e852e6f671827bf08683cbc239731193e554d0a7aa9d1b937944c0d",
        "0x1530c54098c9a71cbdc3baa7ec329a0ba89d0d39f29082f354e666886c10d8da",
        "0xf17fa8d572c754dc8cde56bb27433f9a6842584d8e83c3bf15b775c396090965",
        "0x838e7d4a724903295c4ad19f43d7684b9e6f7839a6e717486a5f1cb5dd502024",
        "0x994b77fcc0c790cfc0b6f6b3fd72a9dd6edfb46631c1f220832177d56c0fd499",
        "0xe321f3cbcc6ddce60f0e082ec90093f9e9706b2a2b8966702ad708514262ab22",
        "0x51a3c0a317e35bd831327ede575fa5af63aac016d4c281b8b4d650c0b8a14c30",
        "0x2b143d348c231891f2b5ff6c02ecca4757c67002e9fc204ae954cd8384763a37",
        "0x97955eb79bdde6d234e37fe3e707ce3811492c1e977260d8b29eb5adbab4bd36",
        "0x5b263c33fa3e2028984b04e663034acca43436fd4d5a53d47ab16168e51d049a",
        "0x01375fc7fc56e7624c54022194c62f53c92daa618f0cf73dffc87f93c3c81bbb",
        "0xa0fae5884c9a374994dfaf39be7b34a8d909916046b11897dd51080fec4d0959",
        "0xe74039c48876fe030a3c43b580ef299d08e333322f9a8fd4f3bbbe0016f3e06a",
        "0x880a8bc04d57885127679089207984b4c317290c2817a1891813281dd8041fb8",
        "0x86372a9b86fd4aef3e27c27cea45272473530d9bf0a044f04a081d9923fe8537",
        "0x0d7f30484b57b12430ef6f7b1e70d9f7b7637ec7cdee48179528c8a441a2d721",
        "0x8422b0567cbaf078716b7f812586559d34021ca3feb503be3b264ba68de86d74",
        "0x165d8c61c7d7ac8e057a4d7937c11e018bb7d98b9bbda410c7d13a52cc148914",
        "0x73246027732bd9845af129cb2888075f05fdcc24b6f76c36a711f776be7fbc6f",
        "0xfac465fc5bc4c7f68b47ef165f782a191c45db23eac66ab24c8a11e5e1bf4987",
        "0x32e20b9b728173bf652bbae0916ee70fb0873909557704a4f2511e96c4b890d6",
        "0xc9d179aeb1a3e7b87ccdb7884586695bbd10552485a88083ea0e5d56a1f05b3c",
        "0x054cf8a5fb6030fca5724d104a70ca4776d19fffecbf47a5527d5643cc263e9b",
        "0x996993363e9e906ae1101ca098cabf16aaf3b8c0e5ddaa7ed3f5bdf9aae3bb15",
        "0xa241f496dc4b687b62a2526d0f20bf9797d08fec01e32123a69f0da59e2f41e6",
        "0xddee11045a75b406df2d5d404ffcf0a3375315e10f512ada430401c1cb8bec17",
        "0xc2ca411777510909233eb77e0c0fccfa61a938c7612a5fe11189e9ee6e925eb8",
        "0x840c5535b46aa10f291502a14e1f1d27932350c75609d60796e97263b7f13f97",
        "0x188c2b78f9c2506d922c9323991e3555bb250eb11eec5ba3185a9c80572312b0",
        "0x47525714245076054a9f4a650418b3f1602a1147051da3cfe6a8f404ff7645b6",
        "0x1e0f630f47c14af90a4235370c92269bad93d326e517fa2b420704086d986d75",
        "0x7e5ba270ae0ac5637f07a48e693bfa943ea0e15ef418521fdd98a0c23418a813",
        "0x48f4493ad2d00a2b8d46e4a6621227a50b97963c4c57fa06128348bfa386f608",
        "0x34ebcebade7a8a928d55b49fffb29d60ed442e1d35080a653d1325d249c7fc30",
    ];
});
