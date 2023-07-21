**enter** - Enters the contingency pool by depositing NAT and f-asset, obtaining pool tokens, allowing holder to exit with NAT and f-asset fees later. If the user doesn't provide enough f-assets, they are still able to collect future f-asset fees and exit with NAT, but their tokens are non-transferable. Tokens can be made transferable by paying the f-asset fee debt and non-transferable by withdrawing f-asset fees.

**exit** - Exits the pool by redeeming the given amount of pool tokens for a share of NAT and f-asset fees. Exiting with non-transferable tokens awards the user with NAT only, while transferable tokens also entitle one to a share of f-asset fees. As there are multiple ways to split spending transferable and non-transferable tokens, the method also takes a parameter called `_exitType`. Exiting with collateral that sinks pool's collateral ratio below exit CR is not allowed and  will revert. In that case, see selfCloseExit.

**selfCloseExit** - Exits the pool by redeeming the given amount of pool tokens and burning f-assets in a way that doesn't endanger the pool collateral ratio. Specifically, if pool's collateral ratio is above exit CR, then the method burns an amount of user's f-assets that do not lower collateral ratio below exit CR. If, on the other hand, contingency pool is below exit CR, then the method burns an amount of user's f-assets that preserve the pool's collateral ratio. F-assets will be redeemed in collateral if their value does not exceed one lot, regardless of  `_redeemToCollateral` value. Method first tries to satisfy the condition by taking f-assets out of sender's f-asset fee share,  specified by `_tokenShare`. If it is not enough it moves on to spending total sender's f-asset fees. If they  are not enough, it takes from the sender's f-asset balance. Spending sender's f-asset fees means that  transferable tokens are converted to non-transferable.

**withdrawFees** - Collect f-asset fees by locking an appropriate ratio of transferable tokens

**payFAssetFeeDebt** - Unlock pool tokens by paying f-asset fee debt

**claimAirdropDistribution** - Claim airdrops earned by holding wrapped native tokens in the pool.
NOTE: only the owner of the pool's corresponding agent vault may call this method.

**optOutOfAirdrop** - Opt out of airdrops for wrapped native tokens in the pool.
NOTE: only the owner of the pool's corresponding agent vault may call this method.

**delegate** - Delegate FTSO vote power for the wrapped native tokens held in this vault.
NOTE: only the owner of the pool's corresponding agent vault may call this method.

**claimFtsoRewards** - Claim the FTSO rewards earned by delegating the vote power for the pool.
NOTE: only the owner of the pool's corresponding agent vault may call this method.

**setAutoClaiming** - Set executors that can then automatically claim rewards and airdrop.
NOTE: only the owner of the pool's corresponding agent vault may call this method.

**withdrawCollateralWhenFAssetTerminated** - In case of f-asset termination, withdraw all of sender's collateral

**poolToken** - Get the ERC20 pool token used by this contingency pool

**agentVault** - Get the vault of the agent that owns this contingency pool

**exitCollateralRatioBIPS** - Get the exit collateral ratio in BIPS This is the collateral ratio below which exiting the pool is not allowed

**topupCollateralRatioBIPS** - Get the topup collateral ratio in BIPS. If the pool's collateral ratio sinks below this value, users are encouraged to buy collateral by making tokens have discount prices

**topupTokenPriceFactorBIPS** - Get the topup token discount in BIPS. If the pool's collateral ratio sinks below topup collateral ratio, tokens are discounted by this factor

**fAssetFeesOf** - Returns the f-asset fees belonging to this user. This is the amount of f-assets the user can withdraw by burning transferable pool tokens.

**fAssetFeeDebtOf** - Returns the user's f-asset fee debt. This is the amount of f-assets the user has to pay to make all pool tokens transferable. The debt is created on entering the pool if the user doesn't provide the f-assets corresponding to the share of the f-asset fees already in the pool.
