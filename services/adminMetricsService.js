const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const GeminiUsage = require("../models/GeminiUsage");
const EmailUsage = require("../models/EmailUsage");
const User = require("../models/User");
const PaddleTransaction = require("../models/PaddleTransaction");
const ProcessedPaddleEvent = require("../models/ProcessedPaddleEvent");

const REQUEST_TIMEOUT_MS = 10000;
const sinceDate = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return date;
};
const monthStart = () => new Date().toISOString().slice(0, 7) + "-01";
const unavailable = (message) => ({
  connected: false,
  message,
});
const configuredLimit = (name) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const getResendUsage = async () => {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return {
      ...unavailable(
        "RESEND_API_KEY and RESEND_FROM_EMAIL must be configured.",
      ),
      used: null,
      limit: configuredLimit("RESEND_MONTHLY_LIMIT"),
    };
  }
  try {
    const usage = await EmailUsage.findOne({ month: monthStart().slice(0, 7) })
      .select("sentCount")
      .lean();
    return {
      connected: true,
      used: usage?.sentCount || 0,
      limit: configuredLimit("RESEND_MONTHLY_LIMIT"),
      source: "NutriMorph Resend send ledger",
      message:
        "Successful email sends through NutriMorph's Resend integration this month. Does not include sends made outside this application.",
    };
  } catch (error) {
    return {
      ...unavailable(
        error.message || "Resend email usage could not be retrieved.",
      ),
      used: null,
      limit: configuredLimit("RESEND_MONTHLY_LIMIT"),
    };
  }
};

const getGoogleServiceAccount = () => {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(
      fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"),
    );
  }
  return null;
};

const getGoogleMonitoringToken = async () => {
  const serviceAccount = getGoogleServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key)
    return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsignedToken = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/monitoring.read",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const assertion = `${unsignedToken}.${signer.sign(serviceAccount.private_key, "base64url")}`;
  const response = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  return response.data?.access_token || null;
};

const queryGoogleQuotaMetric = async (projectId, token, metricType) => {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const response = await axios.get(
    `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        filter: `metric.type = "${metricType}" AND resource.labels.service = "generativelanguage.googleapis.com"`,
        "interval.startTime": start.toISOString(),
        "interval.endTime": now.toISOString(),
        "aggregation.alignmentPeriod": "3600s",
        "aggregation.perSeriesAligner": "ALIGN_MAX",
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  return (response.data?.timeSeries || []).reduce((total, series) => {
    const point = series.points?.[0]?.value || {};
    const value = Number(
      point.int64Value ?? point.doubleValue ?? point.distributionValue?.mean,
    );
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
};

const getGeminiProviderQuota = async () => {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const configuredAccount =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!projectId || !configuredAccount) {
    return {
      connected: false,
      message:
        "Set GOOGLE_CLOUD_PROJECT_ID and a Monitoring-enabled Google service account for provider quota data.",
    };
  }
  try {
    const token = await getGoogleMonitoringToken();
    if (!token)
      throw new Error("Google service account credentials are invalid.");
    const [used, limit] = await Promise.all([
      queryGoogleQuotaMetric(
        projectId,
        token,
        "serviceruntime.googleapis.com/quota/allocation/usage",
      ),
      queryGoogleQuotaMetric(
        projectId,
        token,
        "serviceruntime.googleapis.com/quota/limit",
      ),
    ]);
    return {
      connected: true,
      used,
      limit: limit || null,
      message: "Current Gemini quota metrics from Google Cloud Monitoring.",
      source: "Google Cloud Monitoring",
    };
  } catch (error) {
    return {
      connected: false,
      message:
        error.response?.data?.error?.message ||
        error.message ||
        "Google Cloud Monitoring quota metrics are unavailable.",
    };
  }
};

const getGeminiUsage = async () => {
  try {
    const rows = await GeminiUsage.find({
      date: { $gte: monthStart(), $lte: new Date().toISOString().slice(0, 10) },
    }).select("apiCalls promptTokens candidateTokens");
    const providerQuota = await getGeminiProviderQuota();
    return {
      connected: providerQuota.connected,
      used: providerQuota.connected
        ? providerQuota.used
        : rows.reduce((sum, row) => sum + row.apiCalls, 0),
      limit: providerQuota.connected
        ? providerQuota.limit
        : configuredLimit("GEMINI_MONTHLY_CALL_LIMIT"),
      promptTokens: rows.reduce((sum, row) => sum + row.promptTokens, 0),
      candidateTokens: rows.reduce((sum, row) => sum + row.candidateTokens, 0),
      message: providerQuota.connected
        ? providerQuota.message
        : `Application calls and tokens are tracked by NutriMorph. ${providerQuota.message}`,
      source: providerQuota.source || "NutriMorph usage ledger",
    };
  } catch (error) {
    return {
      ...unavailable(error.message || "Gemini usage could not be retrieved."),
      used: null,
      limit: configuredLimit("GEMINI_MONTHLY_CALL_LIMIT"),
    };
  }
};

const atlasRequest = async (path, params = {}) => {
  const url = new URL(`https://cloud.mongodb.com/api/atlas/v2${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, entry));
    } else if (value != null) {
      url.searchParams.set(key, value);
    }
  }

  const { default: DigestClient } = await import("digest-fetch");
  const client = new DigestClient(
    process.env.MONGODB_ATLAS_PUBLIC_KEY,
    process.env.MONGODB_ATLAS_PRIVATE_KEY,
  );
  const response = await client.fetch(url.toString(), {
    headers: { Accept: "application/vnd.atlas.2025-03-12+json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      data?.detail || data?.error || data?.message || response.statusText;
    throw new Error(`MongoDB Atlas API returned ${response.status}: ${detail}`);
  }
  return { data };
};

const MONGOOSE_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);

// Primary MongoDB status: the live runtime connection the API actually uses
// (MONGO_URI / MONGODB_URI). Independent of the optional Atlas Admin API.
const getDatabaseStatus = async () => {
  const limitMB = configuredLimit("MONGODB_STORAGE_LIMIT_MB");
  try {
    await connectDB();
  } catch (error) {
    return {
      connected: false,
      state: MONGOOSE_STATES[mongoose.connection.readyState] || "unknown",
      used: null,
      limit: limitMB,
      message:
        "The API cannot reach MongoDB. Check MONGO_URI and the Atlas network access list for this server.",
    };
  }

  const state = MONGOOSE_STATES[mongoose.connection.readyState] || "unknown";
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return {
      connected: false,
      state,
      used: null,
      limit: limitMB,
      message: `MongoDB connection is ${state}.`,
    };
  }

  const db = mongoose.connection.db;
  const started = Date.now();
  try {
    await withTimeout(db.admin().ping(), 5000, "MongoDB ping");
  } catch (error) {
    return {
      connected: false,
      state,
      used: null,
      limit: limitMB,
      message: "MongoDB is connected but did not answer a ping.",
    };
  }
  const latencyMs = Date.now() - started;

  // dbStats works with the app's own credentials, so storage is available
  // even when the Atlas Admin API is restricted.
  let usedMB = null;
  try {
    const stats = await withTimeout(db.stats(), 5000, "MongoDB dbStats");
    const bytes = Number(stats.storageSize || 0) + Number(stats.indexSize || 0);
    usedMB = Number.isFinite(bytes) ? bytes / 1024 / 1024 : null;
  } catch {
    usedMB = null;
  }

  return {
    connected: true,
    state,
    latencyMs,
    databaseName: db.databaseName,
    used: usedMB,
    limit: limitMB,
    source: "Live Mongoose connection",
    message: `Live database connection is healthy (ping ${latencyMs} ms).`,
  };
};

const getAtlasUsage = async () => {
  const groupId =
    process.env.MONGODB_ATLAS_GROUP_ID || process.env.MONGODB_ATLAS_PROJECT_ID;
  const publicKey = process.env.MONGODB_ATLAS_PUBLIC_KEY;
  const privateKey = process.env.MONGODB_ATLAS_PRIVATE_KEY;

  // Atlas Admin API metrics are optional extras; the live DB status above is
  // what determines whether MongoDB is connected.
  if (!groupId || !publicKey || !privateKey) {
    return {
      connected: false,
      optional: true,
      used: null,
      limit: null,
      message:
        "Optional Atlas Admin API metrics are not configured. Live database status is unaffected.",
    };
  }

  try {
    const [clustersResponse, processesResponse] = await Promise.all([
      atlasRequest(`/groups/${encodeURIComponent(groupId)}/clusters`),
      atlasRequest(`/groups/${encodeURIComponent(groupId)}/processes`),
    ]);
    if (!clustersResponse.data || !processesResponse.data) {
      throw new Error("MongoDB Atlas returned incomplete usage data.");
    }
    return {
      connected: true,
      optional: true,
      used: null,
      limit: null,
      message: "Atlas Admin API access is working.",
    };
  } catch (error) {
    // Never surface raw provider errors (they can include key IDs or IPs).
    const status = Number(String(error.message).match(/returned (\d{3})/)?.[1]);
    const message =
      status === 403
        ? "Atlas Admin API metrics are restricted by the API key's IP access list. Live database status is unaffected."
        : status === 401
          ? "Atlas Admin API key was rejected. Live database status is unaffected."
          : "Atlas Admin API metrics are temporarily unavailable. Live database status is unaffected.";
    return {
      connected: false,
      optional: true,
      restricted: status === 403,
      used: null,
      limit: null,
      message,
    };
  }
};

const getCloudinaryUsage = async () => {
  const {
    CLOUDINARY_CLOUD_NAME: cloudName,
    CLOUDINARY_API_KEY: apiKey,
    CLOUDINARY_API_SECRET: apiSecret,
  } = process.env;
  if (!cloudName || !apiKey || !apiSecret) {
    return {
      ...unavailable(
        "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required.",
      ),
      used: null,
      limit: null,
    };
  }
  try {
    const response = await axios.get(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/usage`,
      {
        auth: { username: apiKey, password: apiSecret },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    const storage = response.data?.storage || {};
    return {
      connected: true,
      used: Number(storage.usage) / 1024 ** 3,
      limit: storage.limit ? Number(storage.limit) / 1024 ** 3 : null,
      message: "Current Cloudinary Admin API storage usage.",
    };
  } catch (error) {
    return {
      ...unavailable(error.response?.data?.error?.message || error.message),
      used: null,
      limit: null,
    };
  }
};

const EXPO_GRAPHQL_URL = "https://api.expo.dev/graphql";
// Expo bills builds that actually ran; queued/cancelled builds do not count.
const BILLABLE_BUILD_STATUSES = new Set(["finished", "errored"]);
const ACTIVE_BUILD_STATUSES = new Set([
  "new",
  "in_queue",
  "in_progress",
  "pending_cancel",
]);

const expoGraphql = async (query, variables, accessToken) => {
  const response = await axios.post(
    EXPO_GRAPHQL_URL,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  if (response.data?.errors?.length) {
    throw new Error(
      response.data.errors.map((error) => error.message).join("; "),
    );
  }
  return response.data?.data;
};

// The same account-level, billing-period usage the Expo dashboard and
// `eas-cli` show (e.g. "13/30"): it spans every project on the account and
// resets on the billing date, not the calendar month.
const EXPO_ACCOUNT_USAGE_QUERY = `
  query NutriMorphAdminExpoUsage($appId: String!, $currentDate: DateTime!) {
    app {
      byId(appId: $appId) {
        id
        ownerAccount {
          id
          name
          billingPeriod(date: $currentDate) { id start end }
          usageMetrics {
            EAS_BUILD: byBillingPeriod(date: $currentDate, service: BUILDS) {
              id
              planMetrics { id serviceMetric metricType value limit }
            }
          }
        }
      }
    }
  }
`;

const EXPO_BUILDS_QUERY = `
  query NutriMorphAdminBuildMetrics($appId: String!, $offset: Int!, $limit: Int!) {
    app {
      byId(appId: $appId) {
        id
        builds(offset: $offset, limit: $limit) { id status createdAt }
      }
    }
  }
`;

const getExpoAccountUsage = async (projectId, accessToken) => {
  const data = await expoGraphql(
    EXPO_ACCOUNT_USAGE_QUERY,
    { appId: projectId, currentDate: new Date().toISOString() },
    accessToken,
  );
  const account = data?.app?.byId?.ownerAccount;
  const metric = account?.usageMetrics?.EAS_BUILD?.planMetrics?.find(
    (entry) => entry.serviceMetric === "BUILDS" && entry.metricType === "BUILD",
  );
  if (!account || !metric) return null;
  return {
    used: Number(metric.value) || 0,
    limit: Number(metric.limit) > 0 ? Number(metric.limit) : null,
    billingPeriod: account.billingPeriod
      ? { start: account.billingPeriod.start, end: account.billingPeriod.end }
      : null,
    accountName: account.name,
  };
};

// Fallback when the token lacks billing permission: count this project's
// billable builds since the billing period (or calendar month) started.
const getExpoProjectBuildHistory = async (
  projectId,
  accessToken,
  periodStart,
) => {
  const pageSize = 50;
  const builds = [];
  for (let offset = 0; offset < 2000; offset += pageSize) {
    const data = await expoGraphql(
      EXPO_BUILDS_QUERY,
      { appId: projectId, offset, limit: pageSize },
      accessToken,
    );
    const app = data?.app?.byId;
    if (!app) return null;
    const page = app.builds || [];
    builds.push(...page);
    const reachedOlder = page.some(
      (build) => new Date(build.createdAt).getTime() < periodStart,
    );
    if (page.length < pageSize || reachedOlder) break;
  }
  const status = (build) => String(build.status || "").toLowerCase();
  return {
    used: builds.filter(
      (build) =>
        new Date(build.createdAt).getTime() >= periodStart &&
        BILLABLE_BUILD_STATUSES.has(status(build)),
    ).length,
    activeBuilds: builds.filter((build) =>
      ACTIVE_BUILD_STATUSES.has(status(build)),
    ).length,
  };
};

const getExpoBuildUsage = async () => {
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  const projectId = process.env.EXPO_PROJECT_ID || process.env.EAS_PROJECT_ID;
  const envLimit = configuredLimit("EXPO_MONTHLY_BUILD_LIMIT");
  if (!accessToken || !projectId) {
    return {
      ...unavailable(
        "EXPO_ACCESS_TOKEN and EXPO_PROJECT_ID (or EAS_PROJECT_ID) are required.",
      ),
      used: null,
      limit: envLimit,
      activeBuilds: null,
    };
  }

  try {
    let accountUsage = null;
    let accountUsageError = null;
    try {
      accountUsage = await getExpoAccountUsage(projectId, accessToken);
    } catch (error) {
      accountUsageError = error.message;
    }

    const periodStart = accountUsage?.billingPeriod?.start
      ? new Date(accountUsage.billingPeriod.start).getTime()
      : new Date(monthStart()).getTime();
    const history = await getExpoProjectBuildHistory(
      projectId,
      accessToken,
      periodStart,
    );
    if (!history && !accountUsage) {
      return {
        ...unavailable(
          "Expo could not find this project or the access token cannot view it. Use the EAS project UUID and a token with project access.",
        ),
        used: null,
        limit: envLimit,
        activeBuilds: null,
      };
    }

    if (accountUsage) {
      return {
        connected: true,
        used: accountUsage.used,
        // The plan's own limit is authoritative; the env var is a fallback.
        limit: accountUsage.limit ?? envLimit,
        activeBuilds: history?.activeBuilds ?? null,
        billingPeriod: accountUsage.billingPeriod,
        projectId,
        source: "Expo account billing usage",
        message: `Billable builds for the "${accountUsage.accountName}" account this billing period (all projects), matching the Expo dashboard.`,
      };
    }

    return {
      connected: true,
      used: history.used,
      limit: envLimit,
      activeBuilds: history.activeBuilds,
      billingPeriod: null,
      projectId,
      source: "Project build history",
      message:
        "Estimated from this project's finished and errored builds since the start of the month. Give the Expo token account billing access for exact dashboard figures.",
      accountUsageError,
    };
  } catch (error) {
    return {
      ...unavailable(
        error.response?.data?.errors?.[0]?.message ||
          error.response?.data?.message ||
          error.message ||
          "Expo build metrics could not be retrieved.",
      ),
      used: null,
      limit: envLimit,
      activeBuilds: null,
    };
  }
};

const getPaddleUsage = async () => {
  const configured =
    Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET) &&
    /^pri_[A-Za-z0-9_]+$/.test(process.env.PADDLE_PRICE_ID_MONTHLY || "") &&
    /^pri_[A-Za-z0-9_]+$/.test(process.env.PADDLE_PRICE_ID_YEARLY || "") &&
    (process.env.NODE_ENV !== "production" ||
      process.env.PADDLE_ENV === "production");
  if (!configured) {
    return {
      ...unavailable(
        "Set Paddle API/webhook credentials, both monthly/yearly price IDs, and PADDLE_ENV=production for production billing.",
      ),
      activeSubscriptions: null,
      transactionVolumeUSD: null,
      verifiedTransactions30d: null,
      processedWebhookEvents30d: null,
    };
  }
  try {
    const since = sinceDate();
    const [
      activeSubscriptions,
      sales,
      verifiedTransactions30d,
      processedWebhookEvents30d,
    ] = await Promise.all([
      User.countDocuments({
        isPro: true,
        subscriptionExpiresAt: { $gt: new Date() },
      }),
      PaddleTransaction.aggregate([
        { $match: { currency: "usd", paidAt: { $gte: since } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      PaddleTransaction.countDocuments({ paidAt: { $gte: since } }),
      ProcessedPaddleEvent.countDocuments({
        processedAt: { $gte: since },
      }),
    ]);
    return {
      connected: true,
      activeSubscriptions,
      transactionVolumeUSD: sales[0]?.total || 0,
      verifiedTransactions30d,
      processedWebhookEvents30d,
      activeWebhooks: null,
      message:
        "Billing metrics and payout statuses come from verified Paddle webhooks. Confirm payout destination and bank receipt with Paddle and your financial institution.",
    };
  } catch (error) {
    return {
      ...unavailable(error.message || "Paddle metrics could not be retrieved."),
      activeSubscriptions: null,
      transactionVolumeUSD: null,
      verifiedTransactions30d: null,
      processedWebhookEvents30d: null,
    };
  }
};

// RevenueCat is the primary billing provider. Reports which server settings are
// present (never their values) plus subscriber counts from our own database.
const getRevenueCatStatus = async () => {
  const secretKey = Boolean(process.env.REVENUECAT_SECRET_API_KEY?.trim());
  const webhookAuth = Boolean(process.env.REVENUECAT_WEBHOOK_AUTH?.trim());
  const entitlementId = (process.env.REVENUECAT_ENTITLEMENT_ID || "").trim();
  const missing = [
    !secretKey && "REVENUECAT_SECRET_API_KEY",
    !webhookAuth && "REVENUECAT_WEBHOOK_AUTH",
    !entitlementId && "REVENUECAT_ENTITLEMENT_ID",
  ].filter(Boolean);

  let activeSubscribers = null;
  let activeTrials = null;
  try {
    const active = {
      billingProvider: "revenuecat",
      isPro: true,
      deactivatedAt: null,
      $or: [
        { subscriptionExpiresAt: null },
        { subscriptionExpiresAt: { $gt: new Date() } },
      ],
    };
    [activeSubscribers, activeTrials] = await Promise.all([
      User.countDocuments(active),
      User.countDocuments({ ...active, subscriptionStatus: "trialing" }),
    ]);
  } catch {
    // Counts are informational; configuration status is still reported.
  }

  // The secret key verifies purchases and the webhook keeps renewals and
  // cancellations in sync. The entitlement ID falls back to "pro" on the
  // server, so it is flagged (not failed) when unset: it must match the app.
  const connected = secretKey && webhookAuth;
  return {
    connected,
    primary: true,
    checks: {
      secretKey,
      webhookAuth,
      entitlementId: entitlementId || null,
    },
    missing,
    activeSubscribers,
    activeTrials,
    message: connected
      ? missing.length
        ? 'RevenueCat is configured, but REVENUECAT_ENTITLEMENT_ID is unset (defaulting to "pro"). Set it to match the app.'
        : "RevenueCat purchase verification and webhook are configured."
      : `RevenueCat (primary billing) is missing: ${missing.join(", ")}.`,
  };
};

const getAdminMetrics = async () => {
  const [resend, gemini, database, atlas, cloudinary, expo, revenuecat, paddleRaw] =
    await Promise.all([
      getResendUsage(),
      getGeminiUsage(),
      getDatabaseStatus(),
      getAtlasUsage(),
      getCloudinaryUsage(),
      getExpoBuildUsage(),
      getRevenueCatStatus(),
      getPaddleUsage(),
    ]);
  // Paddle is an optional legacy fallback; it never marks the platform unhealthy.
  const paddle = { ...paddleRaw, optional: true, legacy: true };
  return { resend, gemini, database, atlas, cloudinary, expo, revenuecat, paddle };
};

module.exports = {
  getAdminMetrics,
  getPaddleUsage,
  getRevenueCatStatus,
  getExpoBuildUsage,
};
