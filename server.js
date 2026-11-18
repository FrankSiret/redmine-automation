// Local web view for Redmine time entries: a monthly calendar to see and log hours.
// Run with `npm run web` and open http://localhost:3000 (port configurable via REDMINE_WEB_PORT).
//
// The server only listens on 127.0.0.1 and proxies a small set of Redmine API calls,
// so the API key in .env never reaches the browser.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient, describeError, fetchAll, fetchTimeEntries } from "./lib/redmine.js";

dotenv.config({ quiet: true });

const HOST = "127.0.0.1";
const PORT = Number(process.env.REDMINE_WEB_PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

const missing = ["REDMINE_URL", "REDMINE_API_KEY"].filter((n) => !process.env[n]?.trim());
if (missing.length > 0) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  process.exit(1);
}

const redmineUrl = process.env.REDMINE_URL.trim().replace(/\/+$/, "");
const client = createClient({ url: redmineUrl, apiKey: process.env.REDMINE_API_KEY });

// ---------- Validation helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
};

const positiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Optional numeric defaults from .env; invalid values are ignored
const envDefault = (name, { integer = false } = {}) => {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) return null;
  return n;
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new HttpError(413, "Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });

// ---------- API handlers ----------

const slimEntry = (e) => ({
  id: e.id,
  spent_on: e.spent_on,
  hours: e.hours,
  issue_id: e.issue?.id ?? null,
  project: e.project?.name ?? null,
  activity: e.activity?.name ?? null,
  comments: e.comments ?? "",
});

const slimIssue = (i) => ({
  id: i.id,
  subject: i.subject,
  project: i.project?.name ?? null,
  status: i.status?.name ?? null,
});

const routes = {
  "GET /api/config": async () => {
    const { data } = await client.get("/users/current.json");
    return {
      redmineUrl,
      user: [data.user?.firstname, data.user?.lastname].filter(Boolean).join(" "),
      defaults: {
        taskId: envDefault("REDMINE_TASK_ID", { integer: true }),
        hours: envDefault("REDMINE_HOURS") ?? 8,
        activityId: envDefault("REDMINE_ACTIVITY_ID", { integer: true }) ?? 9,
        comments: process.env.REDMINE_COMMENTS?.trim() ?? "",
      },
    };
  },

  "GET /api/time_entries": async ({ query }) => {
    const from = query.get("from");
    const to = query.get("to");
    if (!isRealDate(from) || !isRealDate(to) || from > to) {
      throw new HttpError(400, "from and to must be valid YYYY-MM-DD dates with from <= to");
    }
    const entries = await fetchTimeEntries(client, { from, to });
    return entries.map(slimEntry);
  },

  "POST /api/time_entries": async ({ req }) => {
    const body = await readJsonBody(req);
    const issueId = positiveInt(body.issue_id);
    const activityId = positiveInt(body.activity_id);
    const hours = Number(body.hours);
    if (!issueId) throw new HttpError(400, "issue_id must be a positive integer");
    if (!activityId) throw new HttpError(400, "activity_id must be a positive integer");
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      throw new HttpError(400, "hours must be a number between 0 and 24");
    }
    if (!isRealDate(body.spent_on)) throw new HttpError(400, "spent_on must be a valid YYYY-MM-DD date");
    const comments = typeof body.comments === "string" ? body.comments.trim().slice(0, 1024) : "";

    const { data } = await client.post("/time_entries.json", {
      time_entry: {
        issue_id: issueId,
        activity_id: activityId,
        hours,
        spent_on: body.spent_on,
        comments: comments || undefined,
      },
    });
    return slimEntry(data.time_entry);
  },

  "DELETE /api/time_entries/:id": async ({ params }) => {
    const id = positiveInt(params.id);
    if (!id) throw new HttpError(400, "Invalid time entry id");
    await client.delete(`/time_entries/${id}.json`);
    return { deleted: id };
  },

  "GET /api/activities": async () => {
    const { data } = await client.get("/enumerations/time_entry_activities.json");
    return (data.time_entry_activities ?? [])
      .filter((a) => a.active !== false)
      .map((a) => ({ id: a.id, name: a.name, isDefault: Boolean(a.is_default) }));
  },

  // Issues by id (to show subjects next to time entries)
  "GET /api/issues": async ({ query }) => {
    const ids = (query.get("ids") || "")
      .split(",")
      .map(positiveInt)
      .filter(Boolean)
      .slice(0, 100);
    if (ids.length === 0) return [];
    const issues = await fetchAll(client, "/issues.json", "issues", {
      issue_id: ids.join(","),
      status_id: "*",
    });
    return issues.map(slimIssue);
  },

  // Open issues assigned to the current user (suggestions for the default task)
  "GET /api/my_issues": async () => {
    const { data } = await client.get("/issues.json", {
      params: { assigned_to_id: "me", status_id: "open", sort: "updated_on:desc", limit: 100 },
    });
    return (data.issues ?? []).map(slimIssue);
  },
};

const matchRoute = (method, pathname) => {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const names = [];
    const re = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$"
    );
    const match = pathname.match(re);
    if (match) {
      return { handler, params: Object.fromEntries(names.map((n, i) => [n, match[i + 1]])) };
    }
  }
  return null;
};

// ---------- HTTP server ----------

const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const sendJson = (res, status, payload) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
};

const handleApi = async (req, res, url) => {
  // Custom header forces a CORS preflight (which we never allow), so other websites
  // open in the browser can't trigger requests against this local proxy.
  if (req.headers["x-timesheet"] !== "1") {
    return sendJson(res, 403, { error: "Forbidden" });
  }
  const route = matchRoute(req.method, url.pathname);
  if (!route) return sendJson(res, 404, { error: "Not found" });
  try {
    const result = await route.handler({ req, query: url.searchParams, params: route.params });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    const upstream = err.response?.status;
    const status = upstream && upstream >= 400 && upstream < 500 ? upstream : 502;
    console.error(`${req.method} ${url.pathname} failed: ${describeError(err)}`);
    sendJson(res, status, { error: `Redmine: ${describeError(err)}` });
  }
};

const server = http.createServer(async (req, res) => {
  // Protect against DNS rebinding: only answer requests addressed to localhost
  if (!allowedHosts.has(req.headers.host)) {
    res.writeHead(421).end("Misdirected request");
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);

  const file = req.method === "GET" && STATIC_FILES[url.pathname];
  if (!file) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(path.join(PUBLIC_DIR, file[0]));
    res.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-cache" });
    res.end(content);
  } catch (err) {
    res.writeHead(500).end(err.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Redmine timesheet running at http://localhost:${PORT}`);
});
