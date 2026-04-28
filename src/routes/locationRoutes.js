import express from "express";
import Location from "../models/Location.js";
import User from "../models/User.js";
import authMiddleware from "../middleware/authMiddleware.js";
import requirePermission from "../middleware/requirePermission.js";

const router = express.Router();

const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
];

function normalizeOpeningHours(openingHours = []) {
  const source = Array.isArray(openingHours) ? openingHours : [];

  return DAY_ORDER.map((day) => {
    const match = source.find((item) => item?.day === day);

    return {
      day,
      isActive:
        typeof match?.isActive === "boolean"
          ? match.isActive
          : day !== "sunday",
      open: match?.open || (day === "sunday" ? "10:00" : "09:00"),
      close: match?.close || (day === "sunday" ? "16:00" : "18:00")
    };
  });
}

function normalizeBlockedDates(blockedDates = []) {
  return Array.isArray(blockedDates)
    ? blockedDates
        .map((item) => String(item).slice(0, 10))
        .filter(Boolean)
    : [];
}

function normalizeCustomSlots(customSlots = []) {
  if (!Array.isArray(customSlots)) return [];

  return customSlots
    .map((rule) => ({
      date: rule?.date ? String(rule.date).slice(0, 10) : "",
      day: rule?.day ? String(rule.day).toLowerCase().trim() : "",
      slots: Array.isArray(rule?.slots)
        ? rule.slots.map((slot) => String(slot).trim()).filter(Boolean)
        : []
    }))
    .filter((rule) => rule.date || rule.day || rule.slots.length);
}

function normalizeLocationPayload(body = {}) {
  return {
    name: String(body.name || "").trim(),
    slug: String(body.slug || "")
      .trim()
      .toLowerCase(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    description: String(body.description || "").trim(),
    addressLine1: String(body.addressLine1 || "").trim(),
    addressLine2: String(body.addressLine2 || "").trim(),
    city: String(body.city || "").trim(),
    county: String(body.county || "").trim(),
    postcode: String(body.postcode || "").trim(),
    isActive: typeof body.isActive === "boolean" ? body.isActive : true,
    openingHours: normalizeOpeningHours(body.openingHours),
    blockedDates: normalizeBlockedDates(body.blockedDates),
    slotIntervalMinutes: Number(body.slotIntervalMinutes || 30),
    customSlots: normalizeCustomSlots(body.customSlots)
  };
}

router.get(
  "/",
  authMiddleware,
  requirePermission("locations.view"),
  async (_req, res) => {
    try {
      const locations = await Location.find().sort({ createdAt: -1 });
      res.json(locations);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/availability-editor",
  authMiddleware,
  requirePermission("locations.view"),
  async (_req, res) => {
    try {
      const [locations, barbers] = await Promise.all([
        Location.find().sort({ name: 1 }),
        User.find({
          isActive: true,
          role: {
            $in: ["barber", "staff", "supervisor", "manager", "owner", "founder"]
          }
        })
          .select(
            "name fullName email role isBookableBarber barberDisplayName barberSpecialty locationIds primaryLocationId"
          )
          .populate("locationIds", "name slug")
          .populate("primaryLocationId", "name slug")
          .sort({ fullName: 1, name: 1 })
      ]);

      res.json({
        locations,
        barbers
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to load availability editor data",
        error: error.message
      });
    }
  }
);

router.post(
  "/",
  authMiddleware,
  requirePermission("locations.create"),
  async (req, res) => {
    try {
      const payload = normalizeLocationPayload(req.body);

      if (!payload.name || !payload.slug) {
        return res.status(400).json({
          message: "name and slug are required"
        });
      }

      const location = await Location.create(payload);
      res.status(201).json(location);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put(
  "/:id",
  authMiddleware,
  requirePermission("locations.update"),
  async (req, res) => {
    try {
      const payload = normalizeLocationPayload(req.body);

      const updated = await Location.findByIdAndUpdate(
        req.params.id,
        payload,
        {
          returnDocument: "after",
          runValidators: true
        }
      );

      if (!updated) {
        return res.status(404).json({ message: "Location not found" });
      }

      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put(
  "/:id/availability",
  authMiddleware,
  requirePermission("locations.update"),
  async (req, res) => {
    try {
      const {
        openingHours,
        blockedDates,
        slotIntervalMinutes,
        customSlots,
        isActive
      } = req.body;

      const updateData = {
        openingHours: normalizeOpeningHours(openingHours),
        blockedDates: normalizeBlockedDates(blockedDates),
        slotIntervalMinutes: Number(slotIntervalMinutes || 30),
        customSlots: normalizeCustomSlots(customSlots)
      };

      if (typeof isActive === "boolean") {
        updateData.isActive = isActive;
      }

      const location = await Location.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
          returnDocument: "after",
          runValidators: true
        }
      );

      if (!location) {
        return res.status(404).json({
          message: "Location not found"
        });
      }

      res.json({
        message: "Location availability updated successfully",
        location
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to update location availability",
        error: error.message
      });
    }
  }
);

router.put(
  "/:id/barbers",
  authMiddleware,
  requirePermission("locations.update"),
  async (req, res) => {
    try {
      const { barberIds = [] } = req.body;

      const normalizedBarberIds = Array.isArray(barberIds)
        ? barberIds.filter(Boolean)
        : [];

      const location = await Location.findById(req.params.id);

      if (!location) {
        return res.status(404).json({
          message: "Location not found"
        });
      }

      await User.updateMany(
        { _id: { $in: normalizedBarberIds } },
        {
          $addToSet: { locationIds: location._id },
          isBookableBarber: true
        }
      );

      await User.updateMany(
        {
          _id: { $nin: normalizedBarberIds },
          locationIds: location._id
        },
        {
          $pull: { locationIds: location._id }
        }
      );

      const updatedBarbers = await User.find({
        locationIds: location._id,
        isActive: true
      })
        .select(
          "name fullName barberDisplayName barberSpecialty email role locationIds isBookableBarber"
        )
        .sort({ fullName: 1, name: 1 });

      res.json({
        message: "Location barbers updated successfully",
        locationId: String(location._id),
        barbers: updatedBarbers
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to update location barbers",
        error: error.message
      });
    }
  }
);

router.delete(
  "/:id",
  authMiddleware,
  requirePermission("locations.delete"),
  async (req, res) => {
    try {
      await Location.findByIdAndDelete(req.params.id);
      res.json({ message: "Location deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;