**depositCollateral** - Deposit vault collateral. Parameter `_token` is explicit to allow depositing before collateral switch.
NOTE: owner must call `token.approve(vault, amount)` before calling this method. NOTE: anybody can call this method, to allow the owner to deposit from any wallet.

**updateCollateral** - Update collateral after `transfer(vault, some amount)` was called (alternative to depositCollateral). Parameter `_token` is explicit to allow depositing before collateral switch.
NOTE: anybody can call this method, to allow the owner to deposit from any source.

**withdrawCollateral** - Withdraw vault collateral. This method will work for any token, but for vault collateral and agent pool tokens (which are locked because they may be backing f-assets) there is a check that there was prior announcement by calling `assetManager.announceVaultCollateralWithdrawal(...)`.
NOTE: only the owner of the agent vault may call this method.

**transferExternalToken** - Allow transferring a token, airdropped to the agent vault, to the owner (management address). Doesn't work for vault collateral tokens or agent's pool tokens  because this would allow withdrawing the locked collateral.
NOTE: only the owner of the agent vault may call this method.

**buyCollateralPoolTokens** - Buy collateral pool tokens for NAT. Holding enough pool tokens in the vault is required for minting.
NOTE: anybody can call this method, to allow the owner to deposit from any source.

**withdrawPoolFees** - Collateral pool tokens which must be held by the agent accrue minting fees in form of f-assets. These fees can be withdrawn using this method.
NOTE: only the owner of the agent vault may call this method.

**redeemCollateralPoolTokens** - This method allows the agent to convert collateral pool tokens back to NAT. Prior announcement is required by calling `assetManager.announceAgentPoolTokenRedemption(...)`.
NOTE: only the owner of the agent vault may call this method.

**delegate** - Delegate FTSO vote power for a collateral token held in this vault.
NOTE: only the owner of the agent vault may call this method.

**undelegateAll** - Undelegate FTSO vote power for a collateral token held in this vault.
NOTE: only the owner of the agent vault may call this method.

**revokeDelegationAt** - Revoke FTSO vote power delegation for a block in the past for a collateral token held in this vault.
NOTE: only the owner of the agent vault may call this method.

**delegateGovernance** - Delegate governance vote power for possible NAT collateral token held in this vault.
NOTE: only the owner of the agent vault may call this method.

**undelegateGovernance** - Undelegate governance vote power for possible NAT collateral token held in this vault.
NOTE: only the owner of the agent vault may call this method.

**claimFtsoRewards** - Claim the FTSO rewards earned by delegating. Alternatively, you can set a claim executor and then claim directly from FtsoRewardManager.
NOTE: only the owner of the agent vault may call this method.

**setAutoClaiming** - Set executors and recipients that can then automatically claim rewards and airdrop.
NOTE: only the owner of the agent vault may call this method.

**claimAirdropDistribution** - Claim airdrops earned by holding wNAT in the vault.
NOTE: only the owner of the agent vault may call this method.

**optOutOfAirdrop** - Opt out of airdrops for wNAT in the vault.
NOTE: only the owner of the agent vault may call this method.

**collateralPool** - Get the address of the collateral pool contract corresponding to this agent vault (there is 1:1 correspondence between agent vault and collateral pools).
