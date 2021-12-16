// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./PaymentVerification.sol";

library PaymentReport {
    using SafeMath for uint256;

    enum ReportMatch { DOES_NOT_EXIST, MATCH, MISMATCH }
    
    struct Report {
        // hash of (sourceAddress, targetAddress, valueUBA, gasUBA)
        bytes24 detailsHash;
        
        // report timestamp, to know when report is eligible for cleanup
        uint64 timestamp;
    }
    
    struct Reports {
        // mapping(PaymentVerification.transactionKey(paymentInfo) => Report)
        mapping(bytes32 => Report) reports;
    }
    
    uint256 internal constant REPORT_CLEANUP_SECONDS = 5 * 86400;   // 5 days, as for verification
        
    function createReport(
        Reports storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo
    )
        internal
    {
        bytes32 txKey = PaymentVerification.transactionKey(_paymentInfo);
        _state.reports[txKey] = Report({
            detailsHash: _detailsHash(_paymentInfo),
            timestamp: uint64(block.timestamp)     // cannot overflow
        });
    }

    function deleteReport(
        Reports storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo
    )
        internal
    {
        bytes32 txKey = PaymentVerification.transactionKey(_paymentInfo);
        delete _state.reports[txKey];
    }

    function cleanupReport(
        Reports storage _state,
        bytes32 _transactionKey
    )
        internal
    {
        Report storage report = _state.reports[_transactionKey];
        require(uint256(report.timestamp).add(REPORT_CLEANUP_SECONDS) <= block.timestamp,
            "payment report cleanup too soon");
        delete _state.reports[_transactionKey];
    }

    function reportMatch(
        Reports storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo
    )
        internal view
        returns (ReportMatch)
    {
        bytes32 txKey = PaymentVerification.transactionKey(_paymentInfo);
        Report storage report = _state.reports[txKey];
        if (report.detailsHash == 0) {
            return ReportMatch.DOES_NOT_EXIST;
        } else if (report.detailsHash == _detailsHash(_paymentInfo)) {
            return ReportMatch.MATCH;
        } else {
            return ReportMatch.MISMATCH;
        }
    }
    
    function _detailsHash(
        PaymentVerification.UnderlyingPaymentInfo memory _pi
    )
        private pure
        returns (bytes24)
    {
        bytes32 detailsHash = keccak256(
            abi.encode(_pi.sourceAddress, _pi.targetAddress, _pi.valueUBA, _pi.gasUBA));
        return bytes24(detailsHash);
    }
}
