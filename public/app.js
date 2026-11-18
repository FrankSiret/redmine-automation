// Monthly calendar for Redmine time entries.

const STORAGE_KEY = "redmine-timesheet:settings";

const $ = (sel) => document.querySelector(sel);

const els = {
  title: $("#month-title"),
  prev: $("#prev-month"),
  next: $("#next-month"),
  current: $("#current-month"),
  who: $("#who"),
  task: $("#set-task"),
  taskSubject: $("#task-subject"),
  hours: $("#set-hours"),
  activity: $("#set-activity"),
  comments: $("#set-comments"),
  myIssues: $("#my-issues"),
  summary: $("#summary-text"),
  fill: $("#fill-month"),
  calendar: $("#calendar"),
  grid: $("#grid"),
  status: $("#status"),
  dialog: $("#day-dialog"),
  dayTitle: $("#day-title"),
  dayTotal: $("#day-total"),
  dayEntries: $("#day-entries"),
  addForm: $("#add-form"),
  closeDialog: $("#close-dialog"),
};

const state = {
  month: null, // Date at the 1st of the visible month
  entries: [],
  issues: new Map(), // id -> { subject, project } | null when not found
  activities: [],
  config: null,
  settings: { taskId: null, hours: 8, activityId: 9, comments: "" },
  busy: new Set(), // dates with a request in flight
  selectedDate: null,
  loadToken: 0,
};

// ---------- Dates & formatting ----------

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseIso = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const todayIso = () => isoDate(new Date());

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const fmtHours = (n) => `${nf.format(n)} h`;
const round2 = (n) => Math.round(n * 100) / 100;

const monthName = (d) => d.toLocaleDateString("es-ES", { month: "long" });
const longDate = (s) =>
  parseIso(s).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = (s) => parseIso(s).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });

// First Monday on/before the 1st, last Sunday on/after the end of the month
const gridRange = (month) => {
  const start = addDays(month, -((month.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const end = addDays(last, 6 - ((last.getDay() + 6) % 7));
  return { start, end };
};

// ---------- DOM helper ----------

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) el.append(c);
  }
  return el;
};

// ---------- API ----------

const api = async (path, { method = "GET", body } = {}) => {
  const headers = { "X-Timesheet": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
};

// ---------- Status toast ----------

let statusTimer;
const showStatus = (message, kind = "info") => {
  els.status.textContent = message;
  els.status.classList.toggle("error", kind === "error");
  els.status.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (els.status.hidden = true), kind === "error" ? 7000 : 3500);
};

// ---------- Settings ----------

const loadSavedSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

const saveSettings = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch {
    // Storage unavailable (private mode): settings just won't persist
  }
};

const positiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const validHours = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : null;
};

const issueLabel = (id) => {
  const issue = state.issues.get(id);
  return issue ? `#${id} ${issue.subject}` : `#${id}`;
};

const renderTaskSubject = () => {
  const id = state.settings.taskId;
  const hint = els.taskSubject;
  hint.classList.remove("error");
  if (!id) {
    hint.textContent = els.task.value.trim() ? "Escribe un número de tarea válido" : "Elige la tarea a la que se imputan las horas";
    hint.classList.toggle("error", Boolean(els.task.value.trim()));
    return;
  }
  if (!state.issues.has(id)) {
    hint.textContent = "Buscando tarea…";
    return;
  }
  const issue = state.issues.get(id);
  if (!issue) {
    hint.textContent = `No se encontró la tarea #${id}`;
    hint.classList.add("error");
    return;
  }
  hint.textContent = issue.project ? `${issue.subject} (${issue.project})` : issue.subject;
  hint.title = hint.textContent;
};

const fillActivitySelect = (select, selectedId) => {
  select.replaceChildren(
    ...state.activities.map((a) => h("option", { value: a.id, selected: a.id === selectedId }, a.name))
  );
  // Keep an unknown configured id visible instead of silently switching activity
  if (selectedId && !state.activities.some((a) => a.id === selectedId)) {
    select.prepend(h("option", { value: selectedId, selected: true }, `Actividad ${selectedId}`));
  }
};

const renderSettings = () => {
  const s = state.settings;
  els.task.value = s.taskId ?? "";
  els.hours.value = s.hours;
  els.comments.value = s.comments;
  fillActivitySelect(els.activity, s.activityId);
  renderTaskSubject();
};

const onSettingsChange = async () => {
  const taskId = positiveInt(els.task.value.trim().replace(/^#/, ""));
  const hours = validHours(els.hours.value);
  state.settings = {
    taskId,
    hours: hours ?? state.settings.hours,
    activityId: positiveInt(els.activity.value) ?? state.settings.activityId,
    comments: els.comments.value.trim(),
  };
  saveSettings();
  renderTaskSubject();
  render();
  if (taskId) {
    await ensureIssues([taskId]);
    renderTaskSubject();
  }
};

// ---------- Data loading ----------

const ensureIssues = async (ids) => {
  const missing = [...new Set(ids)].filter((id) => id && !state.issues.has(id));
  if (missing.length === 0) return;
  try {
    const issues = await api(`/api/issues?ids=${missing.join(",")}`);
    for (const id of missing) state.issues.set(id, null);
    for (const i of issues) state.issues.set(i.id, { subject: i.subject, project: i.project });
  } catch {
    // Subjects are a nicety; leave them unresolved so they can be retried later
  }
};

const loadMonth = async () => {
  const token = ++state.loadToken;
  const { start, end } = gridRange(state.month);
  els.calendar.classList.add("loading");
  render();
  try {
    const entries = await api(`/api/time_entries?from=${isoDate(start)}&to=${isoDate(end)}`);
    if (token !== state.loadToken) return; // a newer month was requested meanwhile
    state.entries = entries;
    els.calendar.classList.remove("loading");
    render();
    await ensureIssues(entries.map((e) => e.issue_id));
    if (token === state.loadToken) render();
  } catch (err) {
    if (token !== state.loadToken) return;
    els.calendar.classList.remove("loading");
    state.entries = [];
    render();
    els.grid.replaceChildren(
      h("p", { class: "grid-message" }, `No se pudieron cargar las horas: ${err.message}`)
    );
  }
};

// ---------- Month navigation ----------

const setMonth = (month) => {
  state.month = firstOfMonth(month);
  const key = `${state.month.getFullYear()}-${pad(state.month.getMonth() + 1)}`;
  history.replaceState(null, "", `#${key}`);
  loadMonth();
};

const monthFromHash = () => {
  const m = location.hash.match(/^#(\d{4})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? new Date(Number(m[1]), month - 1, 1) : null;
};

const shiftMonth = (delta) =>
  setMonth(new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1));

// ---------- Derived day info ----------

const entriesByDate = () => {
  const map = new Map();
  for (const e of state.entries) {
    if (!map.has(e.spent_on)) map.set(e.spent_on, []);
    map.get(e.spent_on).push(e);
  }
  return map;
};

const dayInfo = (date, byDate) => {
  const key = isoDate(date);
  const entries = byDate.get(key) ?? [];
  const total = round2(entries.reduce((sum, e) => sum + e.hours, 0));
  const target = state.settings.hours;
  const weekend = isWeekend(date);
  const today = todayIso();
  let status = "empty";
  if (total >= target) status = "full";
  else if (total > 0) status = "partial";
  else if (!weekend && key < today) status = "missing";
  return {
    key,
    date,
    entries,
    total,
    remaining: round2(Math.max(0, target - total)),
    weekend,
    status,
    isToday: key === today,
    inMonth: date.getMonth() === state.month.getMonth(),
  };
};

// Weekdays of the visible month, up to today, that still need hours
const pendingDays = (byDate) => {
  const days = [];
  const last = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0);
  const today = todayIso();
  for (let d = new Date(state.month); d <= last; d = addDays(d, 1)) {
    const info = dayInfo(d, byDate);
    if (!info.weekend && info.key <= today && info.remaining > 0) days.push(info);
  }
  return days;
};

// ---------- Rendering ----------

const renderTitle = () => {
  els.title.querySelector(".m").textContent = monthName(state.month);
  els.title.querySelector(".y").textContent = state.month.getFullYear();
  const now = new Date();
  els.current.disabled =
    state.month.getFullYear() === now.getFullYear() && state.month.getMonth() === now.getMonth();
};

const chipsFor = (entries) => {
  const byIssue = new Map();
  for (const e of entries) {
    const label = e.issue_id ? `#${e.issue_id}` : e.project || "Sin tarea";
    byIssue.set(label, round2((byIssue.get(label) ?? 0) + e.hours));
  }
  const items = [...byIssue.entries()];
  const shown = items.slice(0, 3).map(([label, hours]) => {
    const id = positiveInt(label.slice(1));
    const title = id && state.issues.get(id) ? `${label} ${state.issues.get(id).subject}` : label;
    return h("li", { title }, h("b", {}, fmtHours(hours)), ` ${label}`);
  });
  if (items.length > 3) shown.push(h("li", {}, `y ${items.length - 3} más`));
  return shown;
};

const dayCell = (info) => {
  const busy = state.busy.has(info.key);
  const target = state.settings.hours;
  const classes = ["day", info.status];
  if (info.weekend) classes.push("weekend");
  if (!info.inMonth) classes.push("outside");
  if (info.isToday) classes.push("today");

  const cell = h(
    "div",
    {
      class: classes.join(" "),
      style: `--level:${Math.min(info.total / target, 1)};--ticks:${target}`,
      onclick: (e) => {
        if (!e.target.closest("button")) openDay(info.key);
      },
    },
    h("div", { class: "fill", "aria-hidden": "true" }),
    h(
      "div",
      { class: "day-head" },
      h(
        "button",
        {
          class: "day-num",
          type: "button",
          "aria-label": `${longDate(info.key)}: ${info.total ? fmtHours(info.total) : "sin horas"}. Ver detalle`,
          onclick: () => openDay(info.key),
        },
        String(info.date.getDate())
      ),
      info.total > 0 ? h("span", { class: "day-total" }, fmtHours(info.total)) : null
    ),
    h("ul", { class: "chips" }, chipsFor(info.entries)),
    info.remaining > 0
      ? h(
          "button",
          {
            class: "add",
            type: "button",
            disabled: busy,
            "aria-label": `Imputar ${fmtHours(info.remaining)} el ${longDate(info.key)}`,
            onclick: () => quickAdd(info.key, info.remaining),
          },
          busy ? "Imputando…" : `+${fmtHours(info.remaining)}`
        )
      : null
  );
  return cell;
};

const renderGrid = () => {
  const byDate = entriesByDate();
  const { start, end } = gridRange(state.month);
  const cells = [];
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push(dayCell(dayInfo(d, byDate)));
  els.grid.replaceChildren(...cells);
};

let fillArmed = false;
let fillArmTimer;
let filling = false;

const renderSummary = () => {
  const byDate = entriesByDate();
  const monthKey = isoDate(state.month).slice(0, 7);
  const total = round2(
    state.entries.filter((e) => e.spent_on.startsWith(monthKey)).reduce((s, e) => s + e.hours, 0)
  );
  const pending = pendingDays(byDate);
  const pendingHours = round2(pending.reduce((s, d) => s + d.remaining, 0));

  const parts = [h("strong", {}, fmtHours(total)), ` imputadas en ${monthName(state.month)}. `];
  if (state.month > new Date()) parts.push("Mes futuro.");
  else if (pending.length === 0) parts.push("Todo al día.");
  else
    parts.push(
      `${pending.length} ${pending.length === 1 ? "día laborable pendiente" : "días laborables pendientes"} hasta hoy.`
    );
  els.summary.replaceChildren(...parts);

  els.fill.hidden = pending.length === 0 && !filling;
  if (!filling) {
    els.fill.disabled = false;
    els.fill.classList.toggle("confirm", fillArmed);
    const days = pending.length === 1 ? "1 día" : `${pending.length} días`;
    els.fill.textContent = fillArmed
      ? `Confirmar: imputar ${fmtHours(pendingHours)} en ${days}`
      : `Completar ${days} pendientes`;
  }
};

const render = () => {
  if (!state.month) return;
  renderTitle();
  renderGrid();
  renderSummary();
  if (els.dialog.open) renderDialog();
};

// ---------- Actions ----------

const requireTask = () => {
  if (state.settings.taskId) return true;
  showStatus("Elige primero la tarea por defecto.", "error");
  els.task.focus();
  return false;
};

const createEntry = async ({ date, hours, issueId, activityId, comments }) => {
  const entry = await api("/api/time_entries", {
    method: "POST",
    body: { spent_on: date, hours, issue_id: issueId, activity_id: activityId, comments },
  });
  state.entries.push(entry);
  return entry;
};

const quickAdd = async (date, hours) => {
  if (!requireTask() || state.busy.has(date)) return;
  const { taskId, activityId, comments } = state.settings;
  state.busy.add(date);
  render();
  try {
    await createEntry({ date, hours, issueId: taskId, activityId, comments });
    showStatus(`Imputadas ${fmtHours(hours)} el ${shortDate(date)} en ${issueLabel(taskId)}.`);
  } catch (err) {
    showStatus(`No se pudo imputar el ${shortDate(date)}: ${err.message}`, "error");
  } finally {
    state.busy.delete(date);
    render();
  }
};

const fillPending = async () => {
  if (filling || !requireTask()) return;
  if (!fillArmed) {
    fillArmed = true;
    clearTimeout(fillArmTimer);
    fillArmTimer = setTimeout(() => {
      fillArmed = false;
      renderSummary();
    }, 6000);
    renderSummary();
    return;
  }
  clearTimeout(fillArmTimer);
  fillArmed = false;
  filling = true;
  els.fill.disabled = true;

  const pending = pendingDays(entriesByDate());
  const { taskId, activityId, comments } = state.settings;
  let done = 0;
  const failed = [];
  for (const day of pending) {
    els.fill.textContent = `Imputando ${done + 1} de ${pending.length}…`;
    state.busy.add(day.key);
    renderGrid();
    try {
      // Sequential on purpose: keeps Redmine load low and errors attributable to a day
      await createEntry({ date: day.key, hours: day.remaining, issueId: taskId, activityId, comments });
      done++;
    } catch (err) {
      failed.push(`${shortDate(day.key)} (${err.message})`);
    } finally {
      state.busy.delete(day.key);
    }
  }
  filling = false;
  render();
  if (failed.length) showStatus(`Imputados ${done} días. Fallaron: ${failed.join(", ")}`, "error");
  else showStatus(`Imputados ${done} días en ${issueLabel(taskId)}.`);
};

const deleteEntry = async (entry, button) => {
  if (button.dataset.armed !== "1") {
    button.dataset.armed = "1";
    button.classList.add("confirm");
    button.textContent = "Confirmar";
    setTimeout(() => {
      if (!button.isConnected) return;
      button.dataset.armed = "";
      button.classList.remove("confirm");
      button.textContent = "Borrar";
    }, 4000);
    return;
  }
  button.disabled = true;
  button.textContent = "Borrando…";
  try {
    await api(`/api/time_entries/${entry.id}`, { method: "DELETE" });
    state.entries = state.entries.filter((e) => e.id !== entry.id);
    showStatus(`Borradas ${fmtHours(entry.hours)} del ${shortDate(entry.spent_on)}.`);
  } catch (err) {
    showStatus(`No se pudo borrar: ${err.message}`, "error");
  }
  render();
};

// ---------- Day dialog ----------

const openDay = (date) => {
  state.selectedDate = date;
  renderDialog({ resetForm: true });
  if (!els.dialog.open) els.dialog.showModal();
};

const renderDialog = ({ resetForm = false } = {}) => {
  const date = state.selectedDate;
  if (!date) return;
  const info = dayInfo(parseIso(date), entriesByDate());
  els.dayTitle.textContent = longDate(date);
  els.dayTotal.textContent = info.total
    ? `${fmtHours(info.total)} imputadas${info.remaining > 0 ? `, faltan ${fmtHours(info.remaining)}` : ""}`
    : "Sin horas imputadas";

  const redmineUrl = state.config?.redmineUrl;
  els.dayEntries.replaceChildren(
    ...(info.entries.length
      ? info.entries.map((e) => {
          const issue = e.issue_id ? state.issues.get(e.issue_id) : null;
          const label = e.issue_id ? `#${e.issue_id}${issue ? ` ${issue.subject}` : ""}` : e.project || "Sin tarea";
          const meta = [e.activity, e.comments].filter(Boolean).join(". ");
          return h(
            "li",
            {},
            h("span", { class: "hours" }, nf.format(e.hours)),
            h(
              "div",
              { class: "what" },
              e.issue_id && redmineUrl
                ? h("a", { href: `${redmineUrl}/issues/${e.issue_id}`, target: "_blank", rel: "noopener" }, label)
                : h("span", {}, label),
              meta ? h("p", { class: "meta" }, meta) : null
            ),
            h(
              "button",
              { class: "delete", type: "button", onclick: (ev) => deleteEntry(e, ev.currentTarget) },
              "Borrar"
            )
          );
        })
      : [h("li", {}, h("span", { class: "empty-note" }, "Todavía no hay horas este día."))])
  );

  if (resetForm) {
    const form = els.addForm.elements;
    form.hours.value = info.remaining > 0 ? info.remaining : state.settings.hours;
    form.issue.value = state.settings.taskId ?? "";
    form.comments.value = state.settings.comments;
    fillActivitySelect(form.activity, state.settings.activityId);
  }
};

const onAddSubmit = async (ev) => {
  ev.preventDefault();
  const form = els.addForm.elements;
  const date = state.selectedDate;
  const hours = validHours(form.hours.value);
  const issueId = positiveInt(form.issue.value.trim().replace(/^#/, ""));
  const activityId = positiveInt(form.activity.value);
  if (!hours) return showStatus("Las horas deben estar entre 0 y 24.", "error");
  if (!issueId) return showStatus("Escribe un número de tarea válido.", "error");

  const submit = els.addForm.querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Imputando…";
  state.busy.add(date);
  let created = false;
  try {
    await createEntry({ date, hours, issueId, activityId, comments: form.comments.value.trim() });
    await ensureIssues([issueId]);
    created = true;
    showStatus(`Imputadas ${fmtHours(hours)} el ${shortDate(date)} en ${issueLabel(issueId)}.`);
  } catch (err) {
    showStatus(`No se pudo imputar: ${err.message}`, "error");
  } finally {
    state.busy.delete(date);
    submit.disabled = false;
    submit.textContent = "Imputar horas";
    render();
  }
  if (created) renderDialog({ resetForm: true });
};

// ---------- Init ----------

const bindEvents = () => {
  els.prev.addEventListener("click", () => shiftMonth(-1));
  els.next.addEventListener("click", () => shiftMonth(1));
  els.current.addEventListener("click", () => setMonth(new Date()));
  els.fill.addEventListener("click", fillPending);
  els.closeDialog.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (e) => {
    if (e.target === els.dialog) els.dialog.close(); // click on backdrop
  });
  els.addForm.addEventListener("submit", onAddSubmit);
  for (const el of [els.task, els.hours, els.activity, els.comments]) {
    el.addEventListener("change", onSettingsChange);
  }

  // ← / → change month (when not typing and no dialog is open)
  document.addEventListener("keydown", (e) => {
    if (els.dialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowLeft") shiftMonth(-1);
    if (e.key === "ArrowRight") shiftMonth(1);
  });

  window.addEventListener("hashchange", () => {
    const m = monthFromHash();
    if (m && m.getTime() !== state.month.getTime()) setMonth(m);
  });
};

const init = async () => {
  bindEvents();
  state.month = monthFromHash() ?? firstOfMonth(new Date());
  renderTitle();

  try {
    state.config = await api("/api/config");
  } catch (err) {
    els.grid.replaceChildren(
      h(
        "p",
        { class: "grid-message" },
        `No se pudo conectar con Redmine: ${err.message}. Revisa REDMINE_URL y REDMINE_API_KEY en el .env y reinicia el servidor.`
      )
    );
    return;
  }

  els.who.textContent = state.config.user ? `Horas de ${state.config.user}` : "";
  const saved = loadSavedSettings();
  state.settings = {
    taskId: positiveInt(saved.taskId) ?? state.config.defaults.taskId,
    hours: validHours(saved.hours) ?? state.config.defaults.hours,
    activityId: positiveInt(saved.activityId) ?? state.config.defaults.activityId,
    comments: typeof saved.comments === "string" ? saved.comments : state.config.defaults.comments,
  };

  const [activities, myIssues] = await Promise.allSettled([api("/api/activities"), api("/api/my_issues")]);
  if (activities.status === "fulfilled") state.activities = activities.value;
  if (myIssues.status === "fulfilled") {
    for (const i of myIssues.value) state.issues.set(i.id, { subject: i.subject, project: i.project });
    els.myIssues.replaceChildren(
      ...myIssues.value.map((i) => h("option", { value: i.id }, `#${i.id} ${i.subject}`))
    );
  }

  renderSettings();
  if (state.settings.taskId) ensureIssues([state.settings.taskId]).then(renderTaskSubject);
  setMonth(state.month);
};

init();
