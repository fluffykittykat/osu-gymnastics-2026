# Chatbot AI Setup Guide

This document explains how to set up the Claude AI chatbot for the OSU Gymnastics 2026 stats website.

## Prerequisites

- Node.js installed and dependencies installed (`npm install`)
- Anthropic API key (Claude API access)

## Step 1: Get Your Anthropic API Key

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in with your Anthropic account
3. Navigate to the API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-ant-`)

## Step 2: Configure Environment Variables

### Option A: Using .env file (Recommended for local development)

1. Create or edit `.env` in the project root:
   ```bash
   cp .env.example .env
   ```

2. Add your API key to `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   PORT=8888
   REFRESH_SECRET=your-optional-secret
   ```

3. **IMPORTANT**: `.env` is in `.gitignore` and should NEVER be committed to git. Verify this before committing:
   ```bash
   git check-ignore .env
   ```

### Option B: Using system environment variables

Alternatively, set the environment variable before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
npm start
```

## Step 3: Verify Configuration

### Start the server:
```bash
npm start
```

You should see:
```
🤸 OSU Gymnastics 2026 running on http://localhost:8888
```

### Test the chatbot:

1. Open http://localhost:8888 in your browser
2. Click the chatbot bubble (💬) in the bottom-right corner
3. Send a test message like: "What are the team's recent statistics?"

### Expected behavior:
- The chatbot window opens with a greeting
- Your message appears in the chat
- A typing indicator shows while waiting for Claude
- Claude's response appears in the chat

### Troubleshooting:

**Error: "AI service not configured"**
- `ANTHROPIC_API_KEY` is not set or is empty
- Check your `.env` file or environment variable
- Verify the key format (should start with `sk-ant-`)

**Error: "Invalid API credentials"**
- Your API key is invalid or expired
- Go to https://console.anthropic.com and generate a new key

**Error: "Rate limited"**
- You've exceeded the API rate limit
- Wait a few moments before trying again

**Chatbot widget doesn't appear:**
- Check browser console for JavaScript errors (F12)
- Verify the server is running and accessible
- Clear browser cache if CSS/JS isn't loading

## Step 4: Deploy to Production

For production deployments:

1. **Never commit `.env`** - it's in `.gitignore` for security
2. Set `ANTHROPIC_API_KEY` as an environment variable in your hosting platform:
   - **AWS**: Use Secrets Manager or Parameter Store
   - **Vercel/Netlify**: Set in project environment variables
   - **Docker**: Pass via `--env` or environment file
   - **systemd/PM2**: Set in service file or ecosystem.config.js

3. Example for PM2 (`ecosystem.config.js`):
   ```javascript
   module.exports = {
     apps: [{
       name: 'osu-gymnastics',
       script: './server.js',
       env: {
         ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
         PORT: 8888
       }
     }]
   };
   ```

## Architecture

The chatbot uses a **backend proxy** pattern:

1. **Frontend** (`public/js/chatbot.js`): Handles UI and sends messages to `/api/chat`
2. **Backend** (`server.js`): Validates messages and proxies to Claude API
3. **Claude API**: Processes the request and returns the response

This design:
- ✅ Keeps the API key secure (never exposed to frontend)
- ✅ Allows request validation and rate limiting
- ✅ Enables custom system prompts for gymnastics context
- ✅ Supports future analytics and logging

## Support

For issues or questions:
- Check the troubleshooting section above
- Review server logs: `npm start` output or PM2 logs
- Check browser console errors (F12 > Console tab)
- Visit Anthropic documentation: https://docs.anthropic.com

---

**Security Reminder**: Never share your API key. Treat it like a password. If exposed, regenerate it immediately in the Anthropic console.
