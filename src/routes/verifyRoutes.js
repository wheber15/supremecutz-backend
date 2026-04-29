import express from "express";
import { Resend } from "resend";
import { createTwilioClient, getVerifyServiceSid } from "../config/twilio.js";

const router = express.Router();

const emailOtps = new Map();

function normalizeIrishPhone(phone) {
  if (!phone) return "";
  let value = String(phone).trim().replace(/\s+/g, "");

  if (value.startsWith("+")) return value;
  if (value.startsWith("00")) return `+${value.slice(2)}`;
  if (value.startsWith("0")) return `+353${value.slice(1)}`;

  return value;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
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

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is missing");
  }

  return new Resend(process.env.RESEND_API_KEY);
}

function getEmailFrom() {
  return process.env.EMAIL_FROM || "Supreme Cutz <onboarding@resend.dev>";
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
    const client = createTwilioClient();
    const serviceSid = getVerifyServiceSid();

    const check = await client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({
        to,
        code
      });

    if (check.status !== "approved") {
      return res.status(400).json({
        message: "Invalid or expired verification code",
        status: check.status
      });
    }

    res.json({
      message: "Phone verified successfully",
      approved: true,
      to
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

    const existing = emailOtps.get(email);

    if (existing?.lastSentAt && Date.now() - existing.lastSentAt < 60 * 1000) {
      return res.status(429).json({
        message: "Please wait before requesting another email code"
      });
    }

    const code = createOtpCode();

    emailOtps.set(email, {
      code,
      attempts: 0,
      lastSentAt: Date.now(),
      expires: Date.now() + 10 * 60 * 1000
    });

    const resend = getResendClient();

    const { error } = await resend.emails.send({
      from: getEmailFrom(),
      to: email,
      subject: "Your Supreme Cutz Verification Code",
      html: `
        <div style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;color:#ffffff;">
          <div style="max-width:560px;margin:0 auto;padding:28px;">
            <div style="border:1px solid rgba(212,175,55,0.25);background:#0b0b0f;border-radius:22px;padding:28px;">
              <p style="margin:0 0 14px;letter-spacing:4px;text-transform:uppercase;color:#d4af37;font-size:12px;font-weight:700;">
                Supreme Cutz
              </p>

              <h1 style="margin:0 0 14px;font-size:28px;line-height:1.15;color:#ffffff;">
                Verify your booking
              </h1>

              <p style="margin:0 0 18px;color:#cfcfcf;font-size:15px;line-height:1.6;">
                Use the secure code below to continue your appointment booking.
              </p>

              <div style="margin:22px 0;padding:22px;border-radius:18px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.25);text-align:center;">
                <div style="font-size:38px;letter-spacing:8px;font-weight:900;color:#d4af37;">
                  ${code}
                </div>
              </div>

              <p style="margin:0;color:#a9a9a9;font-size:14px;line-height:1.6;">
                This code expires in 10 minutes. If you did not request this code, you can safely ignore this email.
              </p>
            </div>
          </div>
        </div>
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

    if (record.attempts >= 5) {
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

    res.json({
      message: "Email verified",
      approved: true
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