import express from "express";
import Customer from "../models/Customer.js";
import Booking from "../models/Booking.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone = "") {
  return String(phone).replace(/\s+/g, "").trim();
}

function buildCustomerMatch({ email, phone }) {
  const conditions = [];

  const safeEmail = normalizeEmail(email);
  const safePhone = normalizePhone(phone);

  if (safeEmail) conditions.push({ email: safeEmail });
  if (safePhone) conditions.push({ phone: safePhone });

  return conditions.length ? { $or: conditions } : null;
}

async function calculateCustomerStats(customer) {
  const match = buildCustomerMatch({
    email: customer.email,
    phone: customer.phone
  });

  if (!match) return customer;

  const bookings = await Booking.find(match)
    .populate("location", "name slug")
    .populate("service", "name price durationMinutes")
    .populate("barber", "fullName name barberDisplayName")
    .sort({ createdAt: -1 });

  const completed = bookings.filter((b) => b.status === "completed");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  const totalSpend = completed.reduce((sum, booking) => {
    return sum + Number(booking.service?.price || 0);
  }, 0);

  customer.completedVisits = completed.length;
  customer.cancelledVisits = cancelled.length;
  customer.loyaltyVisitsProgress = completed.length % 10;
  customer.loyaltyPoints = completed.length * 10;
  customer.totalSpend = totalSpend;

  await customer.save();

  return customer;
}

router.get("/", authMiddleware, async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "all");

    const query = {};

    if (status === "active") query.isActive = true;
    if (status === "blocked") query.isActive = false;

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } }
      ];
    }

    const customers = await Customer.find(query)
      .populate("preferredLocationId", "name slug")
      .sort({ updatedAt: -1 });

    res.json(customers);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch customers",
      error: error.message
    });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate(
      "preferredLocationId",
      "name slug"
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    await calculateCustomerStats(customer);

    const match = buildCustomerMatch({
      email: customer.email,
      phone: customer.phone
    });

    const bookings = match
      ? await Booking.find(match)
          .populate("location", "name slug")
          .populate("service", "name price durationMinutes")
          .populate("barber", "fullName name barberDisplayName")
          .sort({ createdAt: -1 })
      : [];

    res.json({
      customer,
      bookings
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch customer",
      error: error.message
    });
  }
});

router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const updateData = {
      fullName: req.body.fullName,
      phone: normalizePhone(req.body.phone),
      email: normalizeEmail(req.body.email),
      preferredBarber: req.body.preferredBarber || "",
      preferredLocationId: req.body.preferredLocationId || null,
      marketingEmailOptIn: Boolean(req.body.marketingEmailOptIn),
      marketingSmsOptIn: Boolean(req.body.marketingSmsOptIn),
      notes: req.body.notes || "",
      isActive: req.body.isActive !== false
    };

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        returnDocument: "after",
        runValidators: true
      }
    ).populate("preferredLocationId", "name slug");

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Customer updated successfully",
      customer
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update customer",
      error: error.message
    });
  }
});

router.put("/:id/block", authMiddleware, async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        isActive: false,
        notes: req.body.reason
          ? `${req.body.reason}\n\n${req.body.notes || ""}`.trim()
          : req.body.notes || ""
      },
      { returnDocument: "after" }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Customer blocked successfully",
      customer
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to block customer",
      error: error.message
    });
  }
});

router.put("/:id/unblock", authMiddleware, async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { returnDocument: "after" }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Customer unblocked successfully",
      customer
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to unblock customer",
      error: error.message
    });
  }
});

export default router;