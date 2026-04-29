import express from "express";
import nodemailer from "nodemailer";
import { createTwilioClient, getVerifyServiceSid } from "../config/twilio.js";

const router = express.Router();

// TEMP in-memory store (for testing)
const emailOtps = new Map();

function normalizeIrishPhone(phone) {
  if (!phone) return "";
  let value = String(phone).trim().replace(/\s+/g, "");

  if (value.startsWith("+")) return value;
  if (value.startsWith("00")) return `+${value.slice(2)}`;
  if (value.startsWith("0")) return `+353${value.slice(1)}`;

  return value;
}

/* =========================
   PHONE (TWILIO)
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
   EMAIL OTP (NEW 🔥)
========================= */

// send email OTP
router.post("/email/start", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // store OTP (expires in 10 min)
    emailOtps.set(email, {
      code,
      expires: Date.now() + 10 * 60 * 1000
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Supreme Cutz" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Verification Code",
      html: `
        <h2>Supreme Cutz Verification</h2>
        <p>Your code is:</p>
        <h1>${code}</h1>
        <p>This code expires in 10 minutes.</p>
      `
    });

    res.json({ message: "Email verification code sent" });
  } catch (error) {
    console.error("Email OTP error:", error.message);
    res.status(500).json({
      message: "Failed to send email OTP",
      error: error.message
    });
  }
});

// verify email OTP
router.post("/email/check", async (req, res) => {
  try {
    const { email, code } = req.body;

    const record = emailOtps.get(email);

    if (!record) {
      return res.status(400).json({ message: "No OTP found" });
    }

    if (record.expires < Date.now()) {
      emailOtps.delete(email);
      return res.status(400).json({ message: "OTP expired" });
    }

    if (record.code !== code) {
      return res.status(400).json({ message: "Invalid OTP" });
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