const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const Stripe = require("stripe");
const GeminiUsage = require("../models/GeminiUsage");
const EmailUsage = require("../models/EmailUsage");

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
  const response = await client.fetch(url, {
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

const getAtlasUsage = async () => {
  const groupId =
    process.env.MONGODB_ATLAS_GROUP_ID ||
    process.env.MONGODB_ATLAS_PROJECT_ID;
  const publicKey = process.env.MONGODB_ATLAS_PUBLIC_KEY;
  const privateKey = process.env.MONGODB_ATLAS_PRIVATE_KEY;
  if (!groupId || !publicKey || !privateKey) {
    return {
      ...unavailable(
        "MONGODB_ATLAS_PUBLIC_KEY, MONGODB_ATLAS_PRIVATE_KEY, and MONGODB_ATLAS_GROUP_ID (or MONGODB_ATLAS_PROJECT_ID) are required.",
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
    const cluster = configuredCluster
      ? clusters.find((item) => item.name === configuredCluster)
      : clusters[0];
    if (configuredCluster && !cluster) {
      return {
        connected: true,
        used: null,
        limit: null,
        clusterName: configuredCluster,
        clusterCount: clusters.length,
        message:
          "Atlas credentials are valid, but MONGODB_ATLAS_CLUSTER_NAME does not match a cluster in this project.",
      };
    }
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
  const projectId =
    process.env.EXPO_PROJECT_ID || process.env.EAS_PROJECT_ID;
  if (!accessToken || !projectId) {
    return {
      ...unavailable(
        "EXPO_ACCESS_TOKEN and EXPO_PROJECT_ID (or EAS_PROJECT_ID) are required.",
      ),
      used: null,
      limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
      activeBuilds: null,
    };
  }
  try {
    const query = `
      query NutriMorphAdminBuildMetrics(
        $appId: String!
        $offset: Int!
        $limit: Int!
      ) {
        app {
          byId(appId: $appId) {
            id
            builds(offset: $offset, limit: $limit) {
              id
              status
              createdAt
            }
          }
        }
      }
    `;
    const response = await axios.post(
      "https://api.expo.dev/graphql",
      {
        query,
        variables: { appId: projectId, offset: 0, limit: 100 },
      },
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
    const app = response.data?.data?.app?.byId;
    if (!app) {
      return {
        ...unavailable(
          "Expo could not find this project or the access token cannot view it. Use the EAS project UUID and a token with project access.",
        ),
        used: null,
        limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
        activeBuilds: null,
      };
    }
    const builds = app.builds || [];
    const since = sinceDate().getTime();
    let offset = 100;
    while (
      builds.length >= offset &&
      !builds.some((build) => new Date(build.createdAt).getTime() < since)
    ) {
      if (offset >= 10000) {
        return {
          ...unavailable(
            "Expo has more than 10,000 recent builds; the usage count was not truncated.",
          ),
          used: null,
          limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
          activeBuilds: null,
        };
      }
      const nextResponse = await axios.post(
        "https://api.expo.dev/graphql",
        {
          query,
          variables: { appId: projectId, offset, limit: 100 },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
      if (nextResponse.data?.errors?.length) {
        throw new Error(
          nextResponse.data.errors
            .map((error) => error.message)
            .join("; "),
        );
      }
      const nextPage = nextResponse.data?.data?.app?.byId?.builds;
      if (!nextPage) {
        throw new Error("Expo did not return the next page of builds.");
      }
      builds.push(...nextPage);
      if (
        nextPage.length < 100 ||
        nextPage.some((build) => new Date(build.createdAt).getTime() < since)
      ) {
        break;
      }
      offset += 100;
    }

    return {
      connected: true,
      used: builds.filter(
        (build) => new Date(build.createdAt).getTime() >= since,
      ).length,
      limit: configuredLimit("EXPO_MONTHLY_BUILD_LIMIT"),
      activeBuilds: builds.filter((build) =>
        ["new", "in_queue", "in_progress"].includes(
          String(build.status).toLowerCase(),
        ),
      ).length,
      projectId,
      message: "Build metrics retrieved from the Expo EAS GraphQL API.",
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
  const [resend, gemini, atlas, cloudinary, expo, stripe] = await Promise.all([
    getResendUsage(),
    getGeminiUsage(),
    getAtlasUsage(),
    getCloudinaryUsage(),
    getExpoBuildUsage(),
    getStripeUsage(),
  ]);
  return { resend, gemini, atlas, cloudinary, expo, stripe };
};

module.exports = {
  getAdminMetrics,
  getStripeUsage,
  getExpoBuildUsage,
};
