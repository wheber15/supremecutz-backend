import express from "express";
import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import Booking from "../models/Booking.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

/* =========================
   CUSTOMER LOGIN (OTP VERIFIED)
========================= */
router.post("/login", async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        message: "Email or phone is required"
      });
    }

    let customer;

    // 🔍 Find or create customer
    if (email) {
      customer = await Customer.findOne({ email });

      if (!customer) {
        customer = await Customer.create({
          email,
          fullName: "Customer",
          loyaltyPoints: 0,
          completedVisits: 0
        });
      }
    }

    if (phone) {
      customer = await Customer.findOne({ phone });

      if (!customer) {
        customer = await Customer.create({
          phone,
          fullName: "Customer",
          loyaltyPoints: 0,
          completedVisits: 0
        });
      }
    }

    // 🔒 Attach old bookings (IMPORTANT FIX)
    await Booking.updateMany(
      {
        customer: null,
        $or: [
          { customerEmail: customer.email },
          { customerPhone: customer.phone }
        ]
      },
      { $set: { customer: customer._id } }
    );

    // 🔐 Generate token
    const token = jwt.sign(
      { id: customer._id },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      customer
    });

  } catch (error) {
    console.error("Customer login error:", error);
    res.status(500).json({
      message: "Login failed"
    });
  }
});

/* =========================
   GET CUSTOMER DATA
========================= */
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "No token"
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const customer = await Customer.findById(decoded.id);

    if (!customer) {
      return res.status(404).json({
        message: "Customer not found"
      });
    }

    // 🔒 ONLY THEIR BOOKINGS (MAIN FIX)
    const bookings = await Booking.find({
      customer: customer._id
    }).sort({ createdAt: -1 });

    res.json({
      customer,
      bookings
    });

  } catch (error) {
    console.error("Customer fetch error:", error);
    res.status(500).json({
      message: "Failed to load customer data"
    });
  }
});

export default router;