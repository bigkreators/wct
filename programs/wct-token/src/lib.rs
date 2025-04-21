// File: programs/wct-token/src/lib.rs
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("YOUR_PROGRAM_ID"); // Replace with your actual program ID

#[program]
pub mod wct_token {
    use super::*;

    // Initialize the token with a total supply of 100M
    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        total_supply: u64,
    ) -> Result<()> {
        // Mint the total supply to the authority (deployer) account
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                &[&[
                    b"mint".as_ref(),
                    &[*ctx.bumps.get("mint").unwrap()],
                ]],
            ),
            total_supply,
        )?;

        Ok(())
    }

    // Distribute tokens to initial wallets according to tokenomics
    pub fn distribute_initial_tokens(
        ctx: Context<DistributeTokens>,
        amount: u64,
    ) -> Result<()> {
        // Transfer tokens from authority to the destination account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.from_token_account.to_account_info(),
                    to: ctx.accounts.to_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [b"mint"],
        bump,
        mint::decimals = 9,
        mint::authority = mint,
    )]
    pub mint: Account<'info, Mint>,
    
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DistributeTokens<'info> {
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.owner == authority.key(),
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = to_token_account.mint == mint.key(),
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// File: scripts/deploy.ts
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WctToken } from '../target/types/wct_token';

async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.WctToken as Program<WctToken>;
  const authority = provider.wallet.publicKey;

  // Derive PDA for the mint
  const [mint, mintBump] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from('mint')],
    program.programId
  );

  console.log('Mint address:', mint.toString());

  // Initialize the token with total supply of 100M tokens
  // With 9 decimals, 100M tokens = 100,000,000 * 10^9
  const totalSupply = new anchor.BN(100_000_000).mul(new anchor.BN(10 ** 9));

  console.log('Initializing token with total supply:', totalSupply.toString());
  
  await program.methods
    .initializeToken(totalSupply)
    .accounts({
      mint,
      authority,
      authorityTokenAccount: await getAssociatedTokenAddress(
        mint,
        authority,
        false
      ),
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log('Token initialized successfully!');

  // Example distribution - Community Rewards (60%)
  // In a real implementation, you'd set up multiple distribution targets
  // based on your tokenomics
  
  const communityWallet = new anchor.web3.Keypair().publicKey;
  const communityTokenAccount = await getAssociatedTokenAddress(
    mint,
    communityWallet,
    false
  );
  
  // Create associated token account for the community wallet
  await createAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer,
    mint,
    communityWallet
  );
  
  // 60% of total supply
  const communityAmount = totalSupply.mul(new anchor.BN(60)).div(new anchor.BN(100));
  
  console.log('Distributing to community wallet:', communityAmount.toString());
  
  await program.methods
    .distributeInitialTokens(communityAmount)
    .accounts({
      mint,
      fromTokenAccount: await getAssociatedTokenAddress(
        mint,
        authority,
        false
      ),
      toTokenAccount: communityTokenAccount,
      authority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
    
  console.log('Community distribution completed!');
  
  // Similarly, you would implement distributions for:
  // - Development Fund (15%)
  // - Team Allocation (10%)
  // - Liquidity Pool (10%) 
  // - Community Treasury (5%)
}

main().then(
  () => process.exit(0),
).catch(
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
