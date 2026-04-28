import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import Service from "../models/Service.js";
import authMiddleware from "../middleware/authMiddleware.js";
import requirePermission from "../middleware/requirePermission.js";

const router = express.Router();

const serviceUploadDir = path.join(process.cwd(), "uploads", "services");

if (!fs.existsSync(serviceUploadDir)) {
  fs.mkdirSync(serviceUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, serviceUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeBase = path
      .basename(file.originalname || "service", ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);

    cb(null, `${Date.now()}-${safeBase || "service"}${ext || ".jpg"}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, and WEBP files are allowed"));
    }
    cb(null, true);
  }
});

function normalizeLocationIds(locationIds) {
  if (!locationIds) return [];
  if (Array.isArray(locationIds)) return locationIds.filter(Boolean);

  try {
    const parsed = JSON.parse(locationIds);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return String(locationIds)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

router.get(
  "/",
  authMiddleware,
  requirePermission("services.view"),
  async (_req, res) => {
    try {
      const services = await Service.find()
        .populate("locationIds", "name slug")
        .sort({ sortOrder: 1, createdAt: -1 });

      res.json(services);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch services",
        error: error.message
      });
    }
  }
);

router.post(
  "/",
  authMiddleware,
  requirePermission("services.create"),
  upload.single("image"),
  async (req, res) => {
    try {
      const locationIds = normalizeLocationIds(req.body.locationIds);

      const service = await Service.create({
        name: req.body.name || "",
        slug: String(req.body.slug || "").trim().toLowerCase(),
        price: Number(req.body.price || 0),
        durationMinutes: Number(req.body.durationMinutes || 30),
        description: req.body.description || "",
        image: req.file ? `/uploads/services/${req.file.filename}` : "",
        locationIds,
        isActive: String(req.body.isActive) === "false" ? false : true,
        showOnHomepage:
          String(req.body.showOnHomepage) === "false" ? false : true,
        showInBooking:
          String(req.body.showInBooking) === "false" ? false : true,
        sortOrder: Number(req.body.sortOrder || 0)
      });

      const populated = await Service.findById(service._id).populate(
        "locationIds",
        "name slug"
      );

      res.status(201).json(populated);
    } catch (error) {
      res.status(500).json({
        message: "Failed to create service",
        error: error.message
      });
    }
  }
);

router.put(
  "/:id",
  authMiddleware,
  requirePermission("services.update"),
  upload.single("image"),
  async (req, res) => {
    try {
      const existing = await Service.findById(req.params.id);

      if (!existing) {
        return res.status(404).json({
          message: "Service not found"
        });
      }

      const updateData = {
        name: req.body.name || "",
        slug: String(req.body.slug || "").trim().toLowerCase(),
        price: Number(req.body.price || 0),
        durationMinutes: Number(req.body.durationMinutes || 30),
        description: req.body.description || "",
        locationIds: normalizeLocationIds(req.body.locationIds),
        isActive: String(req.body.isActive) === "false" ? false : true,
        showOnHomepage:
          String(req.body.showOnHomepage) === "false" ? false : true,
        showInBooking:
          String(req.body.showInBooking) === "false" ? false : true,
        sortOrder: Number(req.body.sortOrder || 0)
      };

      if (req.file) {
        if (
          existing.image &&
          existing.image.startsWith("/uploads/") &&
          fs.existsSync(path.join(process.cwd(), existing.image.replace(/^\//, "")))
        ) {
          fs.unlinkSync(path.join(process.cwd(), existing.image.replace(/^\//, "")));
        }

        updateData.image = `/uploads/services/${req.file.filename}`;
      }

      const service = await Service.findByIdAndUpdate(req.params.id, updateData, {
        returnDocument: "after",
        runValidators: true
      }).populate("locationIds", "name slug");

      res.json(service);
    } catch (error) {
      res.status(500).json({
        message: "Failed to update service",
        error: error.message
      });
    }
  }
);

router.delete(
  "/:id",
  authMiddleware,
  requirePermission("services.delete"),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({
          message: "Service not found"
        });
      }

      if (
        service.image &&
        service.image.startsWith("/uploads/") &&
        fs.existsSync(path.join(process.cwd(), service.image.replace(/^\//, "")))
      ) {
        fs.unlinkSync(path.join(process.cwd(), service.image.replace(/^\//, "")));
      }

      await Service.findByIdAndDelete(req.params.id);

      res.json({
        message: "Service deleted successfully"
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete service",
        error: error.message
      });
    }
  }
);

export default router;