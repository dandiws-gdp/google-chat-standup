# Google Space Standup Reminder

A Deno application that sends daily standup reminders to a Google Space at 10:00 AM UTC+7 (Jakarta time) using Deno Deploy's KV and cron features.

## Features

- Sends formatted daily standup reminders to a Google Space webhook
- Runs on Deno Deploy with built-in cron scheduling
- Timezone-aware (UTC+7)
- Development mode for testing without sending actual messages
- Environment variable configuration

## Prerequisites

- [Deno](https://deno.land/) installed locally (for development)
- A Google Space with webhook integration enabled
- [Deno Deploy](https://deno.com/deploy) account (for deployment)

## Environment Variables

Create a `.env` file in the project root with the following variables:

```env
GOOGLE_SPACE_WEBHOOK_URL=your_webhook_url_here
ENVIRONMENT=development  # Set to 'production' in production
```

## Local Development

1. Install dependencies:
   ```bash
   deno cache --reload main.ts
   ```

2. Run in development mode:
   ```bash
   deno task dev
   ```
   This will start the application in watch mode and send a test message immediately.

3. Run a one-time test:
   ```bash
   deno run --allow-net --allow-env --env-file --unstable-cron --allow-read main.ts test
   ```

## Deployment to Deno Deploy

1. Create a new project on [Deno Deploy](https://dash.deno.com/)
2. Link your GitHub repository or upload the code
3. Set the following environment variables in the Deno Deploy dashboard:
   - `GOOGLE_SPACE_WEBHOOK_URL`: Your Google Space webhook URL
   - `ENVIRONMENT`: `production`
4. Deploy the application

## Cron Schedule

The cron job is set to run daily at 10:00 AM UTC+7 (3:00 AM UTC) using Deno Deploy's cron feature.

## Message Format

The daily standup message will look like this:

```
⏰ *Daily Standup Reminder* ⏰

Good morning team! <users/all> ☀️

*Date:* [Day of week], [Month] [Day], [Year]
*Time:* 10:00 AM (UTC+7)

Please share your updates for today's standup:
1. What did you do yesterday?
2. What will you do today?
3. Any blockers or challenges?

Let's have a great day! 🚀
```

## License

MIT
