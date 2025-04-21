// File: programs/wct-staking/src/lib.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("YOUR_STAKING_PROGRAM_ID");

#[program]
pub mod wct_staking {
    use super::*;

    // Initialize the staking program with admin authority
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        staking_pool.authority = ctx.accounts.authority.key();
        staking_pool.token_mint = ctx.accounts.token_mint.key();
        staking_pool.treasury_token_account = ctx.accounts.treasury_token_account.key();
        staking_pool.total_staked = 0;
        staking_pool.staker_count = 0;
        staking_pool.bump = *ctx.bumps.get("staking_pool").unwrap();
        
        // Default rewards configuration
        staking_pool.reward_rate = 10; // 10 basis points per day (0.1%)
        staking_pool.min_stake_duration = 30 * 24 * 60 * 60; // 30 days in seconds
        staking_pool.max_stake_duration = 365 * 24 * 60 * 60; // 365 days in seconds
        
        Ok(())
    }

    // Start staking tokens
    pub fn stake(ctx: Context<Stake>, amount: u64, duration: i64) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        let user_stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;
        
        // Validate stake duration
        require!(
            duration >= staking_pool.min_stake_duration && duration <= staking_pool.max_stake_duration,
            StakingError::InvalidStakeDuration
        );
        
        // Calculate end timestamp
        let end_timestamp = clock.unix_timestamp + duration;
        
        // Setup user stake account
        user_stake.owner = ctx.accounts.user.key();
        user_stake.stake_amount = amount;
        user_stake.start_timestamp = clock.unix_timestamp;
        user_stake.end_timestamp = end_timestamp;
        user_stake.claimed_reward = 0;
        user_stake.last_claim_timestamp = clock.unix_timestamp;
        user_stake.withdrawn = false;
        
        // Calculate reputation boost based on duration
        // 30 days: 10% boost, 90 days: 20% boost, 180 days: 30% boost, 365 days: 50% boost
        if duration >= 365 * 24 * 60 * 60 {
            user_stake.reputation_boost = 50; // 50% boost
        } else if duration >= 180 * 24 * 60 * 60 {
            user_stake.reputation_boost = 30; // 30% boost
        } else if duration >= 90 * 24 * 60 * 60 {
            user_stake.reputation_boost = 20; // 20% boost
        } else {
            user_stake.reputation_boost = 10; // 10% boost
        }
        
        // Calculate voting power based on duration
        // 1 vote per 1000 tokens, multiplied by duration boost
        let duration_factor = match duration {
            d if d >= 365 * 24 * 60 * 60 => 3, // 3x for 365 days
            d if d >= 180 * 24 * 60 * 60 => 2, // 2x for 180 days
            d if d >= 90 * 24 * 60 * 60 => 1.5, // 1.5x for 90 days
            _ => 1, // 1x for 30 days
        };
        
        user_stake.voting_power = ((amount / 1_000_000_000) as f64 * duration_factor) as u64;
        
        // Update staking pool
        staking_pool.total_staked = staking_pool.total_staked.checked_add(amount).unwrap();
        staking_pool.staker_count = staking_pool.staker_count.checked_add(1).unwrap();
        
        // Transfer tokens from user to staking vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.staking_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Emit stake event
        emit!(StakeEvent {
            user: ctx.accounts.user.key(),
            amount,
            duration,
            end_timestamp,
            reputation_boost: user_stake.reputation_boost,
            voting_power: user_stake.voting_power,
        });
        
        Ok(())
    }

    // Claim staking rewards
    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        let staking_pool = &ctx.accounts.staking_pool;
        let user_stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;
        
        // Ensure stake is still active
        require!(!user_stake.withdrawn, StakingError::StakeAlreadyWithdrawn);
        
        // Calculate time elapsed since last claim
        let time_elapsed = clock
            .unix_timestamp
            .checked_sub(user_stake.last_claim_timestamp)
            .unwrap();
        
        // Ensure some time has elapsed for rewards
        require!(time_elapsed > 0, StakingError::NoRewardsYet);
        
        // Calculate reward (pro-rated for time elapsed)
        // reward = stake_amount * reward_rate * time_elapsed / (365 * 24 * 60 * 60 * 10000)
        // reward_rate is in basis points (1/100 of a percent)
        let days_elapsed = time_elapsed as f64 / (24.0 * 60.0 * 60.0);
        let reward_amount = (user_stake.stake_amount as u128)
            .checked_mul(staking_pool.reward_rate as u128)
            .unwrap()
            .checked_mul(time_elapsed as u128)
            .unwrap()
            .checked_div((365 * 24 * 60 * 60 * 10000) as u128)
            .unwrap() as u64;
        
        // Update user stake
        user_stake.claimed_reward = user_stake.claimed_reward.checked_add(reward_amount).unwrap();
        user_stake.last_claim_timestamp = clock.unix_timestamp;
        
        // Transfer rewards from treasury to user
        let pool_seeds = &[
            b"staking_pool".as_ref(),
            staking_pool.token_mint.as_ref(),
            &[staking_pool.bump],
        ];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.treasury_token_account.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.staking_pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            reward_amount,
        )?;
        
        // Emit reward event
        emit!(RewardEvent {
            user: ctx.accounts.user.key(),
            reward_amount,
            days_elapsed: days_elapsed as u64,
            total_claimed: user_stake.claimed_reward,
        });
        
        Ok(())
    }

    // Unstake tokens after the lock period
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        let user_stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;
        
        // Ensure stake is still active
        require!(!user_stake.withdrawn, StakingError::StakeAlreadyWithdrawn);
        
        // Check if lock period has ended
        require!(
            clock.unix_timestamp >= user_stake.end_timestamp,
            StakingError::StakeLockNotExpired
        );
        
        // Calculate final reward if not claimed
        if clock.unix_timestamp > user_stake.last_claim_timestamp {
            let time_elapsed = clock
                .unix_timestamp
                .checked_sub(user_stake.last_claim_timestamp)
                .unwrap();
                
            let final_reward = (user_stake.stake_amount as u128)
                .checked_mul(staking_pool.reward_rate as u128)
                .unwrap()
                .checked_mul(time_elapsed as u128)
                .unwrap()
                .checked_div((365 * 24 * 60 * 60 * 10000) as u128)
                .unwrap() as u64;
                
            user_stake.claimed_reward = user_stake.claimed_reward.checked_add(final_reward).unwrap();
            
            // Transfer final reward
            let pool_seeds = &[
                b"staking_pool".as_ref(),
                staking_pool.token_mint.as_ref(),
                &[staking_pool.bump],
            ];
            
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.treasury_token_account.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.staking_pool.to_account_info(),
                    },
                    &[pool_seeds],
                ),
                final_reward,
            )?;
        }
        
        // Return staked tokens
        let pool_seeds = &[
            b"staking_pool".as_ref(),
            staking_pool.token_mint.as_ref(),
            &[staking_pool.bump],
        ];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.staking_vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.staking_pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            user_stake.stake_amount,
        )?;
        
        // Update staking pool
        staking_pool.total_staked = staking_pool.total_staked.checked_sub(user_stake.stake_amount).unwrap();
        staking_pool.staker_count = staking_pool.staker_count.checked_sub(1).unwrap();
        
        // Mark stake as withdrawn
        user_stake.withdrawn = true;
        
        // Emit unstake event
        emit!(UnstakeEvent {
            user: ctx.accounts.user.key(),
            amount: user_stake.stake_amount,
            total_rewards: user_stake.claimed_reward,
        });
        
        Ok(())
    }

    // Update reward parameters (admin only)
    pub fn update_reward_params(
        ctx: Context<UpdateRewardParams>,
        new_reward_rate: u64,
        new_min_duration: i64,
        new_max_duration: i64,
    ) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        
        // Update parameters
        staking_pool.reward_rate = new_reward_rate;
        staking_pool.min_stake_duration = new_min_duration;
        staking_pool.max_stake_duration = new_max_duration;
        
        // Emit event
        emit!(ParamsUpdateEvent {
            reward_rate: new_reward_rate,
            min_stake_duration: new_min_duration,
            max_stake_duration: new_max_duration,
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + StakingPool::LEN,
        seeds = [b"staking_pool".as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(
        constraint = treasury_token_account.mint == token_mint.key(),
        constraint = treasury_token_account.owner == staking_pool.key(),
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    #[account(
        init,
        payer = authority,
        associated_token::mint = token_mint,
        associated_token::authority = staking_pool,
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool".as_ref(), staking_pool.token_mint.as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        init,
        payer = user,
        space = 8 + UserStake::LEN,
        seeds = [b"user_stake".as_ref(), user.key().as_ref(), staking_pool.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == staking_pool.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = staking_vault.mint == staking_pool.token_mint,
        constraint = staking_vault.owner == staking_pool.key(),
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(
        seeds = [b"staking_pool".as_ref(), staking_pool.token_mint.as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"user_stake".as_ref(), user.key().as_ref(), staking_pool.key().as_ref()],
        bump,
        constraint = user_stake.owner == user.key(),
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == staking_pool.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = treasury_token_account.key() == staking_pool.treasury_token_account,
        constraint = treasury_token_account.mint == staking_pool.token_mint,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool".as_ref(), staking_pool.token_mint.as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [b"user_stake".as_ref(), user.key().as_ref(), staking_pool.key().as_ref()],
        bump,
        constraint = user_stake.owner == user.key(),
    )]
    pub user_stake: Account<'info, UserStake>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(
        mut,
        constraint = user_token_account.mint == staking_pool.token_mint,
        constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = staking_vault.mint == staking_pool.token_mint,
        constraint = staking_vault.owner == staking_pool.key(),
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = treasury_token_account.key() == staking_pool.treasury_token_account,
        constraint = treasury_token_account.mint == staking_pool.token_mint,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateRewardParams<'info> {
    #[account(
        mut,
        seeds = [b"staking_pool".as_ref(), staking_pool.token_mint.as_ref()],
        bump = staking_pool.bump,
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        constraint = authority.key() == staking_pool.authority,
    )]
    pub authority: Signer<'info>,
}

#[account]
pub struct StakingPool {
    pub authority: Pubkey,         // Admin authority
    pub token_mint: Pubkey,        // Token mint address
    pub treasury_token_account: Pubkey, // Treasury account for rewards
    pub total_staked: u64,         // Total tokens staked
    pub staker_count: u64,         // Number of stakers
    pub reward_rate: u64,          // Basis points per day (1/100 of 1%)
    pub min_stake_duration: i64,   // Minimum staking duration in seconds
    pub max_stake_duration: i64,   // Maximum staking duration in seconds
    pub bump: u8,                  // PDA bump
}

impl StakingPool {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct UserStake {
    pub owner: Pubkey,             // User wallet
    pub stake_amount: u64,         // Amount staked
    pub start_timestamp: i64,      // Start time
    pub end_timestamp: i64,        // End time (lock expiry)
    pub claimed_reward: u64,       // Total rewards claimed
    pub last_claim_timestamp: i64, // Last reward claim time
    pub reputation_boost: u64,     // Reputation boost in percentage
    pub voting_power: u64,         // Governance voting power
    pub withdrawn: bool,           // Whether tokens were withdrawn
}

impl UserStake {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[event]
pub struct StakeEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub duration: i64,
    pub end_timestamp: i64,
    pub reputation_boost: u64,
    pub voting_power: u64,
}

#[event]
pub struct RewardEvent {
    pub user: Pubkey,
    pub reward_amount: u64,
    pub days_elapsed: u64,
    pub total_claimed: u64,
}

#[event]
pub struct UnstakeEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub total_rewards: u64,
}

#[event]
pub struct ParamsUpdateEvent {
    pub reward_rate: u64,
    pub min_stake_duration: i64,
    pub max_stake_duration: i64,
}

#[error_code]
pub enum StakingError {
    #[msg("Invalid stake duration. Must be between min and max duration.")]
    InvalidStakeDuration,
    #[msg("Stake lock period has not expired yet.")]
    StakeLockNotExpired,
    #[msg("Stake has already been withdrawn.")]
    StakeAlreadyWithdrawn,
    #[msg("No rewards available yet.")]
    NoRewardsYet,
}
