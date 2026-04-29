import express from "express";
import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import Booking from "../models/Booking.js";

const router = express.Router();

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone = "") {
  return String(phone).replace(/\s+/g, "").trim();
}

/* =========================
   CUSTOMER LOGIN (OTP BASED)
========================= */

router.post("/login", async (req, res) => {
  try {
    const { email, phone } = req.body;

    const safeEmail = normalizeEmail(email);
    const safePhone = normalizePhone(phone);

    if (!safeEmail && !safePhone) {
      return res.status(400).json({
        message: "Email or phone is required"
      });
    }

    let customer = await Customer.findOne({
      $or: [
        safeEmail ? { email: safeEmail } : null,
        safePhone ? { phone: safePhone } : null
      ].filter(Boolean)
    });

    // Auto-create customer if not exists
    if (!customer) {
      customer = await Customer.create({
        fullName: "Customer",
        email: safeEmail,
        phone: safePhone
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT_SECRET missing"
      });
    }

    const token = jwt.sign(
      {
        customerId: String(customer._id),
        type: "customer"
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
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
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const customer = await Customer.findById(decoded.customerId);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const bookings = await Booking.find({
      $or: [
        { customerEmail: customer.email },
        { customerPhone: customer.phone }
      ]
    })
      .populate("location", "name")
      .populate("service", "name price")
      .populate("barber", "fullName barberDisplayName")
      .sort({ createdAt: -1 });

    res.json({
      customer,
      bookings
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch customer dashboard",
      error: error.message
    });
  }
});

export default router;