// File: backend/src/services/rewards-service.ts
import { User, Contribution, WeeklyReward, UserReward, sequelize } from '../models';
import { Op, Transaction } from 'sequelize';

class RewardsService {
  /**
   * Calculate rewards for users based on their contributions within a date range
   */
  async calculateRewards(startDate: Date, endDate: Date): Promise<{
    users: Array<{
      userId: string;
      walletAddress: string;
      points: number;
      contributionCount: number;
    }>;
    totalPoints: number;
  }> {
    try {
      // Find all contributions in the given date range
      const contributions = await Contribution.findAll({
        where: {
          createdAt: {
            [Op.between]: [startDate, endDate]
          }
        },
        include: [
          {
            model: User,
            attributes: ['id', 'walletAddress', 'username', 'reputation']
          }
        ]
      });

      // Group contributions by user
      const userPoints: Record<string, {
        userId: string;
        walletAddress: string;
        username: string;
        points: number;
        contributionCount: number;
      }> = {};

      // Calculate points for each user
      contributions.forEach(contribution => {
        const userId = contribution.userId;
        const user = contribution.User;
        
        if (!userPoints[userId]) {
          userPoints[userId] = {
            userId,
            walletAddress: user.walletAddress,
            username: user.username,
            points: 0,
            contributionCount: 0
          };
        }
        
        userPoints[userId].points += contribution.totalPoints;
        userPoints[userId].contributionCount += 1;
      });

      // Convert to array and calculate total points
      const users = Object.values(userPoints);
      const totalPoints = users.reduce((sum, user) => sum + user.points, 0);

      return {
        users,
        totalPoints
      };
    } catch (error) {
      console.error('Error calculating rewards:', error);
      throw error;
    }
  }

  /**
   * Create a weekly reward distribution record
   */
  async createWeeklyReward(startDate: Date, endDate: Date, totalTokens: number): Promise<WeeklyReward> {
    try {
      // Calculate rewards
      const { users, totalPoints } = await this.calculateRewards(startDate, endDate);
      
      if (totalPoints === 0 || users.length === 0) {
        throw new Error('No contributions to reward for this period');
      }

      // Calculate point to token ratio
      const pointToTokenRatio = totalTokens / totalPoints;

      // Create weekly reward record
      const weeklyReward = await WeeklyReward.create({
        weekStartDate: startDate,
        weekEndDate: endDate,
        totalPoints,
        totalTokens,
        pointToTokenRatio,
        status: 'pending'
      });

      return weeklyReward;
    } catch (error) {
      console.error('Error creating weekly reward:', error);
      throw error;
    }
  }

  /**
   * Process reward distribution for a user
   */
  async processUserReward(
    weeklyReward: WeeklyReward,
    userId: string,
    tokens: number,
    txHash: string
  ): Promise<UserReward> {
    // Calculate points based on tokens and ratio
    const points = Math.round(tokens / weeklyReward.pointToTokenRatio);

    try {
      // Create user reward record
      const userReward = await UserReward.create({
        userId,
        weeklyRewardId: weeklyReward.id,
        points,
        tokens,
        txHash
      });

      // Update user's total tokens earned
      await User.increment(
        { totalTokensEarned: tokens },
        { where: { id: userId } }
      );

      return userReward;
    } catch (error) {
      console.error('Error processing user reward:', error);
      throw error;
    }
  }

  /**
   * Mark a weekly reward distribution as completed
   */
  async completeDistribution(weeklyRewardId: string, txHash: string): Promise<WeeklyReward> {
    try {
      const weeklyReward = await WeeklyReward.findByPk(weeklyRewardId);
      
      if (!weeklyReward) {
        throw new Error('Weekly reward not found');
      }

      weeklyReward.distributionTxHash = txHash;
      weeklyReward.distributedAt = new Date();
      weeklyReward.status = 'completed';
      
      await weeklyReward.save();
      
      return weeklyReward;
    } catch (error) {
      console.error('Error completing distribution:', error);
      throw error;
    }
  }

  /**
   * Get reward statistics for a user
   */
  async getUserRewardStats(userId: string): Promise<{
    totalEarned: number;
    weeklyAverage: number;
    lastWeekEarned: number;
    rewardsHistory: Array<{
      weekStartDate: Date;
      weekEndDate: Date;
      points: number;
      tokens: number;
    }>;
  }> {
    try {
      // Get user rewards
      const userRewards = await UserReward.findAll({
        where: { userId },
        include: [
          {
            model: WeeklyReward,
            attributes: ['weekStartDate', 'weekEndDate']
          }
        ],
        order: [[sequelize.col('WeeklyReward.weekStartDate'), 'DESC']]
      });

      const totalEarned = userRewards.reduce((sum, reward) => sum + Number(reward.tokens), 0);
      const weeklyAverage = userRewards.length > 0 ? totalEarned / userRewards.length : 0;
      const lastWeekEarned = userRewards.length > 0 ? Number(userRewards[0].tokens) : 0;

      const rewardsHistory = userRewards.map(reward => ({
        weekStartDate: reward.WeeklyReward.weekStartDate,
        weekEndDate: reward.WeeklyReward.weekEndDate,
        points: reward.points,
        tokens: Number(reward.tokens)
      }));

      return {
        totalEarned,
        weeklyAverage,
        lastWeekEarned,
        rewardsHistory
      };
    } catch (error) {
      console.error('Error getting user reward stats:', error);
      throw error;
    }
  }
}

export default new RewardsService();
