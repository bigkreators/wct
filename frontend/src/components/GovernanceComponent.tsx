// File: frontend/src/components/GovernanceComponent.tsx
import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import axios from 'axios';

// Import the IDL for your governance program
import governanceIdl from '../idl/wct_governance.json';

// Constants
const WCT_MINT_ADDRESS = new PublicKey(process.env.REACT_APP_WCT_MINT_ADDRESS || '');
const GOVERNANCE_PROGRAM_ID = new PublicKey(process.env.REACT_APP_GOVERNANCE_PROGRAM_ID || '');
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

// Proposal types
enum ProposalType {
  TreasuryWithdrawal = 0,
  ParameterChange = 1,
  Other = 2,
}

// Vote types
enum Vote {
  Yes = 0,
  No = 1,
  Abstain = 2,
}

// Interfaces
interface Proposal {
  publicKey: PublicKey;
  account: {
    governance: PublicKey;
    proposer: PublicKey;
    proposalId: number;
    title: string;
    description: string;
    proposalType: ProposalType;
    executionPayload: Uint8Array;
    createdAt: number;
    votingEndsAt: number;
    yesVotes: number;
    noVotes: number;
    executed: boolean;
    cancelled: boolean;
  };
}

interface GovernanceData {
  authority: PublicKey;
  tokenMint: PublicKey;
  treasury: PublicKey;
  minProposalTokens: number;
  votingPeriod: number;
  executionDelay: number;
  quorumPercentage: number;
  proposalCount: number;
  totalVotingPower: number;
}

interface CreateProposalForm {
  title: string;
  description: string;
  proposalType: ProposalType;
  payload: string;
}

const GovernanceComponent: React.FC = () => {
  const { connection } = useConnection();
  const wallet = useWallet();
  
  // Component state
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [governanceData, setGovernanceData] = useState<GovernanceData | null>(null);
  const [userVotingPower, setUserVotingPower] = useState<number>(0);
  const [wctBalance, setWctBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [transactionMessage, setTransactionMessage] = useState({ type: '', message: '' });
  
  // Create proposal form state
  const [createProposalForm, setCreateProposalForm] = useState<CreateProposalForm>({
    title: '',
    description: '',
    proposalType: ProposalType.Other,
    payload: '',
  });
  
  const [activeTab, setActiveTab] = useState<'proposals' | 'createProposal' | 'myVotes'>('proposals');
  
  // Setup Anchor program when wallet is connected
  const getProgram = () => {
    if (!wallet.publicKey) return null;
    
    const provider = new AnchorProvider(
      connection,
      wallet as any,
      { commitment: 'confirmed' }
    );
    
    return new Program(governanceIdl as any, GOVERNANCE_PROGRAM_ID, provider);
  };
  
  // Find governance PDA
  const findGovernancePDA = async () => {
    const [governancePDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('governance'),
        WCT_MINT_ADDRESS.toBuffer(),
      ],
      GOVERNANCE_PROGRAM_ID
    );
    
    return governancePDA;
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
  
  // Fetch governance data
  const fetchGovernanceData = async () => {
    const program = getProgram();
    if (!program) return;
    
    try {
      const governancePDA = await findGovernancePDA();
      const governanceAccount = await program.account.governance.fetch(governancePDA);
      
      setGovernanceData({
        authority: governanceAccount.authority,
        tokenMint: governanceAccount.tokenMint,
        treasury: governanceAccount.treasury,
        minProposalTokens: governanceAccount.minProposalTokens.toNumber() / (10 ** 9),
        votingPeriod: governanceAccount.votingPeriod,
        executionDelay: governanceAccount.executionDelay,
        quorumPercentage: governanceAccount.quorumPercentage,
        proposalCount: governanceAccount.proposalCount.toNumber(),
        totalVotingPower: governanceAccount.totalVotingPower.toNumber(),
      });
    } catch (error) {
      console.error('Error fetching governance data:', error);
    }
  };
  
  // Fetch user's voting power
  const fetchUserVotingPower = async () => {
    if (!wallet.publicKey) return;
    
    try {
      // This would typically call a backend API to get voting power
      // For now, we'll fetch it from our API
      const { data } = await axios.get(
        `${API_URL}/governance/voting-power/${wallet.publicKey.toString()}`
      );
      
      setUserVotingPower(data.votingPower || 0);
    } catch (error) {
      console.error('Error fetching voting power:', error);
      // Default to 0 if there's an error
      setUserVotingPower(0);
    }
  };
  
  // Fetch proposals
  const fetchProposals = async () => {
    const program = getProgram();
    if (!program) return;
    
    try {
      const governancePDA = await findGovernancePDA();
      const allProposals = await program.account.proposal.all([
        {
          memcmp: {
            offset: 8, // After discriminator
            bytes: governancePDA.toBase58(),
          },
        },
      ]);
      
      // Sort by proposal ID in descending order (newest first)
      allProposals.sort((a, b) => 
        b.account.proposalId - a.account.proposalId
      );
      
      setProposals(allProposals as unknown as Proposal[]);
    } catch (error) {
      console.error('Error fetching proposals:', error);
    }
  };
  
  // Load data when wallet changes
  useEffect(() => {
    if (wallet.publicKey) {
      fetchTokenBalance();
      fetchGovernanceData();
      fetchUserVotingPower();
      fetchProposals();
    } else {
      setWctBalance(null);
      setGovernanceData(null);
      setUserVotingPower(0);
      setProposals([]);
    }
  }, [wallet.publicKey, connection]);
  
  // Handle create proposal form changes
  const handleCreateProposalFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCreateProposalForm({
      ...createProposalForm,
      [name]: name === 'proposalType' ? parseInt(value) : value,
    });
  };
  
  // Submit a new proposal
  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!wallet.publicKey || !wallet.signTransaction) {
      setTransactionMessage({
        type: 'error',
        message: 'Please connect your wallet',
      });
      return;
    }
    
    if (!governanceData) {
      setTransactionMessage({
        type: 'error',
        message: 'Governance data not loaded',
      });
      return;
    }
    
    // Check if user has enough tokens to create a proposal
    if (wctBalance === null || wctBalance < governanceData.minProposalTokens) {
      setTransactionMessage({
        type: 'error',
        message: `You need at least ${governanceData.minProposalTokens} WCT to create a proposal`,
      });
      return;
    }
    
    if (!createProposalForm.title.trim() || !createProposalForm.description.trim()) {
      setTransactionMessage({
        type: 'error',
        message: 'Title and description are required',
      });
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const governancePDA = await findGovernancePDA();
      
      // Create an execution payload based on proposal type
      let executionPayload = new Uint8Array(0);
      if (createProposalForm.payload) {
        // For simplicity, just convert the string to bytes
        executionPayload = new TextEncoder().encode(createProposalForm.payload);
      }
      
      // Find the proposal PDA
      const [proposalPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('proposal'),
          governancePDA.toBuffer(),
          new BN(governanceData.proposalCount + 1).toArrayLike(Buffer, 'le', 8),
        ],
        GOVERNANCE_PROGRAM_ID
      );
      
      // Get user token account
      const userTokenAccount = await getAssociatedTokenAddress(
        WCT_MINT_ADDRESS,
        wallet.publicKey
      );
      
      // Execute create proposal transaction
      const tx = await program.methods
        .createProposal(
          createProposalForm.title,
          createProposalForm.description,
          createProposalForm.proposalType,
          executionPayload
        )
        .accounts({
          governance: governancePDA,
          proposal: proposalPDA,
          proposer: wallet.publicKey,
          proposerTokenAccount: userTokenAccount,
          systemProgram: web3.SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
      console.log('Create proposal transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully created proposal! Transaction: ${tx}`,
      });
      
      // Reset form and refresh data
      setCreateProposalForm({
        title: '',
        description: '',
        proposalType: ProposalType.Other,
        payload: '',
      });
      
      // Refresh data
      fetchGovernanceData();
      fetchProposals();
      
      // Switch to proposals tab
      setActiveTab('proposals');
      
    } catch (error) {
      console.error('Error creating proposal:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error creating proposal: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Cast a vote on a proposal
  const handleCastVote = async (proposal: Proposal, vote: Vote) => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setTransactionMessage({
        type: 'error',
        message: 'Please connect your wallet',
      });
      return;
    }
    
    if (userVotingPower <= 0) {
      setTransactionMessage({
        type: 'error',
        message: 'You need voting power to vote on proposals. Try staking WCT tokens.',
      });
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const governancePDA = await findGovernancePDA();
      
      // Find the voting power registry PDA
      const [votingPowerRegistryPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('voting_power_registry'),
          governancePDA.toBuffer(),
        ],
        GOVERNANCE_PROGRAM_ID
      );
      
      // Find the voter vote PDA
      const [voterVotePDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('voter_vote'),
          proposal.publicKey.toBuffer(),
          wallet.publicKey.toBuffer(),
        ],
        GOVERNANCE_PROGRAM_ID
      );
      
      // Execute cast vote transaction
      const tx = await program.methods
        .castVote(vote)
        .accounts({
          governance: governancePDA,
          proposal: proposal.publicKey,
          voter: wallet.publicKey,
          voterVote: voterVotePDA,
          votingPowerRegistry: votingPowerRegistryPDA,
          systemProgram: web3.SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
      console.log('Cast vote transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully cast your vote! Transaction: ${tx}`,
      });
      
      // Refresh proposals data
      fetchProposals();
      
    } catch (error) {
      console.error('Error casting vote:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error casting vote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Execute a proposal
  const handleExecuteProposal = async (proposal: Proposal) => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setTransactionMessage({
        type: 'error',
        message: 'Please connect your wallet',
      });
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const governancePDA = await findGovernancePDA();
      
      // Find the voting power registry PDA
      const [votingPowerRegistryPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('voting_power_registry'),
          governancePDA.toBuffer(),
        ],
        GOVERNANCE_PROGRAM_ID
      );
      
      // Execute proposal transaction
      const tx = await program.methods
        .executeProposal()
        .accounts({
          governance: governancePDA,
          proposal: proposal.publicKey,
          executor: wallet.publicKey,
          votingPowerRegistry: votingPowerRegistryPDA,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      
      console.log('Execute proposal transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully executed proposal! Transaction: ${tx}`,
      });
      
      // Refresh proposals data
      fetchProposals();
      
    } catch (error) {
      console.error('Error executing proposal:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error executing proposal: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Cancel a proposal
  const handleCancelProposal = async (proposal: Proposal) => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setTransactionMessage({
        type: 'error',
        message: 'Please connect your wallet',
      });
      return;
    }
    
    // Check if user is the proposer or governance authority
    if (
      !governanceData ||
      (proposal.account.proposer.toString() !== wallet.publicKey.toString() &&
        governanceData.authority.toString() !== wallet.publicKey.toString())
    ) {
      setTransactionMessage({
        type: 'error',
        message: 'Only the proposer or governance authority can cancel this proposal',
      });
      return;
    }
    
    setIsLoading(true);
    setTransactionMessage({ type: '', message: '' });
    
    try {
      const program = getProgram();
      if (!program) throw new Error('Program not initialized');
      
      const governancePDA = await findGovernancePDA();
      
      // Execute cancel proposal transaction
      const tx = await program.methods
        .cancelProposal()
        .accounts({
          governance: governancePDA,
          proposal: proposal.publicKey,
          authority: wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      
      console.log('Cancel proposal transaction successful:', tx);
      
      setTransactionMessage({
        type: 'success',
        message: `Successfully cancelled proposal! Transaction: ${tx}`,
      });
      
      // Refresh proposals data
      fetchProposals();
      
    } catch (error) {
      console.error('Error cancelling proposal:', error);
      setTransactionMessage({
        type: 'error',
        message: `Error cancelling proposal: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Format timestamp to readable date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString() + ' ' + 
           new Date(timestamp * 1000).toLocaleTimeString();
  };
  
  // Calculate time remaining for voting
  const calculateTimeRemaining = (endTimestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const secondsRemaining = Math.max(0, endTimestamp - now);
    
    if (secondsRemaining === 0) return 'Voting ended';
    
    const days = Math.floor(secondsRemaining / (24 * 60 * 60));
    const hours = Math.floor((secondsRemaining % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((secondsRemaining % (60 * 60)) / 60);
    
    return `${days}d ${hours}h ${minutes}m remaining`;
  };
  
  // Get proposal status text
  const getProposalStatusText = (proposal: Proposal) => {
    if (proposal.account.cancelled) return 'Cancelled';
    if (proposal.account.executed) return 'Executed';
    
    const now = Math.floor(Date.now() / 1000);
    if (now < proposal.account.votingEndsAt) return 'Voting Active';
    
    if (governanceData) {
      const executionTime = proposal.account.votingEndsAt + governanceData.executionDelay;
      if (now < executionTime) return `Waiting for execution (${Math.ceil((executionTime - now) / (60 * 60))}h left)`;
      
      // Check if it passed
      const totalVotes = proposal.account.yesVotes + proposal.account.noVotes;
      const quorumThreshold = Math.floor((governanceData.totalVotingPower * governanceData.quorumPercentage) / 100);
      
      if (totalVotes < quorumThreshold) return 'Failed (Quorum not reached)';
      if (proposal.account.yesVotes <= proposal.account.noVotes) return 'Failed (Not enough Yes votes)';
      
      return 'Ready for execution';
    }
    
    return 'Unknown';
  };
  
  // Check if a proposal can be executed
  const canExecuteProposal = (proposal: Proposal) => {
    if (!governanceData) return false;
    if (proposal.account.cancelled || proposal.account.executed) return false;
    
    const now = Math.floor(Date.now() / 1000);
    if (now < proposal.account.votingEndsAt + governanceData.executionDelay) return false;
    
    const totalVotes = proposal.account.yesVotes + proposal.account.noVotes;
    const quorumThreshold = Math.floor((governanceData.totalVotingPower * governanceData.quorumPercentage) / 100);
    
    if (totalVotes < quorumThreshold) return false;
    if (proposal.account.yesVotes <= proposal.account.noVotes) return false;
    
    return true;
  };
  
  // Render proposals list
  const renderProposalsList = () => {
    if (!wallet.publicKey) {
      return (
        <div className="connect-wallet-message">
          <p>Please connect your wallet to view proposals.</p>
        </div>
      );
    }
    
    if (proposals.length === 0) {
      return (
        <div className="no-proposals-message">
          <p>No proposals have been created yet.</p>
          <button 
            className="create-proposal-button" 
            onClick={() => setActiveTab('createProposal')}
          >
            Create First Proposal
          </button>
        </div>
      );
    }
    
    return (
      <div className="proposals-container">
        {proposals.map((proposal, index) => {
          const statusText = getProposalStatusText(proposal);
          const canExecute = canExecuteProposal(proposal);
          const now = Math.floor(Date.now() / 1000);
          const votingActive = now < proposal.account.votingEndsAt && !proposal.account.cancelled && !proposal.account.executed;
          
          return (
            <div key={index} className={`proposal-card ${statusText.toLowerCase().replace(' ', '-')}`}>
              <div className="proposal-header">
                <h3>{proposal.account.title}</h3>
                <div className="proposal-id">ID: {proposal.account.proposalId}</div>
              </div>
              
              <div className="proposal-info">
                <div className="proposal-meta">
                  <div>
                    <span className="meta-label">Proposer:</span>
                    <span className="meta-value">{proposal.account.proposer.toString().slice(0, 6)}...{proposal.account.proposer.toString().slice(-4)}</span>
                  </div>
                  <div>
                    <span className="meta-label">Type:</span>
                    <span className="meta-value">
                      {ProposalType[proposal.account.proposalType]}
                    </span>
                  </div>
                  <div>
                    <span className="meta-label">Created:</span>
                    <span className="meta-value">{formatDate(proposal.account.createdAt)}</span>
                  </div>
                  <div>
                    <span className="meta-label">Voting Ends:</span>
                    <span className="meta-value">{formatDate(proposal.account.votingEndsAt)}</span>
                  </div>
                  <div>
                    <span className="meta-label">Status:</span>
                    <span className={`meta-value status-${statusText.toLowerCase().replace(' ', '-')}`}>
                      {statusText}
                    </span>
                  </div>
                </div>
                
                <div className="proposal-description">
                  <p>{proposal.account.description}</p>
                </div>
                
                <div className="voting-stats">
                  <div className="vote-bar">
                    <div 
                      className="yes-votes" 
                      style={{ width: `${proposal.account.yesVotes + proposal.account.noVotes > 0 
                        ? (proposal.account.yesVotes / (proposal.account.yesVotes + proposal.account.noVotes)) * 100 
                        : 0}%` }}
                    ></div>
                    <div 
                      className="no-votes" 
                      style={{ width: `${proposal.account.yesVotes + proposal.account.noVotes > 0 
                        ? (proposal.account.noVotes / (proposal.account.yesVotes + proposal.account.noVotes)) * 100 
                        : 0}%` }}
                    ></div>
                  </div>
                  
                  <div className="vote-counts">
                    <div className="yes-count">Yes: {proposal.account.yesVotes}</div>
                    <div className="no-count">No: {proposal.account.noVotes}</div>
                  </div>
                  
                  {governanceData && (
                    <div className="quorum-info">
                      Quorum: {proposal.account.yesVotes + proposal.account.noVotes} / 
                      {Math.floor((governanceData.totalVotingPower * governanceData.quorumPercentage) / 100)}
                      {votingActive && (
                        <span className="time-remaining">
                          {calculateTimeRemaining(proposal.account.votingEndsAt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="proposal-actions">
                {votingActive && (
                  <div className="voting-buttons">
                    <button 
                      className="vote-yes-button" 
                      onClick={() => handleCastVote(proposal, Vote.Yes)}
                      disabled={isLoading || userVotingPower <= 0}
                    >
                      Vote Yes
                    </button>
                    <button 
                      className="vote-no-button" 
                      onClick={() => handleCastVote(proposal, Vote.No)}
                      disabled={isLoading || userVotingPower <= 0}
                    >
                      Vote No
                    </button>
                    <button 
                      className="vote-abstain-button" 
                      onClick={() => handleCastVote(proposal, Vote.Abstain)}
                      disabled={isLoading || userVotingPower <= 0}
                    >
                      Abstain
                    </button>
                  </div>
                )}
                
                {canExecute && (
                  <button 
                    className="execute-button" 
                    onClick={() => handleExecuteProposal(proposal)}
                    disabled={isLoading}
                  >
                    Execute Proposal
                  </button>
                )}
                
                {votingActive && (governanceData?.authority.toString() === wallet.publicKey.toString() || 
                                  proposal.account.proposer.toString() === wallet.publicKey.toString()) && (
                  <button 
                    className="cancel-button" 
                    onClick={() => handleCancelProposal(proposal)}
                    disabled={isLoading}
                  >
                    Cancel Proposal
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  
  // Render create proposal form
  const renderCreateProposalForm = () => {
    if (!wallet.publicKey) {
      return (
        <div className="connect-wallet-message">
          <p>Please connect your wallet to create a proposal.</p>
        </div>
      );
    }
    
    if (!governanceData) {
      return (
        <div className="loading-message">
          <p>Loading governance data...</p>
        </div>
      );
    }
    
    return (
      <div className="create-proposal-container">
        <h3>Create New Proposal</h3>
        
        <div className="proposal-requirements">
          <p>
            <strong>Requirements:</strong> You need at least {governanceData.minProposalTokens} WCT tokens to create a proposal.
            {wctBalance !== null && (
              <span className="balance-info">
                Your balance: {wctBalance.toLocaleString()} WCT
                {wctBalance < governanceData.minProposalTokens && (
                  <span className="insufficient-balance">
                    (Insufficient balance)
                  </span>
                )}
              </span>
            )}
          </p>
        </div>
        
        <form onSubmit={handleCreateProposal} className="proposal-form">
          <div className="form-group">
            <label htmlFor="title">Title</label>
            <input
              type="text"
              id="title"
              name="title"
              value={createProposalForm.title}
              onChange={handleCreateProposalFormChange}
              placeholder="Enter proposal title"
              maxLength={100}
              disabled={isLoading}
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={createProposalForm.description}
              onChange={handleCreateProposalFormChange}
              placeholder="Provide a detailed description of your proposal"
              rows={6}
              maxLength={1000}
              disabled={isLoading}
              required
            ></textarea>
          </div>
          
          <div className="form-group">
            <label htmlFor="proposalType">Proposal Type</label>
            <select
              id="proposalType"
              name="proposalType"
              value={createProposalForm.proposalType}
              onChange={handleCreateProposalFormChange}
              disabled={isLoading}
              required
            >
              <option value={ProposalType.TreasuryWithdrawal}>Treasury Withdrawal</option>
              <option value={ProposalType.ParameterChange}>Parameter Change</option>
              <option value={ProposalType.Other}>Other</option>
            </select>
          </div>
          
          <div className="form-group">
            <label htmlFor="payload">Execution Payload (Optional)</label>
            <textarea
              id="payload"
              name="payload"
              value={createProposalForm.payload}
              onChange={handleCreateProposalFormChange}
              placeholder="Enter execution payload data (JSON format recommended)"
              rows={4}
              disabled={isLoading}
            ></textarea>
            <p className="field-help">
              For advanced users: This will be used during proposal execution.
            </p>
          </div>
          
          <button
            type="submit"
            className="submit-proposal-button"
            disabled={isLoading || wctBalance === null || wctBalance < governanceData.minProposalTokens}
          >
            {isLoading ? 'Processing...' : 'Submit Proposal'}
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
  
  return (
    <div className="governance-component">
      <div className="governance-header">
        <h2>WCT Governance</h2>
        <div className="tab-navigation">
          <button
            className={`tab-button ${activeTab === 'proposals' ? 'active' : ''}`}
            onClick={() => setActiveTab('proposals')}
          >
            Proposals
          </button>
          <button
            className={`tab-button ${activeTab === 'createProposal' ? 'active' : ''}`}
            onClick={() => setActiveTab('createProposal')}
          >
            Create Proposal
          </button>
          {wallet.publicKey && (
            <div className="user-info">
              <div className="voting-power">
                Voting Power: {userVotingPower}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="governance-content">
        {activeTab === 'proposals' ? renderProposalsList() : renderCreateProposalForm()}
      </div>
    </div>
  );
};

export default GovernanceComponent;

// Add CSS for the Governance Component
// File: frontend/src/styles/governance.css
/*
 * Governance Component Styles
 */
.governance-component {
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.governance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 1rem;
}

.governance-header h2 {
  margin: 0;
  color: #3f51b5;
}

.tab-navigation {
  display: flex;
  align-items: center;
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

.user-info {
  margin-left: 1.5rem;
  padding-left: 1.5rem;
  border-left: 1px solid #e0e0e0;
}

.voting-power {
  font-size: 0.9rem;
  font-weight: 500;
  color: #4caf50;
}

.connect-wallet-message,
.no-proposals-message,
.loading-message {
  text-align: center;
  padding: 2rem;
  background-color: #f5f5f5;
  border-radius: 8px;
}

.create-proposal-button {
  margin-top: 1rem;
  padding: 0.75rem 1.5rem;
  background-color: #3f51b5;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.create-proposal-button:hover {
  background-color: #303f9f;
}

.proposals-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.proposal-card {
  background-color: #f5f7ff;
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  border-left: 4px solid #3f51b5;
}

.proposal-card.executed {
  border-left-color: #4caf50;
  background-color: #f1f8e9;
}

.proposal-card.cancelled {
  border-left-color: #9e9e9e;
  background-color: #f5f5f5;
  opacity: 0.8;
}

.proposal-card.failed-quorum-not-reached,
.proposal-card.failed-not-enough-yes-votes {
  border-left-color: #f44336;
  background-color: #ffebee;
}

.proposal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.proposal-header h3 {
  margin: 0;
  font-size: 1.25rem;
}

.proposal-id {
  font-size: 0.85rem;
  color: #666666;
  background-color: #e0e0e0;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.proposal-info {
  margin-bottom: 1.25rem;
}

.proposal-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.meta-label {
  color: #666666;
  font-size: 0.85rem;
  margin-right: 0.25rem;
}

.meta-value {
  font-weight: 500;
}

.status-voting-active {
  color: #3f51b5;
}

.status-ready-for-execution {
  color: #4caf50;
}

.status-waiting-for-execution {
  color: #ff9800;
}

.status-executed {
  color: #4caf50;
}

.status-cancelled {
  color: #9e9e9e;
}

.status-failed-quorum-not-reached,
.status-failed-not-enough-yes-votes {
  color: #f44336;
}

.proposal-description {
  margin-bottom: 1rem;
  line-height: 1.5;
}

.voting-stats {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 1rem;
}

.vote-bar {
  height: 8px;
  background-color: #f5f5f5;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  margin-bottom: 0.5rem;
}

.yes-votes {
  height: 100%;
  background-color: #4caf50;
}

.no-votes {
  height: 100%;
  background-color: #f44336;
}

.vote-counts {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.yes-count {
  color: #4caf50;
  font-weight: 500;
}

.no-count {
  color: #f44336;
  font-weight: 500;
}

.quorum-info {
  font-size: 0.85rem;
  color: #666666;
  display: flex;
  justify-content: space-between;
}

.time-remaining {
  color: #ff9800;
  font-weight: 500;
}

.proposal-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.voting-buttons {
  display: flex;
  gap: 0.5rem;
  flex-grow: 1;
}

.vote-yes-button,
.vote-no-button,
.vote-abstain-button,
.execute-button,
.cancel-button {
  padding: 0.75rem;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
  flex-grow: 1;
}

.vote-yes-button {
  background-color: #4caf50;
  color: white;
}

.vote-yes-button:hover:not(:disabled) {
  background-color: #43a047;
}

.vote-no-button {
  background-color: #f44336;
  color: white;
}

.vote-no-button:hover:not(:disabled) {
  background-color: #e53935;
}

.vote-abstain-button {
  background-color: #9e9e9e;
  color: white;
}

.vote-abstain-button:hover:not(:disabled) {
  background-color: #757575;
}

.execute-button {
  background-color: #3f51b5;
  color: white;
}

.execute-button:hover:not(:disabled) {
  background-color: #303f9f;
}

.cancel-button {
  background-color: #ff9800;
  color: white;
}

.cancel-button:hover:not(:disabled) {
  background-color: #f57c00;
}

.vote-yes-button:disabled,
.vote-no-button:disabled,
.vote-abstain-button:disabled,
.execute-button:disabled,
.cancel-button:disabled {
  background-color: #e0e0e0;
  color: #9e9e9e;
  cursor: not-allowed;
}

/* Create Proposal Form Styles */
.create-proposal-container {
  max-width: 800px;
  margin: 0 auto;
}

.proposal-requirements {
  background-color: #e8f5e9;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.balance-info {
  margin-left: 0.5rem;
  font-weight: normal;
}

.insufficient-balance {
  color: #f44336;
  margin-left: 0.5rem;
}

.proposal-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 500;
}

.form-group input,
.form-group textarea,
.form-group select {
  padding: 0.75rem;
  border: 1px solid #dddddd;
  border-radius: 8px;
  font-size: 1rem;
  font-family: inherit;
}

.field-help {
  font-size: 0.85rem;
  color: #666666;
  margin-top: 0.25rem;
}

.submit-proposal-button {
  padding: 0.85rem;
  background-color: #3f51b5;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-top: 1rem;
}

.submit-proposal-button:hover:not(:disabled) {
  background-color: #303f9f;
}

.submit-proposal-button:disabled {
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
