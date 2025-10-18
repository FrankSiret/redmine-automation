import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const assertEnv = () => {
  const requiredVars = [
    "REDMINE_API_KEY",
    "REDMINE_URL",
    "REDMINE_TASK_ID",
    "REDMINE_FROM_DATE",
    "REDMINE_TO_DATE",
  ];
  requiredVars.forEach((varName) => {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  });
};

// helper to interpret environment truthy values
const isTruthy = (v) => typeof v === "string" && v.toLowerCase() === "true";
const REPLACE_EXISTING = isTruthy(process.env.REDMINE_REPLACE_EXISTING || "");

// Use UTC-only operations to avoid local timezone conversions impacting comparisons
const parseDateOnlyToUTC = (dateStr) => {
  // expecting YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const formatDateOnlyFromUTC = (date) => date.toISOString().slice(0, 10);

// dates between from and to, inclusive, with format YYYY-MM-DD and do not include weekends
const getDates = (from, to) => {
  const dates = [];
  const currentDate = parseDateOnlyToUTC(from);
  const endDate = parseDateOnlyToUTC(to);

  // iterate using UTC methods so time zone doesn't shift the day
  while (currentDate.getTime() <= endDate.getTime()) {
    const day = currentDate.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(formatDateOnlyFromUTC(currentDate));
    }
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  return dates;
};

// Create a time entry in Redmine
const createIssues = async (issues) => {
  const from = process.env.REDMINE_FROM_DATE;
  const to = process.env.REDMINE_TO_DATE;
  const dates = getDates(from, to);
  for (const date of dates) {
    const existingEntries =
      issues?.time_entries?.filter((entry) => entry.spent_on === date) || [];

    if (existingEntries.length > 0 && !REPLACE_EXISTING) {
      console.log(`Time entry for date ${date} already exists. Skipping...`);
      continue;
    }

    // If configured, remove existing entries for this date before creating a new one
    if (existingEntries.length > 0 && REPLACE_EXISTING) {
      for (const entry of existingEntries) {
        try {
          console.log(
            `Deleting existing time_entry ${entry.id} for ${date}...`
          );
          await axios.delete(
            `${process.env.REDMINE_URL}/time_entries/${entry.id}.json`,
            {
              headers: {
                "Content-Type": "application/json",
                "X-Redmine-API-Key": process.env.REDMINE_API_KEY,
              },
            }
          );
          console.log(`Deleted time_entry ${entry.id}`);
        } catch (err) {
          console.error(
            `Failed to delete time_entry ${entry.id}:`,
            err.response?.data || err.message
          );
        }
      }
    }

    console.log("Creating time entry for date:", date);
    try {
      const time_entry = {
        issue_id: process.env.REDMINE_TASK_ID, // Or project_id instead of issue_id
        hours: +process.env.REDMINE_HOURS || 8, // Hours spent
        activity_id: +(process.env.REDMINE_ACTIVITY_ID || 9), // ID of the activity (e.g., Development)
        spent_on: date, // Date of the time entry (YYYY-MM-DD)
        comments: process.env.REDMINE_COMMENTS, // Optional comments
      };
      const response = await axios.post(
        `${process.env.REDMINE_URL}/time_entries.json`,
        { time_entry },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Redmine-API-Key": process.env.REDMINE_API_KEY,
          },
        }
      );
      console.log("Issue created:", response.data);
    } catch (err) {
      console.error("Error:", err.response?.data || err.message);
    }
  }
};

// Find times entry between from and to dates
const findIssues = async () => {
  const from = process.env.REDMINE_FROM_DATE;
  const to = process.env.REDMINE_TO_DATE;
  console.log("Finding time entry between dates:", from, to);
  try {
    const response = await axios.get(
      `${process.env.REDMINE_URL}/time_entries.json?from=${from}&to=${to}&user_id=me`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Redmine-API-Key": process.env.REDMINE_API_KEY,
        },
      }
    );
    console.log("Issues found:", response.data);
    return response.data;
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
};

const main = async () => {
  assertEnv();
  const issues = await findIssues();
  await createIssues(issues);
  console.log("Done");
};

main();
