import TelegramBot from 'node-telegram-bot-api';
import OpenAI from 'openai';
import cron from 'node-cron';
import { format, parse, addHours, addMinutes, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime, formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required');
  process.exit(1);
}

// Initialize bot and OpenAI
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Timezone
const TIMEZONE = 'Asia/Kolkata';

// Database (simple JSON file storage)
const DB_FILE = path.join(__dirname, 'tasks.json');

// Initialize database
let db = {
  tasks: [],
  nextId: 1
};

// Load database
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading database:', error);
  }
}

// Save database
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

loadDB();

// Add task
function addTask(userId, title, dueDate, category, priority = 'normal') {
  const task = {
    id: db.nextId++,
    userId,
    title,
    dueDate: dueDate ? dueDate.toISOString() : null,
    category,
    priority,
    status: 'open',
    createdAt: new Date().toISOString(),
    reminded: false
  };

  db.tasks.push(task);
  saveDB();
  return task;
}

// Get tasks for user
function getUserTasks(userId, filter = {}) {
  return db.tasks.filter(task => {
    if (task.userId !== userId) return false;
    if (filter.status && task.status !== filter.status) return false;
    if (filter.today) {
      if (!task.dueDate) return false;
      const taskDate = utcToZonedTime(new Date(task.dueDate), TIMEZONE);
      const now = utcToZonedTime(new Date(), TIMEZONE);
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      if (isBefore(taskDate, todayStart) || isAfter(taskDate, todayEnd)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate) - new Date(b.dueDate);
  });
}

// Mark task as done
function markTaskDone(taskId) {
  const task = db.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = 'done';
    saveDB();
    return true;
  }
  return false;
}

// Snooze task
function snoozeTask(taskId, hours) {
  const task = db.tasks.find(t => t.id === taskId);
  if (task && task.dueDate) {
    const newDate = addHours(new Date(task.dueDate), hours);
    task.dueDate = newDate.toISOString();
    saveDB();
    return task;
  }
  return null;
}

// Delete task
function deleteTask(taskId) {
  const index = db.tasks.findIndex(t => t.id === taskId);
  if (index !== -1) {
    db.tasks.splice(index, 1);
    saveDB();
    return true;
  }
  return false;
}

// Parse natural language with OpenAI
async function parseTasksFromText(text) {
  try {
    const now = utcToZonedTime(new Date(), TIMEZONE);
    const currentTimeStr = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd HH:mm:ss 'IST'");

    const prompt = `Current time: ${currentTimeStr}

Extract tasks from this text: "${text}"

For each task, extract:
1. title: The task description
2. dueDate: When it should be done (format: ISO 8601 in IST timezone)
3. category: Type like "call", "payment", "work", "shopping", "personal", etc.
4. priority: "high" or "normal"

Rules:
- If no time specified, use 9 AM for morning, 2 PM for afternoon, 7 PM for evening
- "today" means current date
- "tomorrow" means next day
- "after work" means 7 PM
- "morning" means 9 AM, "afternoon" means 2 PM, "evening" means 7 PM
- Use context to determine category (e.g., "call" for phone calls, "payment" for bills, etc.)
- Mark as "high" priority if words like "urgent", "important", "ASAP" are used

Return JSON array of tasks. Example:
[
  {
    "title": "Buy groceries",
    "dueDate": "2025-11-06T19:00:00+05:30",
    "category": "shopping",
    "priority": "normal"
  }
]

If no tasks found, return empty array: []`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a task extraction assistant. Extract tasks from text and return valid JSON only. No explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3
    });

    const content = response.choices[0].message.content.trim();
    // Remove markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, content];
    const jsonStr = jsonMatch[1] || content;

    const tasks = JSON.parse(jsonStr);
    return Array.isArray(tasks) ? tasks : [];
  } catch (error) {
    console.error('Error parsing tasks:', error);
    return [];
  }
}

// Transcribe voice message
async function transcribeVoice(fileUrl) {
  try {
    // Download the file
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();

    // Save temporarily
    const tempFile = path.join(__dirname, 'temp_voice.ogg');
    fs.writeFileSync(tempFile, Buffer.from(buffer));

    // Transcribe with OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: 'whisper-1',
      language: 'en'
    });

    // Clean up
    fs.unlinkSync(tempFile);

    return transcription.text;
  } catch (error) {
    console.error('Error transcribing voice:', error);
    throw error;
  }
}

// Format task for display
function formatTask(task) {
  let text = `${task.id}. ${task.title}`;

  if (task.dueDate) {
    const dueDate = utcToZonedTime(new Date(task.dueDate), TIMEZONE);
    text += ` - ${formatInTimeZone(dueDate, TIMEZONE, 'MMM dd, h:mm a')}`;
  }

  if (task.category) {
    text += ` [${task.category}]`;
  }

  if (task.priority === 'high') {
    text += ' ⚠️';
  }

  if (task.status === 'done') {
    text += ' ✅';
  }

  return text;
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMsg = `Welcome to Task Manager Bot! 🤖

I can help you manage your tasks with text or voice messages.

*Commands:*
/add <task> <time> - Add a task
/next - Show next tasks
/today - Show today's tasks
/done <id> - Mark task as done
/snooze <id> <hours>h - Snooze a task
/delete <id> - Delete a task
/list - Show all open tasks

*Examples:*
• Just send: "Buy groceries after work and call Mini at 10 AM tomorrow"
• Voice note: Send a voice message with your tasks
• /add Pay rent tomorrow 10am
• /done 2
• /snooze 3 2h

Time zone: IST (India Standard Time)`;

  bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
});

// Handle /add command
bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = match[1];

  try {
    const tasks = await parseTasksFromText(text);

    if (tasks.length === 0) {
      bot.sendMessage(chatId, "Couldn't understand the task. Please try again with more details.");
      return;
    }

    for (const taskData of tasks) {
      const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : null;
      const task = addTask(userId, taskData.title, dueDate, taskData.category, taskData.priority);

      let response = `Task added: ${task.title}`;
      if (task.dueDate) {
        const dueDateFormatted = formatInTimeZone(new Date(task.dueDate), TIMEZONE, 'MMM dd, h:mm a');
        response += ` - ${dueDateFormatted}`;
      }
      response += ' ✅';

      bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error('Error adding task:', error);
    bot.sendMessage(chatId, 'Error adding task. Please try again.');
  }
});

// Handle /next command
bot.onText(/\/next/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const tasks = getUserTasks(userId, { status: 'open' }).slice(0, 5);

  if (tasks.length === 0) {
    bot.sendMessage(chatId, 'No pending tasks! 🎉');
    return;
  }

  let response = '*Next tasks:*\n\n';
  tasks.forEach(task => {
    response += formatTask(task) + '\n';
  });

  bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// Handle /today command
bot.onText(/\/today/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const tasks = getUserTasks(userId, { status: 'open', today: true });

  if (tasks.length === 0) {
    bot.sendMessage(chatId, 'No tasks for today! 🎉');
    return;
  }

  let response = '*Today\'s tasks:*\n\n';
  tasks.forEach(task => {
    response += formatTask(task) + '\n';
  });

  bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// Handle /list command
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const tasks = getUserTasks(userId, { status: 'open' });

  if (tasks.length === 0) {
    bot.sendMessage(chatId, 'No pending tasks! 🎉');
    return;
  }

  let response = '*All tasks:*\n\n';
  tasks.forEach(task => {
    response += formatTask(task) + '\n';
  });

  bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// Handle /done command
bot.onText(/\/done (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const taskId = parseInt(match[1]);

  if (markTaskDone(taskId)) {
    bot.sendMessage(chatId, `Task ${taskId} marked as done! ✅`);
  } else {
    bot.sendMessage(chatId, `Task ${taskId} not found.`);
  }
});

// Handle /snooze command
bot.onText(/\/snooze (\d+) (\d+)h/, (msg, match) => {
  const chatId = msg.chat.id;
  const taskId = parseInt(match[1]);
  const hours = parseInt(match[2]);

  const task = snoozeTask(taskId, hours);
  if (task) {
    const newTime = formatInTimeZone(new Date(task.dueDate), TIMEZONE, 'MMM dd, h:mm a');
    bot.sendMessage(chatId, `Task ${taskId} snoozed to ${newTime} ⏰`);
  } else {
    bot.sendMessage(chatId, `Task ${taskId} not found or has no due date.`);
  }
});

// Handle /delete command
bot.onText(/\/delete (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const taskId = parseInt(match[1]);

  if (deleteTask(taskId)) {
    bot.sendMessage(chatId, `Task ${taskId} deleted.`);
  } else {
    bot.sendMessage(chatId, `Task ${taskId} not found.`);
  }
});

// Handle voice messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    bot.sendMessage(chatId, 'Transcribing your voice message... 🎤');

    // Get file
    const fileId = msg.voice.file_id;
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

    // Transcribe
    const text = await transcribeVoice(fileUrl);
    bot.sendMessage(chatId, `Heard: "${text}"`);

    // Parse tasks
    const tasks = await parseTasksFromText(text);

    if (tasks.length === 0) {
      bot.sendMessage(chatId, "Couldn't find any tasks in your message.");
      return;
    }

    for (const taskData of tasks) {
      const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : null;
      const task = addTask(userId, taskData.title, dueDate, taskData.category, taskData.priority);

      let response = `Task added: ${task.title}`;
      if (task.dueDate) {
        const dueDateFormatted = formatInTimeZone(new Date(task.dueDate), TIMEZONE, 'MMM dd, h:mm a');
        response += ` - ${dueDateFormatted}`;
      }
      response += ' ✅';

      bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error('Error processing voice:', error);
    bot.sendMessage(chatId, 'Error processing voice message. Please try again.');
  }
});

// Handle text messages
bot.on('message', async (msg) => {
  // Skip if it's a command or voice message
  if (msg.text && (msg.text.startsWith('/') || !msg.text.trim())) return;
  if (msg.voice) return;
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // Handle quick queries
  const lowerText = text.toLowerCase();
  if (lowerText.includes('what\'s next') || lowerText.includes('whats next')) {
    const tasks = getUserTasks(userId, { status: 'open' }).slice(0, 3);
    if (tasks.length === 0) {
      bot.sendMessage(chatId, 'No pending tasks! 🎉');
      return;
    }
    let response = '*Next tasks:*\n\n';
    tasks.forEach(task => {
      response += formatTask(task) + '\n';
    });
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    return;
  }

  if (lowerText.includes('show') && lowerText.includes('today')) {
    const tasks = getUserTasks(userId, { status: 'open', today: true });
    if (tasks.length === 0) {
      bot.sendMessage(chatId, 'No tasks for today! 🎉');
      return;
    }
    let response = '*Today\'s tasks:*\n\n';
    tasks.forEach(task => {
      response += formatTask(task) + '\n';
    });
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    return;
  }

  // Try to parse as task
  try {
    const tasks = await parseTasksFromText(text);

    if (tasks.length === 0) {
      bot.sendMessage(chatId, "I didn't understand that. Try /start to see available commands.");
      return;
    }

    for (const taskData of tasks) {
      const dueDate = taskData.dueDate ? new Date(taskData.dueDate) : null;
      const task = addTask(userId, taskData.title, dueDate, taskData.category, taskData.priority);

      let response = `Task added: ${task.title}`;
      if (task.dueDate) {
        const dueDateFormatted = formatInTimeZone(new Date(task.dueDate), TIMEZONE, 'MMM dd, h:mm a');
        response += ` - ${dueDateFormatted}`;
      }
      response += ' ✅';

      bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error('Error processing message:', error);
    bot.sendMessage(chatId, 'Error processing your message. Please try again.');
  }
});

// Daily summary at 8 AM IST
cron.schedule('0 8 * * *', () => {
  console.log('Sending daily summaries...');

  // Get all users with tasks
  const userIds = new Set(db.tasks.map(t => t.userId));

  userIds.forEach(userId => {
    const tasks = getUserTasks(userId, { status: 'open', today: true });

    if (tasks.length > 0) {
      let message = '*Good morning! ☀️*\n\n*Today\'s tasks:*\n\n';
      tasks.forEach(task => {
        message += formatTask(task) + '\n';
      });

      bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    }
  });
}, {
  timezone: TIMEZONE
});

// Check for reminders every minute
cron.schedule('* * * * *', () => {
  const now = new Date();
  const nowIST = utcToZonedTime(now, TIMEZONE);

  db.tasks.forEach(task => {
    if (task.status !== 'open' || !task.dueDate || task.reminded) return;

    const dueDate = utcToZonedTime(new Date(task.dueDate), TIMEZONE);
    const diffMinutes = (dueDate - nowIST) / (1000 * 60);

    // Send reminder at due time
    if (diffMinutes <= 1 && diffMinutes >= 0) {
      bot.sendMessage(task.userId, `⏰ Reminder: ${task.title}`);
      task.reminded = true;
      saveDB();
    }

    // Early reminder for high priority tasks (30 minutes before)
    if (task.priority === 'high' && diffMinutes <= 30 && diffMinutes > 29) {
      bot.sendMessage(task.userId, `⚠️ Upcoming (in 30 min): ${task.title}`);
    }
  });
});

console.log('Telegram Task Bot is running...');
console.log('Timezone:', TIMEZONE);
