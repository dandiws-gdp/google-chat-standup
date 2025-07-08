// Environment variables
const WEBHOOK_URL = Deno.env.get("GOOGLE_SPACE_WEBHOOK_URL");
const ENVIRONMENT = Deno.env.get("ENVIRONMENT") || "development";

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
  const message = generateStandupMessage();
  
  if (message === null) {
    console.log("No message to send (likely Sunday)");
    return;
  }

  if (ENVIRONMENT === "development") {
    console.log("Running in development mode - no messages will be sent to webhook");
    console.log("Message that would be sent:", message);
    return;
  }

  console.log("Sending reminder...");
  await sendToWebhook(message);
}

// For local testing
if (import.meta.main) {
  if (Deno.args[0] === "test") {
    console.log("Running test message...");
    await sendDailyStandup();
  } else {
    console.log("Starting daily standup scheduler...");
    
    // Run immediately when started (for testing)
    if (ENVIRONMENT === "development") {
      await sendDailyStandup();
    }
    
    // Schedule the job to run every day at 10:00 AM UTC+7 (3:00 AM UTC)
    Deno.cron("daily-standup", "0 3 * * *", async () => {
      console.log("Cron job triggered at:", new Date().toISOString());
      await sendDailyStandup();
    });
  }
}

export { sendDailyStandup };
