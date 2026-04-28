import Booking from "../models/Booking.js";
import Location from "../models/Location.js";
import Service from "../models/Service.js";
import User from "../models/User.js";

function formatDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayNameFromISO(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString("en-IE", { weekday: "long" });
}

function timeStringToMinutes(value) {
  if (!value || !value.includes(":")) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesTo12Hour(totalMinutes) {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function normalizeTimeLabel(value) {
  if (!value) return "";

  if (value.includes("AM") || value.includes("PM")) return value;

  if (value.includes(":")) {
    const mins = timeStringToMinutes(value);
    if (mins !== null) return minutesTo12Hour(mins);
  }

  return value;
}

function generateSlotsFromRange(startTime, endTime, intervalMinutes = 30) {
  const start = timeStringToMinutes(startTime);
  const end = timeStringToMinutes(endTime);

  if (start === null || end === null || start >= end) return [];

  const slots = [];
  let current = start;

  while (current + intervalMinutes <= end) {
    slots.push(minutesTo12Hour(current));
    current += intervalMinutes;
  }

  return slots;
}

function getCustomSlotsForDate(location, bookingDate, dayName) {
  const customSlots = location.customSlots || [];

  const exactMatch = customSlots.find((slotConfig) => {
    if (!slotConfig) return false;
    return slotConfig.date === bookingDate;
  });

  if (exactMatch?.slots?.length) {
    return exactMatch.slots.map(normalizeTimeLabel);
  }

  const dayMatch = customSlots.find((slotConfig) => {
    if (!slotConfig) return false;
    return slotConfig.day === dayName;
  });

  if (dayMatch?.slots?.length) {
    return dayMatch.slots.map(normalizeTimeLabel);
  }

  return null;
}

export async function getBookingAvailability(req, res) {
  try {
    const { barber, location, bookingDate } = req.query;

    if (!barber || !location || !bookingDate) {
      return res.status(400).json({
        message: "barber, location and bookingDate are required"
      });
    }

    const todayIso = formatDateToISO(new Date());
    if (bookingDate < todayIso) {
      return res.status(400).json({
        message: "Past dates are not allowed",
        bookedSlots: [],
        availableSlots: []
      });
    }

    const [locationDoc, barberDoc] = await Promise.all([
      Location.findById(location),
      User.findById(barber).select("isActive isBookableBarber locationIds")
    ]);

    if (!locationDoc) {
      return res.status(404).json({
        message: "Location not found",
        bookedSlots: [],
        availableSlots: []
      });
    }

    if (!barberDoc || !barberDoc.isActive || !barberDoc.isBookableBarber) {
      return res.status(404).json({
        message: "Barber not available",
        bookedSlots: [],
        availableSlots: []
      });
    }

    const barberLocationIds = (barberDoc.locationIds || []).map((id) => String(id));
    if (!barberLocationIds.includes(String(location))) {
      return res.status(400).json({
        message: "Selected barber does not work at this location",
        bookedSlots: [],
        availableSlots: []
      });
    }

    const blockedDates = (locationDoc.blockedDates || []).map((item) => {
      if (!item) return null;
      if (typeof item === "string") return item;
      return formatDateToISO(new Date(item));
    }).filter(Boolean);

    if (blockedDates.includes(bookingDate)) {
      return res.json({
        bookedSlots: [],
        availableSlots: [],
        closed: true,
        reason: "blocked_date"
      });
    }

    const dayName = getDayNameFromISO(bookingDate);

    const customSlots = getCustomSlotsForDate(locationDoc, bookingDate, dayName);

    let baseSlots = [];

    if (customSlots && customSlots.length > 0) {
      baseSlots = customSlots;
    } else {
      const openingRule = (locationDoc.openingHours || []).find(
        (entry) => entry.day === dayName
      );

      if (!openingRule || openingRule.isOpen === false) {
        return res.json({
          bookedSlots: [],
          availableSlots: [],
          closed: true,
          reason: "closed_day"
        });
      }

      const startTime = openingRule.open || openingRule.start;
      const endTime = openingRule.close || openingRule.end;
      const intervalMinutes = locationDoc.slotIntervalMinutes || 30;

      baseSlots = generateSlotsFromRange(startTime, endTime, intervalMinutes);
    }

    const existingBookings = await Booking.find({
      barber,
      location,
      bookingDate,
      status: { $nin: ["cancelled", "rejected"] }
    }).select("bookingTime");

    const bookedSlots = existingBookings
      .map((booking) => normalizeTimeLabel(booking.bookingTime))
      .filter(Boolean);

    const availableSlots = baseSlots.filter((slot) => !bookedSlots.includes(slot));

    return res.json({
      bookedSlots,
      availableSlots,
      closed: false
    });
  } catch (error) {
    console.error("getBookingAvailability error:", error);
    return res.status(500).json({
      message: "Failed to load booking availability",
      error: error.message,
      bookedSlots: [],
      availableSlots: []
    });
  }
}

/**
 * Keep your existing createBooking if already working.
 * This is only a safe example shape.
 */
export async function createBooking(req, res) {
  try {
    const {
      location,
      service,
      barber,
      bookingDate,
      bookingTime,
      customerName,
      customerPhone,
      customerEmail,
      notes,
      phoneVerified
    } = req.body;

    if (
      !location ||
      !service ||
      !barber ||
      !bookingDate ||
      !bookingTime ||
      !customerName ||
      !customerPhone
    ) {
      return res.status(400).json({
        message: "Missing required booking fields"
      });
    }

    const existing = await Booking.findOne({
      location,
      barber,
      bookingDate,
      bookingTime,
      status: { $nin: ["cancelled", "rejected"] }
    });

    if (existing) {
      return res.status(409).json({
        message: "That slot has already been booked"
      });
    }

    const booking = await Booking.create({
      location,
      service,
      barber,
      bookingDate,
      bookingTime,
      customerName,
      customerPhone,
      customerEmail,
      notes,
      phoneVerified: Boolean(phoneVerified),
      status: "pending"
    });

    return res.status(201).json({
      message: "Booking created successfully",
      booking
    });
  } catch (error) {
    console.error("createBooking error:", error);
    return res.status(500).json({
      message: "Failed to create booking",
      error: error.message
    });
  }
}