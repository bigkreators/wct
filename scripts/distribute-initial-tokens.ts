// File: scripts/distribute-initial-tokens.ts
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  getAccount
} from '@solana/spl-token';
import { WctToken } from '../target/types/wct_token';
import fs from 'fs';

// Token distribution according to tokenomics:
// - Community Rewards (60%): 60M tokens
// - Development Fund (15%): 15M tokens
// - Team Allocation (10%): 10M tokens
// - Liquidity Pool (10%): 10M tokens
// - Community Treasury (5%): 5M tokens

async function main() {
  // Configure the client to use the local cluster (or devnet/mainnet depending on stage)
  const provider = anchor.AnchorProvider.env();
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
  // Check if we have pre-defined wallet addresses in a config file
  let wallets: Record<string, anchor.web3.PublicKey>;
  let configExists = false;

  try {
    const walletConfig = JSON.parse(fs.readFileSync('./wallet-config.json', 'utf8'));
    wallets = {
      communityRewards: new anchor.web3.PublicKey(walletConfig.communityRewards),
      developmentFund: new anchor.web3.PublicKey(walletConfig.developmentFund),
      teamAllocation: new anchor.web3.PublicKey(walletConfig.teamAllocation),
      liquidityPool: new anchor.web3.PublicKey(walletConfig.liquidityPool),
      communityTreasury: new anchor.web3.PublicKey(walletConfig.communityTreasury),
    };
    configExists = true;
    console.log('Using pre-configured wallet addresses from wallet-config.json');
  } catch (error) {
    // Create new wallets if config doesn't exist
    console.log('No wallet configuration found. Creating new wallets...');
    
    // Generate keypairs for each allocation
    const communityKeypair = anchor.web3.Keypair.generate();
    const developmentKeypair = anchor.web3.Keypair.generate();
    const teamKeypair = anchor.web3.Keypair.generate();
    const liquidityKeypair = anchor.web3.Keypair.generate();
    const treasuryKeypair = anchor.web3.Keypair.generate();
    
    // Save the keypairs to disk for future reference
    const keypairsConfig = {
      communityRewards: {
        publicKey: communityKeypair.publicKey.toString(),
        secretKey: Array.from(communityKeypair.secretKey)
      },
      developmentFund: {
        publicKey: developmentKeypair.publicKey.toString(),
        secretKey: Array.from(developmentKeypair.secretKey)
      },
      teamAllocation: {
        publicKey: teamKeypair.publicKey.toString(),
        secretKey: Array.from(teamKeypair.secretKey)
      },
      liquidityPool: {
        publicKey: liquidityKeypair.publicKey.toString(),
        secretKey: Array.from(liquidityKeypair.secretKey)
      },
      communityTreasury: {
        publicKey: treasuryKeypair.publicKey.toString(),
        secretKey: Array.from(treasuryKeypair.secretKey)
      }
    };
    
    fs.writeFileSync('./wallet-keypairs.json', JSON.stringify(keypairsConfig, null, 2));
    console.log('Wallet keypairs saved to wallet-keypairs.json');
    
    // Save just the public keys to a separate config file
    const walletConfig = {
      communityRewards: communityKeypair.publicKey.toString(),
      developmentFund: developmentKeypair.publicKey.toString(),
      teamAllocation: teamKeypair.publicKey.toString(),
      liquidityPool: liquidityKeypair.publicKey.toString(),
      communityTreasury: treasuryKeypair.publicKey.toString(),
    };
    
    fs.writeFileSync('./wallet-config.json', JSON.stringify(walletConfig, null, 2));
    console.log('Wallet addresses saved to wallet-config.json');
    
    wallets = {
      communityRewards: communityKeypair.publicKey,
      developmentFund: developmentKeypair.publicKey,
      teamAllocation: teamKeypair.publicKey,
      liquidityPool: liquidityKeypair.publicKey,
      communityTreasury: treasuryKeypair.publicKey,
    };
    
    // Fund the wallets with SOL for rent exemption
    console.log('Funding wallets with SOL for rent exemption...');
    await Promise.all(Object.values(wallets).map(async (wallet) => {
      await fundWalletWithSol(provider, wallet);
    }));
  }

  // Calculate token amounts for each allocation
  const allocations: Record<string, anchor.BN> = {
    communityRewards: TOTAL_SUPPLY.mul(new anchor.BN(60)).div(new anchor.BN(100)),
    developmentFund: TOTAL_SUPPLY.mul(new anchor.BN(15)).div(new anchor.BN(100)),
    teamAllocation: TOTAL_SUPPLY.mul(new anchor.BN(10)).div(new anchor.BN(100)),
    liquidityPool: TOTAL_SUPPLY.mul(new anchor.BN(10)).div(new anchor.BN(100)),
    communityTreasury: TOTAL_SUPPLY.mul(new anchor.BN(5)).div(new anchor.BN(100)),
  };

  // Log the distribution plan
  console.log('\nToken Distribution Plan:');
  for (const [key, amount] of Object.entries(allocations)) {
    const readableAmount = amount.div(DECIMAL_MULTIPLIER).toString();
    console.log(`${key}: ${readableAmount} WCT (${amount.toString()} raw amount)`);
  }

  // Create associated token accounts for all wallets
  console.log('\nCreating token accounts...');
  const tokenAccounts: Record<string, anchor.web3.PublicKey> = {};
  
  for (const [key, wallet] of Object.entries(wallets)) {
    try {
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        provider,
        mint,
        wallet
      );
      tokenAccounts[key] = tokenAccount;
      console.log(`Token account for ${key}: ${tokenAccount.toString()}`);
    } catch (error) {
      console.error(`Error creating token account for ${key}:`, error);
      throw error; // Re-throw to stop the process
    }
  }

  // Check if authority has enough tokens to distribute
  const authorityTokenAccount = await getAssociatedTokenAddress(mint, authority);
  let authorityTokenBalance;
  
  try {
    const accountInfo = await getAccount(provider.connection, authorityTokenAccount);
    authorityTokenBalance = accountInfo.amount;
    console.log(`Authority token balance: ${authorityTokenBalance.toString()}`);
    
    // Convert to readable format
    const readableBalance = Number(authorityTokenBalance) / (10 ** DECIMALS);
    console.log(`Readable balance: ${readableBalance} WCT`);
    
    // Verify if authority has enough tokens
    if (authorityTokenBalance < TOTAL_SUPPLY.toString()) {
      throw new Error(`Authority doesn't have enough tokens. Expected: ${TOTAL_SUPPLY.toString()}, Found: ${authorityTokenBalance.toString()}`);
    }
  } catch (error) {
    if ((error as any).name === 'TokenAccountNotFoundError') {
      console.error(`Authority token account not found. Initialize token first.`);
      process.exit(1);
    } else {
      console.error(`Error checking authority token balance:`, error);
      process.exit(1);
    }
  }
  
  // Distribute tokens to each wallet
  console.log('\nDistributing tokens...');
  const distributionResults: Record<string, string> = {};
  
  for (const [key, wallet] of Object.entries(wallets)) {
    try {
      const tokenAccount = tokenAccounts[key];
      const amount = allocations[key];
      
      console.log(`Distributing ${amount.div(DECIMAL_MULTIPLIER).toString()} WCT to ${key}...`);
      
      const signature = await program.methods
        .distributeInitialTokens(amount)
        .accounts({
          mint,
          fromTokenAccount: authorityTokenAccount,
          toTokenAccount: tokenAccount,
          authority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
        
      console.log(`Successfully distributed tokens to ${key}. Transaction: ${signature}`);
      distributionResults[key] = signature;
    } catch (error) {
      console.error(`Error distributing tokens to ${key}:`, error);
      // Continue with other distributions even if one fails
    }
  }

  // Save distribution results
  const distributionSummary = {
    timestamp: new Date().toISOString(),
    mint: mint.toString(),
    authority: authority.toString(),
    total_supply: TOTAL_SUPPLY.toString(),
    decimals: DECIMALS,
    wallets: Object.entries(wallets).reduce((acc, [key, wallet]) => {
      acc[key] = {
        address: wallet.toString(),
        tokenAccount: tokenAccounts[key].toString(),
        allocation: allocations[key].toString(),
        readableAllocation: allocations[key].div(DECIMAL_MULTIPLIER).toString(),
        transactionSignature: distributionResults[key] || 'Failed',
      };
      return acc;
    }, {} as Record<string, any>)
  };
  
  fs.writeFileSync('./distribution-summary.json', JSON.stringify(distributionSummary, null, 2));
  console.log('\nDistribution summary saved to distribution-summary.json');
  
  // Verify final balances
  console.log('\nVerifying final balances...');
  for (const [key, wallet] of Object.entries(wallets)) {
    try {
      const tokenAccount = await getAssociatedTokenAddress(mint, wallet);
      const balance = await provider.connection.getTokenAccountBalance(tokenAccount);
      const expectedAmount = Number(allocations[key].div(DECIMAL_MULTIPLIER).toString());
      const actualAmount = balance.value.uiAmount;
      
      console.log(`${key} balance: ${actualAmount} WCT`);
      
      if (actualAmount !== expectedAmount) {
        console.warn(`Warning: Balance mismatch for ${key}. Expected: ${expectedAmount}, Actual: ${actualAmount}`);
      }
    } catch (error) {
      console.error(`Error checking balance for ${key}:`, error);
    }
  }
  
  console.log('\nInitial token distribution completed successfully!');
}

/**
 * Fund a wallet with SOL for rent exemption
 */
async function fundWalletWithSol(
  provider: anchor.AnchorProvider,
  wallet: anchor.web3.PublicKey
): Promise<string> {
  const LAMPORTS_TO_SEND = anchor.web3.LAMPORTS_PER_SOL * 0.1; // 0.1 SOL
  
  try {
    // Check if the wallet already has SOL
    const balance = await provider.connection.getBalance(wallet);
    if (balance >= LAMPORTS_TO_SEND) {
      console.log(`Wallet ${wallet.toString()} already has enough SOL: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
      return 'Wallet already funded';
    }
    
    // Create a transfer transaction
    const transaction = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: wallet,
        lamports: LAMPORTS_TO_SEND,
      })
    );
    
    // Send the transaction
    const signature = await provider.sendAndConfirm(transaction);
    console.log(`Funded wallet ${wallet.toString()} with 0.1 SOL. Transaction: ${signature}`);
    return signature;
  } catch (error) {
    console.error(`Error funding wallet ${wallet.toString()}:`, error);
    throw error;
  }
}

/**
 * Get or create an associated token account
 */
async function getOrCreateAssociatedTokenAccount(
  provider: anchor.AnchorProvider,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> {
  const associatedTokenAddress = await getAssociatedTokenAddress(mint, owner);
  
  try {
    // Check if the account already exists
    await getAccount(provider.connection, associatedTokenAddress);
    console.log(`Token account ${associatedTokenAddress.toString()} already exists`);
    return associatedTokenAddress;
  } catch (error) {
    if ((error as any).name === 'TokenAccountNotFoundError') {
      console.log(`Creating token account for ${owner.toString()}...`);
      
      // Create the token account
      const transaction = new anchor.web3.Transaction().add(
        await createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          associatedTokenAddress,
          owner,
          mint
        )
      );
      
      const signature = await provider.sendAndConfirm(transaction);
      console.log(`Created token account ${associatedTokenAddress.toString()}. Transaction: ${signature}`);
      return associatedTokenAddress;
    }
    throw error;
  }
}

/**
 * Create an instruction to create an associated token account
 */
async function createAssociatedTokenAccountInstruction(
  payer: anchor.web3.PublicKey,
  associatedToken: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey
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

main().then(
  () => process.exit(0),
).catch(
  (error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  }
);
