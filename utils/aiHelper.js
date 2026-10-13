/**
 * Helper function to retry Gemini API calls with exponential backoff
 * @param {Function} apiCallFn - The async function making the Gemini API call
 * @param {number} retries - Maximum retry attempts (default: 2)
 * @param {number} delay - Initial delay in ms (default: 1000ms)
 */
async function callGeminiWithRetry(apiCallFn, retries = 2, delay = 1000) {
  try {
    return await apiCallFn();
  } catch (error) {
    // Check for rate limit (429) or temporary server errors (5xx)
    const status = error.status || error.statusCode;
    const isTransientError =
      status === 429 ||
      (status >= 500 && status < 600) ||
      error.message?.includes("429");

    if (retries > 0 && isTransientError) {
      console.warn(
        `⚠️ Gemini API busy/rate-limited. Retrying in ${delay}ms... (${retries} attempts left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Recursive call with doubled delay (Exponential Backoff)
      return callGeminiWithRetry(apiCallFn, retries - 1, delay * 2);
    }

    // If out of retries or non-transient error, throw error
    throw error;
  }
}

module.exports = { callGeminiWithRetry };
