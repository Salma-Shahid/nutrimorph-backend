const { Resend } = require("resend");
const connectDB = require("../config/db");
const EmailUsage = require("../models/EmailUsage");

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured in the backend environment.");
  }
  return new Resend(apiKey);
};

const getFromAddress = () => {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error(
      "RESEND_FROM_EMAIL is not configured in the backend environment.",
    );
  }
  return from;
};

const recordSuccessfulSend = async () => {
  try {
    await connectDB();
    const month = new Date().toISOString().slice(0, 7);
    await EmailUsage.findOneAndUpdate(
      { month },
      { $inc: { sentCount: 1 }, $set: { lastSentAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    console.error("Could not record Resend email usage:", error);
  }
};

const sendEmail = async (options) => {
  if (!options?.email || !options?.subject) {
    throw new Error("A recipient email address and subject are required.");
  }
  if (!options.html && !options.text) {
    throw new Error("Email content is required.");
  }

  const resend = getResendClient();
  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to: options.email,
    subject: options.subject,
    ...(options.html ? { html: options.html } : {}),
    ...(options.text ? { text: options.text } : {}),
  });

  if (error) {
    throw new Error(error.message || "Resend could not send the email.");
  }

  await recordSuccessfulSend();
  return data;
};

module.exports = sendEmail;
