const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const Stripe = require("stripe");
const GeminiUsage = require("../models/GeminiUsage");

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

const getSendGridUsage = async () => {
  if (!process.env.SENDGRID_API_KEY) {
    return {
      ...unavailable("SENDGRID_API_KEY is not configured."),
      used: null,
      limit: configuredLimit("SENDGRID_MONTHLY_LIMIT"),
    };
  }
  try {
    const response = await axios.get("https://api.sendgrid.com/v3/stats", {
      params: {
        start_date: monthStart(),
        end_date: new Date().toISOString().slice(0, 10),
        aggregated_by: "day",
      },
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const used = (response.data || []).reduce((total, day) => {
      const metrics = day.stats?.reduce(
        (sum, entry) => sum + (Number(entry.metrics?.requests) || 0),
        0,
      );
      return total + (metrics || 0);
    }, 0);
    return {
      connected: true,
      used,
      limit: configuredLimit("SENDGRID_MONTHLY_LIMIT"),
      message: "Current-month requests from SendGrid Statistics API.",
    };
  } catch (error) {
    return {
      ...unavailable(
        error.response?.data?.errors?.[0]?.message ||
          error.message ||
          "SendGrid usage could not be retrieved.",
      ),
      used: null,
      limit: configuredLimit("SENDGRID_MONTHLY_LIMIT"),
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
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
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
    if (!token) throw new Error("Google service account credentials are invalid.");
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

const atlasRequest = (path, params) =>
  axios.get(`https://cloud.mongodb.com/api/atlas/v2${path}`, {
    auth: {
      username: process.env.MONGODB_ATLAS_PUBLIC_KEY,
      password: process.env.MONGODB_ATLAS_PRIVATE_KEY,
    },
    headers: { Accept: "application/vnd.atlas.2023-01-01+json" },
    params,
    timeout: REQUEST_TIMEOUT_MS,
  });

const getAtlasUsage = async () => {
  const groupId = process.env.MONGODB_ATLAS_GROUP_ID;
  const publicKey = process.env.MONGODB_ATLAS_PUBLIC_KEY;
  const privateKey = process.env.MONGODB_ATLAS_PRIVATE_KEY;
  if (!groupId || !publicKey || !privateKey) {
    return {
      ...unavailable(
        "MONGODB_ATLAS_GROUP_ID, MONGODB_ATLAS_PUBLIC_KEY, and MONGODB_ATLAS_PRIVATE_KEY are required.",
      ),
      used: null,
      limit: null,
    };
  }
  try {
    const [clustersResponse, processesResponse] = await Promise.all([
      atlasRequest(`/groups/${encodeURIComponent(groupId)}/clusters`),
      atlasRequest(`/groups/${encodeURIComponent(groupId)}/processes`),
    ]);
    const clusters = clustersResponse.data?.results || [];
    const configuredCluster = process.env.MONGODB_ATLAS_CLUSTER_NAME;
    const cluster =
      clusters.find((item) => item.name === configuredCluster) || clusters[0];
    const processes = (processesResponse.data?.results || []).filter(
      (item) =>
        !configuredCluster ||
        item.clusterName === configuredCluster ||
        item.hostname?.startsWith(configuredCluster),
    );
    let used = null;
    if (cluster && processes[0]?.hostname) {
      const processId = `${processes[0].hostname}:${processes[0].port || 27017}`;
      const measurements = await atlasRequest(
        `/groups/${encodeURIComponent(groupId)}/processes/${encodeURIComponent(processId)}/measurements`,
        {
          granularity: "PT1H",
          period: "P1D",
          m: "DB_STORAGE_USED",
        },
      );
      const measurement = measurements.data?.measurements?.find(
        (item) => item.name === "DB_STORAGE_USED",
      );
      const dataPoints = measurement?.dataPoints || [];
      const latest = dataPoints.at(-1)?.value;
      used = Number.isFinite(Number(latest)) ? Number(latest) : null;
    }

    return {
      connected: true,
      used,
      limit: null,
      clusterName: cluster?.name || null,
      clusterCount: clusters.length,
      message: used == null
        ? "Atlas is connected; storage measurements are not available for the selected cluster."
        : "Latest DB_STORAGE_USED measurement from MongoDB Atlas.",
    };
  } catch (error) {
    return {
      ...unavailable(
        error.response?.data?.detail ||
          error.response?.data?.error ||
          error.message ||
          "MongoDB Atlas monitoring could not be retrieved.",
      ),
      used: null,
      limit: null,
    };
  }
};

const getCloudinaryUsage = async () => {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
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

const getExpoBuildUsage = async () => {
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  const projectId = process.env.EXPO_PROJECT_ID;
  if (!accessToken || !projectId) {
    return {
      ...unavailable("EXPO_ACCESS_TOKEN and EXPO_PROJECT_ID are required."),
      used: null,
      limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
      activeBuilds: null,
    };
  }
  try {
    const response = await axios.get(
      `https://api.expo.dev/v2/projects/${encodeURIComponent(projectId)}/builds`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 100 },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    const builds = response.data?.data || [];
    const since = sinceDate().getTime();
    return {
      connected: true,
      used: builds.filter(
        (build) => new Date(build.createdAt).getTime() >= since,
      ).length,
      limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
      activeBuilds: builds.filter((build) =>
        ["new", "in-queue", "in-progress"].includes(build.status),
      ).length,
      message: "Builds returned by the Expo EAS project API.",
    };
  } catch (error) {
    return {
      ...unavailable(error.response?.data?.message || error.message),
      used: null,
      limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
      activeBuilds: null,
    };
  }
};

const getStripeClient = () =>
  process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const getStripeUsage = async () => {
  const stripe = getStripeClient();
  if (!stripe) {
    return {
      ...unavailable("STRIPE_SECRET_KEY is not configured."),
      activeSubscriptions: null,
      transactionVolumeUSD: null,
      activeWebhooks: null,
      pendingWebhookEvents: null,
    };
  }
  try {
    const since = Math.floor(sinceDate().getTime() / 1000);
    const [subscriptions, webhookEndpoints, events, charges] = await Promise.all([
      stripe
        .subscriptions.list({ status: "all", limit: 100 })
        .autoPagingToArray({ limit: 10000 }),
      stripe.webhookEndpoints.list({ limit: 100 }),
      stripe
        .events.list({ limit: 100, created: { gte: since } })
        .autoPagingToArray({ limit: 10000 }),
      stripe
        .charges.list({ limit: 100, created: { gte: since }, paid: true })
        .autoPagingToArray({ limit: 10000 }),
    ]);
    const activeSubscriptions = subscriptions.filter((subscription) =>
      ["active", "trialing"].includes(subscription.status),
    ).length;
    const pendingWebhookEvents = events.filter(
      (event) => Number(event.pending_webhooks) > 0,
    ).length;
    const transactionVolumeUSD = charges
      .filter((charge) => charge.currency === "usd")
      .reduce((sum, charge) => sum + charge.amount, 0) / 100;
    const activeWebhooks = webhookEndpoints.data.filter(
      (endpoint) => endpoint.status === "enabled",
    ).length;
    return {
      connected: true,
      activeSubscriptions,
      transactionVolumeUSD,
      activeWebhooks,
      pendingWebhookEvents,
      message: "Live Stripe subscriptions, charges, events, and webhook endpoints.",
    };
  } catch (error) {
    return {
      ...unavailable(error.message || "Stripe metrics could not be retrieved."),
      activeSubscriptions: null,
      transactionVolumeUSD: null,
      activeWebhooks: null,
      pendingWebhookEvents: null,
    };
  }
};

const getAdminMetrics = async () => {
  const [sendgrid, gemini, atlas, cloudinary, expo, stripe] = await Promise.all([
    getSendGridUsage(),
    getGeminiUsage(),
    getAtlasUsage(),
    getCloudinaryUsage(),
    getExpoBuildUsage(),
    getStripeUsage(),
  ]);
  return { sendgrid, gemini, atlas, cloudinary, expo, stripe };
};

module.exports = {
  getAdminMetrics,
  getStripeUsage,
  getExpoBuildUsage,
};
