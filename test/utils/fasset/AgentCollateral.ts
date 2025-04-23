import { AgentInfo, AssetManagerSettings, CollateralClass } from "../../../lib/fasset/AssetManagerTypes";
import { BN_ZERO, MAX_BIPS, exp10, maxBN, minBN, toBN } from "../../../lib/utils/helpers";
import { IIAssetManagerInstance } from "../../../typechain-truffle";
import { CollateralData, CollateralDataFactory, CollateralKind } from "./CollateralData";

const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

export class AgentCollateral {
    constructor(
        public settings: AssetManagerSettings,
        public agentInfo: AgentInfo,
        public vault: CollateralData,
        public pool: CollateralData,
        public agentPoolTokens: CollateralData,
    ) {

    }

    static async create(assetManager: IIAssetManagerInstance, settings: AssetManagerSettings, agentVault: string) {
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const collateralPool = await CollateralPool.at(agentInfo.collateralPool);
        const collateralPoolToken = await CollateralPoolToken.at(await collateralPool.poolToken());
        const vaultCollateral = await assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        const poolCollateral = await assetManager.getCollateralType(CollateralClass.POOL, await collateralPool.wNat());
        const collateralDataFactory = await CollateralDataFactory.create(settings);
        const vaultCollateralCD = await collateralDataFactory.vault(vaultCollateral, agentVault);
        const poolCD = await collateralDataFactory.pool(poolCollateral, collateralPool.address);
        const agetPoolTokenCD = await collateralDataFactory.agentPoolTokens(poolCD, collateralPoolToken, agentVault);
        return new AgentCollateral(settings, agentInfo, vaultCollateralCD, poolCD, agetPoolTokenCD);
    }

    ofKind(kind: CollateralKind) {
        switch (kind) {
            case CollateralKind.VAULT:
                return this.vault;
            case CollateralKind.POOL:
                return this.pool;
            case CollateralKind.AGENT_POOL_TOKENS:
                return this.agentPoolTokens;
        }
    }

    freeCollateralLots(chargePoolFee: boolean = true) {
        const vaultCollateralLots = this.freeSingleCollateralLots(this.vault, chargePoolFee);
        const poolLots = this.freeSingleCollateralLots(this.pool, chargePoolFee);
        const agentPoolLots = this.freeSingleCollateralLots(this.agentPoolTokens, chargePoolFee);
        return minBN(vaultCollateralLots, poolLots, agentPoolLots);
    }

    freeSingleCollateralLots(data: CollateralData, chargePoolFee: boolean = true): BN {
        const collateralWei = this.freeCollateralWei(data);
        const lotWei = this.mintingLotCollateralWei(data, chargePoolFee);
        return collateralWei.div(lotWei);
    }

    freeCollateralWei(data: CollateralData): BN {
        const lockedCollateral = this.lockedCollateralWei(data);
        return maxBN(data.balance.sub(lockedCollateral), BN_ZERO);
    }

    lockedCollateralWei(data: CollateralData): BN {
        const [mintingMinCollateralRatioBIPS, systemMinCollateralRatioBIPS] = this.mintingCollateralRatio(data.kind());
        const backedUBA = toBN(this.agentInfo.reservedUBA).add(toBN(this.agentInfo.mintedUBA));
        const mintingCollateral = data.convertUBAToTokenWei(backedUBA).mul(mintingMinCollateralRatioBIPS).divn(MAX_BIPS);
        const redeemingUBA = data.kind() === CollateralKind.POOL ? toBN(this.agentInfo.poolRedeemingUBA) : toBN(this.agentInfo.redeemingUBA);
        const redeemingCollateral = data.convertUBAToTokenWei(redeemingUBA).mul(systemMinCollateralRatioBIPS).divn(MAX_BIPS);
        const announcedWithdrawal =
            data.kind() === CollateralKind.VAULT ? toBN(this.agentInfo.announcedVaultCollateralWithdrawalWei) :
            data.kind() === CollateralKind.AGENT_POOL_TOKENS ? toBN(this.agentInfo.announcedPoolTokensWithdrawalWei) :
            BN_ZERO;
        return mintingCollateral.add(redeemingCollateral).add(announcedWithdrawal);
    }

    mintingLotCollateralWei(data: CollateralData, chargePoolFee: boolean = true): BN {
        return this.collateralRequiredToMintAmountAMG(data, toBN(this.settings.lotSizeAMG), chargePoolFee);
    }

    collateralRequiredToMintAmountAMG(data: CollateralData, amountAMG: BN, chargePoolFee: boolean = true) {
        const amountPoolFeeAMG = amountAMG
            .mul(toBN(this.agentInfo.feeBIPS)).divn(MAX_BIPS)
            .mul(toBN(this.agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
        const totalMintAmountAMG = chargePoolFee ? amountAMG.add(amountPoolFeeAMG) : amountAMG;
        const totalMintAmountWei = data.convertAmgToTokenWei(totalMintAmountAMG);
        const [mintingMinCollateralRatio] = this.mintingCollateralRatio(data.kind());
        return totalMintAmountWei.mul(mintingMinCollateralRatio).divn(MAX_BIPS);
    }

    mintingCollateralRatio(kind: CollateralKind): [mintingBIPS: BN, systemBIPS: BN] {
        switch (kind) {
            case CollateralKind.VAULT: {
                const systemBIPS = toBN(this.vault.collateral!.minCollateralRatioBIPS);
                const mintingBIPS = maxBN(toBN(this.agentInfo.mintingVaultCollateralRatioBIPS), systemBIPS);
                return [mintingBIPS, systemBIPS];
            }
            case CollateralKind.POOL: {
                const systemBIPS = toBN(this.pool.collateral!.minCollateralRatioBIPS);
                const mintingBIPS = maxBN(toBN(this.agentInfo.mintingPoolCollateralRatioBIPS), systemBIPS);
                return [mintingBIPS, systemBIPS];
            }
            case CollateralKind.AGENT_POOL_TOKENS: {
                const systemBIPS = toBN(this.settings.mintingPoolHoldingsRequiredBIPS);
                const mintingBIPS = toBN(this.settings.mintingPoolHoldingsRequiredBIPS);
                return [mintingBIPS, systemBIPS];
            }
        }
    }

    collateralRatioBIPS(data: CollateralData) {
        const redeemingUBA = data.kind() === CollateralKind.POOL ? this.agentInfo.poolRedeemingUBA : this.agentInfo.redeemingUBA;
        const totalBacked = toBN(this.agentInfo.mintedUBA).add(toBN(this.agentInfo.reservedUBA)).add(toBN(redeemingUBA))
        if (totalBacked.isZero()) return exp10(10);    // nothing minted - ~infinite collateral ratio (but avoid overflows)
        const backingTokenWei = data.convertUBAToTokenWei(totalBacked);
        return data.balance.muln(MAX_BIPS).div(backingTokenWei);
    }
}
