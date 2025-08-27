# ⏱️ Redmine Time Entry Automation

This Node.js script automates creating **Redmine time entries** across a date range (weekdays only). It uses the Redmine REST API with an API key for authentication.

---

## 📦 Requirements

* Node.js 18+
* A [Redmine API key](https://www.redmine.org/projects/redmine/wiki/Rest_api#Authentication)
* A `.env` file configured with the required variables

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

## 🔑 Environment Variables

Create a `.env` file in the project root with:

```env
# Redmine credentials
REDMINE_API_KEY=your_redmine_api_key

# Task or project ID (required)
REDMINE_TASK_ID=1234

# Default hours per day (optional, defaults to 8)
REDMINE_HOURS=8

# Comments for each entry (optional)
REDMINE_COMMENTS=Worked on feature implementation

# Date range (inclusive, format YYYY-MM-DD)
REDMINE_FROM_DATE=2025-08-01
REDMINE_TO_DATE=2025-08-15
```

---

## ▶️ Usage

Run the script:

```bash
node index.js
```

The script will:

1. Generate all weekdays between `REDMINE_FROM_DATE` and `REDMINE_TO_DATE`.
2. For each date, create a **time entry** in Redmine with:

   * `issue_id` (or project\_id if adapted)
   * `hours` worked
   * `activity_id` (set to `9` in the script, usually “Development”)
   * `comments` (if provided)
   * `spent_on` date

---

## 📝 Example Output

```bash
dotenv config loaded { ... }
Creating time entry for date: 2025-08-01
Issue created: { "time_entry": { "id": 101, ... } }
Creating time entry for date: 2025-08-04
Issue created: { "time_entry": { "id": 102, ... } }
...
```
