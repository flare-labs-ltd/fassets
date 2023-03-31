import { AgentInfo, AssetManagerSettings, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
import { convertAmgToTokenWei, convertUBAToTokenWei } from "../../../lib/fasset/Conversions";
import { BN_ZERO, MAX_BIPS, maxBN, minBN, toBN } from "../../../lib/utils/helpers";
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
        const class1Collateral = await assetManager.getCollateralToken(CollateralTokenClass.CLASS1, agentInfo.class1CollateralToken);
        const poolCollateral = await assetManager.getCollateralToken(CollateralTokenClass.POOL, await collateralPool.wNat());
        const collateralDataFactory = await CollateralDataFactory.create(settings);
        const class1CD = await collateralDataFactory.class1(class1Collateral, agentVault);
        const poolCD = await collateralDataFactory.pool(poolCollateral, collateralPool.address);
        const agetPoolTokenCD = await collateralDataFactory.agentPoolTokens(poolCD, collateralPoolToken, agentVault);
        return new AgentCollateral(settings, agentInfo, class1CD, poolCD, agetPoolTokenCD);
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
        const mintingCollateral = this.convertUBAToTokenWei(data, backedUBA).mul(mintingMinCollateralRatioBIPS).divn(MAX_BIPS);
        const redeemingUBA = data.kind() === CollateralKind.POOL ? toBN(this.agentInfo.poolRedeemingUBA) : toBN(this.agentInfo.redeemingUBA);
        const redeemingCollateral = this.convertUBAToTokenWei(data, redeemingUBA).mul(systemMinCollateralRatioBIPS).divn(MAX_BIPS);
        // TODO: add announced withdrawal amounts to full agent info
        // const announcedWithdrawal =
        //     data.kind() !== CollateralKind.POOL ? this.agentInfo.announcedWithdrawal : 0;
        return mintingCollateral.add(redeemingCollateral);
    }

    mintingLotCollateralWei(data: CollateralData): BN {
        const [mintingBIPS] = this.mintingCollateralRatio(data.kind());
        const lotSizeWei = convertAmgToTokenWei(this.settings.lotSizeAMG, data.amgToTokenWei);
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

    convertUBAToTokenWei(data: CollateralData, valueUBA: BN) {
        return convertUBAToTokenWei(this.settings, valueUBA, data.amgToTokenWei);
    }
}
