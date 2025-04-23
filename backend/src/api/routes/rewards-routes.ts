// File: backend/src/api/routes/rewards-routes.ts
import express from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth-middleware';
import rewardsService from '../../services/rewards-service';
import { User, WeeklyReward, UserReward } from '../../models';

const router = express.Router();

// Middleware to authenticate requests
router.use(authMiddleware);

// Calculate rewards for a date range
router.get('/calculate', adminMiddleware, async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    
    const results = await rewardsService.calculateRewards(startDate, endDate);
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Error calculating rewards:', error);
    res.status(500).json({ error: 'Failed to calculate rewards' });
  }
});

// Create a weekly reward distribution
router.post('/create-distribution', adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, totalTokens } = req.body;
    
    if (!startDate || !endDate || !totalTokens) {
      return res.status(400).json({ error: 'Start date, end date, and total tokens are required' });
    }
    
    const weeklyReward = await rewardsService.createWeeklyReward(
      new Date(startDate),
      new Date(endDate),
      parseFloat(totalTokens)
    );
    
    res.status(201).json({
      weeklyReward,
      message: 'Weekly reward distribution created successfully'
    });
  } catch (error) {
    console.error('Error creating weekly reward:', error);
    res.status(500).json({ error: 'Failed to create weekly reward' });
  }
});

// Confirm a user reward 
router.post('/confirm', adminMiddleware, async (req, res) => {
  try {
    const { userId, tokens, txHash, weekStartDate, weekEndDate } = req.body;
    
    if (!userId || !tokens || !txHash || !weekStartDate || !weekEndDate) {
      return res.status(400).json({ error: 'User ID, tokens, transaction hash, and week dates are required' });
    }
    
    // Find the weekly reward
    const weeklyReward = await WeeklyReward.findOne({
      where: {
        weekStartDate: new Date(weekStartDate),
        weekEndDate: new Date(weekEndDate)
      }
    });
    
    if (!weeklyReward) {
      return res.status(404).json({ error: 'Weekly reward distribution not found' });
    }
    
    // Process the user reward
    const userReward = await rewardsService.processUserReward(
      weeklyReward,
      userId,
      parseFloat(tokens),
      txHash
    );
    
    res.status(200).json({
      userReward,
      message: 'User reward confirmed successfully'
    });
  } catch (error) {
    console.error('Error confirming user reward:', error);
    res.status(500).json({ error: 'Failed to confirm user reward' });
  }
});

// Mark distribution as complete
router.post('/distribution-complete', adminMiddleware, async (req, res) => {
  try {
    const { weekStartDate, weekEndDate, totalTokens, totalUsers, successfulTransactions, failedTransactions } = req.body;
    
    // Find the weekly reward
    const weeklyReward = await WeeklyReward.findOne({
      where: {
        weekStartDate: new Date(weekStartDate),
        weekEndDate: new Date(weekEndDate)
      }
    });
    
    if (!weeklyReward) {
      return res.status(404).json({ error: 'Weekly reward distribution not found' });
    }
    
    // Update weekly reward status
    weeklyReward.status = successfulTransactions === totalUsers ? 'completed' : 'partial';
    await weeklyReward.save();
    
    res.status(200).json({
      weeklyReward,
      message: 'Distribution marked as complete',
      stats: {
        totalTokens,
        totalUsers,
        successfulTransactions,
        failedTransactions
      }
    });
  } catch (error) {
    console.error('Error completing distribution:', error);
    res.status(500).json({ error: 'Failed to complete distribution' });
  }
});

// Get reward statistics for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if requesting user is authorized
    if (req.user.id !== userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to view this user\'s rewards' });
    }
    
    // Get user
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get reward stats
    const rewardStats = await rewardsService.getUserRewardStats(userId);
    
    res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
        totalTokensEarned: user.totalTokensEarned
      },
      rewardStats
    });
  } catch (error) {
    console.error('Error getting user reward stats:', error);
    res.status(500).json({ error: 'Failed to get user reward stats' });
  }
});

// Get recent weekly rewards
router.get('/recent', adminMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    const weeklyRewards = await WeeklyReward.findAll({
      order: [['weekStartDate', 'DESC']],
      limit,
      include: [
        {
          model: UserReward,
          attributes: ['id', 'userId', 'points', 'tokens'],
          include: [
            {
              model: User,
              attributes: ['id', 'username', 'walletAddress']
            }
          ]
        }
      ]
    });
    
    res.status(200).json(weeklyRewards);
  } catch (error) {
    console.error('Error getting recent rewards:', error);
    res.status(500).json({ error: 'Failed to get recent rewards' });
  }
});

// Get projected rewards for current period
router.get('/projected', async (req, res) => {
  try {
    // Get current week start and end
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - (startOfWeek.getDay() === 0 ? 6 : startOfWeek.getDay() - 1));
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    // Calculate rewards
    const { users, totalPoints } = await rewardsService.calculateRewards(startOfWeek, endOfWeek);
    
    // Assume weekly token allocation (this would be configured elsewhere)
    const WEEKLY_TOKEN_ALLOCATION = 200000; // 200K tokens per week
    
    // Calculate token per point ratio
    const tokenPerPoint = totalPoints > 0 ? WEEKLY_TOKEN_ALLOCATION / totalPoints : 0;
    
    // Get current user's projected rewards
    const currentUser = users.find(user => user.userId === req.user.id);
    
    res.status(200).json({
      currentPeriod: {
        startDate: startOfWeek,
        endDate: endOfWeek,
        totalPoints,
        totalUsers: users.length,
        tokenPerPoint
      },
      userProjection: currentUser ? {
        points: currentUser.points,
        contributionCount: currentUser.contributionCount,
        projectedTokens: currentUser.points * tokenPerPoint
      } : {
        points: 0,
        contributionCount: 0,
        projectedTokens: 0
      },
      leaderboard: users
        .sort((a, b) => b.points - a.points)
        .slice(0, 10)
        .map(user => ({
          username: user.username,
          points: user.points,
          projectedTokens: user.points * tokenPerPoint
        }))
    });
  } catch (error) {
    console.error('Error getting projected rewards:', error);
    res.status(500).json({ error: 'Failed to get projected rewards' });
  }
});

export default router;
