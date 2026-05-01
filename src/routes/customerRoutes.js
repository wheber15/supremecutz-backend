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

async function getCustomerBookings(customer) {
  const match = buildCustomerMatch({
    email: customer.email,
    phone: customer.phone
  });

  if (!match) return [];

  return Booking.find(match)
    .populate("location", "name slug")
    .populate("service", "name price durationMinutes")
    .populate("barber", "fullName name barberDisplayName")
    .sort({ createdAt: -1 });
}

async function calculateCustomerStats(customer) {
  const bookings = await getCustomerBookings(customer);
  const completed = bookings.filter((b) => b.status === "completed");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  const totalSpend = completed.reduce((sum, booking) => {
    return sum + Number(booking.service?.price || 0);
  }, 0);

  customer.completedVisits = completed.length;
  customer.cancelledVisits = cancelled.length;
  customer.loyaltyVisitsProgress = completed.length % 10;
  customer.totalSpend = totalSpend;

  // IMPORTANT:
  // Do not overwrite loyaltyPoints here. Admin can manually add/remove/set points,
  // and recalculating from bookings on every refresh was wiping those changes.
  if (typeof customer.loyaltyPoints !== "number") {
    customer.loyaltyPoints = 0;
  }

  await customer.save();

  return { customer, bookings };
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

    const result = await calculateCustomerStats(customer);

    res.json(result);
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

router.patch("/:id/loyalty", authMiddleware, async (req, res) => {
  try {
    const mode = String(req.body.mode || "set");
    const rawPoints = Number(req.body.points || 0);

    if (!Number.isFinite(rawPoints)) {
      return res.status(400).json({ message: "Points must be a number" });
    }

    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const currentPoints = Number(customer.loyaltyPoints || 0);
    let nextPoints = currentPoints;

    if (mode === "add") {
      nextPoints = currentPoints + rawPoints;
    } else if (mode === "remove") {
      nextPoints = currentPoints - rawPoints;
    } else {
      nextPoints = rawPoints;
    }

    customer.loyaltyPoints = Math.max(0, Math.round(nextPoints));

    if (typeof req.body.notes === "string" && req.body.notes.trim()) {
      const stamp = new Date().toLocaleString("en-IE");
      const line = `[${stamp}] Loyalty ${mode}: ${rawPoints} point(s). ${req.body.notes.trim()}`;
      customer.notes = customer.notes ? `${line}\n${customer.notes}` : line;
    }

    await customer.save();

    res.json({
      message: "Loyalty points updated successfully",
      customer
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update loyalty points",
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
