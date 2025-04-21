// File: frontend/src/components/ContributionDashboard.tsx
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import axios from 'axios';

interface ContributionStats {
  totalContributions: number;
  totalPoints: number;
  totalTokensEarned: number;
  reputation: number;
}

interface Contribution {
  id: string;
  type: 'creation' | 'major_edit' | 'minor_edit' | 'review';
  basePoints: number;
  qualityMultiplier: number;
  reputationMultiplier: number;
  demandMultiplier: number;
  totalPoints: number;
  description: string;
  createdAt: string;
  article: {
    id: string;
    title: string;
    slug: string;
  };
}

const ContributionDashboard: React.FC = () => {
  const { publicKey } = useWallet();
  const [stats, setStats] = useState<ContributionStats | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Example API base URL - would be your actual API endpoint
  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

  useEffect(() => {
    const fetchUserData = async () => {
      if (!publicKey) {
        setStats(null);
        setContributions([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // In a real app, you'd get the user ID from the authentication system
        // For now, we'll use the wallet address as user ID
        const userId = publicKey.toString();
        
        const response = await axios.get(`${API_BASE_URL}/contributions/user/${userId}`);
        
        setStats({
          totalContributions: response.data.user.totalContributions,
          totalPoints: response.data.user.totalPoints,
          totalTokensEarned: response.data.user.totalTokensEarned,
          reputation: response.data.user.reputation,
        });
        
        setContributions(response.data.contributions);
        
      } catch (err) {
        console.error('Error fetching user data:', err);
        setError('Failed to load your contribution data. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
    
    // Refresh data periodically
    const intervalId = setInterval(fetchUserData, 60000);
    return () => clearInterval(intervalId);
  }, [publicKey, API_BASE_URL]);

  const getContributionTypeLabel = (type: string): string => {
    switch (type) {
      case 'creation':
        return 'New Article';
      case 'major_edit':
        return 'Major Edit';
      case 'minor_edit':
        return 'Minor Edit';
      case 'review':
        return 'Peer Review';
      default:
        return type;
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  if (!publicKey) {
    return (
      <div className="contribution-placeholder">
        <p>Connect your wallet to view your contribution stats and earnings.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="contribution-loading">
        <p>Loading your contribution data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="contribution-error">
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="contribution-dashboard">
      <h2>Your Contribution Stats</h2>
      
      {stats && (
        <div className="stats-container">
          <div className="stat-card">
            <h3>Contributions</h3>
            <p className="stat-value">{stats.totalContributions}</p>
          </div>
          
          <div className="stat-card">
            <h3>Total Points</h3>
            <p className="stat-value">{stats.totalPoints}</p>
          </div>
          
          <div className="stat-card">
            <h3>WCT Earned</h3>
            <p className="stat-value">{stats.totalTokensEarned.toFixed(2)}</p>
          </div>
          
          <div className="stat-card">
            <h3>Reputation</h3>
            <p className="stat-value">{stats.reputation.toFixed(2)}x</p>
            <p className="stat-description">Your contribution multiplier</p>
          </div>
        </div>
      )}
      
      <div className="projected-rewards">
        <h3>Projected Weekly Rewards</h3>
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${Math.min((stats?.totalPoints || 0) % 100, 100)}%` }}></div>
        </div>
        <p>Estimated WCT reward: {((stats?.totalPoints || 0) * 0.05).toFixed(2)} WCT</p>
        <p className="reward-note">Rewards are distributed weekly based on your points and the total community activity</p>
      </div>
      
      <div className="recent-contributions">
        <h3>Recent Contributions</h3>
        
        {contributions.length === 0 ? (
          <p>You haven't made any contributions yet. Start contributing to earn WCT!</p>
        ) : (
          <table className="contributions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Article</th>
                <th>Type</th>
                <th>Base Points</th>
                <th>Multipliers</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((contribution) => (
                <tr key={contribution.id}>
                  <td>{formatDate(contribution.createdAt)}</td>
                  <td>
                    <a href={`/wiki/${contribution.article.slug}`}>
                      {contribution.article.title}
                    </a>
                  </td>
                  <td>{getContributionTypeLabel(contribution.type)}</td>
                  <td>{contribution.basePoints}</td>
                  <td>
                    <div className="multipliers">
                      <span title="Quality">Q: {contribution.qualityMultiplier.toFixed(2)}x</span>
                      <span title="Reputation">R: {contribution.reputationMultiplier.toFixed(2)}x</span>
                      <span title="Demand">D: {contribution.demandMultiplier.toFixed(2)}x</span>
                    </div>
                  </td>
                  <td className="points-cell">{contribution.totalPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      <div className="contribution-info">
        <h3>How to Earn More WCT</h3>
        <ul>
          <li><strong>Create new articles:</strong> 50-200 base points</li>
          <li><strong>Make major edits:</strong> 20-100 base points</li>
          <li><strong>Make minor edits:</strong> 5-20 base points</li>
          <li><strong>Write peer reviews:</strong> 10-50 base points</li>
          <li><strong>Increase your reputation:</strong> Consistent quality contributions improve your multiplier</li>
          <li><strong>Focus on in-demand topics:</strong> Topics with higher demand multipliers earn more points</li>
        </ul>
      </div>
    </div>
  );
};

// File: frontend/src/components/StakingPreview.tsx
import React from 'react';

const StakingPreview: React.FC = () => {
  return (
    <div className="staking-preview">
      <h2>Staking Coming Soon</h2>
      <p>
        Stake your WCT tokens to earn additional benefits in Phase 2:
      </p>
      
      <div className="staking-benefits">
        <div className="benefit-card">
          <h3>Enhanced Reputation</h3>
          <p>Boost your contribution multiplier by up to 50%</p>
        </div>
        
        <div className="benefit-card">
          <h3>Governance Power</h3>
          <p>Vote on platform decisions and treasury allocations</p>
        </div>
        
        <div className="benefit-card">
          <h3>Fee Sharing</h3>
          <p>Earn 30% of all transaction fees generated on the platform</p>
        </div>
        
        <div className="benefit-card">
          <h3>Tiered Rewards</h3>
          <p>Longer staking periods (30/90/180/365 days) offer increased rewards</p>
        </div>
      </div>
      
      <div className="staking-progress">
        <h3>Development Progress</h3>
        <div className="progress-container">
          <div className="progress-bar" style={{ width: '35%' }}></div>
        </div>
        <p className="progress-label">35% Complete - Estimated Launch: Month 3</p>
      </div>
    </div>
  );
};

// Let's add the CSS for these components
// File: frontend/src/styles/dashboard.css
/*
 * Contribution Dashboard Styles
 */
.contribution-dashboard {
  padding: 1.5rem;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
}

.stats-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  background-color: #f5f7ff;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: bold;
  margin: 0.5rem 0;
  color: #3f51b5;
}

.stat-description {
  font-size: 0.85rem;
  color: #666666;
  margin-top: 0;
}

.projected-rewards {
  background-color: #e8f5e9;
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 2rem;
}

.progress-container {
  width: 100%;
  height: 12px;
  background-color: #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  margin: 1rem 0;
}

.progress-bar {
  height: 100%;
  background-color: #4caf50;
  transition: width 0.3s ease-in-out;
}

.reward-note {
  font-size: 0.85rem;
  color: #666666;
  margin-top: 0.5rem;
}

.recent-contributions {
  margin-bottom: 2rem;
}

.contributions-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

.contributions-table th,
.contributions-table td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #e0e0e0;
}

.contributions-table th {
  background-color: #f5f5f5;
  font-weight: 500;
}

.multipliers {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.points-cell {
  font-weight: bold;
  color: #3f51b5;
}

.contribution-info {
  background-color: #f5f7ff;
  border-radius: 8px;
  padding: 1.25rem;
}

.contribution-info ul {
  padding-left: 1.5rem;
  margin-top: 0.5rem;
}

.contribution-info li {
  margin-bottom: 0.5rem;
}

.contribution-placeholder,
.contribution-loading,
.contribution-error {
  padding: 2rem;
  text-align: center;
  background-color: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 2rem;
}

.contribution-error {
  background-color: #ffebee;
  color: #c62828;
}

/* Staking Preview Styles */
.staking-preview {
  padding: 1.5rem;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.staking-benefits {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}

.benefit-card {
  background-color: #f0f4c3;
  border-radius: 8px;
  padding: 1rem;
  transition: transform 0.2s;
}

.benefit-card:hover {
  transform: translateY(-5px);
}

.benefit-card h3 {
  margin-top: 0;
  color: #558b2f;
}

.staking-progress {
  background-color: #e0f7fa;
  border-radius: 8px;
  padding: 1.25rem;
  margin-top: 1.5rem;
}

.staking-progress .progress-bar {
  background-color: #00acc1;
}

.progress-label {
  text-align: center;
  font-weight: 500;
  margin-top: 0.5rem;
  color: #00838f;
}

// Now update the App.tsx to include these components
// File: frontend/src/App.tsx (updated)
import React from 'react';
import WalletConnection from './components/WalletConnection';
import TransactionForm from './components/TransactionForm';
import ContributionDashboard from './components/ContributionDashboard';
import StakingPreview from './components/StakingPreview';
import './App.css';
import './styles/dashboard.css';

const App: React.FC = () => {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Wiki Contribution Token (WCT)</h1>
        <p>A Solana-based token reward system for wiki contributions</p>
      </header>
      
      <main className="app-main">
        <div className="left-column">
          <section className="wallet-section">
            <WalletConnection />
          </section>
          
          <section className="dashboard-section">
            <ContributionDashboard />
          </section>
        </div>
        
        <div className="right-column">
          <section className="transaction-section">
            <TransactionForm />
          </section>
          
          <section className="staking-section">
            <StakingPreview />
          </section>
        </div>
      </main>
      
      <footer className="app-footer">
        <p>&copy; 2025 Big Kreators. All rights reserved.</p>
        <p className="license-note">Released under the MIT License</p>
      </footer>
    </div>
  );
};

export default App;

// Update App.css for the new layout
// File: frontend/src/App.css (updated)
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

@media (min-width: 992px) {
  .app-main {
    grid-template-columns: 3fr 2fr;
  }
}

.left-column, .right-column {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.wallet-section,
.transaction-section,
.dashboard-section,
.staking-section {
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.app-footer {
  margin-top: 3rem;
  text-align: center;
  color: #666666;
  font-size: 0.9rem;
}

.license-note {
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: #888888;
}
