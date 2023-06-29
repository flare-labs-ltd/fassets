// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./Bytes.sol";


/**
 * @title Base58
 * @author storyicon@foxmail.com
 * @notice This algorithm was migrated from github.com/mr-tron/base58 to solidity.
 * Note that it is not yet optimized for gas, so it is recommended to use it only in the view/pure function.
 */
library Base58 {
    uint256 private constant ACC_BITS = 128;
    uint256 private constant ACC_BYTES = ACC_BITS / 8;
    uint256 private constant ACC_MASK = (1 << ACC_BITS) - 1;

    /**
     * @notice decode is used to decode the given string in base58 standard.
     * @param _data data encoded with base58, passed in as bytes.
     * @return raw data, returned as bytes.
     */
    function decode(bytes memory _data, bytes memory _alphabet) internal pure returns (bytes memory, bool) {
        unchecked {
            uint256 zero = uint256(uint8(_alphabet[0]));
            uint256 b58sz = _data.length;
            uint zcount;
            for (; zcount < b58sz && uint8(_data[zcount]) == zero; zcount++) { }
            bytes memory alphabetIndex = createIndex(_alphabet);
            bytes memory binu = new bytes(2 * (((b58sz * 8351) / 6115) + 1));
            uint128[] memory outi = new uint128[]((b58sz + ACC_BYTES - 1) / ACC_BYTES);
            for (uint256 i = 0; i < _data.length; i++) {
                bytes1 r = _data[i];
                (uint256 c, bool f) = indexOf(alphabetIndex, r);
                if (!f) return (new bytes(0), false);
                for (int256 k = int256(outi.length) - 1; k >= 0; k--) {
                    uint256 t = uint256(outi[uint256(k)]) * 58 + c;
                    c = t >> ACC_BITS;
                    outi[uint256(k)] = uint128(t & ACC_MASK);
                }
            }
            uint256 mask = (b58sz % ACC_BYTES) * 8;
            if (mask == 0) mask = ACC_BITS;
            mask -= 8;
            uint256 outLen = 0;
            for (uint256 j = 0; j < outi.length; j++) {
                while (mask < ACC_BITS) {
                    binu[outLen] = bytes1(uint8(outi[j] >> mask));
                    outLen++;
                    if (mask < 8) break;
                    mask -= 8;
                }
                mask = ACC_BITS - 8;
            }
            for (uint256 msb = zcount; msb < binu.length; msb++) {
                if (binu[msb] > 0) {
                    return (Bytes.slice(binu, msb - zcount, outLen), true);
                }
            }
            return (Bytes.slice(binu, 0, outLen), true);
        }
    }

    function createIndex(bytes memory _data)
        internal pure
        returns (bytes memory)
    {
        assert(_data.length < 255);
        bytes memory index = new bytes(256);
        for (uint256 i = 0; i < _data.length; i++) {
            index[uint8(_data[i])] = bytes1(uint8(i + 1));
        }
        return index;
    }

    function indexOf(bytes memory _index, bytes1 _char)
        internal pure
        returns (uint256, bool)
    {
        uint256 pos = uint8(_index[uint8(_char)]);
        if (pos == 0) return (0, false);
        return (pos - 1, true);
    }
}
