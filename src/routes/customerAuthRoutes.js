import express from "express";
import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import Booking from "../models/Booking.js";

const router = express.Router();

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET missing");
  }
  return process.env.JWT_SECRET;
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone = "") {
  let value = String(phone).replace(/[\s().-]/g, "").trim();

  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (value.startsWith("0")) value = `+353${value.slice(1)}`;
  if (value.startsWith("353")) value = `+${value}`;

  return value;
}

function verifyLoginToken({ verificationToken, email, phone }) {
  if (!verificationToken) {
    return { ok: false, status: 401, message: "Please verify your code before logging in." };
  }

  try {
    const decoded = jwt.verify(verificationToken, getJwtSecret());

    if (decoded.type !== "booking_verification") {
      return { ok: false, status: 401, message: "Invalid verification token." };
    }

    if (decoded.method === "email") {
      const safeEmail = normalizeEmail(email);
      if (!decoded.email || decoded.email !== safeEmail) {
        return { ok: false, status: 401, message: "Verified email does not match login email." };
      }
      return { ok: true, method: "email", email: decoded.email, phone: "" };
    }

    if (decoded.method === "phone") {
      const safePhone = normalizePhone(phone);
      if (!decoded.phone || decoded.phone !== safePhone) {
        return { ok: false, status: 401, message: "Verified phone does not match login phone." };
      }
      return { ok: true, method: "phone", phone: decoded.phone, email: "" };
    }

    return { ok: false, status: 401, message: "Unsupported verification method." };
  } catch {
    return { ok: false, status: 401, message: "Verification expired. Please request a new code." };
  }
}

async function claimLegacyBookingsForVerifiedContact(customer, verified) {
  const conditions = [];

  // Only claim unlinked legacy bookings for the EXACT verified contact.
  // This avoids stealing history from customers with similar/empty details.
  if (verified.method === "email" && verified.email) {
    conditions.push({ customer: null, customerEmail: verified.email });
  }

  if (verified.method === "phone" && verified.phone) {
    conditions.push({ customer: null, customerPhone: verified.phone });
  }

  if (!conditions.length) return;

  await Booking.updateMany(
    { $or: conditions },
    { $set: { customer: customer._id } }
  );
}

async function recalculateCustomerStats(customer) {
  const bookings = await Booking.find({ customer: customer._id })
    .populate("service", "price")
    .sort({ createdAt: -1 });

  const completed = bookings.filter((booking) => booking.status === "completed");
  const cancelled = bookings.filter((booking) => booking.status === "cancelled");

  customer.completedVisits = completed.length;
  customer.cancelledVisits = cancelled.length;
  customer.loyaltyVisitsProgress = completed.length % 10;
  customer.totalSpend = completed.reduce((sum, booking) => {
    return sum + Number(booking.service?.price || 0);
  }, 0);

  if (typeof customer.loyaltyPoints !== "number") {
    customer.loyaltyPoints = 0;
  }

  await customer.save();
  return bookings;
}

function createCustomerToken(customer) {
  return jwt.sign(
    {
      customerId: String(customer._id),
      type: "customer"
    },
    getJwtSecret(),
    { expiresIn: "7d" }
  );
}

function getCustomerIdFromRequest(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;

  const decoded = jwt.verify(token, getJwtSecret());

  if (decoded.type === "customer" && decoded.customerId) {
    return decoded.customerId;
  }

  // Backward compatibility for older customer tokens created with { id }.
  if (decoded.id && !decoded.role) {
    return decoded.id;
  }

  return null;
}

/* =========================
   CUSTOMER LOGIN (OTP BASED)
========================= */

router.post("/login", async (req, res) => {
  try {
    const safeEmail = normalizeEmail(req.body.email);
    const safePhone = normalizePhone(req.body.phone);

    if (!safeEmail && !safePhone) {
      return res.status(400).json({ message: "Email or phone is required" });
    }

    const verified = verifyLoginToken({
      verificationToken: req.body.verificationToken,
      email: safeEmail,
      phone: safePhone
    });

    if (!verified.ok) {
      return res.status(verified.status).json({ message: verified.message });
    }

    const query =
      verified.method === "email"
        ? { email: verified.email }
        : { phone: verified.phone };

    let customer = await Customer.findOne(query);

    if (!customer) {
      customer = await Customer.create({
        fullName: "Customer",
        email: verified.method === "email" ? verified.email : safeEmail,
        phone: verified.method === "phone" ? verified.phone : safePhone,
        lastVerifiedMethod: verified.method,
        lastVerifiedAt: new Date()
      });
    }

    if (customer.isActive === false) {
      return res.status(403).json({ message: "This customer account is currently blocked." });
    }

    customer.lastVerifiedMethod = verified.method;
    customer.lastVerifiedAt = new Date();

    if (safeEmail && !customer.email) customer.email = safeEmail;
    if (safePhone && !customer.phone) customer.phone = safePhone;

    await customer.save();
    await claimLegacyBookingsForVerifiedContact(customer, verified);
    await recalculateCustomerStats(customer);

    res.json({
      message: "Login successful",
      token: createCustomerToken(customer),
      customer
    });
  } catch (error) {
    res.status(500).json({
      message: "Customer login failed",
      error: error.message
    });
  }
});

/* =========================
   CUSTOMER DASHBOARD
========================= */

router.get("/me", async (req, res) => {
  try {
    const customerId = getCustomerIdFromRequest(req);

    if (!customerId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const customer = await Customer.findById(customerId).populate(
      "preferredLocationId",
      "name slug"
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    if (customer.isActive === false) {
      return res.status(403).json({ message: "Customer account blocked" });
    }

    await recalculateCustomerStats(customer);

    const bookings = await Booking.find({ customer: customer._id })
      .populate("location", "name slug")
      .populate("service", "name price durationMinutes")
      .populate("barber", "fullName name barberDisplayName")
      .sort({ createdAt: -1 });

    res.json({ customer, bookings });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch customer dashboard",
      error: error.message
    });
  }
});

export default router;
