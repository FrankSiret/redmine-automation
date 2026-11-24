# ⏱️ Redmine Time Entry Automation

This Node.js script automates creating **Redmine time entries** across a date range (weekdays only). It uses the Redmine REST API with an API key for authentication.

---

## 📦 Requirements

- Node.js 18+
- Access to your Redmine instance
- A Redmine API key (explained below)
- A `.env` file with your configuration

---

## ⚙️ Installation

```bash
# Clone the project
git clone https://github.com/FrankSiret/redmine-automation.git
cd redmine-automation

# Install dependencies
npm install
```

---

## 🔑 How to Get Your Redmine API Key

1. Log in to your Redmine account in the browser.
2. Go to **My Account** (usually in the top-right menu).
3. Scroll down to the section **API access key**.

   - If no key is displayed, click **Show** or **Generate** to create one.

4. Copy the key — it looks like a long hex string, e.g.:

   ```
   4b92a4c93acddfd7d7f6d3e15b5c9f15a32d12aa
   ```

5. Paste it into your `.env` file as `REDMINE_API_KEY`.

---

## 🔑 Environment Variables

Create a `.env` file in the project root with:

```env
# Redmine instance URL (required)
REDMINE_URL=https://www.redmine.org

# Redmine credentials (required)
REDMINE_API_KEY=your_redmine_api_key

# Issue ID to log time on (required)
REDMINE_TASK_ID=1234

# Hours per day (optional, defaults to 8, max 24)
# REDMINE_HOURS=8

# Redmine activity ID to use for time entries (optional, defaults to 9, commonly "Development")
# REDMINE_ACTIVITY_ID=9

# Comments for each entry (optional)
# REDMINE_COMMENTS=Worked on feature implementation
```

## 🗓️ Run web view (calendar)

A local web page to see your hours month by month and log new ones with one click:

```bash
npm run web
# open http://localhost:3000
```

- Opens on the current month. Use the arrows (or ← / → on the keyboard) to go to the previous or next month.
- Each day fills up from the bottom as hours are logged: green when complete, amber when partial, striped red for past weekdays with no hours.
- The **+8 h** button on each day logs the remaining hours for that day (e.g. **+4 h** if 4 are already logged) on the default task.
- **Complete N pending days** fills every weekday of the month up to today that still needs hours (asks for a second click to confirm).
- Click a day to see its entries, delete one, or log hours on a different task.
- The default task, hours per day, activity and comment are set at the top of the page and saved in the browser. The first time, they are taken from `.env` (`REDMINE_TASK_ID`, `REDMINE_HOURS`, `REDMINE_ACTIVITY_ID`, `REDMINE_COMMENTS`).

Only `REDMINE_URL` and `REDMINE_API_KEY` are required for the web view. The server listens on `127.0.0.1` only, so your API key never leaves your machine. Use `REDMINE_WEB_PORT` to change the port.

---

# For script run only

```env
# Date range (inclusive, format YYYY-MM-DD) (required)
REDMINE_FROM_DATE=2025-08-01
REDMINE_TO_DATE=2025-08-15

# Optional: when true, existing entries on REDMINE_TASK_ID for the selected dates are deleted
# and recreated. Entries logged on other issues are never deleted.
# REDMINE_REPLACE_EXISTING=false

# Optional: when true, only prints what would be created/deleted without changing anything
# REDMINE_DRY_RUN=false

# Optional: comma-separated dates to skip (holidays, vacations)
# REDMINE_SKIP_DATES=2025-08-15,2025-12-25
```

---

## ▶️ Usage

Run the script:

```bash
npm start
# or
node index.js
```

Tip: run it first with `REDMINE_DRY_RUN=true` to check what it will do.

The script will:

1. Validate the configuration (required variables, dates, numbers) and stop with a clear error if something is wrong.
2. Fetch all your time entries in the date range (following pagination).
3. For each weekday between `REDMINE_FROM_DATE` and `REDMINE_TO_DATE`:

   - Skip it if it is listed in `REDMINE_SKIP_DATES`.
   - Skip it if you already logged time on **another** issue or project that day.
   - Skip it if you already logged time on `REDMINE_TASK_ID`, unless `REDMINE_REPLACE_EXISTING=true`, in which case those entries are deleted and recreated (if a deletion fails, no new entry is created).
   - Otherwise create a **time entry** with `issue_id`, `hours`, `activity_id`, `comments` and `spent_on`.

4. Print a summary. The process exits with code `1` if any operation failed.

---

## 📝 Example Output

```bash
Fetching your time entries between 2025-08-01 and 2025-08-08...
Found 1 existing time entries.
2025-08-01:
  Created time entry #101 (8h) for 2025-08-01
2025-08-04:
  Already has time logged on issue #1234. Skipping.
2025-08-05:
  Created time entry #102 (8h) for 2025-08-05
...

Done. Created: 5, deleted: 0, skipped: 1, failed: 0
```
