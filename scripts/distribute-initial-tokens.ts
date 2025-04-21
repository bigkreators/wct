// File: scripts/distribute-initial-tokens.ts
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WctToken } from '../target/types/wct_token';

// Token distribution according to tokenomics:
// - Community Rewards (60%): 60M tokens
// - Development Fund (15%): 15M tokens
// - Team Allocation (10%): 10M tokens
// - Liquidity Pool (10%): 10M tokens
// - Community Treasury (5%): 5M tokens

async function main() {
  // Configure the client to use the local cluster (or devnet/mainnet depending on stage)
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.WctToken as Program<WctToken>;
  const authority = provider.wallet.publicKey;

  // Derive PDA for the mint
  const [mint] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from('mint')],
    program.programId
  );

  console.log('Mint address:', mint.toString());

  // With 9 decimals, 100M tokens = 100,000,000 * 10^9
  const DECIMALS = 9;
  const DECIMAL_MULTIPLIER = new anchor.BN(10 ** DECIMALS);
  const TOTAL_SUPPLY = new anchor.BN(100_000_000).mul(DECIMAL_MULTIPLIER);

  // Define wallet addresses for each allocation
  // In a production environment, these would be your actual wallet addresses
  const wallets = {
    communityRewards: new anchor.web3.Keypair().publicKey,
    developmentFund: new anchor.web3.Keypair().publicKey,
    teamAllocation: new anchor.web3.Keypair().publicKey,
    liquidityPool: new anchor.web3.Keypair().publicKey,
    communityTreasury: new anchor.web3.Keypair().publicKey,
  };

  // Calculate token amounts for each allocation
  const allocations = {
    communityRewards: TOTAL_SUPPLY.mul(new anchor.BN(60)).div(new anchor.BN(100)),
    developmentFund: TOTAL_SUPPLY.mul(new anchor.BN(15)).div(new anchor.BN(100)),
    teamAllocation: TOTAL_SUPPLY.mul(new anchor.BN(10)).div(new anchor.BN(100)),
    liquidityPool: TOTAL_SUPPLY.mul(new anchor.BN(10)).div(new anchor.BN(100)),
    communityTreasury: TOTAL_SUPPLY.mul(new anchor.BN(5)).div(new anchor.BN(100)),
  };

  // Log the distribution plan
  console.log('Token Distribution Plan:');
  for (const [key, amount] of Object.entries(allocations)) {
    console.log(`${key}: ${amount.div(DECIMAL_MULTIPLIER).toString()} WCT`);
  }

  // Create associated token accounts for all wallets
  console.log('\nCreating token accounts...');
  for (const [key, wallet] of Object.entries(wallets)) {
    try {
      const tokenAccount = await getAssociatedTokenAddress(mint, wallet, false);
      
      // Check if token account already exists
      const accountInfo = await provider.connection.getAccountInfo(tokenAccount);
      
      if (!accountInfo) {
        console.log(`Creating token account for ${key}...`);
        await createAssociatedTokenAccount(
          provider.connection,
          provider.wallet.payer,
          mint,
          wallet
        );
        console.log(`Created token account for ${key}`);
      } else {
        console.log(`Token account for ${key} already exists`);
      }
    } catch (error) {
      console.error(`Error creating token account for ${key}:`, error);
    }
  }

  // Distribute tokens to each wallet
  console.log('\nDistributing tokens...');
  const authorityTokenAccount = await getAssociatedTokenAddress(mint, authority, false);
  
  for (const [key, wallet] of Object.entries(wallets)) {
    try {
      const tokenAccount = await getAssociatedTokenAddress(mint, wallet, false);
      const amount = allocations[key];
      
      console.log(`Distributing ${amount.div(DECIMAL_MULTIPLIER).toString()} WCT to ${key}...`);
      
      await program.methods
        .distributeInitialTokens(amount)
        .accounts({
          mint,
          fromTokenAccount: authorityTokenAccount,
          toTokenAccount: tokenAccount,
          authority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
        
      console.log(`Successfully distributed tokens to ${key}`);
    } catch (error) {
      console.error(`Error distributing tokens to ${key}:`, error);
    }
  }

  console.log('\nInitial token distribution completed!');
  
  // Verify final balances
  console.log('\nVerifying final balances...');
  for (const [key, wallet] of Object.entries(wallets)) {
    try {
      const tokenAccount = await getAssociatedTokenAddress(mint, wallet, false);
      const balance = await provider.connection.getTokenAccountBalance(tokenAccount);
      console.log(`${key} balance: ${balance.value.uiAmount} WCT`);
    } catch (error) {
      console.error(`Error checking balance for ${key}:`, error);
    }
  }
}

main().then(
  () => process.exit(0),
).catch(
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
