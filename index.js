// Redmine time entry automation
// Creates one time entry in Redmine for each weekday between REDMINE_FROM_DATE and REDMINE_TO_DATE.
// It checks for existing entries and can optionally replace the ones logged on the configured issue.
//
// Required environment variables:
// - REDMINE_API_KEY: Your Redmine API key
// - REDMINE_URL: Base URL of your Redmine instance (e.g., https://redmine.example.com)
// - REDMINE_TASK_ID: ID of the issue to log time on
// - REDMINE_FROM_DATE / REDMINE_TO_DATE: Inclusive date range (YYYY-MM-DD)
//
// Optional environment variables:
// - REDMINE_HOURS: Hours per day (default 8)
// - REDMINE_ACTIVITY_ID: Activity ID (default 9, commonly "Development")
// - REDMINE_COMMENTS: Comment added to each entry
// - REDMINE_REPLACE_EXISTING: "true" to replace existing entries on REDMINE_TASK_ID
// - REDMINE_DRY_RUN: "true" to only print what would be done, without changing anything
// - REDMINE_SKIP_DATES: Comma-separated dates to skip (holidays, vacations), e.g. 2025-12-25,2025-12-26

import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const REQUIRED_VARS = [
  "REDMINE_API_KEY",
  "REDMINE_URL",
  "REDMINE_TASK_ID",
  "REDMINE_FROM_DATE",
  "REDMINE_TO_DATE",
];

// ---------- Config parsing & validation ----------

const isTruthy = (v) => typeof v === "string" && v.trim().toLowerCase() === "true";

const isBlank = (v) => v === undefined || v.trim() === "";

// Use UTC-only operations to avoid local timezone conversions impacting comparisons
const formatDateOnlyFromUTC = (date) => date.toISOString().slice(0, 10);

const parseDateOnlyToUTC = (name, dateStr) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid ${name}: "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates such as 2025-02-31 (which Date would roll over to March)
  if (formatDateOnlyFromUTC(date) !== dateStr) {
    throw new Error(`Invalid ${name}: "${dateStr}" is not a real date.`);
  }
  return date;
};

const parsePositiveNumber = (name, raw, { defaultValue, integer = false, max = Infinity } = {}) => {
  if (isBlank(raw)) return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) {
    const kind = integer ? "positive integer" : "positive number";
    const limit = Number.isFinite(max) ? ` up to ${max}` : "";
    throw new Error(`Invalid ${name}: "${raw}". Expected a ${kind}${limit}.`);
  }
  return value;
};

const loadConfig = () => {
  const env = process.env;

  const missing = REQUIRED_VARS.filter((name) => isBlank(env[name]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }

  const from = env.REDMINE_FROM_DATE.trim();
  const to = env.REDMINE_TO_DATE.trim();
  const fromDate = parseDateOnlyToUTC("REDMINE_FROM_DATE", from);
  const toDate = parseDateOnlyToUTC("REDMINE_TO_DATE", to);
  if (fromDate > toDate) {
    throw new Error(`REDMINE_FROM_DATE (${from}) must be on or before REDMINE_TO_DATE (${to}).`);
  }

  const skipDates = new Set(
    (env.REDMINE_SKIP_DATES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => formatDateOnlyFromUTC(parseDateOnlyToUTC("REDMINE_SKIP_DATES", s)))
  );

  return {
    url: env.REDMINE_URL.trim().replace(/\/+$/, ""),
    apiKey: env.REDMINE_API_KEY.trim(),
    taskId: parsePositiveNumber("REDMINE_TASK_ID", env.REDMINE_TASK_ID, { integer: true }),
    hours: parsePositiveNumber("REDMINE_HOURS", env.REDMINE_HOURS, { defaultValue: 8, max: 24 }),
    activityId: parsePositiveNumber("REDMINE_ACTIVITY_ID", env.REDMINE_ACTIVITY_ID, {
      defaultValue: 9,
      integer: true,
    }),
    comments: isBlank(env.REDMINE_COMMENTS) ? undefined : env.REDMINE_COMMENTS.trim(),
    from,
    to,
    fromDate,
    toDate,
    skipDates,
    replaceExisting: isTruthy(env.REDMINE_REPLACE_EXISTING),
    dryRun: isTruthy(env.REDMINE_DRY_RUN),
  };
};

// ---------- Helpers ----------

// Weekdays between from and to (inclusive), formatted as YYYY-MM-DD
const getWeekdays = (fromDate, toDate) => {
  const dates = [];
  const current = new Date(fromDate.getTime());
  while (current.getTime() <= toDate.getTime()) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(formatDateOnlyFromUTC(current));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};

const describeError = (err) => {
  if (!err.response) return err.message;
  const { status, data } = err.response;
  const details = Array.isArray(data?.errors) ? `: ${data.errors.join("; ")}` : "";
  return `HTTP ${status}${details}`;
};

const createClient = ({ url, apiKey }) =>
  axios.create({
    baseURL: url,
    headers: { "X-Redmine-API-Key": apiKey },
  });

// ---------- Redmine operations ----------

// Fetch all of the current user's time entries in the date range (follows pagination)
const fetchTimeEntries = async (client, { from, to }) => {
  console.log(`Fetching your time entries between ${from} and ${to}...`);
  const limit = 100;
  const entries = [];
  let offset = 0;
  for (;;) {
    const { data } = await client.get("/time_entries.json", {
      params: { from, to, user_id: "me", limit, offset },
    });
    const page = data.time_entries ?? [];
    entries.push(...page);
    offset += page.length;
    if (page.length === 0 || offset >= (data.total_count ?? 0)) break;
  }
  console.log(`Found ${entries.length} existing time entries.`);
  return entries;
};

const deleteTimeEntry = async (client, config, entry, date) => {
  if (config.dryRun) {
    console.log(`  [dry-run] Would delete time entry #${entry.id} (${entry.hours}h) for ${date}`);
    return;
  }
  await client.delete(`/time_entries/${entry.id}.json`);
  console.log(`  Deleted time entry #${entry.id} (${entry.hours}h) for ${date}`);
};

const createTimeEntry = async (client, config, date) => {
  const time_entry = {
    issue_id: config.taskId,
    hours: config.hours,
    activity_id: config.activityId,
    spent_on: date,
    comments: config.comments,
  };
  if (config.dryRun) {
    console.log(`  [dry-run] Would create ${config.hours}h on issue #${config.taskId} for ${date}`);
    return;
  }
  const { data } = await client.post("/time_entries.json", { time_entry });
  console.log(`  Created time entry #${data.time_entry?.id} (${config.hours}h) for ${date}`);
};

// Create one time entry per weekday, skipping or replacing existing ones
const createTimeEntries = async (client, config, existingEntries) => {
  const summary = { created: 0, deleted: 0, skipped: 0, failed: 0 };
  const dates = getWeekdays(config.fromDate, config.toDate);

  for (const date of dates) {
    console.log(`${date}:`);

    if (config.skipDates.has(date)) {
      console.log("  Listed in REDMINE_SKIP_DATES. Skipping.");
      summary.skipped++;
      continue;
    }

    const entriesOnDate = existingEntries.filter((e) => e.spent_on === date);
    const ownEntries = entriesOnDate.filter((e) => e.issue?.id === config.taskId);
    const otherEntries = entriesOnDate.filter((e) => e.issue?.id !== config.taskId);

    // Never touch time logged on other issues/projects; just leave that day alone
    if (otherEntries.length > 0) {
      const where = otherEntries
        .map((e) => (e.issue ? `issue #${e.issue.id}` : `project "${e.project?.name}"`))
        .join(", ");
      console.log(`  Already has time logged on ${where}. Skipping.`);
      summary.skipped++;
      continue;
    }

    if (ownEntries.length > 0 && !config.replaceExisting) {
      console.log(`  Already has time logged on issue #${config.taskId}. Skipping.`);
      summary.skipped++;
      continue;
    }

    // Replace mode: delete existing entries on the configured issue first.
    // If any deletion fails, don't create a new entry, to avoid duplicates.
    let deleteFailed = false;
    for (const entry of ownEntries) {
      try {
        await deleteTimeEntry(client, config, entry, date);
        summary.deleted++;
      } catch (err) {
        console.error(`  Failed to delete time entry #${entry.id}: ${describeError(err)}`);
        deleteFailed = true;
      }
    }
    if (deleteFailed) {
      console.error("  Not creating a new entry because a deletion failed.");
      summary.failed++;
      continue;
    }

    try {
      await createTimeEntry(client, config, date);
      summary.created++;
    } catch (err) {
      console.error(`  Failed to create time entry: ${describeError(err)}`);
      summary.failed++;
    }
  }

  return summary;
};

// ---------- Main ----------

const main = async () => {
  const config = loadConfig();
  if (config.dryRun) {
    console.log("DRY RUN: nothing will be created or deleted.\n");
  }

  const client = createClient(config);
  const existingEntries = await fetchTimeEntries(client, config);
  const summary = await createTimeEntries(client, config, existingEntries);

  const prefix = config.dryRun ? "[dry-run] " : "";
  console.log(
    `\n${prefix}Done. Created: ${summary.created}, deleted: ${summary.deleted}, ` +
      `skipped: ${summary.skipped}, failed: ${summary.failed}`
  );
  if (summary.failed > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error(`Error: ${describeError(err)}`);
  process.exitCode = 1;
});
