import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import authMiddleware from "../middleware/authMiddleware.js";
import requirePermission from "../middleware/requirePermission.js";

const router = express.Router();

function normalizeEmail(email = "") {
  return String(email).toLowerCase().trim();
}

function normalizeRole(role = "") {
  const safeRole = String(role).toLowerCase().trim();

  const allowedRoles = [
    "founder",
    "owner",
    "manager",
    "supervisor",
    "staff",
    "barber"
  ];

  return allowedRoles.includes(safeRole) ? safeRole : "staff";
}

function normalizeLocationIds(locationIds) {
  return Array.isArray(locationIds) ? locationIds.filter(Boolean) : [];
}

function normalizeSpecialties(specialties) {
  if (Array.isArray(specialties)) {
    return specialties
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof specialties === "string") {
    return specialties
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

router.get(
  "/",
  authMiddleware,
  requirePermission("users.view"),
  async (_req, res) => {
    try {
      const users = await User.find()
        .populate("locationIds", "name slug")
        .populate("primaryLocationId", "name slug")
        .select("-passwordHash -staffPinHash")
        .sort({ createdAt: -1 });

      res.json(users);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/",
  authMiddleware,
  requirePermission("users.create"),
  async (req, res) => {
    try {
      const {
        fullName,
        name,
        email,
        password,
        staffPin,
        pin,
        phone,
        role,
        permissions,
        locationIds,
        primaryLocationId,
        jobTitle,
        specialties,
        barberDisplayName,
        barberSpecialty,
        canLogin,
        isActive,
        notes
      } = req.body;

      const resolvedName = String(fullName || name || "").trim();
      const resolvedEmail = normalizeEmail(email);
      const resolvedRole = normalizeRole(role);
      const resolvedLocationIds = normalizeLocationIds(locationIds);
      const resolvedSpecialties = normalizeSpecialties(specialties);

      if (!resolvedName || !resolvedEmail || !resolvedRole) {
        return res.status(400).json({
          message: "fullName/name, email, and role are required"
        });
      }

      const existingUser = await User.findOne({ email: resolvedEmail });

      if (existingUser) {
        return res.status(409).json({ message: "Email already exists" });
      }

      const resolvedPassword = password || `TEMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const passwordHash = await bcrypt.hash(String(resolvedPassword), 10);

      const resolvedStaffPin = String(staffPin || pin || "").trim();
      const staffPinHash = resolvedStaffPin ? await bcrypt.hash(resolvedStaffPin, 10) : "";

      const isBarber = resolvedRole === "barber";

      const user = await User.create({
        fullName: resolvedName,
        name: resolvedName,
        email: resolvedEmail,
        passwordHash,
        staffPinHash,
        phone: phone || "",
        role: resolvedRole,
        permissions: Array.isArray(permissions) ? permissions : [],
        locationIds: resolvedLocationIds,
        primaryLocationId: primaryLocationId || null,
        canLogin: canLogin ?? true,
        isActive: isActive ?? true,
        notes: notes || "",
        isBookableBarber: isBarber,
        barberDisplayName: isBarber
          ? String(barberDisplayName || resolvedName).trim()
          : "",
        barberSpecialty: isBarber
          ? String(
              barberSpecialty ||
                resolvedSpecialties.join(", ") ||
                jobTitle ||
                ""
            ).trim()
          : ""
      });

      const safeUser = await User.findById(user._id)
        .populate("locationIds", "name slug")
        .populate("primaryLocationId", "name slug")
        .select("-passwordHash -staffPinHash");

      res.status(201).json(safeUser);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.put(
  "/:id",
  authMiddleware,
  requirePermission("users.update"),
  async (req, res) => {
    try {
      const updateData = { ...req.body };

      delete updateData.passwordHash;
      delete updateData.staffPinHash;

      if (updateData.email) {
        updateData.email = normalizeEmail(updateData.email);
      }

      if (updateData.role) {
        updateData.role = normalizeRole(updateData.role);
      }

      if (updateData.fullName || updateData.name) {
        const resolvedName = String(updateData.fullName || updateData.name || "").trim();
        updateData.fullName = resolvedName;
        updateData.name = resolvedName;
      }

      if ("locationIds" in updateData) {
        updateData.locationIds = normalizeLocationIds(updateData.locationIds);
      }

      if ("specialties" in updateData) {
        const resolvedSpecialties = normalizeSpecialties(updateData.specialties);
        updateData.barberSpecialty = resolvedSpecialties.join(", ");
        delete updateData.specialties;
      }

      if (updateData.jobTitle && !updateData.barberSpecialty) {
        updateData.barberSpecialty = String(updateData.jobTitle).trim();
      }

      if (updateData.password) {
        updateData.passwordHash = await bcrypt.hash(updateData.password, 10);
        delete updateData.password;
      }

      const incomingStaffPin = updateData.staffPin ?? updateData.pin;
      delete updateData.staffPin;
      delete updateData.pin;

      if (incomingStaffPin !== undefined) {
        const nextPin = String(incomingStaffPin || "").trim();

        if (nextPin) {
          updateData.staffPinHash = await bcrypt.hash(nextPin, 10);
        }
      }

      if (updateData.role === "barber") {
        updateData.isBookableBarber = true;

        if (!updateData.barberDisplayName) {
          updateData.barberDisplayName =
            updateData.fullName || updateData.name || "";
        }
      }

      const updated = await User.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
          returnDocument: "after",
          runValidators: true
        }
      )
        .populate("locationIds", "name slug")
        .populate("primaryLocationId", "name slug")
        .select("-passwordHash -staffPinHash");

      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.delete(
  "/:id",
  authMiddleware,
  requirePermission("users.delete"),
  async (req, res) => {
    try {
      await User.findByIdAndDelete(req.params.id);
      res.json({ message: "User deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;