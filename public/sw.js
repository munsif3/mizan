const CACHE_NAME = "mizan-app-v4";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/instrument-sans-latin.woff2",
  "/fonts/instrument-sans-latin-ext.woff2",
  "/fonts/instrument-serif-latin.woff2",
  "/fonts/instrument-serif-latin-ext.woff2",
  "/fonts/instrument-serif-italic-latin.woff2",
  "/fonts/instrument-serif-italic-latin-ext.woff2",
];

const NOTIFICATION_DB = "mizan-pwa-v1";
const NOTIFICATION_DB_VERSION = 1;
const NOTIFICATION_STATE_ID = "notification";
const PERIODIC_SYNC_TAG = "mizan-notifications";
const WEEKLY_NOTIFICATION_LIMIT = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SHARED_FILE_BYTES = 20 * 1024 * 1024;

const DEFAULT_NOTIFICATION_STATE = {
  version: 1,
  settings: {
    enabled: true,
    weeklyDay: 0,
    weeklyHour: 19,
    weeklyMinute: 30,
    accountReminders: false,
  },
  context: null,
  history: {},
};

// The app sends derived, non-authoritative context here when it opens. No
// ledger or statement data is fetched by this worker. The accepted messages
// are deliberately plain so the future Settings UI can configure reminders
// without coupling the worker to the React bundle:
//
// { type: "mizan:notification-state", state: {
//   settings: { enabled, weeklyDay, weeklyHour, weeklyMinute, accountReminders },
//   context: {
//     weekIso, weekNumber, payoff, merchantCount, estimateMinutes,
//     firstIncompleteStep, hasMeaningfulChange,
//     accountReminders: [{ id, label, statementDay, enabled, needsStatement }]
//   }
// } }
//
// `hasMeaningfulChange` is required for the weekly notice. This prevents a
// notification from being emitted merely because a number became smaller.

let memoryState = null;
let memoryShares = [];
let operationQueue = Promise.resolve();

function queueOperation(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => undefined);
  return next;
}

function openNotificationDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTIFICATION_DB, NOTIFICATION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state", { keyPath: "id" });
      if (!db.objectStoreNames.contains("shares")) db.createObjectStore("shares", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open Mizan's local PWA store."));
  });
}

async function readNotificationState() {
  if (memoryState) return memoryState;
  try {
    const db = await openNotificationDb();
    if (!db) return memoryState;
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("state", "readonly").objectStore("state").get(NOTIFICATION_STATE_ID);
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    memoryState = value || null;
    return memoryState;
  } catch {
    return memoryState;
  }
}

async function writeNotificationState(state) {
  memoryState = state;
  try {
    const db = await openNotificationDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const request = db.transaction("state", "readwrite").objectStore("state").put({
        id: NOTIFICATION_STATE_ID,
        value: state,
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    // An unavailable local store must not break the app shell or importer.
  }
}

async function writeSharedStatement(value) {
  memoryShares.push(value);
  try {
    const db = await openNotificationDb();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const request = db.transaction("shares", "readwrite").objectStore("shares").put(value);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    // The redirect still opens Mizan; the browser may retry the share from the
    // mail app if storage is unavailable.
  }
}

async function claimSharedStatements() {
  const claimed = [...memoryShares];
  memoryShares = [];
  try {
    const db = await openNotificationDb();
    if (!db) return claimed;
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction("shares", "readonly").objectStore("shares").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("shares", "readwrite");
      const store = transaction.objectStore("shares");
      records.forEach((record) => store.delete(record.id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    return [...claimed, ...records];
  } catch {
    return claimed;
  }
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeSettings(settings) {
  const source = settings || {};
  let weeklyDay = clampInteger(source.weeklyDay, 0, 7, 0);
  if (weeklyDay === 7) weeklyDay = 0;
  return {
    enabled: source.enabled !== false,
    weeklyDay,
    weeklyHour: clampInteger(source.weeklyHour, 0, 23, 19),
    weeklyMinute: clampInteger(source.weeklyMinute, 0, 59, 30),
    accountReminders: source.accountReminders === true,
  };
}

function normalizeAccountReminder(account) {
  if (!account || typeof account !== "object") return null;
  const id = typeof account.id === "string" ? account.id.trim() : "";
  const label = typeof account.label === "string" ? account.label.trim() : "";
  const statementDay = clampInteger(account.statementDay, 1, 28, 0);
  if (!id || !label || !statementDay) return null;
  return {
    id,
    label,
    statementDay,
    enabled: account.enabled === true,
    needsStatement: account.needsStatement === true,
  };
}

function normalizeContext(context) {
  if (!context || typeof context !== "object") return null;
  const weekIso = typeof context.weekIso === "string" && /^\d{4}-W\d{2}$/.test(context.weekIso)
    ? context.weekIso
    : "";
  const payoff = typeof context.payoff === "string" ? context.payoff.trim() : "";
  const accountReminders = Array.isArray(context.accountReminders)
    ? context.accountReminders.map(normalizeAccountReminder).filter(Boolean)
    : [];
  return {
    weekIso,
    weekNumber: clampInteger(context.weekNumber, 1, 53, 0),
    payoff,
    merchantCount: clampInteger(context.merchantCount, 0, 100000, 0),
    estimateMinutes: clampInteger(context.estimateMinutes, 1, 180, 3),
    firstIncompleteStep: clampInteger(context.firstIncompleteStep, 1, 4, 1),
    hasMeaningfulChange: context.hasMeaningfulChange === true,
    accountReminders,
  };
}

function normalizeHistory(history) {
  if (!history || typeof history !== "object") return {};
  return Object.fromEntries(Object.entries(history)
    .filter(([weekIso]) => /^\d{4}-W\d{2}$/.test(weekIso))
    .slice(-8)
    .map(([weekIso, value]) => [weekIso, {
      notifications: clampInteger(value?.notifications, 0, WEEKLY_NOTIFICATION_LIMIT, 0),
      weeklyShownAt: Number(value?.weeklyShownAt) || 0,
      snoozeUsedAt: Number(value?.snoozeUsedAt) || 0,
      snoozedUntil: Number(value?.snoozedUntil) || 0,
      weeklySnoozeShownAt: Number(value?.weeklySnoozeShownAt) || 0,
      accountReminderIds: Array.isArray(value?.accountReminderIds)
        ? value.accountReminderIds.filter((id) => typeof id === "string").slice(0, 8)
        : [],
    }]));
}

function normalizeState(state) {
  const source = state || {};
  return {
    version: 1,
    settings: normalizeSettings(source.settings),
    context: normalizeContext(source.context),
    history: normalizeHistory(source.history),
  };
}

async function getState() {
  return normalizeState(await readNotificationState() || DEFAULT_NOTIFICATION_STATE);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localWeekIso(date) {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = value.getDay() || 7;
  value.setDate(value.getDate() + 4 - day);
  const year = value.getFullYear();
  const first = new Date(year, 0, 1);
  const week = Math.ceil((((value - first) / DAY_MS) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function historyFor(state, weekIso) {
  return state.history[weekIso] || {
    notifications: 0,
    weeklyShownAt: 0,
    snoozeUsedAt: 0,
    snoozedUntil: 0,
    weeklySnoozeShownAt: 0,
    accountReminderIds: [],
  };
}

function weeklyIsDue(now, settings) {
  if (now.getDay() !== settings.weeklyDay) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= settings.weeklyHour * 60 + settings.weeklyMinute;
}

function accountReminderIsDue(account, now) {
  return now.getDate() === account.statementDay + 1 && account.needsStatement;
}

function withPeriod(value) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function weeklyPayload(context, weekIso, snoozed) {
  const weekNumber = context.weekNumber || Number((/W(\d+)/.exec(weekIso) || ["", ""])[1]) || 0;
  const merchantLabel = context.merchantCount === 1 ? "1 merchant to name" : `${context.merchantCount} merchants to name`;
  const cost = `about ${context.estimateMinutes} minute${context.estimateMinutes === 1 ? "" : "s"}`;
  const payoff = context.payoff || "This week's close is ready to turn your latest activity into a clear plan";
  return {
    title: `Week ${weekNumber} is ready to close`,
    body: `${withPeriod(payoff)} ${merchantLabel} — ${cost}.`,
    tag: `mizan-weekly-${weekIso}-${snoozed ? "snooze" : "initial"}`,
    data: {
      kind: "weekly",
      weekIso,
      url: `/#weekly-close/step-${context.firstIncompleteStep}`,
    },
    actions: [
      { action: "close", title: "Close it" },
      { action: "tomorrow", title: "Tomorrow" },
    ],
  };
}

function accountPayload(account, weekIso) {
  return {
    title: "Statement reminder",
    body: `${account.label} usually sends your statement around now.`,
    tag: `mizan-account-${account.id}-${localDateKey(new Date())}`,
    data: {
      kind: "account",
      accountId: account.id,
      weekIso,
      url: "/#catch-up",
    },
    actions: [{ action: "catch-up", title: "Catch up" }],
  };
}

async function showNotification(payload) {
  try {
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: payload.data,
      actions: payload.actions,
      renotify: false,
    });
    return true;
  } catch {
    return false;
  }
}

async function evaluateNotifications() {
  const state = await getState();
  if (!state.settings.enabled || !state.context) return;

  const now = new Date();
  const weekIso = localWeekIso(now);
  // A worker should never turn last week's derived context into this week's
  // notification. The next app open publishes a fresh context instead.
  if (state.context.weekIso && state.context.weekIso !== weekIso) return;

  const history = historyFor(state, weekIso);
  let changed = false;

  if (
    state.context.hasMeaningfulChange
    && history.weeklyShownAt
    && history.snoozeUsedAt
    && !history.weeklySnoozeShownAt
    && now.getTime() >= history.snoozedUntil
    && history.notifications < WEEKLY_NOTIFICATION_LIMIT
  ) {
    if (await showNotification(weeklyPayload(state.context, weekIso, true))) {
      history.notifications += 1;
      history.weeklySnoozeShownAt = now.getTime();
      changed = true;
    }
  } else if (
    state.context.hasMeaningfulChange
    && !history.weeklyShownAt
    && weeklyIsDue(now, state.settings)
    && history.notifications < WEEKLY_NOTIFICATION_LIMIT
  ) {
    if (await showNotification(weeklyPayload(state.context, weekIso, false))) {
      history.notifications += 1;
      history.weeklyShownAt = now.getTime();
      changed = true;
    }
  }

  if (state.settings.accountReminders && history.notifications < WEEKLY_NOTIFICATION_LIMIT) {
    const account = state.context.accountReminders.find((candidate) =>
      candidate.enabled
      && !history.accountReminderIds.includes(candidate.id)
      && accountReminderIsDue(candidate, now));
    if (account && await showNotification(accountPayload(account, weekIso))) {
      history.notifications += 1;
      history.accountReminderIds.push(account.id);
      changed = true;
    }
  }

  if (changed) {
    state.history[weekIso] = history;
    await writeNotificationState(state);
  }
}

async function registerPeriodicSync() {
  const periodicSync = self.registration.periodicSync;
  if (!periodicSync || typeof periodicSync.register !== "function") return false;
  try {
    await periodicSync.register(PERIODIC_SYNC_TAG, { minInterval: 6 * 60 * 60 * 1000 });
    return true;
  } catch {
    // Permission and browser policy can reject periodic sync. Navigation is
    // the supported fallback and evaluates the same local state on next open.
    return false;
  }
}

async function saveIncomingNotificationState(incoming) {
  const current = await getState();
  const state = normalizeState({
    ...current,
    ...incoming,
    settings: { ...current.settings, ...(incoming?.settings || {}) },
    context: incoming?.context === undefined ? current.context : incoming.context,
    history: current.history,
  });
  await writeNotificationState(state);
  await registerPeriodicSync();
  await evaluateNotifications();
}

async function snoozeWeeklyNotification(weekIso) {
  const state = await getState();
  const currentWeek = weekIso || localWeekIso(new Date());
  const history = historyFor(state, currentWeek);
  if (!history.snoozeUsedAt) {
    history.snoozeUsedAt = Date.now();
    history.snoozedUntil = Date.now() + DAY_MS;
    state.history[currentWeek] = history;
    await writeNotificationState(state);
  }
}

async function openNotificationUrl(url) {
  const target = new URL(url || "/", self.location.origin).toString();
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows[0];
  if (existing) {
    await existing.navigate(target);
    await existing.focus();
    return;
  }
  await self.clients.openWindow(target);
}

async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const files = [];
    for (const [, value] of form.entries()) {
      if (!value || typeof value === "string" || typeof value.arrayBuffer !== "function") continue;
      if (!value.size || value.size > MAX_SHARED_FILE_BYTES) continue;
      files.push({
        name: typeof value.name === "string" ? value.name : "shared-statement",
        type: typeof value.type === "string" ? value.type : "application/octet-stream",
        lastModified: Number(value.lastModified) || Date.now(),
        blob: value,
      });
    }
    await writeSharedStatement({
      id: `share_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      receivedAt: new Date().toISOString(),
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      files,
    });
  } catch {
    // Still return to Mizan. The app's regular file picker remains available.
  }
  return Response.redirect(new URL("/?share-target=statement", request.url).toString(), 303);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) event.waitUntil(queueOperation(evaluateNotifications));
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();
  if (event.action === "tomorrow" && data.kind === "weekly") {
    event.waitUntil(queueOperation(() => snoozeWeeklyNotification(data.weekIso)));
    return;
  }
  event.waitUntil(queueOperation(() => openNotificationUrl(data.url || "/")));
});

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const type = message.type;
  if (type === "mizan:notification-state" || type === "MIZAN_NOTIFICATION_STATE") {
    event.waitUntil(queueOperation(() => saveIncomingNotificationState(message.state || message)));
    return;
  }
  if (type === "mizan:notification-settings" || type === "MIZAN_NOTIFICATION_SETTINGS") {
    event.waitUntil(queueOperation(() => saveIncomingNotificationState({ settings: message.settings || message })));
    return;
  }
  if (type === "mizan:claim-shared-statements" || type === "MIZAN_CLAIM_SHARED_STATEMENTS") {
    event.waitUntil(queueOperation(async () => {
      const shares = await claimSharedStatements();
      const response = { type: "mizan:shared-statements", shares };
      if (event.ports?.[0]) event.ports[0].postMessage(response);
      else event.source?.postMessage(response);
    }));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  const isBuildAsset = url.pathname.startsWith("/assets/");
  const isNavigation = request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html";
  const isMutableShellAsset = url.pathname === "/manifest.webmanifest";
  if (!isNavigation && !isMutableShellAsset && !isBuildAsset) return;

  // Real FetchEvents always expose waitUntil. Keep the cache fallback usable
  // in lightweight Web Worker shims that only implement respondWith.
  if (isNavigation && typeof event.waitUntil === "function") {
    event.waitUntil(queueOperation(evaluateNotifications));
  }

  if (isNavigation || isMutableShellAsset) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () => (await caches.match(request)) ?? (await caches.match("/index.html")) ?? Response.error()),
    );
    return;
  }

  // Vite asset names are content-hashed, so a cached response is immutable.
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
