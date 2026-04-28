import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import GalleryImage from "../models/GalleryImage.js";
import authMiddleware from "../middleware/authMiddleware.js";
import requirePermission from "../middleware/requirePermission.js";

const router = express.Router();

const galleryUploadDir = path.join(process.cwd(), "uploads", "gallery");

if (!fs.existsSync(galleryUploadDir)) {
  fs.mkdirSync(galleryUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, galleryUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeBase = path
      .basename(file.originalname || "image", ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);

    cb(null, `${Date.now()}-${safeBase || "gallery"}${ext || ".jpg"}`);
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
  requirePermission("gallery.view"),
  async (_req, res) => {
    try {
      const images = await GalleryImage.find()
        .populate("locationIds", "name slug")
        .sort({ sortOrder: 1, createdAt: -1 });

      res.json(images);
    } catch (error) {
      res.status(500).json({
        message: "Failed to fetch gallery images",
        error: error.message
      });
    }
  }
);

router.post(
  "/",
  authMiddleware,
  requirePermission("gallery.create"),
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          message: "Image file is required"
        });
      }

      const locationIds = normalizeLocationIds(req.body.locationIds);

      const image = await GalleryImage.create({
        title: req.body.title || "",
        description: req.body.description || "",
        imageUrl: `/uploads/gallery/${req.file.filename}`,
        imagePath: req.file.path,
        locationIds,
        showOnHomepage: String(req.body.showOnHomepage) === "false" ? false : true,
        isActive: String(req.body.isActive) === "false" ? false : true,
        sortOrder: Number(req.body.sortOrder || 0)
      });

      const populated = await GalleryImage.findById(image._id).populate(
        "locationIds",
        "name slug"
      );

      res.status(201).json(populated);
    } catch (error) {
      res.status(500).json({
        message: "Failed to create gallery image",
        error: error.message
      });
    }
  }
);

router.put(
  "/:id",
  authMiddleware,
  requirePermission("gallery.update"),
  upload.single("image"),
  async (req, res) => {
    try {
      const existing = await GalleryImage.findById(req.params.id);

      if (!existing) {
        return res.status(404).json({
          message: "Gallery image not found"
        });
      }

      const updateData = {
        title: req.body.title || "",
        description: req.body.description || "",
        locationIds: normalizeLocationIds(req.body.locationIds),
        showOnHomepage: String(req.body.showOnHomepage) === "false" ? false : true,
        isActive: String(req.body.isActive) === "false" ? false : true,
        sortOrder: Number(req.body.sortOrder || 0)
      };

      if (req.file) {
        if (existing.imagePath && fs.existsSync(existing.imagePath)) {
          fs.unlinkSync(existing.imagePath);
        }

        updateData.imageUrl = `/uploads/gallery/${req.file.filename}`;
        updateData.imagePath = req.file.path;
      }

      const updated = await GalleryImage.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
          returnDocument: "after",
          runValidators: true
        }
      ).populate("locationIds", "name slug");

      res.json(updated);
    } catch (error) {
      res.status(500).json({
        message: "Failed to update gallery image",
        error: error.message
      });
    }
  }
);

router.delete(
  "/:id",
  authMiddleware,
  requirePermission("gallery.delete"),
  async (req, res) => {
    try {
      const existing = await GalleryImage.findById(req.params.id);

      if (!existing) {
        return res.status(404).json({
          message: "Gallery image not found"
        });
      }

      if (existing.imagePath && fs.existsSync(existing.imagePath)) {
        fs.unlinkSync(existing.imagePath);
      }

      await GalleryImage.findByIdAndDelete(req.params.id);

      res.json({
        message: "Gallery image deleted successfully"
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to delete gallery image",
        error: error.message
      });
    }
  }
);

export default router;