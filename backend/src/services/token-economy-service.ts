// File: backend/services/token-economy-service.ts
import { User, Article, Contribution, WeeklyReward, UserReward, Tag } from '../models';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import axios from 'axios';
import { Op } from 'sequelize';
import * as anchor from '@project-serum/anchor';
import { logger } from '../utils/logger';

// Set environment variables and constants
const WCT_PROGRAM_ID = new PublicKey(process.env.WCT_PROGRAM_ID || '');
const WCT_MINT_ADDRESS = new PublicKey(process.env.WCT_MINT_ADDRESS || '');
const TREASURY_WALLET = new PublicKey(process.env.TREASURY_WALLET || '');
const TOKEN_DECIMALS = 9; // 9 decimals for the token
const WEEKLY_REWARD_POOL = 200000; // 200k tokens per week (adjust as needed)
const MIN_TOKENS_PER_USER = 10; // Minimum token reward per user

interface TokenDistributionResult {
  success: boolean;
  totalUsers: number;
  totalTokens: number;
  totalPoints: number;
  weekStartDate: Date;
  weekEndDate: Date;
  successfulTransactions: number;
  failedTransactions: number;
  errorMessage?: string;
}

interface UserRewardData {
  userId: string;
  walletAddress: string;
  points: number;
  tokenAmount: number;
}

/**
 * Service for handling the token economy including points calculations, 
 * rewards distribution, and blockchain interactions.
 */
class TokenEconomyService {
  /**
   * Calculate points for a contribution based on multiple factors
   */
  async calculatePoints(
    contributionType: 'creation' | 'major_edit' | 'minor_edit' | 'review',
    userId: string,
    articleId?: string,
    tags?: string[]
  ): Promise<{ 
    basePoints: number; 
    qualityMultiplier: number;
    reputationMultiplier: number;
    demandMultiplier: number;
    totalPoints: number;
  }> {
    // Get base points range based on contribution type
    let basePointsRange: { min: number; max: number };
    switch (contributionType) {
      case 'creation':
        basePointsRange = { min: 50, max: 200 };
        break;
      case 'major_edit':
        basePointsRange = { min: 20, max: 100 };
        break;
      case 'minor_edit':
        basePointsRange = { min: 5, max: 20 };
        break;
      case 'review':
        basePointsRange = { min: 10, max: 50 };
        break;
      default:
        basePointsRange = { min: 10, max: 20 };
    }
    
    // Calculate base points (within defined range)
    const basePoints = Math.floor(
      basePointsRange.min + Math.random() * (basePointsRange.max - basePointsRange.min + 1)
    );
    
    // Get user's reputation multiplier
    const user = await User.findByPk(userId);
    const reputationMultiplier = user ? user.reputation : 1.0;
    
    // Determine quality multiplier
    // In a real application, this would involve NLP and quality analysis
    // For now, we'll use a simplified random approach
    // Quality ranges from 0.5 to 3.0
    const qualityMultiplier = parseFloat((0.5 + Math.random() * 2.5).toFixed(2));
    
    // Calculate demand multiplier based on tags
    let demandMultiplier = 1.0;
    
    if (tags && tags.length > 0) {
      const tagObjects = await Tag.findAll({
        where: {
          name: tags
        }
      });
      
      if (tagObjects.length > 0) {
        // Average the demand multipliers of all associated tags
        demandMultiplier = tagObjects.reduce((sum, tag) => sum + tag.demandMultiplier, 0) / tagObjects.length;
      }
    } else if (articleId) {
      // If no tags provided but articleId exists, get tags from article
      const article = await Article.findByPk(articleId, {
        include: [Tag]
      });
      
      if (article && article.Tags && article.Tags.length > 0) {
        demandMultiplier = article.Tags.reduce((sum, tag) => sum + tag.demandMultiplier, 0) / article.Tags.length;
      }
    }
    
    // Calculate total points
    const totalPoints = Math.floor(
      basePoints * qualityMultiplier * reputationMultiplier * demandMultiplier
    );
    
    return {
      basePoints,
      qualityMultiplier,
      reputationMultiplier,
      demandMultiplier,
      totalPoints
    };
  }
  
  /**
   * Record a new contribution and update user and article statistics
   */
  async recordContribution(
    userId: string,
    articleId: string,
    contributionType: 'creation' | 'major_edit' | 'minor_edit' | 'review',
    description?: string,
    tags?: string[]
  ): Promise<Contribution> {
    // Calculate points for this contribution
    const pointsData = await this.calculatePoints(contributionType, userId, articleId, tags);
    
    // Create contribution record
    const contribution = await Contribution.create({
      userId,
      articleId,
      type: contributionType,
      basePoints: pointsData.basePoints,
      qualityMultiplier: pointsData.qualityMultiplier,
      reputationMultiplier: pointsData.reputationMultiplier,
      demandMultiplier: pointsData.demandMultiplier,
      totalPoints: pointsData.totalPoints,
      description
    });
    
    // Update user stats
    await User.increment(
      { totalContributions: 1, totalPoints: pointsData.totalPoints },
      { where: { id: userId } }
    );
    
    // Update user's last active timestamp
    await User.update(
      { lastActiveAt: new Date() },
      { where: { id: userId } }
    );
    
    // Update article stats if it's an edit
    if (contributionType !== 'creation') {
      await Article.increment(
        { totalRevisions: 1 },
        { where: { id: articleId } }
      );
    }
    
    // Update article quality score based on contribution
    // This is a simplified approach - in a real system, this would be more sophisticated
    if (contributionType === 'creation' || contributionType === 'major_edit') {
      await Article.update(
        { 
          qualityScore: pointsData.qualityMultiplier,
          updatedAt: new Date()
        },
        { where: { id: articleId } }
      );
    }
    
    return contribution;
  }

  /**
   * Calculate rewards for users based on their contributions in a given period
   */
  async calculateWeeklyRewards(
    startDate: Date,
    endDate: Date
  ): Promise<UserRewardData[]> {
    try {
      // Get all contributions within the date range
      const contributions = await Contribution.findAll({
        where: {
          createdAt: {
            [Op.between]: [startDate, endDate]
          }
        },
        include: [
          {
            model: User,
            attributes: ['id', 'walletAddress', 'username']
          }
        ]
      });
      
      // Calculate total points and group by user
      const userPointsMap = new Map<string, { points: number; walletAddress: string }>();
      
      contributions.forEach(contribution => {
        const userId = contribution.userId;
        const walletAddress = contribution.User.walletAddress;
        
        if (!userPointsMap.has(userId)) {
          userPointsMap.set(userId, { points: 0, walletAddress });
        }
        
        const userData = userPointsMap.get(userId)!;
        userData.points += contribution.totalPoints;
        userPointsMap.set(userId, userData);
      });
      
      // Calculate total points
      const totalPoints = Array.from(userPointsMap.values()).reduce(
        (sum, userData) => sum + userData.points, 
        0
      );
      
      // If no points, return empty array
      if (totalPoints === 0) {
        return [];
      }
      
      // Calculate token distribution
      const pointToTokenRatio = WEEKLY_REWARD_POOL / totalPoints;
      
      // Calculate tokens for each user
      const userRewards: UserRewardData[] = Array.from(userPointsMap.entries()).map(
        ([userId, userData]) => ({
          userId,
          walletAddress: userData.walletAddress,
          points: userData.points,
          // Ensure minimum token amount
          tokenAmount: Math.max(
            Math.floor(userData.points * pointToTokenRatio), 
            MIN_TOKENS_PER_USER
          )
        })
      );
      
      return userRewards;
    } catch (error) {
      logger.error('Error calculating weekly rewards:', error);
      throw error;
    }
  }

  /**
   * Distribute rewards for users based on their contributions
   */
  async distributeWeeklyRewards(
    startDate: Date,
    endDate: Date
  ): Promise<TokenDistributionResult> {
    try {
      // Calculate rewards
      const userRewards = await this.calculateWeeklyRewards(startDate, endDate);
      
      if (userRewards.length === 0) {
        return {
          success: true,
          totalUsers: 0,
          totalTokens: 0,
          totalPoints: 0,
          weekStartDate: startDate,
          weekEndDate: endDate,
          successfulTransactions: 0,
          failedTransactions: 0
        };
      }
      
      // Create weekly reward record in database
      const totalTokens = userRewards.reduce((sum, reward) => sum + reward.tokenAmount, 0);
      const totalPoints = userRewards.reduce((sum, reward) => sum + reward.points, 0);
      
      const weeklyReward = await WeeklyReward.create({
        weekStartDate: startDate,
        weekEndDate: endDate,
        totalPoints,
        totalTokens,
        pointToTokenRatio: WEEKLY_REWARD_POOL / totalPoints,
        status: 'processing'
      });
      
      // Connect to Solana
      const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');
      
      // Load the payer keypair (from environment or file)
      const payerSecretKey = Uint8Array.from(
        JSON.parse(process.env.TREASURY_KEYPAIR || '[]')
      );
      const payer = anchor.web3.Keypair.fromSecretKey(payerSecretKey);
      
      // Successul and failed transactions counters
      let successfulTransactions = 0;
      let failedTransactions = 0;
      
      // Process rewards for each user
      for (const reward of userRewards) {
        try {
          if (!reward.walletAddress) {
            logger.warn(`User ${reward.userId} has no wallet address, skipping reward`);
            failedTransactions++;
            continue;
          }
          
          const recipientWallet = new PublicKey(reward.walletAddress);
          const tokenAmount = reward.tokenAmount * Math.pow(10, TOKEN_DECIMALS); // Scale by decimals
          
          // Get token accounts
          const treasuryTokenAccount = await getAssociatedTokenAddress(
            WCT_MINT_ADDRESS,
            TREASURY_WALLET,
            true // Allow ownerOffCurve
          );
          
          const recipientTokenAccount = await getAssociatedTokenAddress(
            WCT_MINT_ADDRESS,
            recipientWallet
          );
          
          // Create transfer instruction
          const transferIx = createTransferInstruction(
            treasuryTokenAccount,
            recipientTokenAccount,
            TREASURY_WALLET,
            BigInt(tokenAmount)
          );
          
          // Create and sign transaction
          const transaction = new Transaction().add(transferIx);
          
          // Set recent blockhash and sign transaction
          transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
          transaction.feePayer = payer.publicKey;
          
          // Sign transaction
          transaction.sign(payer);
          
          // Send transaction and confirm
          const signature = await connection.sendRawTransaction(transaction.serialize());
          await connection.confirmTransaction(signature);
          
          // Record reward in database
          await UserReward.create({
            userId: reward.userId,
            weeklyRewardId: weeklyReward.id,
            points: reward.points,
            tokens: reward.tokenAmount,
            txHash: signature
          });
          
          // Update user's total tokens earned
          await User.increment(
            { totalTokensEarned: reward.tokenAmount },
            { where: { id: reward.userId } }
          );
          
          successfulTransactions++;
          
          // Add a delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          logger.error(`Error distributing reward to user ${reward.userId}:`, error);
          
          // Record failed reward
          await UserReward.create({
            userId: reward.userId,
            weeklyRewardId: weeklyReward.id,
            points: reward.points,
            tokens: reward.tokenAmount,
            txHash: null
          });
          
          failedTransactions++;
        }
      }
      
      // Update weekly reward status
      await weeklyReward.update({
        status: successfulTransactions > 0 ? 
          failedTransactions > 0 ? 'partial' : 'completed' : 
          'failed',
        distributedAt: new Date(),
        distributionTxHash: 'batch_distribution'
      });
      
      return {
        success: successfulTransactions > 0,
        totalUsers: userRewards.length,
        totalTokens,
        totalPoints,
        weekStartDate: startDate,
        weekEndDate: endDate,
        successfulTransactions,
        failedTransactions
      };
      
    } catch (error) {
      logger.error('Error distributing weekly rewards:', error);
      
      return {
        success: false,
        totalUsers: 0,
        totalTokens: 0,
        totalPoints: 0,
        weekStartDate: startDate,
        weekEndDate: endDate,
        successfulTransactions: 0,
        failedTransactions: 0,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get pending rewards for a user
   */
  async getPendingRewardsForUser(userId: string): Promise<{
    pendingPoints: number;
    estimatedTokens: number;
    lastUpdated: Date;
  }> {
    try {
      // Get current week's contribution points for the user
      const now = new Date();
      // Start date is the beginning of the current week (Sunday 00:00:00)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      // Get all contributions for this week
      const contributions = await Contribution.findAll({
        where: {
          userId,
          createdAt: {
            [Op.gte]: startOfWeek
          }
        }
      });
      
      // Calculate pending points
      const pendingPoints = contributions.reduce(
        (sum, contribution) => sum + contribution.totalPoints, 
        0
      );
      
      // Get the latest weekly reward to estimate the point-to-token ratio
      const latestWeeklyReward = await WeeklyReward.findOne({
        order: [['createdAt', 'DESC']]
      });
      
      // Default ratio if no previous distribution
      let pointToTokenRatio = WEEKLY_REWARD_POOL / 10000; // Assume 10000 total points
      
      if (latestWeeklyReward) {
        pointToTokenRatio = latestWeeklyReward.pointToTokenRatio;
      }
      
      // Estimate tokens based on points and ratio
      const estimatedTokens = Math.max(
        Math.floor(pendingPoints * pointToTokenRatio),
        pendingPoints > 0 ? MIN_TOKENS_PER_USER : 0
      );
      
      return {
        pendingPoints,
        estimatedTokens,
        lastUpdated: now
      };
    } catch (error) {
      logger.error(`Error getting pending rewards for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get the rewards history for a user
   */
  async getUserRewardsHistory(userId: string, limit: number = 10, offset: number = 0) {
    try {
      const userRewards = await UserReward.findAndCountAll({
        where: { userId },
        include: [
          {
            model: WeeklyReward,
            attributes: ['weekStartDate', 'weekEndDate', 'status']
          }
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset
      });
      
      return {
        rewards: userRewards.rows,
        total: userRewards.count,
        limit,
        offset
      };
    } catch (error) {
      logger.error(`Error getting rewards history for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Adjust a user's reputation multiplier based on their contribution history
   * This would be run periodically to update user reputation
   */
  async updateUserReputation(userId: string): Promise<number> {
    try {
      // Get user's contribution history
      const contributions = await Contribution.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 100 // Consider the last 100 contributions
      });
      
      if (contributions.length === 0) {
        return 1.0; // Default multiplier
      }
      
      // Calculate average quality multiplier from contributions
      const avgQuality = contributions.reduce(
        (sum, contribution) => sum + contribution.qualityMultiplier, 
        0
      ) / contributions.length;
      
      // Convert this to reputation (0.8 - 1.5 range)
      // Quality multiplier ranges from 0.5 to 3.0, so we scale it
      const baseReputation = 0.8 + (avgQuality - 0.5) * (0.7 / 2.5);
      
      // Get staking reputation boost (if any)
      // In the first phase, we'll skip this and implement it in Phase 2
      // with the staking program
      const stakingBoost = 0;
      
      // Apply staking boost
      const newReputation = Math.max(
        0.8, 
        Math.min(1.5, baseReputation * (1 + stakingBoost / 100))
      );
      
      // Update user reputation
      await User.update(
        { reputation: newReputation },
        { where: { id: userId } }
      );
      
      return newReputation;
    } catch (error) {
      logger.error(`Error updating reputation for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update demand multipliers for tags based on popularity and engagement
   * This would be run periodically to adjust demand multipliers
   */
  async updateTagDemandMultipliers(): Promise<number> {
    try {
      // Get all tags with their associated articles
      const tags = await Tag.findAll({
        include: [{
          model: Article,
          through: { attributes: [] }, // Don't include junction table data
          include: [{
            model: Contribution,
            attributes: ['id', 'createdAt'],
            where: {
              createdAt: {
                [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
              }
            },
            required: false
          }]
        }]
      });
      
      let updatedTags = 0;
      
      // Calculate demand multiplier based on recent activity
      for (const tag of tags) {
        // Count recent contributions for this tag
        let totalContributions = 0;
        
        if (tag.Articles) {
          tag.Articles.forEach(article => {
            totalContributions += article.Contributions ? article.Contributions.length : 0;
          });
        }
        
        // Base demand multiplier on activity
        // The formula can be adjusted based on desired economics
        let newDemandMultiplier = 1.0;
        
        if (totalContributions > 0) {
          // Scale from 1.0 to 2.5 based on activity
          newDemandMultiplier = 1.0 + Math.min(1.5, totalContributions / 10);
        }
        
        // Update tag if the multiplier has changed significantly
        if (Math.abs(newDemandMultiplier - tag.demandMultiplier) > 0.1) {
          await tag.update({ demandMultiplier: newDemandMultiplier });
          updatedTags++;
        }
      }
      
      return updatedTags;
    } catch (error) {
      logger.error('Error updating tag demand multipliers:', error);
      throw error;
    }
  }
}

export default new TokenEconomyService();
