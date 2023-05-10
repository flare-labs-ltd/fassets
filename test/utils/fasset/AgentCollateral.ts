import { AgentInfo, AssetManagerSettings, CollateralClass } from "../../../lib/fasset/AssetManagerTypes";
import { BN_ZERO, MAX_BIPS, exp10, maxBN, minBN, toBN } from "../../../lib/utils/helpers";
import { AssetManagerInstance } from "../../../typechain-truffle";
import { CollateralData, CollateralDataFactory, CollateralKind } from "./CollateralData";

const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

export class AgentCollateral {
    constructor(
        public settings: AssetManagerSettings,
        public agentInfo: AgentInfo,
        public class1: CollateralData,
        public pool: CollateralData,
        public agentPoolTokens: CollateralData,
    ) {

    }

    static async create(assetManager: AssetManagerInstance, settings: AssetManagerSettings, agentVault: string) {
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const collateralPool = await CollateralPool.at(agentInfo.collateralPool);
        const collateralPoolToken = await CollateralPoolToken.at(await collateralPool.poolToken());
        const class1Collateral = await assetManager.getCollateralType(CollateralClass.CLASS1, agentInfo.class1CollateralToken);
        const poolCollateral = await assetManager.getCollateralType(CollateralClass.POOL, await collateralPool.wNat());
        const collateralDataFactory = await CollateralDataFactory.create(settings);
        const class1CD = await collateralDataFactory.class1(class1Collateral, agentVault);
        const poolCD = await collateralDataFactory.pool(poolCollateral, collateralPool.address);
        const agetPoolTokenCD = await collateralDataFactory.agentPoolTokens(poolCD, collateralPoolToken, agentVault);
        return new AgentCollateral(settings, agentInfo, class1CD, poolCD, agetPoolTokenCD);
    }

    ofKind(kind: CollateralKind) {
        switch (kind) {
            case CollateralKind.CLASS1:
                return this.class1;
            case CollateralKind.POOL:
                return this.pool;
            case CollateralKind.AGENT_POOL_TOKENS:
                return this.agentPoolTokens;
        }
    }

    freeCollateralLots() {
        const class1Lots = this.freeSingleCollateralLots(this.class1);
        const poolLots = this.freeSingleCollateralLots(this.pool);
        const agentPoolLots = this.freeSingleCollateralLots(this.agentPoolTokens);
        return minBN(class1Lots, poolLots, agentPoolLots);
    }

    freeSingleCollateralLots(data: CollateralData): BN {
        const collateralWei = this.freeCollateralWei(data);
        const lotWei = this.mintingLotCollateralWei(data);
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
            data.kind() === CollateralKind.CLASS1 ? toBN(this.agentInfo.announcedClass1WithdrawalWei) :
            data.kind() === CollateralKind.AGENT_POOL_TOKENS ? toBN(this.agentInfo.announcedPoolTokensWithdrawalWei) :
            BN_ZERO;
        return mintingCollateral.add(redeemingCollateral).add(announcedWithdrawal);
    }

    mintingLotCollateralWei(data: CollateralData): BN {
        const [mintingBIPS] = this.mintingCollateralRatio(data.kind());
        const lotSizeWei = data.convertAmgToTokenWei(this.settings.lotSizeAMG);
        return lotSizeWei.mul(mintingBIPS).divn(MAX_BIPS);
    }

    mintingCollateralRatio(kind: CollateralKind): [mintingBIPS: BN, systemBIPS: BN] {
        switch (kind) {
            case CollateralKind.CLASS1: {
                const systemBIPS = toBN(this.class1.collateral!.minCollateralRatioBIPS);
                const mintingBIPS = maxBN(toBN(this.agentInfo.mintingClass1CollateralRatioBIPS), systemBIPS);
                return [mintingBIPS, systemBIPS];
            }
            case CollateralKind.POOL: {
                const systemBIPS = toBN(this.pool.collateral!.minCollateralRatioBIPS);
                const mintingBIPS = maxBN(toBN(this.agentInfo.mintingPoolCollateralRatioBIPS), systemBIPS);
                return [mintingBIPS, systemBIPS];
            }
            case CollateralKind.AGENT_POOL_TOKENS: {
                const [poolMintingBIPS, poolSystemBIPS] = this.mintingCollateralRatio(CollateralKind.POOL);
                const systemBIPS = toBN(this.settings.mintingPoolHoldingsRequiredBIPS).mul(poolSystemBIPS).divn(MAX_BIPS);
                const mintingBIPS = toBN(this.settings.mintingPoolHoldingsRequiredBIPS).mul(poolMintingBIPS).divn(MAX_BIPS);
                return [mintingBIPS, systemBIPS];
            }
        }
    }

    collateralRatioBIPS(data: CollateralData) {
        const totalBacked = toBN(this.agentInfo.mintedUBA).add(toBN(this.agentInfo.reservedUBA)).add(toBN(this.agentInfo.redeemingUBA))
        if (totalBacked.isZero()) return exp10(10);    // nothing minted - ~infinite collateral ratio (but avoid overflows)
        const backingTokenWei = data.convertUBAToTokenWei(totalBacked);
        return data.balance.muln(MAX_BIPS).div(backingTokenWei);
    }
}
