import express from "express";
import { createTwilioClient, getVerifyServiceSid } from "../config/twilio.js";

const router = express.Router();

function normalizeIrishPhone(phone) {
  if (!phone) return "";
  let value = String(phone).trim().replace(/\s+/g, "");

  if (value.startsWith("+")) return value;
  if (value.startsWith("00")) return `+${value.slice(2)}`;
  if (value.startsWith("0")) return `+353${value.slice(1)}`;

  return value;
}

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

export default router;