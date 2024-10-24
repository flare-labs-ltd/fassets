// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "./IWNat.sol";


interface IISettingsManagement {
    function updateSystemContracts(address _controller, IWNat _wNat)
        external;

    function setWhitelist(address _value)
        external;

    function setAgentOwnerRegistry(address _value)
        external;

    function setAgentVaultFactory(address _value)
        external;

    function setCollateralPoolFactory(address _value)
        external;

    function setCollateralPoolTokenFactory(address _value)
        external;

    function setPriceReader(address _value)
        external;

    function setFdcVerification(address _value)
        external;

    function setCleanerContract(address _value)
        external;

    function setCleanupBlockNumberManager(address _value)
        external;

    function upgradeFAssetImplementation(address _value, bytes memory callData)
        external;

    function setTimeForPayment(uint256 _underlyingBlocks, uint256 _underlyingSeconds)
        external;

    function setPaymentChallengeReward(uint256 _rewardNATWei, uint256 _rewardBIPS)
        external;

    function setMinUpdateRepeatTimeSeconds(uint256 _value)
        external;

    function setLotSizeAmg(uint256 _value)
        external;

    function setMinUnderlyingBackingBips(uint256 _value)
        external;

    function setMaxTrustedPriceAgeSeconds(uint256 _value)
        external;

    function setCollateralReservationFeeBips(uint256 _value)
        external;

    function setRedemptionFeeBips(uint256 _value)
        external;

    function setRedemptionDefaultFactorBips(uint256 _vaultFactor, uint256 _poolFactor)
        external;

    function setConfirmationByOthersAfterSeconds(uint256 _value)
        external;

    function setConfirmationByOthersRewardUSD5(uint256 _value)
        external;

    function setMaxRedeemedTickets(uint256 _value)
        external;

    function setWithdrawalOrDestroyWaitMinSeconds(uint256 _value)
        external;

    function setCcbTimeSeconds(uint256 _value)
        external;

    function setAttestationWindowSeconds(uint256 _value)
        external;

    function setAverageBlockTimeMS(uint256 _value)
        external;

    function setAnnouncedUnderlyingConfirmationMinSeconds(uint256 _value)
        external;

    function setMintingPoolHoldingsRequiredBIPS(uint256 _value)
        external;

    function setMintingCapAmg(uint256 _value)
        external;

    function setTokenInvalidationTimeMinSeconds(uint256 _value)
        external;

    function setVaultCollateralBuyForFlareFactorBIPS(uint256 _value)
        external;

    function setAgentExitAvailableTimelockSeconds(uint256 _value)
        external;

    function setAgentFeeChangeTimelockSeconds(uint256 _value)
        external;

    function setAgentMintingCRChangeTimelockSeconds(uint256 _value)
        external;

    function setPoolExitAndTopupChangeTimelockSeconds(uint256 _value)
        external;

    function setAgentTimelockedOperationWindowSeconds(uint256 _value)
        external;

    function setCollateralPoolTokenTimelockSeconds(uint256 _value)
        external;

    function setLiquidationStepSeconds(uint256 _stepSeconds)
        external;

    function setLiquidationPaymentFactors(
        uint256[] memory _liquidationFactors,
        uint256[] memory _vaultCollateralFactors
    ) external;

    function setMaxEmergencyPauseDurationSeconds(uint256 _value)
        external;

    function setEmergencyPauseDurationResetAfterSeconds(uint256 _value)
        external;

    function setCancelCollateralReservationAfterSeconds(uint256 _value)
        external;

    function setRejectRedemptionRequestWindowSeconds(uint256 _value)
        external;

    function setTakeOverRedemptionRequestWindowSeconds(uint256 _value)
        external;

    function setRejectedRedemptionDefaultFactorBips(uint256 _vaultF, uint256 _poolF)
        external;
}
