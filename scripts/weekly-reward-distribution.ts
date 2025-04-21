// File: scripts/weekly-reward-distribution.ts
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WctToken } from '../target/types/wct_token';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const DISTRIBUTION_LOG_DIR = './distribution-logs';
const WEEKLY_REWARD_POOL = 200000; // 200k tokens per week (adjust as needed)
const MIN_TOKENS_PER_USER = 10; // Minimum token reward per user

interface UserContribution {
  userId: string;
  walletAddress: string;
  points: number;
  tokenAmount: number;
}

interface DistributionResult {
  timestamp: string;
  weekStartDate: string;
  weekEndDate: string;
  totalPoints: number;
  totalTokens: number;
  totalUsers: number;
  pointToTokenRatio: number;
  transactions: Array<{
    walletAddress: string;
    tokens: number;
    signature: string | null;
    status: 'success' | 'failed';
    error?: string;
  }>;
}

async function main() {
  // Configure the client to use the local cluster (or devnet/mainnet)
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.WctToken as Program<WctToken>;
  const authority = provider.wallet.publicKey;

  console.log('Authority:', authority.toString());

  // Derive PDA for the mint
  const [mint] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from('mint')],
    program.programId
  );

  console.log('Mint address:', mint.toString());

  // Create logs directory if it doesn't exist
  if (!fs.existsSync(DISTRIBUTION_LOG_DIR)) {
    fs.mkdirSync(DISTRIBUTION_LOG_DIR, { recursive: true });
  }

  // Calculate date range for this distribution
  const now = new Date();
  const weekEndDate = new Date(now.setHours(0, 0, 0, 0));
  const weekStartDate = new Date(weekEndDate);
  weekStartDate.setDate(weekStartDate.getDate() - 7);

  console.log(`Processing rewards for week: ${weekStartDate.toISOString()} to ${weekEndDate.toISOString()}`);

  try {
    // Fetch user contributions from API
    console.log('Fetching user contributions from API...');
    const { data } = await axios.get(
      `${API_URL}/rewards/calculate?startDate=${weekStartDate.toISOString()}&endDate=${weekEndDate.toISOString()}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.API_TOKEN || 'dev-token'}`,
        }
      }
    );

    const { users, totalPoints } = data;
    console.log(`Found ${users.length} users with a total of ${totalPoints} points`);

    if (users.length === 0 || totalPoints === 0) {
      console.log('No rewards to distribute. Exiting.');
      return;
    }

    // Calculate token distribution
    const pointToTokenRatio = WEEKLY_REWARD_POOL / totalPoints;
    console.log(`Point to token ratio: ${pointToTokenRatio} tokens per point`);

    // Calculate tokens for each user
    const userContributions: UserContribution[] = users.map((user: any) => ({
      userId: user.userId,
      walletAddress: user.walletAddress,
      points: user.points,
      tokenAmount: Math.max(Math.floor(user.points * pointToTokenRatio), MIN_TOKENS_PER_USER)
    }));

    // Get authority token account
    const authorityTokenAccount = await getAssociatedTokenAddress(mint, authority);
    
    // Check authority balance
    const authorityAccountInfo = await getAccount(provider.connection, authorityTokenAccount);
    const totalTokensNeeded = userContributions.reduce((sum, user) => sum + user.tokenAmount, 0);
    const DECIMALS = 9;
    const totalTokensNeededRaw = totalTokensNeeded * (10 ** DECIMALS);
    
    console.log(`Total tokens needed: ${totalTokensNeeded} WCT (${totalTokensNeededRaw} raw amount)`);
    console.log(`Authority balance: ${authorityAccountInfo.amount} raw amount`);
    
    if (BigInt(authorityAccountInfo.amount) < BigInt(totalTokensNeededRaw)) {
      throw new Error('Insufficient tokens in authority account for distribution');
    }

    // Distribute tokens to each user
    console.log('\nStarting token distribution...');
    const distributionResult: DistributionResult = {
      timestamp: new Date().toISOString(),
      weekStartDate: weekStartDate.toISOString(),
      weekEndDate: weekEndDate.toISOString(),
      totalPoints,
      totalTokens: totalTokensNeeded,
      totalUsers: userContributions.length,
      pointToTokenRatio,
      transactions: []
    };

    for (const user of userContributions) {
      try {
        console.log(`Processing user ${user.userId} (${user.walletAddress}): ${user.points} points, ${user.tokenAmount} WCT`);
        
        // Convert token amount to raw amount with decimals
        const rawTokenAmount = new anchor.BN(user.tokenAmount).mul(new anchor.BN(10 ** DECIMALS));
        
        // Check if recipient wallet is valid
        let recipientPubkey: anchor.web3.PublicKey;
        try {
          recipientPubkey = new anchor.web3.PublicKey(user.walletAddress);
        } catch (error) {
          throw new Error(`Invalid wallet address: ${user.walletAddress}`);
        }
        
        // Get or create recipient token account
        const recipientTokenAccount = await getOrCreateTokenAccount(
          provider,
          mint,
          recipientPubkey
        );
        
        // Distribute tokens
        const signature = await program.methods
          .distributeInitialTokens(rawTokenAmount)
          .accounts({
            mint,
            fromTokenAccount: authorityTokenAccount,
            toTokenAccount: recipientTokenAccount,
            authority,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        console.log(`Successfully distributed ${user.tokenAmount} WCT to ${user.walletAddress}. Transaction: ${signature}`);
        
        // Add to results
        distributionResult.transactions.push({
          walletAddress: user.walletAddress,
          tokens: user.tokenAmount,
          signature,
          status: 'success'
        });
        
        // Update API about reward distribution
        await axios.post(
          `${API_URL}/rewards/confirm`,
          {
            userId: user.userId,
            tokens: user.tokenAmount,
            txHash: signature,
            weekStartDate: weekStartDate.toISOString(),
            weekEndDate: weekEndDate.toISOString()
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.API_TOKEN || 'dev-token'}`,
            }
          }
        );
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`Error distributing tokens to ${user.walletAddress}:`, error);
        distributionResult.transactions.push({
          walletAddress: user.walletAddress,
          tokens: user.tokenAmount,
          signature: null,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Save distribution results
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const logFilename = path.join(DISTRIBUTION_LOG_DIR, `distribution-${timestamp}.json`);
    fs.writeFileSync(logFilename, JSON.stringify(distributionResult, null, 2));
    console.log(`Distribution log saved to ${logFilename}`);
    
    // Count success and failures
    const successfulTransactions = distributionResult.transactions.filter(tx => tx.status === 'success');
    const failedTransactions = distributionResult.transactions.filter(tx => tx.status === 'failed');
    
    console.log(`\nDistribution summary:`);
    console.log(`- Total users: ${distributionResult.totalUsers}`);
    console.log(`- Total points: ${distributionResult.totalPoints}`);
    console.log(`- Total tokens: ${distributionResult.totalTokens} WCT`);
    console.log(`- Successful transactions: ${successfulTransactions.length}`);
    console.log(`- Failed transactions: ${failedTransactions.length}`);
    
    // Notify API about completion
    await axios.post(
      `${API_URL}/rewards/distribution-complete`,
      {
        weekStartDate: weekStartDate.toISOString(),
        weekEndDate: weekEndDate.toISOString(),
        totalTokens: distributionResult.totalTokens,
        totalUsers: distributionResult.totalUsers,
        successfulTransactions: successfulTransactions.length,
        failedTransactions: failedTransactions.length
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.API_TOKEN || 'dev-token'}`,
        }
      }
    );
    
    console.log('\nWeekly token distribution completed successfully!');
    
  } catch (error) {
    console.error('Error during distribution:', error);
    process.exit(1);
  }
}

/**
 * Get or create an associated token account
 */
async function getOrCreateTokenAccount(
  provider: anchor.AnchorProvider,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> {
  const associatedTokenAddress = await getAssociatedTokenAddress(mint, owner);
  
  try {
    // Check if the account already exists
    await getAccount(provider.connection, associatedTokenAddress);
    return associatedTokenAddress;
  } catch (error) {
    if ((error as any).name === 'TokenAccountNotFoundError') {
      console.log(`Creating token account for ${owner.toString()}...`);
      
      // Create the token account
      const transaction = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          provider.wallet.publicKey,
          associatedTokenAddress,
          owner,
          mint
        )
      );
      
      await provider.sendAndConfirm(transaction);
      return associatedTokenAddress;
    }
    throw error;
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
