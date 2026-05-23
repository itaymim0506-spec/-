# Discord Verify + Welcome Bot

## Setup

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Fill in `.env`:
   - `CLIENT_ID`: your Discord application client ID.
   - `GUILD_ID`: your server ID.
   - `WELCOME_CHANNEL_ID`: channel where welcome messages should be sent.
   - `VERIFIED_ROLE_ID`: role to give after clicking Verify.
4. Run `npm run deploy` to register `/setup-verify`.
5. Run `npm start` to start the bot.
6. In Discord, run `/setup-verify` in the channel where you want the verify button.

## Required Bot Settings

Enable **Server Members Intent** in the Discord Developer Portal so welcome messages can work.
