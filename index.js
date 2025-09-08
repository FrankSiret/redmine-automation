import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// dates between from and to, inclusive, with format YYYY-MM-DD and do not include weekends
const getDates = (from, to) => {
    const dates = [];
    const currentDate = new Date(from);
    const endDate = new Date(to);

    while (currentDate <= endDate) {
        const day = currentDate.getDay();
        if (day !== 0 && day !== 6) {
            dates.push(currentDate.toISOString().split('T')[0]);
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
}

// Create a time entry in Redmine
const createIssues = async (issues) => {
    const from = process.env.REDMINE_FROM_DATE;
    const to = process.env.REDMINE_TO_DATE;
    const dates = getDates(from, to);
    dates.forEach(async date => {
        if (issues?.time_entries?.find(entry => entry.spent_on === date)) {
            console.log(`Time entry for date ${date} already exists. Skipping...`);
            return;
        }
        console.log('Creating time entry for date:', date);
        try {
            const time_entry = {
                issue_id: process.env.REDMINE_TASK_ID,           // Or project_id instead of issue_id
                hours: +process.env.REDMINE_HOURS || 8,          // Hours spent
                activity_id: 9,                                  // ID of the activity (e.g., Development)
                spent_on: date,                                  // Date of the time entry (YYYY-MM-DD)
                comments: process.env.REDMINE_COMMENTS           // Optional comments
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
    });
}

// Find times entry between from and to dates
const findIssues = async () => {
    const from = process.env.REDMINE_FROM_DATE;
    const to = process.env.REDMINE_TO_DATE;
    console.log('Finding time entry between dates:', from, to);
    try {
        const response = await axios.get(
            `${process.env.REDMINE_URL}/time_entries.json?from=${from}&to=${to}&user_id=me`,
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-Redmine-API-Key": process.env.REDMINE_API_KEY,
                }
            }
        );
        console.log("Issues found:", response.data);
        return response.data;
    } catch (err) {
        console.error("Error:", err.response?.data || err.message);
    }
}

const issues = await findIssues();

await createIssues(issues);

console.log('Done');
