// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title Base58
 * @author storyicon@foxmail.com
 * @notice This algorithm was migrated from github.com/mr-tron/base58 to solidity.
 * Note that it is not yet optimized for gas, so it is recommended to use it only in the view/pure function.
 */
library Base58 {

    /**
     * @notice decode is used to decode the given string in base58 standard.
     * @param data_ data encoded with base58, passed in as bytes.
     * @return raw data, returned as bytes.
     */
    function decode(bytes memory data_, bytes memory alphabet_) internal pure returns (bytes memory, bool) {
        unchecked {
            uint256 zero = uint256(uint8(alphabet_[0]));
            uint256 b58sz = data_.length;
            uint zcount;
            for (; zcount < b58sz && uint8(data_[zcount]) == zero; zcount++) { }
            uint256 t;
            uint256 c;
            bool f;
            bytes memory binu = new bytes(2 * (((b58sz * 8351) / 6115) + 1));
            uint32[] memory outi = new uint32[]((b58sz + 3) / 4);
            for (uint256 i = 0; i < data_.length; i++) {
                bytes1 r = data_[i];
                (c, f) = indexOf(alphabet_, r);
                if (!f) return (new bytes(0), false);
                for (int256 k = int256(outi.length) - 1; k >= 0; k--) {
                    t = uint64(outi[uint256(k)]) * 58 + c;
                    c = t >> 32;
                    outi[uint256(k)] = uint32(t & 0xffffffff);
                }
            }
            uint64 mask = uint64(b58sz % 4) * 8;
            if (mask == 0) {
                mask = 32;
            }
            mask -= 8;
            uint256 outLen = 0;
            for (uint256 j = 0; j < outi.length; j++) {
                while (mask < 32) {
                    binu[outLen] = bytes1(uint8(outi[j] >> mask));
                    outLen++;
                    if (mask < 8) {
                        break;
                    }
                    mask -= 8;
                }
                mask = 24;
            }
            for (uint256 msb = zcount; msb < binu.length; msb++) {
                if (binu[msb] > 0) {
                    return (slice(binu, msb - zcount, outLen), true);
                }
            }
            return (slice(binu, 0, outLen), true);
        }
    }

    function slice(
        bytes memory data_,
        uint256 start_,
        uint256 end_
    )
        internal pure
        returns (bytes memory)
    {
        unchecked {
            bytes memory ret = new bytes(end_ - start_);
            for (uint256 i = 0; i < end_ - start_; i++) {
                ret[i] = data_[i + start_];
            }
            return ret;
        }
    }

    function indexOf(bytes memory data_, bytes1 char_)
        internal pure
        returns (uint256, bool)
    {
        unchecked {
            for (uint256 i = 0; i < data_.length; i++) {
                if (data_[i] == char_) {
                    return (i, true);
                }
            }
            return (0, false);
        }
    }
}
