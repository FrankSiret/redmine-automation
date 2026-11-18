// Shared Redmine API helpers used by the CLI (index.js) and the web view (server.js).

import axios from "axios";

export const createClient = ({ url, apiKey }) =>
  axios.create({
    baseURL: url.trim().replace(/\/+$/, ""),
    headers: { "X-Redmine-API-Key": apiKey.trim() },
    timeout: 30_000,
  });

// Human-readable message for an axios error (includes Redmine validation errors when present)
export const describeError = (err) => {
  if (!err.response) return err.message;
  const { status, data } = err.response;
  const details = Array.isArray(data?.errors) ? `: ${data.errors.join("; ")}` : "";
  return `HTTP ${status}${details}`;
};

// Fetch every item of a paginated Redmine collection
export const fetchAll = async (client, path, key, params = {}) => {
  const limit = 100;
  const items = [];
  let offset = 0;
  for (;;) {
    const { data } = await client.get(path, { params: { ...params, limit, offset } });
    const page = data[key] ?? [];
    items.push(...page);
    offset += page.length;
    if (page.length === 0 || offset >= (data.total_count ?? 0)) break;
  }
  return items;
};

// All of the current user's time entries between from and to (inclusive, YYYY-MM-DD)
export const fetchTimeEntries = (client, { from, to }) =>
  fetchAll(client, "/time_entries.json", "time_entries", { from, to, user_id: "me" });
