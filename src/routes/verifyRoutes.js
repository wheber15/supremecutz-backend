import express from "express";
import jwt from "jsonwebtoken";
import { Resend } from "resend";
import { createTwilioClient, getVerifyServiceSid } from "../config/twilio.js";

const router = express.Router();

const RESEND_BASE_URL = "https://api.eu.resend.com";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const VERIFICATION_TOKEN_TTL = "30m";

const emailOtps = new Map();
const emailRateLimit = new Map();
const phoneRateLimit = new Map();

const BLOCKED_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "tempmail.com",
  "10minutemail.com",
  "guerrillamail.com",
  "yopmail.com",
  "sharklasers.com",
  "trashmail.com"
]);

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing");
  }

  return process.env.JWT_SECRET;
}

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is missing");
  }

  return new Resend(process.env.RESEND_API_KEY, {
    baseUrl: RESEND_BASE_URL
  });
}

function getEmailFrom() {
  return process.env.EMAIL_FROM || "Supreme Cutz <bookings@whsystems.ie>";
}

function normalizeIrishPhone(phone) {
  if (!phone) return "";

  let value = String(phone)
    .trim()
    .replace(/[\s().-]/g, "");

  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (value.startsWith("0")) value = `+353${value.slice(1)}`;
  if (value.startsWith("353")) value = `+${value}`;

  return value;
}

function isValidIrishPhone(phone) {
  return /^\+3538\d{8}$/.test(phone);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function getEmailDomain(email) {
  return normalizeEmail(email).split("@")[1] || "";
}

function createOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanupExpiredEmailOtps() {
  const now = Date.now();

  for (const [email, record] of emailOtps.entries()) {
    if (!record || record.expires < now) {
      emailOtps.delete(email);
    }
  }
}

function cleanupRateLimit(store) {
  const now = Date.now();

  for (const [key, record] of store.entries()) {
    if (!record || record.resetAt < now) {
      store.delete(key);
    }
  }
}

function checkRateLimit(store, key, limit = 5, windowMs = 15 * 60 * 1000) {
  cleanupRateLimit(store);

  const now = Date.now();
  const record = store.get(key) || {
    count: 0,
    resetAt: now + windowMs
  };

  if (record.count >= limit) {
    return false;
  }

  record.count += 1;
  store.set(key, record);
  return true;
}

function createVerificationToken({ method, phone = "", email = "" }) {
  return jwt.sign(
    {
      type: "booking_verification",
      method,
      phone,
      email
    },
    getJwtSecret(),
    { expiresIn: VERIFICATION_TOKEN_TTL }
  );
}

/* =========================
   PHONE OTP - TWILIO
========================= */

router.post("/start", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const to = normalizeIrishPhone(phone);

    if (!isValidIrishPhone(to)) {
      return res.status(400).json({
        message: "Invalid Irish mobile number. Use format 08XXXXXXXX or +3538XXXXXXXX."
      });
    }

    const rateKey = `${req.ip}:${to}`;
    if (!checkRateLimit(phoneRateLimit, rateKey, 5)) {
      return res.status(429).json({
        message: "Too many SMS verification attempts. Please wait before trying again."
      });
    }

    const client = createTwilioClient();
    const serviceSid = getVerifyServiceSid();

    const verification = await client.verify.v2
      .services(serviceSid)
      .verifications.create({
        to,
        channel: "sms"
      });

    res.json({
      message: "Verification code sent",
      to,
      status: verification.status
    });
  } catch (error) {
    console.error("Verify start error:", error.message);

    res.status(500).json({
      message: "Failed to send verification code",
      error: error.message
    });
  }
});

router.post("/check", async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: "Phone and code are required" });
    }

    const to = normalizeIrishPhone(phone);

    if (!isValidIrishPhone(to)) {
      return res.status(400).json({
        message: "Invalid Irish mobile number. Use format 08XXXXXXXX or +3538XXXXXXXX."
      });
    }

    const client = createTwilioClient();
    const serviceSid = getVerifyServiceSid();

    const check = await client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({
        to,
        code: String(code).trim()
      });

    if (check.status !== "approved") {
      return res.status(400).json({
        message: "Invalid or expired verification code",
        status: check.status
      });
    }

    const verificationToken = createVerificationToken({
      method: "phone",
      phone: to
    });

    res.json({
      message: "Phone verified successfully",
      approved: true,
      to,
      verificationToken
    });
  } catch (error) {
    console.error("Verify check error:", error.message);

    res.status(500).json({
      message: "Failed to verify code",
      error: error.message
    });
  }
});

/* =========================
   EMAIL OTP - RESEND
========================= */

router.post("/email/start", async (req, res) => {
  try {
    cleanupExpiredEmailOtps();

    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address"
      });
    }

    const domain = getEmailDomain(email);
    if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
      return res.status(400).json({
        message: "Temporary email addresses are not allowed. Please use your real email."
      });
    }

    const rateKey = `${req.ip}:${email}`;
    if (!checkRateLimit(emailRateLimit, rateKey, 5)) {
      return res.status(429).json({
        message: "Too many email verification attempts. Please wait before trying again."
      });
    }

    const existing = emailOtps.get(email);

    if (existing?.lastSentAt && Date.now() - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({
        message: "Please wait before requesting another email code"
      });
    }

    const code = createOtpCode();

    emailOtps.set(email, {
      code,
      attempts: 0,
      lastSentAt: Date.now(),
      expires: Date.now() + OTP_TTL_MS
    });

    const resend = getResendClient();

    const { error } = await resend.emails.send({
      from: getEmailFrom(),
      to: email,
      subject: "Your Supreme Cutz Verification Code",
      html: `
        <!DOCTYPE html>
        <html>
          <body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;color:#ffffff;">
            <div style="max-width:620px;margin:0 auto;padding:28px 16px;">
              <div style="border:1px solid rgba(212,175,55,0.28);border-radius:28px;background:#0b0b10;padding:30px;">
                <p style="margin:0 0 14px;color:#d4af37;letter-spacing:5px;font-size:12px;font-weight:800;text-transform:uppercase;">Supreme Cutz</p>
                <h1 style="margin:0 0 16px;font-size:34px;line-height:1.05;color:#ffffff;">Verify your booking</h1>
                <p style="margin:0 0 24px;color:#d7d7d7;font-size:16px;line-height:1.7;">Use the secure code below to continue your appointment booking.</p>
                <div style="border:1px solid rgba(212,175,55,0.35);background:rgba(212,175,55,0.10);border-radius:22px;padding:22px;text-align:center;margin:22px 0;">
                  <div style="font-size:46px;letter-spacing:10px;font-weight:900;color:#d4af37;">${code}</div>
                </div>
                <p style="margin:0;color:#a9a9a9;font-size:14px;line-height:1.6;">This code expires in 10 minutes. If you did not request this code, you can safely ignore this email.</p>
              </div>
              <p style="text-align:center;color:#777;font-size:12px;margin-top:18px;">Supreme Cutz · Premium Barber Experience</p>
            </div>
          </body>
        </html>
      `
    });

    if (error) {
      throw new Error(error.message || "Resend failed to send email");
    }

    res.json({
      message: "Email verification code sent"
    });
  } catch (error) {
    console.error("Email OTP error:", error.message);

    res.status(500).json({
      message: "Failed to send email OTP",
      error: error.message
    });
  }
});

router.post("/email/check", async (req, res) => {
  try {
    cleanupExpiredEmailOtps();

    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({
        message: "Email and code are required"
      });
    }

    const record = emailOtps.get(email);

    if (!record) {
      return res.status(400).json({
        message: "No OTP found or OTP expired"
      });
    }

    if (record.expires < Date.now()) {
      emailOtps.delete(email);

      return res.status(400).json({
        message: "OTP expired"
      });
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      emailOtps.delete(email);

      return res.status(400).json({
        message: "Too many attempts. Please request a new code."
      });
    }

    record.attempts += 1;

    if (record.code !== code) {
      return res.status(400).json({
        message: "Invalid OTP"
      });
    }

    emailOtps.delete(email);

    const verificationToken = createVerificationToken({
      method: "email",
      email
    });

    res.json({
      message: "Email verified",
      approved: true,
      email,
      verificationToken
    });
  } catch (error) {
    console.error("Email verify error:", error.message);

    res.status(500).json({
      message: "Failed to verify email",
      error: error.message
    });
  }
});

export default router;
