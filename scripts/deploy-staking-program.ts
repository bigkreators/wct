// File: scripts/deploy-staking-program.ts
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { WctStaking } from '../target/types/wct_staking';

// Configuration
const TREASURY_ALLOCATION_PERCENT = 30; // 30% of transaction fees go to staking rewards

async function main() {
  // Configure the client to use the local cluster (or devnet/mainnet depending on stage)
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.WctStaking as Program<WctStaking>;
  const authority = provider.wallet.publicKey;

  console.log('Authority:', authority.toString());
  console.log('Program ID:', program.programId.toString());

  // Read token configuration
  let tokenMint: anchor.web3.PublicKey;
  let tokenConfig;
  
  try {
    tokenConfig = JSON.parse(fs.readFileSync('./wallet-config.json', 'utf8'));
    tokenMint = new anchor.web3.PublicKey(tokenConfig.tokenMint);
    console.log('Using token mint from config:', tokenMint.toString());
  } catch (error) {
    // If config doesn't exist, try to find it in the distribution summary
    try {
      const distributionSummary = JSON.parse(fs.readFileSync('./distribution-summary.json', 'utf8'));
      tokenMint = new anchor.web3.PublicKey(distributionSummary.mint);
      console.log('Using token mint from distribution summary:', tokenMint.toString());
    } catch (error) {
      console.error('Could not find token mint address. Please provide it manually:');
      process.exit(1);
    }
  }

  // Find the staking pool PDA
  const [stakingPoolPDA] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from('staking_pool'),
      tokenMint.toBuffer(),
    ],
    program.programId
  );
  
  console.log('Staking Pool PDA:', stakingPoolPDA.toString());

  // Find the staking vault PDA
  const [stakingVaultPDA] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from('stake_vault'),
      tokenMint.toBuffer(),
      stakingPoolPDA.toBuffer(),
    ],
    program.programId
  );
  
  console.log('Staking Vault PDA:', stakingVaultPDA.toString());

  // Create or get the treasury token account
  let treasuryWallet;
  
  try {
    // Try to find treasury wallet in config
    if (tokenConfig.communityTreasury) {
      treasuryWallet = new anchor.web3.PublicKey(tokenConfig.communityTreasury);
      console.log('Using treasury wallet from config:', treasuryWallet.toString());
    } else {
      throw new Error('Treasury wallet not found in config');
    }
  } catch (error) {
    // Generate a new wallet for treasury
    treasuryWallet = anchor.web3.Keypair.generate().publicKey;
    console.log('Generated new treasury wallet:', treasuryWallet.toString());
    
    // Update config if it exists
    if (tokenConfig) {
      tokenConfig.treasuryWallet = treasuryWallet.toString();
      fs.writeFileSync('./wallet-config.json', JSON.stringify(tokenConfig, null, 2));
      console.log('Updated wallet config with treasury wallet address');
    }
  }
  
  // Fund treasury wallet with SOL for rent exemption
  await fundAccountWithSol(provider, treasuryWallet);
  
  // Get or create treasury token account
  const treasuryTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider,
    tokenMint,
    treasuryWallet
  );
  
  console.log('Treasury Token Account:', treasuryTokenAccount.toString());

  // Create or get the staking vault token account
  const stakingVaultTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider,
    tokenMint,
    stakingVaultPDA,
    true
  );
  
  console.log('Staking Vault Token Account:', stakingVaultTokenAccount.toString());

  // Initialize staking program
  try {
    console.log('Initializing staking program...');
    
    const tx = await program.methods
      .initialize()
      .accounts({
        stakingPool: stakingPoolPDA,
        authority,
        tokenMint,
        treasuryTokenAccount,
        stakingVault: stakingVaultTokenAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    
    console.log('Staking program initialized successfully!');
    console.log('Transaction signature:', tx);
    
    // Save staking program configuration
    const stakingConfig = {
      programId: program.programId.toString(),
      tokenMint: tokenMint.toString(),
      stakingPool: stakingPoolPDA.toString(),
      stakingVault: stakingVaultTokenAccount.toString(),
      treasuryWallet: treasuryWallet.toString(),
      treasuryTokenAccount: treasuryTokenAccount.toString(),
      authority: authority.toString(),
      initialized: true,
      initializationTx: tx,
      deploymentDate: new Date().toISOString()
    };
    
    fs.writeFileSync('./staking-config.json', JSON.stringify(stakingConfig, null, 2));
    console.log('Staking configuration saved to staking-config.json');
    
    // Update frontend environment variables
    updateFrontendEnv({
      REACT_APP_STAKING_PROGRAM_ID: program.programId.toString(),
      REACT_APP_STAKING_POOL: stakingPoolPDA.toString()
    });
    
  } catch (error) {
    console.error('Error initializing staking program:', error);
    process.exit(1);
  }

  console.log('\nStaking program deployment completed successfully!');
  console.log('Next steps:');
  console.log('1. Fund the treasury account with tokens for staking rewards');
  console.log('2. Update your frontend to include the StakingComponent');
  console.log('3. Integrate the staking program with your contribution system');
}

/**
 * Fund an account with SOL for rent exemption
 */
async function fundAccountWithSol(
  provider: anchor.AnchorProvider,
  account: anchor.web3.PublicKey
): Promise<string> {
  const LAMPORTS_TO_SEND = anchor.web3.LAMPORTS_PER_SOL * 0.1; // 0.1 SOL
  
  try {
    // Check if the account already has SOL
    const balance = await provider.connection.getBalance(account);
    if (balance >= LAMPORTS_TO_SEND) {
      console.log(`Account ${account.toString()} already has enough SOL: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
      return 'Account already funded';
    }
    
    // Create a transfer transaction
    const transaction = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: account,
        lamports: LAMPORTS_TO_SEND,
      })
    );
    
    // Send the transaction
    const signature = await provider.sendAndConfirm(transaction);
    console.log(`Funded account ${account.toString()} with 0.1 SOL. Transaction: ${signature}`);
    return signature;
  } catch (error) {
    console.error(`Error funding account ${account.toString()}:`, error);
    throw error;
  }
}

/**
 * Get or create an associated token account
 */
async function getOrCreateAssociatedTokenAccount(
  provider: anchor.AnchorProvider,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  isPDA: boolean = false
): Promise<anchor.web3.PublicKey> {
  const associatedTokenAddress = await getAssociatedTokenAddress(mint, owner, isPDA);
  
  try {
    // Check if the account already exists
    await provider.connection.getAccountInfo(associatedTokenAddress);
    console.log(`Token account ${associatedTokenAddress.toString()} already exists`);
    return associatedTokenAddress;
  } catch (error) {
    console.log(`Creating token account for ${owner.toString()}...`);
    
    // Create the token account
    const transaction = new anchor.web3.Transaction().add(
      await createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        associatedTokenAddress,
        owner,
        mint,
        isPDA
      )
    );
    
    const signature = await provider.sendAndConfirm(transaction);
    console.log(`Created token account ${associatedTokenAddress.toString()}. Transaction: ${signature}`);
    return associatedTokenAddress;
  }
}

/**
 * Create an instruction to create an associated token account
 */
async function createAssociatedTokenAccountInstruction(
  payer: anchor.web3.PublicKey,
  associatedToken: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  isPDA: boolean = false
): Promise<anchor.web3.TransactionInstruction> {
  return anchor.web3.SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: associatedToken,
    space: 165,
    lamports: await anchor.web3.Token.getMinBalanceRentForExemptAccount(
      payer.connection
    ),
    programId: TOKEN_PROGRAM_ID,
  });
}

/**
 * Update frontend environment variables
 */
function updateFrontendEnv(newVars: Record<string, string>) {
  const envPath = path.join(process.cwd(), 'app', 'frontend', '.env');
  
  try {
    // Read existing .env file
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch (error) {
      // If file doesn't exist, create it
      console.log('Creating new .env file for frontend');
    }
    
    // Update or add new variables
    for (const [key, value] of Object.entries(newVars)) {
      const regex = new RegExp(`^${key}=.*`, 'm');
      
      if (regex.test(envContent)) {
        // Update existing variable
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        // Add new variable
        envContent += `\n${key}=${value}`;
      }
    }
    
    // Write updated content back to .env file
    fs.writeFileSync(envPath, envContent.trim());
    console.log('Updated frontend environment variables');
    
  } catch (error) {
    console.error('Error updating frontend environment variables:', error);
  }
}

main().then(
  () => process.exit(0),
).catch(
  (error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  }
);
