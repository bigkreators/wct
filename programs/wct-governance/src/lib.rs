// File: programs/wct-governance/src/lib.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("YOUR_GOVERNANCE_PROGRAM_ID");

#[program]
pub mod wct_governance {
    use super::*;

    // Initialize the governance program
    pub fn initialize(
        ctx: Context<Initialize>,
        min_proposal_tokens: u64,
        voting_period: i64,
        execution_delay: i64,
        quorum_percentage: u8,
    ) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        
        // Validate parameters
        require!(quorum_percentage > 0 && quorum_percentage <= 100, GovernanceError::InvalidQuorumPercentage);
        require!(voting_period > 0, GovernanceError::InvalidVotingPeriod);
        require!(execution_delay >= 0, GovernanceError::InvalidExecutionDelay);
        
        // Initialize governance
        governance.authority = ctx.accounts.authority.key();
        governance.token_mint = ctx.accounts.token_mint.key();
        governance.treasury = ctx.accounts.treasury.key();
        governance.min_proposal_tokens = min_proposal_tokens;
        governance.voting_period = voting_period;
        governance.execution_delay = execution_delay;
        governance.quorum_percentage = quorum_percentage;
        governance.proposal_count = 0;
        governance.total_voting_power = 0; // Will be updated as users stake
        governance.bump = *ctx.bumps.get("governance").unwrap();
        
        // Initialize voting power registry
        let voting_power_registry = &mut ctx.accounts.voting_power_registry;
        voting_power_registry.governance = governance.key();
        voting_power_registry.total_voting_power = 0;
        voting_power_registry.bump = *ctx.bumps.get("voting_power_registry").unwrap();
        
        emit!(GovernanceInitializedEvent {
            governance: governance.key(),
            min_proposal_tokens,
            voting_period,
            execution_delay,
            quorum_percentage,
        });
        
        Ok(())
    }

    // Create a new proposal
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        title: String,
        description: String,
        proposal_type: ProposalType,
        execution_payload: Vec<u8>,
    ) -> Result<()> {
        let governance = &ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;
        let proposer = &ctx.accounts.proposer;
        let clock = Clock::get()?;
        
        // Verify user has enough tokens to create a proposal
        require!(
            ctx.accounts.proposer_token_account.amount >= governance.min_proposal_tokens,
            GovernanceError::InsufficientTokens
        );
        
        // Initialize proposal
        proposal.governance = governance.key();
        proposal.proposer = proposer.key();
        proposal.proposal_id = governance.proposal_count + 1;
        proposal.title = title;
        proposal.description = description;
        proposal.proposal_type = proposal_type;
        proposal.execution_payload = execution_payload;
        proposal.created_at = clock.unix_timestamp;
        proposal.voting_ends_at = clock.unix_timestamp + governance.voting_period;
        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.executed = false;
        proposal.cancelled = false;
        
        // Update governance proposal count
        let governance_data = &mut ctx.accounts.governance.load_mut()?;
        governance_data.proposal_count += 1;
        
        emit!(ProposalCreatedEvent {
            proposal: proposal.key(),
            governance: governance.key(),
            proposer: proposer.key(),
            proposal_id: proposal.proposal_id,
            title: proposal.title.clone(),
            proposal_type: proposal.proposal_type,
            voting_ends_at: proposal.voting_ends_at,
        });
        
        Ok(())
    }

    // Cast vote on a proposal
    pub fn cast_vote(
        ctx: Context<CastVote>,
        vote: Vote,
    ) -> Result<()> {
        let governance = &ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;
        let voter = &ctx.accounts.voter;
        let voting_power_registry = &ctx.accounts.voting_power_registry;
        let clock = Clock::get()?;
        
        // Verify voting is still open
        require!(
            clock.unix_timestamp < proposal.voting_ends_at,
            GovernanceError::VotingClosed
        );
        
        // Verify proposal is not cancelled
        require!(
            !proposal.cancelled,
            GovernanceError::ProposalCancelled
        );
        
        // Verify proposal is not executed
        require!(
            !proposal.executed,
            GovernanceError::ProposalAlreadyExecuted
        );
        
        // Get voter's voting power
        let voter_power = get_voter_power(voting_power_registry, voter.key())?;
        
        require!(voter_power > 0, GovernanceError::NoVotingPower);
        
        // Check if the voter already voted
        let voter_vote_account_info = &ctx.accounts.voter_vote;
        
        if voter_vote_account_info.data_is_empty() {
            // First time voting, create vote record
            let voter_vote = &mut ctx.accounts.voter_vote;
            voter_vote.voter = voter.key();
            voter_vote.proposal = proposal.key();
            voter_vote.vote = vote;
            voter_vote.voting_power = voter_power;
            
            // Update proposal vote counts
            match vote {
                Vote::Yes => {
                    proposal.yes_votes = proposal.yes_votes.checked_add(voter_power).unwrap();
                }
                Vote::No => {
                    proposal.no_votes = proposal.no_votes.checked_add(voter_power).unwrap();
                }
                Vote::Abstain => {
                    // Abstaining doesn't affect yes/no counts but still counts toward quorum
                }
            }
        } else {
            // Voter already voted, update their vote
            let voter_vote = &mut ctx.accounts.voter_vote;
            
            // Remove previous vote
            match voter_vote.vote {
                Vote::Yes => {
                    proposal.yes_votes = proposal.yes_votes.checked_sub(voter_vote.voting_power).unwrap();
                }
                Vote::No => {
                    proposal.no_votes = proposal.no_votes.checked_sub(voter_vote.voting_power).unwrap();
                }
                Vote::Abstain => {
                    // Abstaining doesn't affect yes/no counts
                }
            }
            
            // Update to new vote
            voter_vote.vote = vote;
            voter_vote.voting_power = voter_power; // Update voting power in case it changed
            
            // Add new vote
            match vote {
                Vote::Yes => {
                    proposal.yes_votes = proposal.yes_votes.checked_add(voter_power).unwrap();
                }
                Vote::No => {
                    proposal.no_votes = proposal.no_votes.checked_add(voter_power).unwrap();
                }
                Vote::Abstain => {
                    // Abstaining doesn't affect yes/no counts
                }
            }
        }
        
        emit!(VoteCastEvent {
            proposal: proposal.key(),
            voter: voter.key(),
            vote,
            voting_power: voter_power,
        });
        
        Ok(())
    }

    // Execute a passed proposal
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let governance = &ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;
        let clock = Clock::get()?;
        
        // Verify voting is closed
        require!(
            clock.unix_timestamp >= proposal.voting_ends_at,
            GovernanceError::VotingStillOpen
        );
        
        // Verify proposal has not been executed
        require!(
            !proposal.executed,
            GovernanceError::ProposalAlreadyExecuted
        );
        
        // Verify proposal has not been cancelled
        require!(
            !proposal.cancelled,
            GovernanceError::ProposalCancelled
        );
        
        // Verify execution delay has passed
        require!(
            clock.unix_timestamp >= proposal.voting_ends_at + governance.execution_delay,
            GovernanceError::ExecutionDelayNotPassed
        );
        
        // Verify proposal passed
        let total_votes = proposal.yes_votes + proposal.no_votes;
        let voting_power_registry = &ctx.accounts.voting_power_registry;
        
        // Check quorum
        let quorum_threshold = (voting_power_registry.total_voting_power as u128)
            .checked_mul(governance.quorum_percentage as u128)
            .unwrap()
            .checked_div(100)
            .unwrap() as u64;
        
        require!(
            total_votes >= quorum_threshold,
            GovernanceError::QuorumNotReached
        );
        
        // Check if yes votes are greater than no votes
        require!(
            proposal.yes_votes > proposal.no_votes,
            GovernanceError::ProposalNotPassed
        );
        
        // Mark proposal as executed
        proposal.executed = true;
        
        // Execute proposal based on type
        match proposal.proposal_type {
            ProposalType::TreasuryWithdrawal => {
                // Handle treasury withdrawal
                // This would typically transfer tokens from treasury to recipient
                // For simplicity, we'll just emit an event
                emit!(ProposalExecutedEvent {
                    proposal: proposal.key(),
                    executed_by: ctx.accounts.executor.key(),
                    execution_time: clock.unix_timestamp,
                    proposal_type: proposal.proposal_type,
                });
            }
            ProposalType::ParameterChange => {
                // Handle parameter change
                // This would update governance parameters
                emit!(ProposalExecutedEvent {
                    proposal: proposal.key(),
                    executed_by: ctx.accounts.executor.key(),
                    execution_time: clock.unix_timestamp,
                    proposal_type: proposal.proposal_type,
                });
            }
            ProposalType::Other => {
                // Generic proposal execution
                emit!(ProposalExecutedEvent {
                    proposal: proposal.key(),
                    executed_by: ctx.accounts.executor.key(),
                    execution_time: clock.unix_timestamp,
                    proposal_type: proposal.proposal_type,
                });
            }
        }
        
        Ok(())
    }

    // Cancel a proposal (only by the proposer or governance authority)
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let authority = &ctx.accounts.authority;
        let clock = Clock::get()?;
        
        // Verify proposal has not been executed
        require!(
            !proposal.executed,
            GovernanceError::ProposalAlreadyExecuted
        );
        
        // Verify proposal has not been cancelled
        require!(
            !proposal.cancelled,
            GovernanceError::ProposalCancelled
        );
        
        // Verify cancellation is authorized
        require!(
            authority.key() == proposal.proposer || authority.key() == ctx.accounts.governance.authority,
            GovernanceError::UnauthorizedCancellation
        );
        
        // Mark proposal as cancelled
        proposal.cancelled = true;
        
        emit!(ProposalCancelledEvent {
            proposal: proposal.key(),
            cancelled_by: authority.key(),
            cancellation_time: clock.unix_timestamp,
        });
        
        Ok(())
    }

    // Update governance parameters (only by governance authority)
    pub fn update_governance(
        ctx: Context<UpdateGovernance>,
        min_proposal_tokens: Option<u64>,
        voting_period: Option<i64>,
        execution_delay: Option<i64>,
        quorum_percentage: Option<u8>,
    ) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        
        // Update min_proposal_tokens if provided
        if let Some(new_min_proposal_tokens) = min_proposal_tokens {
            governance.min_proposal_tokens = new_min_proposal_tokens;
        }
        
        // Update voting_period if provided
        if let Some(new_voting_period) = voting_period {
            require!(new_voting_period > 0, GovernanceError::InvalidVotingPeriod);
            governance.voting_period = new_voting_period;
        }
        
        // Update execution_delay if provided
        if let Some(new_execution_delay) = execution_delay {
            require!(new_execution_delay >= 0, GovernanceError::InvalidExecutionDelay);
            governance.execution_delay = new_execution_delay;
        }
        
        // Update quorum_percentage if provided
        if let Some(new_quorum_percentage) = quorum_percentage {
            require!(
                new_quorum_percentage > 0 && new_quorum_percentage <= 100,
                GovernanceError::InvalidQuorumPercentage
            );
            governance.quorum_percentage = new_quorum_percentage;
        }
        
        emit!(GovernanceUpdatedEvent {
            governance: governance.key(),
            min_proposal_tokens: governance.min_proposal_tokens,
            voting_period: governance.voting_period,
            execution_delay: governance.execution_delay,
            quorum_percentage: governance.quorum_percentage,
        });
        
        Ok(())
    }

    // Register voting power (called by staking program)
    pub fn register_voting_power(
        ctx: Context<RegisterVotingPower>,
        voter: Pubkey,
        voting_power: u64,
    ) -> Result<()> {
        let voting_power_registry = &mut ctx.accounts.voting_power_registry;
        let voter_power = &mut ctx.accounts.voter_power;
        
        // If this is a new voter, initialize their power
        if voter_power.data_is_empty() {
            voter_power.voter = voter;
            voter_power.voting_power = voting_power;
            voting_power_registry.total_voting_power = voting_power_registry.total_voting_power.checked_add(voting_power).unwrap();
        } else {
            // Update existing voter's power
            let old_power = voter_power.voting_power;
            voter_power.voting_power = voting_power;
            
            // Update total voting power
            voting_power_registry.total_voting_power = voting_power_registry
                .total_voting_power
                .checked_sub(old_power)
                .unwrap()
                .checked_add(voting_power)
                .unwrap();
        }
        
        emit!(VotingPowerUpdatedEvent {
            voter,
            old_voting_power: voter_power.voting_power,
            new_voting_power: voting_power,
            total_voting_power: voting_power_registry.total_voting_power,
        });
        
        Ok(())
    }
}

// Helper function to get voter's voting power
fn get_voter_power(
    voting_power_registry: &Account<VotingPowerRegistry>,
    voter: Pubkey,
) -> Result<u64> {
    // In a real implementation, this would query the voter's voting power
    // from the voting power registry
    // For simplicity, we're returning a fixed value
    Ok(10)
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Governance::LEN,
        seeds = [b"governance".as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + VotingPowerRegistry::LEN,
        seeds = [b"voting_power_registry".as_ref(), governance.key().as_ref()],
        bump
    )]
    pub voting_power_registry: Account<'info, VotingPowerRegistry>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    /// Treasury account that holds governance-controlled funds
    pub treasury: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub governance: Account<'info, Governance>,
    
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::LEN,
        seeds = [
            b"proposal".as_ref(),
            governance.key().as_ref(),
            &(governance.proposal_count + 1).to_le_bytes()
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(mut)]
    pub proposer: Signer<'info>,
    
    #[account(
        constraint = proposer_token_account.mint == governance.token_mint,
        constraint = proposer_token_account.owner == proposer.key(),
    )]
    pub proposer_token_account: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub governance: Account<'info, Governance>,
    
    #[account(
        mut,
        constraint = proposal.governance == governance.key(),
        constraint = !proposal.cancelled,
        constraint = !proposal.executed,
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(mut)]
    pub voter: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = voter,
        space = 8 + VoterVote::LEN,
        seeds = [
            b"voter_vote".as_ref(),
            proposal.key().as_ref(),
            voter.key().as_ref()
        ],
        bump
    )]
    pub voter_vote: Account<'info, VoterVote>,
    
    #[account(
        constraint = voting_power_registry.governance == governance.key(),
    )]
    pub voting_power_registry: Account<'info, VotingPowerRegistry>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    pub governance: Account<'info, Governance>,
    
    #[account(
        mut,
        constraint = proposal.governance == governance.key(),
        constraint = !proposal.cancelled,
        constraint = !proposal.executed,
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(mut)]
    pub executor: Signer<'info>,
    
    #[account(
        constraint = voting_power_registry.governance == governance.key(),
    )]
    pub voting_power_registry: Account<'info, VotingPowerRegistry>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub governance: Account<'info, Governance>,
    
    #[account(
        mut,
        constraint = proposal.governance == governance.key(),
        constraint = !proposal.cancelled,
        constraint = !proposal.executed,
    )]
    pub proposal: Account<'info, Proposal>,
    
    #[account(
        constraint = authority.key() == proposal.proposer || authority.key() == governance.authority,
    )]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGovernance<'info> {
    #[account(
        mut,
        constraint = authority.key() == governance.authority,
    )]
    pub governance: Account<'info, Governance>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterVotingPower<'info> {
    #[account(
        mut,
        seeds = [b"voting_power_registry".as_ref(), voting_power_registry.governance.as_ref()],
        bump = voting_power_registry.bump,
    )]
    pub voting_power_registry: Account<'info, VotingPowerRegistry>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + VoterPower::LEN,
        seeds = [
            b"voter_power".as_ref(),
            voting_power_registry.key().as_ref(),
            &voter.to_bytes()
        ],
        bump
    )]
    pub voter_power: Account<'info, VoterPower>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct Governance {
    pub authority: Pubkey,         // Admin authority
    pub token_mint: Pubkey,        // Token mint address
    pub treasury: Pubkey,          // Treasury account
    pub min_proposal_tokens: u64,  // Minimum tokens required to create a proposal
    pub voting_period: i64,        // Voting period in seconds
    pub execution_delay: i64,      // Delay between voting end and execution in seconds
    pub quorum_percentage: u8,     // Percentage of total voting power required for quorum
    pub proposal_count: u64,       // Number of proposals created
    pub total_voting_power: u64,   // Total voting power in the system
    pub bump: u8,                  // PDA bump
}

impl Governance {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1;
}

#[account]
pub struct Proposal {
    pub governance: Pubkey,             // Governance account
    pub proposer: Pubkey,               // Proposer's public key
    pub proposal_id: u64,               // Proposal ID
    pub title: String,                  // Proposal title
    pub description: String,            // Proposal description
    pub proposal_type: ProposalType,    // Type of proposal
    pub execution_payload: Vec<u8>,     // Data for execution
    pub created_at: i64,                // Timestamp when proposal was created
    pub voting_ends_at: i64,            // Timestamp when voting ends
    pub yes_votes: u64,                 // Number of "yes" votes
    pub no_votes: u64,                  // Number of "no" votes
    pub executed: bool,                 // Whether proposal has been executed
    pub cancelled: bool,                // Whether proposal has been cancelled
}

impl Proposal {
    pub const LEN: usize = 32 + 32 + 8 + 100 + 1000 + 1 + 200 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[account]
pub struct VotingPowerRegistry {
    pub governance: Pubkey,            // Governance account
    pub total_voting_power: u64,       // Total voting power across all voters
    pub bump: u8,                      // PDA bump
}

impl VotingPowerRegistry {
    pub const LEN: usize = 32 + 8 + 1;
}

#[account]
pub struct VoterPower {
    pub voter: Pubkey,                // Voter's public key
    pub voting_power: u64,            // Voter's voting power
}

impl VoterPower {
    pub const LEN: usize = 32 + 8;
}

#[account]
pub struct VoterVote {
    pub voter: Pubkey,                // Voter's public key
    pub proposal: Pubkey,             // Proposal being voted on
    pub vote: Vote,                   // Vote choice
    pub voting_power: u64,            // Voting power at time of vote
}

impl VoterVote {
    pub const LEN: usize = 32 + 32 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum
