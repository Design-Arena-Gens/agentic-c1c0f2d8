# Telegram Task Manager Bot

A Telegram bot that helps you manage tasks with natural language processing, voice message support, and automatic reminders.

## Features

- 📝 Text and voice message support
- 🤖 Natural language task extraction using OpenAI
- ⏰ Automatic reminders at task due time
- ⚠️ Early reminders for high-priority tasks (30 min before)
- 🌅 Daily morning summary at 8:00 AM IST
- 🏷️ Automatic task categorization
- 📅 Smart date/time parsing

## Setup

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow instructions
3. Save the bot token

### 2. Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Create an API key
3. Save the key

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

Create `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
```

### 5. Run the Bot

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Usage

### Commands

- `/start` - Welcome message and help
- `/add <task> <time>` - Add a task manually
- `/next` - Show next 5 tasks
- `/today` - Show today's tasks
- `/list` - Show all open tasks
- `/done <id>` - Mark task as done
- `/snooze <id> <hours>h` - Snooze a task
- `/delete <id>` - Delete a task

### Natural Language

Just send messages like:

- "Buy groceries after work today and call Mini at 10 AM tomorrow"
- "Pay rent tomorrow 10am"
- "Meeting at 3 PM"
- "Urgent: Submit report by 5 PM today"

### Voice Messages

Send voice notes describing your tasks. The bot will:
1. Transcribe the audio
2. Extract tasks
3. Add them automatically

### Quick Queries

- "What's next?"
- "Show me my tasks for today"

## Task Features

- **Smart time parsing**: "tomorrow morning" = 9 AM, "after work" = 7 PM
- **Auto-categorization**: Detects types like "call", "payment", "work", "shopping"
- **Priority detection**: Marks tasks with "urgent", "important", "ASAP" as high priority
- **IST timezone**: All times in Indian Standard Time

## Examples

### Text Message
```
User: "Buy groceries after work and call Rohan tomorrow 3 PM"

Bot:
Task added: Buy groceries - Nov 06, 7:00 PM ✅
Task added: Call Rohan - Nov 07, 3:00 PM [call] ✅
```

### Voice Note
```
User: [Voice message] "Remind me to pay electricity bill tomorrow morning"

Bot:
Heard: "Remind me to pay electricity bill tomorrow morning"
Task added: Pay electricity bill - Nov 07, 9:00 AM [payment] ✅
```

### Commands
```
User: /next

Bot:
Next tasks:

1. Buy groceries - Nov 06, 7:00 PM [shopping]
2. Call Rohan - Nov 07, 3:00 PM [call]
3. Pay electricity bill - Nov 07, 9:00 AM [payment]
```

## Data Storage

Tasks are stored in `tasks.json` in the bot directory. The file persists between restarts.

## Reminders

- **Due time reminder**: Sent when task is due
- **Early reminder**: 30 minutes before for high-priority tasks
- **Daily summary**: Every day at 8:00 AM IST with today's tasks

## Requirements

- Node.js 18+
- Telegram Bot Token
- OpenAI API Key (with access to GPT-4 and Whisper)

## Costs

- OpenAI API usage (Whisper for transcription, GPT-4 for task parsing)
- Free Telegram Bot API

## License

ISC
