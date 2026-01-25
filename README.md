# LinearFlow

A Discord bot managing all things linear.

## Setup

### 1. Prerequisites
- Node.js 20+
- A Discord bot account
- Linear API access

### 2. Get Your Tokens

**Discord:**
1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to "Bot" → Copy the token
4. Enable "Message Content Intent"

**Linear:**
1. Go to https://linear.app/settings/api
2. Create a Personal API Key
3. Copy the key

### 3. Installation
```bash
# Clone the repository
git clone https://github.com/hrtmnj/LinearFlow.git

# Install dependencies
npm install

# Create environment file & add tokens
cp .env.example .env
```

## Usage

- `/issue create` - Create a new Linear issue
- More commands coming soon!