// File: frontend/src/components/WalletConnection.tsx
import React, { useState, useEffect } from 'react';
import { 
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter
} from '@solana/wallet-adapter-wallets';
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useConnection
} from '@solana/wallet-adapter-react';
import {
  WalletModalProvider,
  WalletMultiButton
} from '@solana/wallet-adapter-react-ui';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';

// Import styles for the wallet button
import '@solana/wallet-adapter-react-ui/styles.css';

// The token mint address (would be your actual token mint in production)
const WCT_MINT_ADDRESS = new PublicKey('Your_WCT_Token_Mint_Address_Here');

const WalletContent = () => {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [transactionHistory, setTransactionHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch balances when wallet is connected
  useEffect(() => {
    const fetchBalances = async () => {
      if (!publicKey || !connected) {
        setSolBalance(null);
        setTokenBalance(null);
        setTransactionHistory([]);
        return;
      }

      try {
        setIsLoading(true);
        
        // Fetch SOL balance
        const sol = await connection.getBalance(publicKey);
        setSolBalance(sol / LAMPORTS_PER_SOL);
        
        // Fetch WCT token balance
        try {
          const tokenAccount = await getAssociatedTokenAddress(
            WCT_MINT_ADDRESS,
            publicKey
          );
          
          const tokenAccountInfo = await getAccount(connection, tokenAccount);
          setTokenBalance(Number(tokenAccountInfo.amount) / (10 ** 9)); // Assuming 9 decimals
        } catch (error) {
          console.log('No token account found or other error:', error);
          setTokenBalance(0);
        }
        
        // Fetch recent transactions
        const transactions = await connection.getConfirmedSignaturesForAddress2(
          publicKey,
          { limit: 10 }
        );
        
        setTransactionHistory(transactions);
      } catch (error) {
        console.error('Error fetching balances:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalances();
    
    // Set up interval to refresh balances
    const intervalId = setInterval(fetchBalances, 30000);
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [publicKey, connected, connection]);

  if (!connected) {
    return (
      <div className="wallet-disconnect-message">
        <p>Connect your wallet to view your WCT balance and interaction history.</p>
      </div>
    );
  }

  return (
    <div className="wallet-content">
      <div className="wallet-info">
        <h3>Wallet Information</h3>
        <p><strong>Address:</strong> {publicKey?.toString()}</p>
        
        <div className="balances">
          <div className="balance-card">
            <h4>SOL Balance</h4>
            {isLoading ? (
              <p>Loading...</p>
            ) : (
              <p className="balance-amount">{solBalance !== null ? solBalance.toFixed(4) : 'N/A'}</p>
            )}
          </div>
          
          <div className="balance-card wct-balance">
            <h4>WCT Balance</h4>
            {isLoading ? (
              <p>Loading...</p>
            ) : (
              <p className="balance-amount">{tokenBalance !== null ? tokenBalance.toFixed(2) : 'N/A'}</p>
            )}
          </div>
        </div>
      </div>
      
      <div className="transaction-form">
      <h3>Send WCT Tokens</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="recipient">Recipient Address</label>
          <input
            type="text"
            id="recipient"
            value={recipient}
            onChange={handleRecipientChange}
            placeholder="Enter Solana wallet address"
            disabled={!publicKey || isLoading}
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="amount">Amount (WCT)</label>
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.00"
            min="0.000001"
            step="0.000001"
            disabled={!publicKey || isLoading}
          />
        </div>
        
        <div className="fee-info">
          <p>Transfer Fee: 2% (20% burned, 50% to treasury, 30% to staking rewards)</p>
        </div>
        
        <button 
          type="submit" 
          className="send-button" 
          disabled={!publicKey || isLoading}
        >
          {isLoading ? 'Processing...' : 'Send Tokens'}
        </button>
      </form>
      
      {transactionStatus.status && (
        <div className={`status-message ${transactionStatus.status}`}>
          <p>{transactionStatus.message}</p>
          {transactionStatus.status === 'success' && (
            <a 
              href={`https://explorer.solana.com/tx/${transactionStatus.message.split(': ')[1]}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Explorer
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default TransactionForm;

// File: frontend/src/App.tsx
import React from 'react';
import WalletConnection from './components/WalletConnection';
import TransactionForm from './components/TransactionForm';
import './App.css';

const App: React.FC = () => {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Wiki Contribution Token (WCT)</h1>
        <p>A Solana-based token reward system for wiki contributions</p>
      </header>
      
      <main className="app-main">
        <section className="wallet-section">
          <WalletConnection />
        </section>
        
        <section className="transaction-section">
          <TransactionForm />
        </section>
      </main>
      
      <footer className="app-footer">
        <p>&copy; 2025 Big Kreators. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;

// File: frontend/src/App.css
/* Main app styles */
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  font-family: 'Inter', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
}

.app-header {
  text-align: center;
  margin-bottom: 2rem;
}

.app-header h1 {
  color: #3f51b5;
  margin-bottom: 0.5rem;
}

.app-main {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
}

@media (min-width: 768px) {
  .app-main {
    grid-template-columns: 3fr 2fr;
  }
}

.wallet-section, .transaction-section {
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
}

.app-footer {
  margin-top: 3rem;
  text-align: center;
  color: #666666;
  font-size: 0.9rem;
}

/* Wallet container styles */
.wallet-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.wallet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.wallet-info {
  margin-bottom: 2rem;
}

.balances {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.balance-card {
  background-color: #f5f7ff;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.wct-balance {
  background-color: #e8f5e9;
}

.balance-amount {
  font-size: 1.5rem;
  font-weight: bold;
  margin-top: 0.5rem;
}

.transaction-history {
  margin-top: 1.5rem;
}

.transaction-history table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

.transaction-history th,
.transaction-history td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

.status-confirmed {
  color: #4caf50;
}

.status-processing {
  color: #ff9800;
}

.status-failed {
  color: #f44336;
}

/* Transaction form styles */
.transaction-form {
  padding: 1rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #dddddd;
  border-radius: 8px;
  font-size: 1rem;
}

.fee-info {
  background-color: #f5f5f5;
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
}

.send-button {
  width: 100%;
  padding: 0.75rem;
  background-color: #3f51b5;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.send-button:hover:not(:disabled) {
  background-color: #303f9f;
}

.send-button:disabled {
  background-color: #c5cae9;
  cursor: not-allowed;
}

.status-message {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
}

.status-message.success {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.status-message.error {
  background-color: #ffebee;
  color: #c62828;
}

.status-message.info {
  background-color: #e3f2fd;
  color: #1565c0;
}

.status-message a {
  display: inline-block;
  margin-top: 0.5rem;
  color: inherit;
  text-decoration: underline;
}history">
        <h3>Recent Transactions</h3>
        {isLoading ? (
          <p>Loading...</p>
        ) : transactionHistory.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Signature</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {transactionHistory.map((tx) => (
                <tr key={tx.signature}>
                  <td>
                    <a 
                      href={`https://explorer.solana.com/tx/${tx.signature}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      {`${tx.signature.substring(0, 8)}...${tx.signature.substring(tx.signature.length - 8)}`}
                    </a>
                  </td>
                  <td className={`status-${tx.confirmationStatus}`}>
                    {tx.confirmationStatus}
                  </td>
                  <td>
                    {new Date(tx.blockTime * 1000).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No recent transactions found.</p>
        )}
      </div>
    </div>
  );
};

const WalletConnection = () => {
  // Configure wallet adapters
  const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new TorusWalletAdapter()
  ];

  return (
    <ConnectionProvider endpoint={process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.devnet.solana.com'}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="wallet-container">
            <div className="wallet-header">
              <h2>Wiki Contribution Token (WCT)</h2>
              <WalletMultiButton />
            </div>
            <WalletContent />
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default WalletConnection;

// File: frontend/src/components/TransactionForm.tsx
import React, { useState } from 'react';
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
  createTransferCheckedInstruction,
  getAccount,
  getMint
} from '@solana/spl-token';

// The token mint address (would be your actual token mint in production)
const WCT_MINT_ADDRESS = new PublicKey('Your_WCT_Token_Mint_Address_Here');
// The program ID for your transfer with fee instruction
const WCT_PROGRAM_ID = new PublicKey('Your_WCT_Program_ID_Here');

const TransactionForm: React.FC = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    status: 'success' | 'error' | 'info' | null;
    message: string;
  }>({ status: null, message: '' });

  const handleRecipientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRecipient(e.target.value);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
  };

  const validateForm = () => {
    if (!publicKey) {
      setTransactionStatus({
        status: 'error',
        message: 'Please connect your wallet first.'
      });
      return false;
    }

    if (!recipient) {
      setTransactionStatus({
        status: 'error',
        message: 'Please enter a recipient address.'
      });
      return false;
    }

    try {
      new PublicKey(recipient);
    } catch (error) {
      setTransactionStatus({
        status: 'error',
        message: 'Invalid recipient address.'
      });
      return false;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setTransactionStatus({
        status: 'error',
        message: 'Please enter a valid amount.'
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm() || !publicKey) return;
    
    try {
      setIsLoading(true);
      setTransactionStatus({ status: 'info', message: 'Preparing transaction...' });
      
      const recipientPubkey = new PublicKey(recipient);
      
      if (recipientPubkey.equals(publicKey)) {
        setTransactionStatus({
          status: 'error',
          message: 'Cannot send tokens to yourself.'
        });
        setIsLoading(false);
        return;
      }
      
      // Get token accounts
      const senderTokenAccount = await getAssociatedTokenAddress(
        WCT_MINT_ADDRESS,
        publicKey
      );
      
      let recipientTokenAccount;
      try {
        recipientTokenAccount = await getAssociatedTokenAddress(
          WCT_MINT_ADDRESS,
          recipientPubkey
        );
        
        // Check if recipient token account exists
        await getAccount(connection, recipientTokenAccount);
      } catch (error) {
        // Token account doesn't exist, we'll create it
        const transaction = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientTokenAccount,
            recipientPubkey,
            WCT_MINT_ADDRESS
          )
        );
        
        const signature = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(signature, 'confirmed');
      }
      
      // Get token decimals
      const mintInfo = await getMint(connection, WCT_MINT_ADDRESS);
      const tokenDecimals = mintInfo.decimals;
      
      // Calculate token amount with decimals
      const tokenAmount = Math.floor(parseFloat(amount) * Math.pow(10, tokenDecimals));
      
      // For this example, we'll just use a regular SPL token transfer
      // In a production app, you would call your custom transfer_with_fee instruction
      
      setTransactionStatus({ 
        status: 'info', 
        message: 'Please approve the transaction in your wallet...' 
      });
      
      // Create transfer transaction
      const transaction = new Transaction();
      
      // Add the transfer instruction
      transaction.add(
        createTransferCheckedInstruction(
          senderTokenAccount,
          WCT_MINT_ADDRESS,
          recipientTokenAccount,
          publicKey,
          BigInt(tokenAmount),
          tokenDecimals
        )
      );
      
      // Note: In a real application, you would call your custom transfer_with_fee instruction here
      // This would require building a custom instruction for your Solana program
      
      // Send the transaction
      const signature = await sendTransaction(transaction, connection);
      
      setTransactionStatus({ 
        status: 'info', 
        message: 'Transaction sent, waiting for confirmation...' 
      });
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error('Transaction failed');
      }
      
      setTransactionStatus({ 
        status: 'success', 
        message: `Transfer successful! Transaction ID: ${signature}` 
      });
      
      // Reset form
      setRecipient('');
      setAmount('');
      
    } catch (error) {
      console.error('Transaction error:', error);
      setTransactionStatus({ 
        status: 'error', 
        message: `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="transaction-
