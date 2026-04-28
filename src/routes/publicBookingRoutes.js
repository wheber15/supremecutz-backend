import express from "express";
import Location from "../models/Location.js";
import Service from "../models/Service.js";
import User from "../models/User.js";
import GalleryImage from "../models/GalleryImage.js";

const router = express.Router();

router.get("/booking-config", async (_req, res) => {
  try {
    const [locations, services, barbers, gallery] = await Promise.all([
      Location.find({ isActive: true }).sort({ name: 1 }),
      Service.find({ isActive: true })
        .populate("locationIds", "name slug")
        .sort({ sortOrder: 1, createdAt: -1 }),
      User.find({
        isActive: true,
        isBookableBarber: true
      })
        .populate("locationIds", "name slug")
        .populate("primaryLocationId", "name slug")
        .sort({ fullName: 1, name: 1 }),
      GalleryImage.find({ isActive: true })
        .populate("locationIds", "name slug")
        .sort({ sortOrder: 1, createdAt: -1 })
    ]);

    const safeLocations = locations.map((location) => ({
      id: String(location._id),
      _id: String(location._id),
      name: location.name,
      slug: location.slug,
      note: location.description || "Premium location",
      phone: location.phone || "",
      email: location.email || "",
      description: location.description || "",
      addressLine1: location.addressLine1 || "",
      addressLine2: location.addressLine2 || "",
      city: location.city || "",
      county: location.county || "",
      postcode: location.postcode || "",
      blockedDates: Array.isArray(location.blockedDates)
        ? location.blockedDates
        : [],
      openingHours: Array.isArray(location.openingHours)
        ? location.openingHours
        : [],
      slotIntervalMinutes: Number(location.slotIntervalMinutes || 30)
    }));

    const safeServices = services.map((service) => ({
      id: String(service._id),
      _id: String(service._id),
      name: service.name,
      slug: service.slug,
      price: Number(service.price || 0),
      durationMinutes: Number(service.durationMinutes || 30),
      duration: `${Number(service.durationMinutes || 30)} min`,
      description: service.description || "",
      image: service.image || "",
      isActive: Boolean(service.isActive),
      showOnHomepage: Boolean(service.showOnHomepage),
      showInBooking: Boolean(service.showInBooking),
      sortOrder: Number(service.sortOrder || 0),
      locationIds: Array.isArray(service.locationIds)
        ? service.locationIds.map((loc) => ({
            _id: String(loc?._id || loc),
            name: loc?.name || "",
            slug: loc?.slug || ""
          }))
        : []
    }));

    const safeBarbers = barbers.map((barber) => ({
      id: String(barber._id),
      _id: String(barber._id),
      name:
        barber.barberDisplayName ||
        barber.fullName ||
        barber.name ||
        "Barber",
      fullName: barber.fullName || barber.name || "",
      barberDisplayName: barber.barberDisplayName || "",
      barberSpecialty: barber.barberSpecialty || "",
      specialty: barber.barberSpecialty || "",
      role: barber.role,
      locationIds: Array.isArray(barber.locationIds)
        ? barber.locationIds.map((loc) => String(loc._id || loc))
        : [],
      primaryLocationId: barber.primaryLocationId
        ? String(barber.primaryLocationId._id || barber.primaryLocationId)
        : "",
      email: barber.email || ""
    }));

    const safeGallery = gallery.map((item) => ({
      id: String(item._id),
      _id: String(item._id),
      title: item.title || "",
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      showOnHomepage: Boolean(item.showOnHomepage),
      isActive: Boolean(item.isActive),
      sortOrder: Number(item.sortOrder || 0),
      locationIds: Array.isArray(item.locationIds)
        ? item.locationIds.map((loc) => ({
            _id: String(loc._id || loc),
            name: loc.name || "",
            slug: loc.slug || ""
          }))
        : []
    }));

    res.json({
      locations: safeLocations,
      services: safeServices,
      barbers: safeBarbers,
      gallery: safeGallery
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to load booking config",
      error: error.message
    });
  }
});

export default router;