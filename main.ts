// Environment variables
const WEBHOOK_URL = Deno.env.get("GOOGLE_SPACE_WEBHOOK_URL");
const ENVIRONMENT = Deno.env.get("ENVIRONMENT") || "development";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const GITHUB_REPOS = Deno.env.get("GITHUB_REPOS") || "";
const MAX_PR_AGE_DAYS = parseInt(Deno.env.get("MAX_PR_AGE_DAYS") || "120", 10);

// Import GitHub PR functionality
import { fetchPRsWaitingForReview, generatePRReminderMessage } from "./github-prs.ts";

if (!WEBHOOK_URL) {
  const errorMsg = "Error: GOOGLE_SPACE_WEBHOOK_URL environment variable is not set";
  console.error(errorMsg);
  if (typeof Deno.exit === 'function') {
    Deno.exit(1);
  } else {
    // In Deno Deploy, we'll log the error and continue
    console.warn("Running in Deno Deploy - continuing without webhook URL");
  }
}

// Timezone offset for UTC+7
const TIMEZONE_OFFSET = 7 * 60 * 60 * 1000; // 7 hours in milliseconds

// Helper function to get current date in Jakarta time (UTC+7)
function getJakartaTime(): Date {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + TIMEZONE_OFFSET);
}

// Function to send message to Google Space webhook
async function sendToWebhook(message: string): Promise<boolean> {
  if (!WEBHOOK_URL) {
    console.warn("Webhook URL is not set. Cannot send message.");
    return false;
  }

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        text: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
    }

    console.log("Message sent successfully");
    return true;
  } catch (error) {
    console.error("Error sending message to webhook:", error);
    return false;
  }
}

// Function to generate weekly report reminder message
function generateWeeklyReportMessage(date: Date): string {
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);

  return `📊 *Weekly Report Reminder* 📊\n\n` +
    `Good ${dayName}, team! <users/all> ☀️\n\n` +
    `Don't forget to fill out your weekly report! Have a great weekend! 🌟`
}

// Function to generate daily standup message
function generateStandupMessage(): string | null {
  const today = getJakartaTime();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Don't send any message on Sunday
  if (dayOfWeek === 0) {
    console.log("It's Sunday - no message will be sent");
    return null;
  }
  
  // Send weekly report reminder on Saturday
  if (dayOfWeek === 6) {
    return generateWeeklyReportMessage(today);
  }
  
  // Regular standup message for weekdays (Monday-Friday)
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(today);
  const dateStr = new Intl.DateTimeFormat('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  }).format(today);
  
  return `⏰ *Daily Standup Reminder* ⏰\n\n` +
    `Good morning team! <users/all> ☀️\n\n` +
    `*Date:* ${dayName}, ${dateStr}\n` +
    `*Time:* 10:00 AM (UTC+7)\n\n` +
    `Please share your updates for today's standup:\n` +
    `1. What did you do yesterday?\n` +
    `2. What will you do today?\n` +
    `3. Any blockers or challenges?\n\n` +
    `Let's have a great day! 🚀`;
}

// Main function to handle the scheduled job
async function sendDailyStandup() {
  const standupMessage = generateStandupMessage();
  
  if (standupMessage === null) {
    console.log("No message to send (likely Sunday)");
    return;
  }

  if (ENVIRONMENT === "development") {
    console.log("Running in development mode - no messages will be sent to webhook");
    console.log("Message that would be sent:", standupMessage);
    return;
  }

  console.log("Sending standup reminder...");
  await sendToWebhook(standupMessage);
}

// Separate function for PR reminders at 8 AM
async function sendPRReminder() {
  // Fetch PRs waiting for review
  const { prs, draftCounts } = await fetchPRsWaitingForReview(GITHUB_TOKEN, GITHUB_REPOS);
  const prMessage = generatePRReminderMessage(prs, MAX_PR_AGE_DAYS, draftCounts);

  if (!prMessage) {
    console.log("No PRs waiting for review");
    return;
  }

  if (ENVIRONMENT === "development") {
    console.log("Running in development mode - no messages will be sent to webhook");
    console.log("PR reminder that would be sent:", prMessage);
    return;
  }

  console.log("Sending PR reminder...");
  await sendToWebhook(prMessage);
}

// For local testing
if (import.meta.main) {
  if (Deno.args[0] === "test") {
    console.log("Running test message...");
    await sendDailyStandup();
  } else if (Deno.args[0] === "pr-test") {
    console.log("Running PR reminder test...");
    await sendPRReminder();
  } else {
    console.log("Starting daily standup scheduler...");
    // Schedule the job to run every day at 10:00 AM UTC+7 (3:00 AM UTC) for standup
    Deno.cron("daily-standup", "0 3 * * *", async () => {
      console.log("Standup cron job triggered at:", new Date().toISOString());
      await sendDailyStandup();
    });
    
    // Schedule the job to run every day at 8:00 AM UTC+7 (1:00 AM UTC) for PR reminders
    Deno.cron("pr-reminder", "0 1 * * *", async () => {
      console.log("PR reminder cron job triggered at:", new Date().toISOString());
      await sendPRReminder();
    });
  }
}

export { sendDailyStandup, sendPRReminder };
