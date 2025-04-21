#!/bin/bash
# WCT Project Setup and Deployment Script
# This script sets up the development environment for the Wiki Contribution Token project

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print section headers
print_section() {
  echo -e "\n${YELLOW}==============================================${NC}"
  echo -e "${YELLOW}$1${NC}"
  echo -e "${YELLOW}==============================================${NC}\n"
}

# Function to check if a command was successful
check_success() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Success${NC}"
  else
    echo -e "${RED}✗ Failed${NC}"
    exit 1
  fi
}

# Welcome message
print_section "Wiki Contribution Token (WCT) Project Setup"
echo "This script will set up your development environment for the WCT project."
echo "It will install dependencies, configure the blockchain environment,"
echo "and set up both the backend and frontend applications."
echo -e "\nPress Enter to continue or Ctrl+C to cancel..."
read

# Check for required tools
print_section "Checking Required Tools"

echo -n "Checking for Node.js... "
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v)
  echo -e "${GREEN}Found Node.js $NODE_VERSION${NC}"
else
  echo -e "${RED}Node.js not found. Please install Node.js v16 or newer.${NC}"
  exit 1
fi

echo -n "Checking for npm... "
if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm -v)
  echo -e "${GREEN}Found npm $NPM_VERSION${NC}"
else
  echo -e "${RED}npm not found. Please install npm.${NC}"
  exit 1
fi

echo -n "Checking for Rust and Cargo... "
if command -v cargo &> /dev/null; then
  RUST_VERSION=$(rustc --version)
  echo -e "${GREEN}Found $RUST_VERSION${NC}"
else
  echo -e "${RED}Rust not found. Installing Rust...${NC}"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source $HOME/.cargo/env
  check_success
fi

echo -n "Checking for Solana CLI... "
if command -v solana &> /dev/null; then
  SOLANA_VERSION=$(solana --version)
  echo -e "${GREEN}Found $SOLANA_VERSION${NC}"
else
  echo -e "${YELLOW}Solana CLI not found. Installing Solana...${NC}"
  sh -c "$(curl -sSfL https://release.solana.com/v1.14.17/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
  check_success
fi

echo -n "Checking for Anchor CLI... "
if command -v anchor &> /dev/null; then
  ANCHOR_VERSION=$(anchor --version)
  echo -e "${GREEN}Found $ANCHOR_VERSION${NC}"
else
  echo -e "${YELLOW}Anchor CLI not found. Installing Anchor...${NC}"
  cargo install --git https://github.com/coral-xyz/anchor avm --locked
  avm install latest
  avm use latest
  check_success
fi

# Create project directory structure
print_section "Creating Project Directory Structure"

mkdir -p wct-project/{programs/wct-token/src,app/{backend,frontend},scripts,tests}
check_success

cd wct-project

# Initialize Anchor project
print_section "Initializing Anchor Project"

anchor init --no-git .
check_success

# Create Solana wallet for development
print_section "Setting up Solana Development Environment"

echo -n "Configuring Solana for local development... "
solana config set --url localhost
check_success

echo -n "Generating a new Solana keypair for development... "
solana-keygen new --no-bip39-passphrase -o ./keypair.json
check_success

echo -n "Setting this keypair as default... "
solana config set -k ./keypair.json
check_success

# Create package.json for the project root
cat > package.json << EOF
{
  "name": "wct-project",
  "version": "0.1.0",
  "description": "Wiki Contribution Token - A Solana-based token reward system for wiki contributions",
  "scripts": {
    "start:validator": "solana-test-validator",
    "start:backend": "cd app/backend && npm run start",
    "start:frontend": "cd app/frontend && npm run start",
    "build:program": "anchor build",
    "deploy:program": "anchor deploy",
    "test:program": "anchor test",
    "setup:all": "npm run setup:backend && npm run setup:frontend",
    "setup:backend": "cd app/backend && npm install",
    "setup:frontend": "cd app/frontend && npm install",
    "dev": "concurrently \"npm run start:validator\" \"npm run start:backend\" \"npm run start:frontend\""
  },
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "concurrently": "^8.0.1"
  }
}
EOF
check_success

# Set up backend
print_section "Setting up Backend"

cd app/backend

# Initialize backend package.json
cat > package.json << EOF
{
  "name": "wct-backend",
  "version": "0.1.0",
  "description": "Backend API for Wiki Contribution Token",
  "main": "index.js",
  "scripts": {
    "start": "ts-node src/index.ts",
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "migrate": "sequelize-cli db:migrate",
    "test": "jest"
  },
  "dependencies": {
    "@solana/spl-token": "^0.3.7",
    "@solana/web3.js": "^1.75.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.0",
    "pg": "^8.10.0",
    "pg-hstore": "^2.3.4",
    "sequelize": "^6.31.0",
    "winston": "^3.8.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.13",
    "@types/express": "^4.17.17",
    "@types/jsonwebtoken": "^9.0.1",
    "@types/node": "^18.15.11",
    "jest": "^29.5.0",
    "nodemon": "^2.0.22",
    "sequelize-cli": "^6.6.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.1",
    "typescript": "^5.0.4"
  }
}
EOF
check_success

# Create basic directory structure for backend
mkdir -p src/{models,services,api/{routes,middleware},utils,config}

# Create .env file for backend
cat > .env << EOF
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=wct_wiki

# JWT Secret for authentication
JWT_SECRET=your_jwt_secret_for_development

# Solana Configuration
SOLANA_RPC_URL=http://localhost:8899
WCT_PROGRAM_ID=your_program_id_after_deployment
WCT_MINT_ADDRESS=your_mint_address_after_deployment

# Server Configuration
PORT=3000
NODE_ENV=development
EOF
check_success

# Create tsconfig.json for backend
cat > tsconfig.json << EOF
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "lib": ["es2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
EOF
check_success

# Create a simple index.ts file to start the server
cat > src/index.ts << EOF
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sequelize } from './models';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes will be imported here
// app.use('/api/route', routeImport);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start the server
app.listen(PORT, async () => {
  try {
    // Connect to database
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Sync models in development (use migrations in production)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('Database models synchronized.');
    }

    console.log(\`Server running on port \${PORT}\`);
  } catch (error) {
    console.error('Error starting server:', error);
  }
});
EOF
check_success

# Create a simple db.js configuration file
cat > src/config/database.js << EOF
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  development: {
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'wct_wiki',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    dialect: 'postgres'
  },
  test: {
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME_TEST || 'wct_wiki_test',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    dialect: 'postgres'
  },
  production: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    dialect: 'postgres'
  }
};
EOF
check_success

# Create a simple models/index.ts file
cat > src/models/index.ts << EOF
import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Sequelize with your database connection
export const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'wct_wiki',
  logging: false,
});

// Models will be defined and exported here
// export const ModelName = ModelDefinition;

// Function to sync all models with the database
export async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    // Sync all models 
    // Note: In production, use { force: false } or migrations
    await sequelize.sync({ alter: true });
    console.log('All models synchronized with database.');
    
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
}
EOF
check_success

# Setup frontend
print_section "Setting up Frontend"

cd ../frontend

# Create React app
echo -n "Creating React app for frontend... "
npx create-react-app . --template typescript
check_success

# Install additional dependencies
echo -n "Installing frontend dependencies... "
npm install \
  @solana/wallet-adapter-base \
  @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-wallets \
  @solana/web3.js \
  @solana/spl-token \
  axios \
  react-router-dom \
  styled-components \
  @types/styled-components
check_success

# Create .env file for frontend
cat > .env << EOF
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_SOLANA_RPC_URL=http://localhost:8899
REACT_APP_WCT_PROGRAM_ID=your_program_id_after_deployment
REACT_APP_WCT_MINT_ADDRESS=your_mint_address_after_deployment
EOF
check_success

# Return to project root
cd ../../../

# Setup Anchor.toml
print_section "Configuring Anchor.toml"

cat > Anchor.toml << EOF
[features]
seeds = false
skip-lint = false

[programs.localnet]
wct_token = "YourProgramIdWillBeFilledHere"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "./keypair.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
EOF
check_success

# Set up token program
print_section "Setting up Token Program"

# Create program code file
cat > programs/wct-token/src/lib.rs << EOF
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("YourProgramIdWillBeFilledHere");

#[program]
pub mod wct_token {
    use super::*;

    // Initialize the token with a total supply of 100M
    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        total_supply: u64,
    ) -> Result<()> {
        // Mint the total supply to the authority (deployer) account
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: ctx.accounts.mint.to_account_info(),
                },
                &[&[
                    b"mint".as_ref(),
                    &[*ctx.bumps.get("mint").unwrap()],
                ]],
            ),
            total_supply,
        )?;

        Ok(())
    }

    // Distribute tokens to initial wallets according to tokenomics
    pub fn distribute_initial_tokens(
        ctx: Context<DistributeTokens>,
        amount: u64,
    ) -> Result<()> {
        // Transfer tokens from authority to the destination account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.from_token_account.to_account_info(),
                    to: ctx.accounts.to_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        Ok(())
    }

    // Transfer with fee implementation
    pub fn transfer_with_fee(
        ctx: Context<TransferWithFee>, 
        amount: u64
    ) -> Result<()> {
        // Calculate the fee (2% of the transfer amount)
        let fee_amount = amount.checked_mul(2).unwrap().checked_div(100).unwrap();
        
        // Calculate the actual transfer amount (after fee)
        let transfer_amount = amount.checked_sub(fee_amount).unwrap();
        
        // Calculate distribution of fees:
        // 20% for burning
        let burn_amount = fee_amount.checked_mul(20).unwrap().checked_div(100).unwrap();
        
        // 50% to treasury
        let treasury_amount = fee_amount.checked_mul(50).unwrap().checked_div(100).unwrap();
        
        // 30% to staking rewards (to be implemented in Phase 2)
        let staking_amount = fee_amount.checked_sub(burn_amount).unwrap().checked_sub(treasury_amount).unwrap();
        
        // Execute the main transfer to the recipient
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.from_token_account.to_account_info(),
                    to: ctx.accounts.to_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            transfer_amount,
        )?;
        
        // Transfer treasury portion to the treasury account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.from_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            treasury_amount,
        )?;
        
        // Transfer staking portion to the staking rewards account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.from_token_account.to_account_info(),
                    to: ctx.accounts.staking_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            staking_amount,
        )?;
        
        // Burn the burn_amount portion
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.from_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            burn_amount,
        )?;
        
        // Emit an event with transfer details
        emit!(TransferEvent {
            from: ctx.accounts.from_token_account.owner,
            to: ctx.accounts.to_token_account.owner,
            amount: transfer_amount,
            fee: fee_amount,
            burned: burn_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeToken<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [b"mint"],
        bump,
        mint::decimals = 9,
        mint::authority = mint,
    )]
    pub mint: Account<'info, Mint>,
    
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DistributeTokens<'info> {
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.owner == authority.key(),
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = to_token_account.mint == mint.key(),
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferWithFee<'info> {
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        constraint = from_token_account.mint == mint.key(),
        constraint = from_token_account.owner == authority.key(),
    )]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = to_token_account.mint == mint.key(),
    )]
    pub to_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = treasury_token_account.mint == mint.key(),
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = staking_token_account.mint == mint.key(),
    )]
    pub staking_token_account: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct TransferEvent {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub burned: u64,
    pub timestamp: i64,
}
EOF
check_success

# Create deployment script
print_section "Creating Deployment Script"

mkdir -p scripts
cat > scripts/deploy.ts << EOF
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WctToken } from '../target/types/wct_token';
import fs from 'fs';

async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.WctToken as Program<WctToken>;
  const authority = provider.wallet.publicKey;

  console.log('Authority pubkey:', authority.toString());

  // Derive PDA for the mint
  const [mint, mintBump] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from('mint')],
    program.programId
  );

  console.log('Mint PDA address:', mint.toString());
  console.log('Program ID:', program.programId.toString());

  // Update config files with the program ID and mint address
  updateConfig(program.programId.toString(), mint.toString());

  // Initialize the token with total supply of 100M tokens
  // With 9 decimals, 100M tokens = 100,000,000 * 10^9
  const totalSupply = new anchor.BN(100_000_000).mul(new anchor.BN(10 ** 9));

  console.log('Initializing token with total supply:', totalSupply.toString());
  
  try {
    // Initialize the token
    await program.methods
      .initializeToken(totalSupply)
      .accounts({
        mint,
        authorityTokenAccount: await getAssociatedTokenAddress(
          mint,
          authority,
          false
        ),
        authority,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log('Token initialized successfully!');

    // Now set up distribution wallets
    console.log('Setting up token distribution wallets...');

    // Create wallets for each allocation
    const communityWallet = anchor.web3.Keypair.generate();
    const developmentWallet = anchor.web3.Keypair.generate();
    const teamWallet = anchor.web3.Keypair.generate();
    const liquidityWallet = anchor.web3.Keypair.generate();
    const treasuryWallet = anchor.web3.Keypair.generate();
    const stakingWallet = anchor.web3.Keypair.generate();

    console.log('Community wallet:', communityWallet.publicKey.toString());
    console.log('Development wallet:', developmentWallet.publicKey.toString());
    console.log('Team wallet:', teamWallet.publicKey.toString());
    console.log('Liquidity wallet:', liquidityWallet.publicKey.toString());
    console.log('Treasury wallet:', treasuryWallet.publicKey.toString());
    console.log('Staking wallet:', stakingWallet.publicKey.toString());
    
    // Calculate token amounts for each allocation
    const decimals = 9;
    const decimalMultiplier = new anchor.BN(10 ** decimals);
    
    const communityAmount = totalSupply.mul(new anchor.BN(60)).div(new anchor.BN(100));
    const developmentAmount = totalSupply.mul(new anchor.BN(15)).div(new anchor.BN(100));
    const teamAmount = totalSupply.mul(new anchor.BN(10)).div(new anchor.BN(100));
    const liquidityAmount = totalSupply.mul(new anchor.BN(10)).div(new anchor.BN(100));
    const treasuryAmount = totalSupply.mul(new anchor.BN(5)).div(new anchor.BN(100));

    // Fund the wallets with some SOL for rent exemption
    await fundWallet(provider, communityWallet.publicKey);
    await fundWallet(provider, developmentWallet.publicKey);
    await fundWallet(provider, teamWallet.publicKey);
    await fundWallet(provider, liquidityWallet.publicKey);
    await fundWallet(provider, treasuryWallet.publicKey);
    await fundWallet(provider, stakingWallet.publicKey);
    
    // Create token accounts
    const authorityTokenAccount = await getAssociatedTokenAddress(
      mint,
      authority,
      false
    );
    
    const communityTokenAccount = await createTokenAccountIfNeeded(
      provider,
      mint,
      communityWallet.publicKey,
      authority
    );
    
    const developmentTokenAccount = await createTokenAccountIfNeeded(
      provider,
      mint,
      developmentWallet.publicKey,
      authority
    );
    
    const teamTokenAccount = await createTokenAccountIfNeeded(
      provider,
      mint,
      teamWallet.publicKey,
      authority
    );
    
    const liquidityTokenAccount = await createTokenAccountIfNeeded(
      provider,
      mint,
      liquidityWallet.publicKey,
      authority
    );
    
    const treasuryTokenAccount = await createTokenAccountIfNeeded(
      provider,
      mint,
      treasuryWallet.publicKey,
      authority
    );
    
    const stakingTokenAccount = await createTokenAccountIfNeeded(
      provider,
      mint,
      stakingWallet.publicKey,
      authority
    );
    
    // Distribute tokens
    console.log('Distributing tokens to Community wallet...');
    await distributeTokens(
      program,
      mint,
      authorityTokenAccount,
      communityTokenAccount,
      authority,
      communityAmount
    );
    
    console.log('Distributing tokens to Development wallet...');
    await distributeTokens(
      program,
      mint,
      authorityTokenAccount,
      developmentTokenAccount,
      authority,
      developmentAmount
    );
    
    console.log('Distributing tokens to Team wallet...');
    await distributeTokens(
      program,
      mint,
      authorityTokenAccount,
      teamTokenAccount,
      authority,
      teamAmount
    );
    
    console.log('Distributing tokens to Liquidity wallet...');
    await distributeTokens(
      program,
      mint,
      authorityTokenAccount,
      liquidityTokenAccount,
      authority,
      liquidityAmount
    );
    
    console.log('Distributing tokens to Treasury wallet...');
    await distributeTokens(
      program,
      mint,
      authorityTokenAccount,
      treasuryTokenAccount,
      authority,
      treasuryAmount
    );
    
    // Save wallet info to a file for reference
    const walletInfo = {
      programId: program.programId.toString(),
      mint: mint.toString(),
      authority: authority.toString(),
      community: {
        wallet: communityWallet.publicKey.toString(),
        tokenAccount: communityTokenAccount.toString(),
        amount: communityAmount.div(decimalMultiplier).toString()
      },
      development: {
        wallet: developmentWallet.publicKey.toString(),
        tokenAccount: developmentTokenAccount.toString(),
        amount: developmentAmount.div(decimalMultiplier).toString()
      },
      team: {
        wallet: teamWallet.publicKey.toString(),
        tokenAccount: teamTokenAccount.toString(),
        amount: teamAmount.div(decimalMultiplier).toString()
      },
      liquidity: {
        wallet: liquidityWallet.publicKey.toString(),
        tokenAccount: liquidityTokenAccount.toString(),
        amount: liquidityAmount.div(decimalMultiplier).toString()
      },
      treasury: {
        wallet: treasuryWallet.publicKey.toString(),
        tokenAccount: treasuryTokenAccount.toString(),
        amount: treasuryAmount.div(decimalMultiplier).toString()
      },
      staking: {
        wallet: stakingWallet.publicKey.toString(),
        tokenAccount: stakingTokenAccount.toString(),
        amount: "0" // Will be funded in Phase 2
      }
    };
    
    fs.writeFileSync('wallet-info.json', JSON.stringify(walletInfo, null, 2));
    console.log('Wallet information saved to wallet-info.json');
    
    console.log('Deployment and initial distribution completed successfully!');
    
  } catch (error) {
    console.error('Error during deployment:', error);
  }
}

async function fundWallet(provider: anchor.AnchorProvider, wallet: anchor.web3.PublicKey) {
  const transferTx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: wallet,
      lamports: anchor.web3.LAMPORTS_PER_SOL * 0.1 // 0.1 SOL for rent
    })
  );
  
  await provider.sendAndConfirm(transferTx);
  console.log(`Funded ${wallet.toString()} with 0.1 SOL`);
}

async function createTokenAccountIfNeeded(
  provider: anchor.AnchorProvider,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> {
  const associatedTokenAccount = await getAssociatedTokenAddress(
    mint,
    owner,
    false
  );
  
  try {
    // Check if the account exists
    await provider.connection.getAccountInfo(associatedTokenAccount);
    console.log(`Token account ${associatedTokenAccount.toString()} already exists`);
  } catch (error) {
    // Create the token account if it doesn't exist
    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer,
        associatedTokenAccount,
        owner,
        mint
      )
    );
    
    await provider.sendAndConfirm(tx);
    console.log(`Created token account ${associatedTokenAccount.toString()}`);
  }
  
  return associatedTokenAccount;
}

async function distributeTokens(
  program: Program<WctToken>,
  mint: anchor.web3.PublicKey,
  fromAccount: anchor.web3.PublicKey,
  toAccount: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey,
  amount: anchor.BN
) {
  await program.methods
    .distributeInitialTokens(amount)
    .accounts({
      mint,
      fromTokenAccount: fromAccount,
      toTokenAccount: toAccount,
      authority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
    
  console.log(`Distributed ${amount.div(new anchor.BN(10 ** 9)).toString()} tokens to ${toAccount.toString()}`);
}

function updateConfig(programId: string, mintAddress: string) {
  // Update Anchor.toml
  let anchorConfig = fs.readFileSync('Anchor.toml', 'utf8');
  anchorConfig = anchorConfig.replace('YourProgramIdWillBeFilledHere', programId);
  fs.writeFileSync('Anchor.toml', anchorConfig);
  
  // Update program lib.rs
  let programCode = fs.readFileSync('programs/wct-token/src/lib.rs', 'utf8');
  programCode = programCode.replace('YourProgramIdWillBeFilledHere', programId);
  fs.writeFileSync('programs/wct-token/src/lib.rs', programCode);
  
  // Update backend .env
  let backendEnv = fs.readFileSync('app/backend/.env', 'utf8');
  backendEnv = backendEnv.replace('your_program_id_after_deployment', programId);
  backendEnv = backendEnv.replace('your_mint_address_after_deployment', mintAddress);
  fs.writeFileSync('app/backend/.env', backendEnv);
  
  // Update frontend .env
  let frontendEnv = fs.readFileSync('app/frontend/.env', 'utf8');
  frontendEnv = frontendEnv.replace('your_program_id_after_deployment', programId);
  frontendEnv = frontendEnv.replace('your_mint_address_after_deployment', mintAddress);
  fs.writeFileSync('app/frontend/.env', frontendEnv);
  
  console.log('Updated configuration files with program ID and mint address');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
check_success

# Create test script
print_section "Creating Test Script"

mkdir -p tests
cat > tests/wct-token.ts << EOF
import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WctToken } from '../target/types/wct_token';
import { expect } from
