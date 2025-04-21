// File: frontend/src/components/StakingComponent.tsx
import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';

// Import the IDL for your staking program
import stakingIdl from '../idl/wct_staking.json';

// Constants
const WCT_MINT_ADDRESS = new PublicKey(process.env.REACT_APP_WCT_MINT_ADDRESS || '');
const STAKING_PROGRAM_ID = new PublicKey(process.env.REACT_APP_STAKING_PROGRAM_ID || '');
const STAKE_DURATIONS = [
  { label: '30 Days', value: 30 * 24 * 60 * 60 }, // 30 days in seconds
  { label: '90 Days', value: 90 * 24 * 60 * 60 }, // 90 days in seconds
  { label: '180 Days', value: 180 * 24 * 60 * 60 }, // 180 days in seconds
  { label: '365 Days', value: 365 * 24 * 60 * 60 }, // 365 days in seconds
];

// Type definitions
interface UserStake {
  owner: PublicKey;
  stakeAmount: BN;
  startTimestamp: BN;
  endTimestamp: BN;
  claimedReward: BN;
  lastClaimTimestamp: BN;
  reputationBoost: BN;
  votingPower: BN;
  withdrawn: boolean;
}

interface StakingStats {
  totalStaked: number;
  stakerCount: number;
  rewardRate: number;
  minStakeDuration: number;
  maxStakeDuration: number;
}

interface StakeFormData {
  amount: string;
  duration: number;
}

const StakingComponent: React.FC = () => {
  const { connection } = useConnection();
  const wallet = useWallet();
  
  // Component state
  const [userStakes, setUserStakes] = useState<UserStake[]>([]);
  const [stakingStats, setStakingStats] = useState<StakingStats | null>(null);
  const [wctBalance, setWctBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [transactionMessage, setTransactionMessage] = useState({ type: '', message: '' });
  
  // Staking form state
  const [stakeForm, setStakeForm] = useState<StakeFormData>({
    amount: '',
    duration: STAKE_DURATIONS[0].value,
  });
  
  const [activeTab, setActiveTab] = useState<'stake' | 'myStakes'>('stake');
  
  // Setup Anchor program when wallet is connected
  const getProgram = () => {
    if (!wallet.publicKey) return null;
    
    const provider = new AnchorProvider(
      connection,
      wallet as any,
      { commitment: 'confirmed' }
    );
    
    return new Program(stakingIdl as any, STAKING_PROGRAM_ID, provider);
  };
  
  // Find staking pool PDA
  const findStakingPoolPDA = async () => {
    const [stakingPoolPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('staking_pool'),
        WCT_MINT_ADDRESS.toBuffer(),
      ],
      STAKING_PROGRAM_ID
    );
    
    return stakingPoolPDA;
  };
  
  // Find user stake PDA
  const findUserStakePDA = async (userPubkey: PublicKey, stakingPoolPDA: PublicKey) => {
    const [userStakePDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('user_stake'),
        userPubkey.toBuffer(),
        stakingPoolPDA.toBuffer(),
      ],
      STAKING_PROGRAM_ID
    );
    
    return userStakePDA;
  };
  
  // Fetch user's token balance
  const fetchTokenBalance = async () => {
    if (!wallet.publicKey) return;
    
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        WCT_MINT_ADDRESS,
        wallet.publicKey
      );
      
      try {
        const balance = await connection.getTokenAccountBalance(tokenAccount);
        setWctBalance(balance.value.uiAmount);
      } catch (error) {
        // Token account might not exist yet
        console.log('Token account not found or other error:', error);
        setWctBalance(0);
      }
    } catch (error) {
      console.error('Error fetching token balance:', error);
    }
  };
  
  // Fetch staking pool stats
  const fetchStakingStats = async () => {
    const program = getProgram();
    if (!program) return;
    
    try {
      const stakingPoolPDA = await findStakingPoolPDA();
      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPDA);
      
      setStakingStats({
        totalStaked: stakingPool.totalStaked.toNumber() / (10 ** 9),
        stakerCount: stakingPool.stakerCount.toNumber(),
        rewardRate: stakingPool.rewardRate.toNumber() / 100, // Convert basis points to percentage
        minStakeDuration: stakingPool.minStakeDuration.toNumber() / (24 * 60 * 60), // Convert seconds to days
        maxStakeDuration: stakingPool.maxStakeDuration.toNumber() / (24 * 60 * 60), // Convert seconds to days
      });
    } catch (error) {
      console.error('Error fetching staking stats:', error);
    }
  };
  
  // Fetch user's active stakes
  const fetchUserStakes = async () => {
    const program = getProgram();
    if (!program || !wallet.publicKey) return;
    
    try {
      const stakingPoolPDA = await findStakingPoolPDA();
      const userStakePDA = await findUserStakePDA(wallet.publicKey, stakingPoolPDA);
      
      try {
        const userStake = await program.account.userStake.fetch(userStakePDA);
        setUserStakes([userStake as unknown as UserStake]);
      } catch (error) {
        // User might not have any active stakes
        console.log('No active stakes found or other error:', error);
        setUserStakes([]);
      }
    } catch (error) {
      console.error('Error fetching user stakes:', error);
    }
  };
  
  // Load data when wallet changes
  useEffect(() => {
    if (wallet.publicKey) {
      fetchTokenBalance();
      fetchStakingStats();
      fetchUserStakes();
    } else {
      setWctBalance(null);
      setUserStakes([]);
      setStakingStats(null);
    }
  }, [wallet.publicKey, connection]);
  
  // Handle stake form changes
  const handleStakeFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setStakeForm({
      ...stakeForm,
      [name]: name === 'duration' ? parseInt(value) : value,
    });
  };
  
  // Stake tokens
  const handleStake = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!wallet.publicKey || !wallet.signTransaction) {
      setTransactionMessage({
        type: 'error',
        message: 'Please connect your wallet',
      });
      return;
    }
    
    const amount = parseFloat(stakeForm.amount);
    if (isNaN(amount) || amount <= 0) {
      setTransactionMessage({
        type: 'error',
        message: 'Please enter a valid amount',
      });
      return;
    }
    
    if (wctBalance === null || amount > wctBalance) {
      setTransactionMessage({
        type: 'error',
        message: 'Insufficient token balance',
      });
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const stakingPoolPDA = await findStakingPoolPDA();
      const userStakePDA = await findUserStakePDA(wallet.publicKey, stakingPoolPDA);
      
      // Find stake vault PDA
      const [stakeVaultPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('stake_vault'),
          WCT_MINT_ADDRESS.toBuffer(),
          stakingPoolPDA.toBuffer(),
        ],
        STAKING_PROGRAM_ID
      );
      
      // Calculate token amount with decimals
      const tokenAmount = new BN(amount * (10 ** 9)); // 9 decimals
      
      // Get user token account
      const userTokenAccount = await getAssociatedTokenAddress(
        WCT_MINT_ADDRESS,
        wallet.publicKey
      );
      
      // Execute stake transaction
      const tx = await program.methods
        .stake(tokenAmount, new BN(stakeForm.duration))
        .accounts({
          stakingPool: stakingPoolPDA,
          userStake: userStakePDA,
          user: wallet.publicKey,
          userTokenAccount,
          stakingVault: stakeVaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
      console.log('Stake transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully staked ${amount} WCT for ${stakeForm.duration / (24 * 60 * 60)} days. Transaction: ${tx}`,
      });
      
      // Reset form and refresh data
      setStakeForm({
        amount: '',
        duration: STAKE_DURATIONS[0].value,
      });
      
      // Refresh data
      fetchTokenBalance();
      fetchStakingStats();
      fetchUserStakes();
      
    } catch (error) {
      console.error('Error staking tokens:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error staking tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Claim rewards
  const handleClaimRewards = async (stakeIndex: number) => {
    if (!wallet.publicKey || !wallet.signTransaction || userStakes.length <= stakeIndex) {
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const stakingPoolPDA = await findStakingPoolPDA();
      const userStakePDA = await findUserStakePDA(wallet.publicKey, stakingPoolPDA);
      
      // Get treasury token account from staking pool
      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPDA);
      const treasuryTokenAccount = stakingPool.treasuryTokenAccount;
      
      // Get user token account
      const userTokenAccount = await getAssociatedTokenAddress(
        WCT_MINT_ADDRESS,
        wallet.publicKey
      );
      
      // Execute claim transaction
      const tx = await program.methods
        .claimReward()
        .accounts({
          stakingPool: stakingPoolPDA,
          userStake: userStakePDA,
          user: wallet.publicKey,
          userTokenAccount,
          treasuryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      console.log('Claim rewards transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully claimed rewards. Transaction: ${tx}`,
      });
      
      // Refresh data
      fetchTokenBalance();
      fetchUserStakes();
      
    } catch (error) {
      console.error('Error claiming rewards:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error claiming rewards: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Unstake tokens
  const handleUnstake = async (stakeIndex: number) => {
    if (!wallet.publicKey || !wallet.signTransaction || userStakes.length <= stakeIndex) {
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const stakingPoolPDA = await findStakingPoolPDA();
      const userStakePDA = await findUserStakePDA(wallet.publicKey, stakingPoolPDA);
      
      // Find staking vault PDA
      const [stakeVaultPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('stake_vault'),
          WCT_MINT_ADDRESS.toBuffer(),
          stakingPoolPDA.toBuffer(),
        ],
        STAKING_PROGRAM_ID
      );
      
      // Get treasury token account from staking pool
      const stakingPool = await program.account.stakingPool.fetch(stakingPoolPDA);
      const treasuryTokenAccount = stakingPool.treasuryTokenAccount;
      
      // Get user token account
      const userTokenAccount = await getAssociatedTokenAddress(
        WCT_MINT_ADDRESS,
        wallet.publicKey
      );
      
      // Execute unstake transaction
      const tx = await program.methods
        .unstake()
        .accounts({
          stakingPool: stakingPoolPDA,
          userStake: userStakePDA,
          user: wallet.publicKey,
          userTokenAccount,
          stakingVault: stakeVaultPDA,
          treasuryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      console.log('Unstake transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully unstaked tokens. Transaction: ${tx}`,
      });
      
      // Refresh data
      fetchTokenBalance();
      fetchStakingStats();
      fetchUserStakes();
      
    } catch (error) {
      console.error('Error unstaking tokens:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error unstaking tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };
  
  // Calculate days remaining for a stake
  const calculateDaysRemaining = (endTimestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const secondsRemaining = Math.max(0, endTimestamp - now);
    return Math.ceil(secondsRemaining / (24 * 60 * 60));
  };
  
  // Calculate estimated rewards
  const calculateEstimatedRewards = (stake: UserStake) => {
    if (!stakingStats) return 0;
    
    const now = Math.floor(Date.now() / 1000);
    const secondsElapsed = Math.max(0, now - stake.lastClaimTimestamp.toNumber());
    const daysElapsed = secondsElapsed / (24 * 60 * 60);
    
    // Calculate with the same formula as in the contract
    // reward = stake_amount * reward_rate * time_elapsed / (365 * 24 * 60 * 60 * 10000)
    const stakeAmount = stake.stakeAmount.toNumber();
    const rewardRate = stakingStats.rewardRate * 100; // Convert percentage back to basis points
    
    const reward = (stakeAmount * rewardRate * secondsElapsed) / (365 * 24 * 60 * 60 * 10000);
    return reward / (10 ** 9); // Convert to WCT
  };
  
  // Determine if a stake can be unstaked
  const canUnstake = (stake: UserStake) => {
    const now = Math.floor(Date.now() / 1000);
    return !stake.withdrawn && now >= stake.endTimestamp.toNumber();
  };
  
  // Determine if rewards can be claimed
  const canClaimRewards = (stake: UserStake) => {
    const now = Math.floor(Date.now() / 1000);
    return !stake.withdrawn && now > stake.lastClaimTimestamp.toNumber() && calculateEstimatedRewards(stake) > 0;
  };
  
  // Render the staking form
  const renderStakingForm = () => {
    return (
      <div className="staking-form-container">
        <h3>Stake WCT Tokens</h3>
        <p className="staking-description">
          Stake your WCT tokens to earn rewards, gain reputation boosts, and participate in governance.
          Longer staking periods offer higher benefits.
        </p>
        
        {stakingStats && (
          <div className="staking-stats">
            <div className="stat-item">
              <span className="stat-label">Total Staked</span>
              <span className="stat-value">{stakingStats.totalStaked.toLocaleString()} WCT</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Number of Stakers</span>
              <span className="stat-value">{stakingStats.stakerCount}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">APY</span>
              <span className="stat-value">{(stakingStats.rewardRate * 365).toFixed(2)}%</span>
            </div>
          </div>
        )}
        
        <form onSubmit={handleStake} className="stake-form">
          <div className="form-group">
            <label htmlFor="amount">Amount (WCT)</label>
            <input
              type="number"
              id="amount"
              name="amount"
              value={stakeForm.amount}
              onChange={handleStakeFormChange}
              placeholder="0.00"
              min="0.000001"
              step="0.000001"
              disabled={isLoading || !wallet.publicKey}
              required
            />
            {wctBalance !== null && (
              <div className="balance-info">
                Balance: {wctBalance.toLocaleString()} WCT
                <button
                  type="button"
                  className="max-button"
                  onClick={() => setStakeForm({ ...stakeForm, amount: wctBalance.toString() })}
                  disabled={isLoading || !wallet.publicKey}
                >
                  MAX
                </button>
              </div>
            )}
          </div>
          
          <div className="form-group">
            <label htmlFor="duration">Staking Period</label>
            <select
              id="duration"
              name="duration"
              value={stakeForm.duration}
              onChange={handleStakeFormChange}
              disabled={isLoading || !wallet.publicKey}
              required
            >
              {STAKE_DURATIONS.map((duration) => (
                <option key={duration.value} value={duration.value}>
                  {duration.label} - {duration.label === '30 Days' ? '10%' : 
                    duration.label === '90 Days' ? '20%' : 
                    duration.label === '180 Days' ? '30%' : '50%'} Reputation Boost
                </option>
              ))}
            </select>
          </div>
          
          <div className="staking-benefits">
            <h4>Benefits</h4>
            <ul>
              <li>
                Reputation Boost: {stakeForm.duration === STAKE_DURATIONS[0].value ? '10%' : 
                  stakeForm.duration === STAKE_DURATIONS[1].value ? '20%' : 
                  stakeForm.duration === STAKE_DURATIONS[2].value ? '30%' : '50%'}
              </li>
              <li>
                APY: {stakingStats ? (stakingStats.rewardRate * 365).toFixed(2) : '?'}%
              </li>
              <li>
                Voting Power: {stakeForm.amount && !isNaN(parseFloat(stakeForm.amount)) ? 
                  Math.floor(parseFloat(stakeForm.amount) / 1000) * 
                  (stakeForm.duration === STAKE_DURATIONS[0].value ? 1 : 
                   stakeForm.duration === STAKE_DURATIONS[1].value ? 1.5 : 
                   stakeForm.duration === STAKE_DURATIONS[2].value ? 2 : 3) : 0} votes
              </li>
            </ul>
          </div>
          
          <button
            type="submit"
            className="stake-button"
            disabled={isLoading || !wallet.publicKey}
          >
            {isLoading ? 'Processing...' : 'Stake WCT'}
          </button>
        </form>
        
        {transactionMessage.message && (
          <div className={`transaction-message ${transactionMessage.type}`}>
            <p>{transactionMessage.message}</p>
            {transactionMessage.type === 'success' && transactionMessage.message.includes('Transaction') && (
              <a 
                href={`https://explorer.solana.com/tx/${transactionMessage.message.split('Transaction: ')[1]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                View on Explorer
              </a>
            )}
          </div>
        )}
      </div>
    );
  };
  
  // Render user stakes
  const renderUserStakes = () => {
    if (!wallet.publicKey) {
      return (
        <div className="connect-wallet-message">
          <p>Please connect your wallet to view your staked tokens.</p>
        </div>
      );
    }
    
    if (userStakes.length === 0) {
      return (
        <div className="no-stakes-message">
          <p>You don't have any active stakes. Start staking to earn rewards and benefits!</p>
        </div>
      );
    }
    
    return (
      <div className="user-stakes-container">
        <h3>Your Staked Tokens</h3>
        
        {userStakes.map((stake, index) => {
          const stakeAmount = stake.stakeAmount.toNumber() / (10 ** 9);
          const startDate = formatDate(stake.startTimestamp.toNumber());
          const endDate = formatDate(stake.endTimestamp.toNumber());
          const daysRemaining = calculateDaysRemaining(stake.endTimestamp.toNumber());
          const estimatedRewards = calculateEstimatedRewards(stake);
          const claimedRewards = stake.claimedReward.toNumber() / (10 ** 9);
          const isUnstakable = canUnstake(stake);
          const isClaimable = canClaimRewards(stake);
          
          return (
            <div key={index} className={`stake-card ${stake.withdrawn ? 'withdrawn' : ''}`}>
              {stake.withdrawn && (
                <div className="withdrawn-badge">Withdrawn</div>
              )}
              
              <div className="stake-header">
                <h4>{stakeAmount.toLocaleString()} WCT</h4>
                <div className="reputation-boost">
                  +{stake.reputationBoost.toNumber()}% Reputation
                </div>
              </div>
              
              <div className="stake-info">
                <div className="info-row">
                  <span className="info-label">Start Date</span>
                  <span className="info-value">{startDate}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">End Date</span>
                  <span className="info-value">{endDate}</span>
                </div>
                {!stake.withdrawn && (
                  <div className="info-row">
                    <span className="info-label">Days Remaining</span>
                    <span className="info-value">{daysRemaining}</span>
                  </div>
                )}
                <div className="info-row">
                  <span className="info-label">Voting Power</span>
                  <span className="info-value">{stake.votingPower.toNumber()} votes</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Claimed Rewards</span>
                  <span className="info-value">{claimedRewards.toLocaleString()} WCT</span>
                </div>
                {!stake.withdrawn && (
                  <div className="info-row">
                    <span className="info-label">Pending Rewards</span>
                    <span className="info-value">{estimatedRewards.toLocaleString()} WCT</span>
                  </div>
                )}
              </div>
              
              {!stake.withdrawn && (
                <div className="stake-actions">
                  <button
                    className="claim-button"
                    onClick={() => handleClaimRewards(index)}
                    disabled={!isClaimable || isLoading}
                  >
                    {isLoading ? 'Processing...' : 'Claim Rewards'}
                  </button>
                  
                  <button
                    className="unstake-button"
                    onClick={() => handleUnstake(index)}
                    disabled={!isUnstakable || isLoading}
                  >
                    {isLoading ? 'Processing...' : isUnstakable ? 'Unstake' : `Locked for ${daysRemaining} days`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        
        {transactionMessage.message && (
          <div className={`transaction-message ${transactionMessage.type}`}>
            <p>{transactionMessage.message}</p>
            {transactionMessage.type === 'success' && transactionMessage.message.includes('Transaction') && (
              <a 
                href={`https://explorer.solana.com/tx/${transactionMessage.message.split('Transaction: ')[1]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                View on Explorer
              </a>
            )}
          </div>
        )}
      </div>
    );
  };
  
  return (
    <div className="staking-component">
      <div className="staking-header">
        <h2>WCT Staking</h2>
        <div className="tab-navigation">
          <button
            className={`tab-button ${activeTab === 'stake' ? 'active' : ''}`}
            onClick={() => setActiveTab('stake')}
          >
            Stake Tokens
          </button>
          <button
            className={`tab-button ${activeTab === 'myStakes' ? 'active' : ''}`}
            onClick={() => setActiveTab('myStakes')}
          >
            My Stakes
          </button>
        </div>
      </div>
      
      <div className="staking-content">
        {activeTab === 'stake' ? renderStakingForm() : renderUserStakes()}
      </div>
    </div>
  );
};

export default StakingComponent;

// Add CSS for the Staking Component
// File: frontend/src/styles/staking.css
/*
 * Staking Component Styles
 */
.staking-component {
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.staking-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 1rem;
}

.staking-header h2 {
  margin: 0;
  color: #3f51b5;
}

.tab-navigation {
  display: flex;
}

.tab-button {
  background-color: transparent;
  border: none;
  padding: 0.75rem 1.25rem;
  font-size: 1rem;
  font-weight: 500;
  color: #666666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
}

.tab-button.active {
  color: #3f51b5;
  border-bottom-color: #3f51b5;
}

.staking-form-container, .user-stakes-container {
  max-width: 800px;
  margin: 0 auto;
}

.staking-description {
  color: #666666;
  margin-bottom: 1.5rem;
}

.staking-stats {
  display: flex;
  justify-content: space-between;
  background-color: #f5f7ff;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-label {
  font-size: 0.85rem;
  color: #666666;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: #3f51b5;
}

.stake-form {
  margin-top: 1.5rem;
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #dddddd;
  border-radius: 8px;
  font-size: 1rem;
}

.balance-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: #666666;
  margin-top: 0.5rem;
}

.max-button {
  background-color: transparent;
  border: 1px solid #dddddd;
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #3f51b5;
  cursor: pointer;
}

.staking-benefits {
  background-color: #f0f4c3;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.staking-benefits h4 {
  margin-top: 0;
  margin-bottom: 0.75rem;
  color: #558b2f;
}

.staking-benefits ul {
  list-style-type: none;
  padding-left: 0;
  margin: 0;
}

.staking-benefits li {
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
}

.staking-benefits li:before {
  content: "✓";
  margin-right: 0.5rem;
  color: #558b2f;
  font-weight: bold;
}

.stake-button,
.claim-button,
.unstake-button {
  width: 100%;
  padding: 0.85rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.stake-button {
  background-color: #3f51b5;
  color: white;
}

.stake-button:hover:not(:disabled) {
  background-color: #303f9f;
}

.stake-button:disabled,
.claim-button:disabled,
.unstake-button:disabled {
  background-color: #c5cae9;
  cursor: not-allowed;
}

.transaction-message {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
}

.transaction-message.success {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.transaction-message.error {
  background-color: #ffebee;
  color: #c62828;
}

.explorer-link {
  display: inline-block;
  margin-top: 0.5rem;
  color: inherit;
  text-decoration: underline;
}

.connect-wallet-message,
.no-stakes-message {
  text-align: center;
  padding: 2rem;
  background-color: #f5f5f5;
  border-radius: 8px;
}

.user-stakes-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.stake-card {
  position: relative;
  background-color: #f5f7ff;
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: transform 0.2s ease;
}

.stake-card:hover {
  transform: translateY(-5px);
}

.stake-card.withdrawn {
  background-color: #f5f5f5;
  opacity: 0.7;
}

.withdrawn-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  background-color: #9e9e9e;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.stake-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.stake-header h4 {
  margin: 0;
  font-size: 1.25rem;
  color: #3f51b5;
}

.reputation-boost {
  background-color: #e8f5e9;
  color: #2e7d32;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.stake-info {
  margin-bottom: 1.25rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.info-label {
  color: #666666;
  font-size: 0.9rem;
}

.info-value {
  font-weight: 500;
}

.stake-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.claim-button {
  background-color: #4caf50;
  color: white;
}

.claim-button:hover:not(:disabled) {
  background-color: #43a047;
}

.unstake-button {
  background-color: #ff9800;
  color: white;
}

.unstake-button:hover:not(:disabled) {
  background-color: #f57c00;
}

@media (max-width: 768px) {
  .staking-stats {
    flex-direction: column;
    gap: 1rem;
  }
  
  .user-stakes-container {
    grid-template-columns: 1fr;
  }
  
  .stake-actions {
    grid-template-columns: 1fr;
  }
}
