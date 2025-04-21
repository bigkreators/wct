// File: backend/models/index.ts
import { Sequelize, DataTypes } from 'sequelize';

// Initialize Sequelize with your database connection
const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'wct_wiki',
  logging: false,
});

// User Model
const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  walletAddress: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  reputation: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0, // Starting reputation multiplier
  },
  totalContributions: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  totalPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  totalTokensEarned: {
    type: DataTypes.DECIMAL(24, 9), // High precision for token amounts
    defaultValue: 0,
  },
  joinedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  lastActiveAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

// Article Model
const Article = sequelize.define('Article', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  demandScore: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0, // Base multiplier for content demand
  },
  qualityScore: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0, // Base multiplier for content quality
  },
  totalLikes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  totalRevisions: {
    type: DataTypes.INTEGER,
    defaultValue: 1, // Initial creation counts as first revision
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

// Contribution Model (tracks edits, reviews, etc.)
const Contribution = sequelize.define('Contribution', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  type: {
    type: DataTypes.ENUM('creation', 'major_edit', 'minor_edit', 'review'),
    allowNull: false,
  },
  basePoints: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Base points awarded for this contribution type',
  },
  qualityMultiplier: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0,
    comment: 'Multiplier based on content quality (0.5 to 3.0)',
  },
  reputationMultiplier: {
    type: DataTypes.FLOAT,
    allowNull: false, 
    comment: 'User reputation multiplier at time of contribution (0.8 to 1.5)',
  },
  demandMultiplier: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0,
    comment: 'Multiplier based on content demand (1.0 to 2.5)',
  },
  totalPoints: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Total points after applying all multipliers',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Description of the contribution',
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

// Like/Upvote Model
const Like = sequelize.define('Like', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

// Weekly Reward Distribution Model
const WeeklyReward = sequelize.define('WeeklyReward', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  weekStartDate: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  weekEndDate: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  totalPoints: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  totalTokens: {
    type: DataTypes.DECIMAL(24, 9),
    allowNull: false,
  },
  pointToTokenRatio: {
    type: DataTypes.DECIMAL(24, 9),
    allowNull: false,
    comment: 'How many tokens awarded per point for this week',
  },
  distributionTxHash: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Blockchain transaction hash for this reward distribution',
  },
  distributedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    allowNull: false,
    defaultValue: 'pending',
  },
});

// UserReward Model (individual reward records)
const UserReward = sequelize.define('UserReward', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  points: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tokens: {
    type: DataTypes.DECIMAL(24, 9),
    allowNull: false,
  },
  txHash: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Individual transaction hash for this user reward',
  },
});

// Define relationships
User.hasMany(Contribution);
Contribution.belongsTo(User);

Article.hasMany(Contribution);
Contribution.belongsTo(Article);

User.hasMany(Like);
Like.belongsTo(User);

Article.hasMany(Like);
Like.belongsTo(Article);

WeeklyReward.hasMany(UserReward);
UserReward.belongsTo(WeeklyReward);

User.hasMany(UserReward);
UserReward.belongsTo(User);

// Create tag-related models for categorization
const Tag = sequelize.define('Tag', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  demandMultiplier: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0,
    comment: 'Demand multiplier for this topic/tag',
  },
});

const ArticleTag = sequelize.define('ArticleTag', {});

// Many-to-many relationship between Articles and Tags
Article.belongsToMany(Tag, { through: ArticleTag });
Tag.belongsToMany(Article, { through: ArticleTag });

// Function to sync all models with the database
async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    // Sync all models 
    // Note: In production, use { force: false } or migrations
    await sequelize.sync({ force: true });
    console.log('All models synchronized with database.');
    
    // Create initial tags with demand multipliers
    await Tag.bulkCreate([
      { name: 'blockchain', demandMultiplier: 2.0 },
      { name: 'defi', demandMultiplier: 1.8 },
      { name: 'nft', demandMultiplier: 1.5 },
      { name: 'web3', demandMultiplier: 1.7 },
      { name: 'dao', demandMultiplier: 1.6 },
      { name: 'gaming', demandMultiplier: 1.3 },
      { name: 'metaverse', demandMultiplier: 1.4 },
      { name: 'solana', demandMultiplier: 2.2 },
      { name: 'tokenomics', demandMultiplier: 1.9 },
    ]);
    console.log('Initial tags created.');
    
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
}

// Export models and database connection
export {
  sequelize,
  User,
  Article,
  Contribution,
  Like,
  WeeklyReward,
  UserReward,
  Tag,
  ArticleTag,
  syncDatabase,
};

// File: backend/services/contribution-service.ts
import { User, Article, Contribution, Tag } from '../models';

// Service for handling contribution logic
class ContributionService {
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
    // Get base points based on contribution type
    let basePoints: number;
    switch (contributionType) {
      case 'creation':
        basePoints = Math.floor(Math.random() * (200 - 50 + 1) + 50); // 50-200 base points
        break;
      case 'major_edit':
        basePoints = Math.floor(Math.random() * (100 - 20 + 1) + 20); // 20-100 base points
        break;
      case 'minor_edit':
        basePoints = Math.floor(Math.random() * (20 - 5 + 1) + 5); // 5-20 base points
        break;
      case 'review':
        basePoints = Math.floor(Math.random() * (50 - 10 + 1) + 10); // 10-50 base points
        break;
      default:
        basePoints = 10;
    }
    
    // Get user's reputation multiplier
    const user = await User.findByPk(userId);
    const reputationMultiplier = user ? user.reputation : 1.0;
    
    // Determine quality multiplier (simplified for now)
    // In a real application, this would involve more sophisticated content analysis
    const qualityMultiplier = 1.0; // Default multiplier
    
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
    
    return contribution;
  }
}

export default new ContributionService();

// File: backend/api/routes/contribution-routes.ts
import express from 'express';
import contributionService from '../../services/contribution-service';
import { User, Article, Contribution } from '../../models';
import { authMiddleware } from '../middleware/auth-middleware';

const router = express.Router();

// Middleware to authenticate requests
router.use(authMiddleware);

// Create a new article contribution
router.post('/article', async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.user.id; // From auth middleware
    
    // Validate input
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    
    // Generate slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-');
    
    // Create the article
    const article = await Article.create({
      title,
      slug,
      content
    });
    
    // Add tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const tagObjects = await Promise.all(
        tags.map(async (tagName) => {
          const [tag] = await Tag.findOrCreate({
            where: { name: tagName.toLowerCase() }
          });
          return tag;
        })
      );
      await article.setTags(tagObjects);
    }
    
    // Record the contribution
    const contribution = await contributionService.recordContribution(
      userId,
      article.id,
      'creation',
      `Created article: ${title}`,
      tags
    );
    
    res.status(201).json({
      article,
      contribution,
      message: `Article created successfully. Earned ${contribution.totalPoints} points.`
    });
  } catch (error) {
    console.error('Error creating article:', error);
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// Record an edit to an existing article
router.post('/edit/:articleId', async (req, res) => {
  try {
    const { content, editType, description, tags } = req.body;
    const { articleId } = req.params;
    const userId = req.user.id; // From auth middleware
    
    // Validate input
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Check if article exists
    const article = await Article.findByPk(articleId);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Update the article content
    await article.update({ content, updatedAt: new Date() });
    
    // Update tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      const tagObjects = await Promise.all(
        tags.map(async (tagName) => {
          const [tag] = await Tag.findOrCreate({
            where: { name: tagName.toLowerCase() }
          });
          return tag;
        })
      );
      await article.setTags(tagObjects);
    }
    
    // Determine edit type
    const contributionType = editType === 'major' ? 'major_edit' : 'minor_edit';
    
    // Record the contribution
    const contribution = await contributionService.recordContribution(
      userId,
      articleId,
      contributionType,
      description || `Edited article: ${article.title}`,
      tags
    );
    
    res.status(200).json({
      contribution,
      message: `Article edited successfully. Earned ${contribution.totalPoints} points.`
    });
  } catch (error) {
    console.error('Error editing article:', error);
    res.status(500).json({ error: 'Failed to edit article' });
  }
});

// Record a peer review
router.post('/review/:articleId', async (req, res) => {
  try {
    const { reviewContent, tags } = req.body;
    const { articleId } = req.params;
    const userId = req.user.id; // From auth middleware
    
    // Validate input
    if (!reviewContent) {
      return res.status(400).json({ error: 'Review content is required' });
    }
    
    // Check if article exists
    const article = await Article.findByPk(articleId);
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Record the review contribution
    const contribution = await contributionService.recordContribution(
      userId,
      articleId,
      'review',
      `Reviewed article: ${article.title}`,
      tags
    );
    
    res.status(200).json({
      contribution,
      message: `Review recorded successfully. Earned ${contribution.totalPoints} points.`
    });
  } catch (error) {
    console.error('Error recording review:', error);
    res.status(500).json({ error: 'Failed to record review' });
  }
});

// Get user's contribution history
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    
    // Get contributions with pagination
    const { count, rows } = await Contribution.findAndCountAll({
      where: { userId },
      include: [
        {
          model: Article,
          attributes: ['id', 'title', 'slug']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    
    // Get user stats
    const user = await User.findByPk(userId, {
      attributes: ['id', 'username', 'reputation', 'totalContributions', 'totalPoints', 'totalTokensEarned']
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json({
      user,
      contributions: rows,
      pagination: {
        total: count,
        pages: Math.ceil(count / limit),
        page,
        limit
      }
    });
  } catch (error) {
    console.error('Error fetching user contributions:', error);
    res.status(500).json({ error: 'Failed to fetch contributions' });
  }
});

export default router;

// File: backend/api/index.ts
import express from 'express';
import cors from 'cors';
import contributionRoutes from './routes/contribution-routes';
// Import other routes as needed

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/contributions', contributionRoutes);
// Add other routes here

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
