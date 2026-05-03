import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { Resend } from "resend";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

const staffOtps = new Map();
const STAFF_OTP_TTL_MS = 10 * 60 * 1000;
const STAFF_ALLOWED_ROLES = new Set(["founder", "owner", "manager", "supervisor", "staff", "barber"]);

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function createOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createStaffToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing in .env");
  }

  return jwt.sign(
    {
      userId: String(user._id),
      id: String(user._id),
      role: user.role,
      staff: true
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function buildStaffUser(user) {
  return {
    _id: user._id,
    fullName: user.fullName || user.name || "",
    name: user.name || user.fullName || "",
    email: user.email,
    role: user.role,
    phone: user.phone || "",
    locationIds: user.locationIds || [],
    primaryLocationId: user.primaryLocationId || null,
    barberDisplayName: user.barberDisplayName || "",
    barberSpecialty: user.barberSpecialty || ""
  };
}

async function findActiveStaffByEmail(email, includePin = false) {
  let query = User.findOne({ email: normalizeEmail(email) })
    .populate("locationIds", "name slug")
    .populate("primaryLocationId", "name slug");

  if (includePin) query = query.select("+staffPinHash");

  const user = await query;

  if (!user || !STAFF_ALLOWED_ROLES.has(user.role)) return null;
  if (user.isActive === false || user.canLogin === false) return null;

  return user;
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail })
      .populate("locationIds", "name slug")
      .populate("primaryLocationId", "name slug");

    console.log("Login attempt:", normalizedEmail);
    console.log(
      "User found:",
      user
        ? {
            id: String(user._id),
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            canLogin: user.canLogin,
            isActiveType: typeof user.isActive,
            canLoginType: typeof user.canLogin
          }
        : null
    );

    if (!user) {
      console.log("Login branch: no user");
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    const isFounder = user.role === "founder";
    const isActive = user.isActive !== false;
    const canLogin = user.canLogin !== false;

    console.log("Computed login flags:", {
      isFounder,
      isActive,
      canLogin
    });

    if (!isFounder && (!isActive || !canLogin)) {
      console.log("Login branch: blocked account");
      return res.status(403).json({
        message: "This account is disabled"
      });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    console.log("Password match:", passwordOk);

    if (!passwordOk) {
      console.log("Login branch: invalid password");
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT_SECRET is missing in .env"
      });
    }

    const resolvedPermissions =
      user.role === "founder" ? ["*"] : Array.isArray(user.permissions) ? user.permissions : [];

    const token = jwt.sign(
      {
        userId: String(user._id),
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("Login branch: success");

    return res.json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName || user.name || "",
        name: user.name || user.fullName || "",
        email: user.email,
        role: user.role,
        phone: user.phone || "",
        locationIds: user.locationIds || [],
        primaryLocationId: user.primaryLocationId || null,
        permissions: resolvedPermissions
      }
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({
      message: "Login failed",
      error: error.message
    });
  }
});


router.post("/staff/pin-login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const pin = String(req.body.pin || "").trim();

    if (!email || !pin) {
      return res.status(400).json({ message: "Staff email and PIN are required" });
    }

    const user = await findActiveStaffByEmail(email, true);

    if (!user || !user.staffPinHash) {
      return res.status(401).json({ message: "Invalid staff login details" });
    }

    const pinOk = await bcrypt.compare(pin, user.staffPinHash);

    if (!pinOk) {
      return res.status(401).json({ message: "Invalid staff login details" });
    }

    const token = createStaffToken(user);

    return res.json({
      message: "Staff login successful",
      token,
      user: buildStaffUser(user)
    });
  } catch (error) {
    console.error("Staff PIN login failed:", error);
    return res.status(500).json({ message: "Staff login failed", error: error.message });
  }
});

router.post("/staff/email/start", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid staff email" });
    }

    const user = await findActiveStaffByEmail(email);

    if (!user) {
      return res.status(404).json({ message: "No active staff account found for this email" });
    }

    const code = createOtpCode();
    staffOtps.set(email, {
      code,
      attempts: 0,
      expires: Date.now() + STAFF_OTP_TTL_MS
    });

    if (!process.env.RESEND_API_KEY) {
      console.log(`Staff OTP for ${email}: ${code}`);
      return res.json({ message: "Staff login code created. Check server console in development." });
    }

    const resend = new Resend(process.env.RESEND_API_KEY, {
      baseUrl: "https://api.eu.resend.com"
    });

    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Supreme Cutz <bookings@whsystems.ie>",
      to: email,
      subject: "Your Supreme Cutz Staff Login Code",
      html: `
        <div style="margin:0;padding:28px;background:#050507;color:#ffffff;font-family:Arial,sans-serif;">
          <div style="max-width:560px;margin:0 auto;border:1px solid rgba(212,175,55,.28);border-radius:24px;background:#0b0b10;padding:28px;">
            <p style="margin:0 0 12px;color:#d4af37;letter-spacing:4px;font-size:12px;font-weight:800;text-transform:uppercase;">Supreme Cutz Staff</p>
            <h1 style="margin:0 0 16px;font-size:30px;">Staff login code</h1>
            <p style="color:#cfcfcf;line-height:1.6;">Use this secure code to access your staff dashboard.</p>
            <div style="margin:22px 0;padding:20px;border-radius:18px;border:1px solid rgba(212,175,55,.35);background:rgba(212,175,55,.10);text-align:center;font-size:42px;font-weight:900;letter-spacing:10px;color:#d4af37;">${code}</div>
            <p style="color:#999;line-height:1.6;">This code expires in 10 minutes.</p>
          </div>
        </div>
      `
    });

    if (error) throw new Error(error.message || "Failed to send staff code");

    return res.json({ message: "Staff login code sent" });
  } catch (error) {
    console.error("Staff email code failed:", error);
    return res.status(500).json({ message: "Could not send staff login code", error: error.message });
  }
});

router.post("/staff/email/check", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const record = staffOtps.get(email);

    if (!record || record.expires < Date.now()) {
      staffOtps.delete(email);
      return res.status(400).json({ message: "Staff code expired. Please request a new code." });
    }

    if (record.attempts >= 5) {
      staffOtps.delete(email);
      return res.status(400).json({ message: "Too many attempts. Please request a new code." });
    }

    record.attempts += 1;

    if (record.code !== code) {
      return res.status(400).json({ message: "Invalid staff code" });
    }

    const user = await findActiveStaffByEmail(email);

    if (!user) {
      staffOtps.delete(email);
      return res.status(404).json({ message: "No active staff account found" });
    }

    staffOtps.delete(email);
    const token = createStaffToken(user);

    return res.json({
      message: "Staff login successful",
      token,
      user: buildStaffUser(user)
    });
  } catch (error) {
    console.error("Staff email check failed:", error);
    return res.status(500).json({ message: "Staff login failed", error: error.message });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  return res.json({
    user: req.user
  });
});

export default router;