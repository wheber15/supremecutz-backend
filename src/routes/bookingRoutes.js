// server/src/routes/bookingRoutes.js

import express from "express";
import Booking from "../models/Booking.js";
import Location from "../models/Location.js";
import User from "../models/User.js";
import Service from "../models/Service.js";
import Customer from "../models/Customer.js";
import {
  sendBookingRequestReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingCancelledEmail,
  sendBookingCompletedFeedbackEmail
} from "../utils/bookingEmails.js";

const router = express.Router();

function formatDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayNameFromDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString("en-IE", { weekday: "long" }).toLowerCase();
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

  const mins = timeStringToMinutes(value);
  if (mins === null) return value;

  return minutesTo12Hour(mins);
}

function generateTimeSlots(start, end, interval = 30) {
  if (!start || !end) return [];

  const startTotal = timeStringToMinutes(start);
  const endTotal = timeStringToMinutes(end);

  if (startTotal === null || endTotal === null || startTotal >= endTotal) {
    return [];
  }

  const slots = [];

  for (let mins = startTotal; mins + interval <= endTotal; mins += interval) {
    slots.push(minutesTo12Hour(mins));
  }

  return slots;
}

function getCustomSlotsForDate(location, bookingDate, dayName) {
  const rules = Array.isArray(location.customSlots) ? location.customSlots : [];

  const exactDateRule = rules.find((rule) => rule.date === bookingDate);
  if (exactDateRule?.slots?.length) {
    return exactDateRule.slots.map(normalizeTimeLabel);
  }

  const dayRule = rules.find((rule) => rule.day === dayName);
  if (dayRule?.slots?.length) {
    return dayRule.slots.map(normalizeTimeLabel);
  }

  return null;
}

function buildCustomerMatch({ email, phone }) {
  const conditions = [];

  if (email) conditions.push({ email: String(email).trim().toLowerCase() });
  if (phone) conditions.push({ phone: String(phone).trim() });

  if (!conditions.length) return null;
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

async function getPopulatedBookingById(id) {
  return Booking.findById(id)
    .populate("location", "name slug phone email")
    .populate("service", "name slug price durationMinutes")
    .populate("barber", "fullName barberDisplayName name barberSpecialty");
}

async function createOrUpdateCustomerFromBooking(bookingInput) {
  const booking = await Booking.findById(bookingInput._id || bookingInput.id || bookingInput)
    .populate("service", "price")
    .lean();

  if (!booking) return null;

  const email = booking.customerEmail
    ? String(booking.customerEmail).trim().toLowerCase()
    : "";

  const phone = booking.customerPhone ? String(booking.customerPhone).trim() : "";

  const match = buildCustomerMatch({ email, phone });
  if (!match) return null;

  let customer = await Customer.findOne(match);

  if (!customer) {
    customer = await Customer.create({
      fullName: booking.customerName || "Customer",
      phone,
      email,
      preferredBarber: booking.barber || null,
      preferredLocation: booking.location || null,
      marketingEmailOptIn: false,
      marketingSmsOptIn: false,
      notes: "",
      completedVisits: 0,
      cancelledVisits: 0,
      noShowCount: 0,
      loyaltyPoints: 0,
      loyaltyVisitsProgress: 0,
      totalSpend: 0,
      isActive: true
    });
  } else {
    customer.fullName = booking.customerName || customer.fullName;
    customer.phone = phone || customer.phone;
    customer.email = email || customer.email;
    customer.preferredBarber = customer.preferredBarber || booking.barber || null;
    customer.preferredLocation = customer.preferredLocation || booking.location || null;
  }

  const bookings = await Booking.find(buildCustomerMatch({
    email: customer.email,
    phone: customer.phone
  }))
    .populate("service", "price")
    .sort({ createdAt: -1 });

  const completed = bookings.filter((item) => item.status === "completed");
  const cancelled = bookings.filter((item) => item.status === "cancelled");

  const totalSpend = completed.reduce((sum, item) => {
    return sum + Number(item.service?.price || 0);
  }, 0);

  customer.completedVisits = completed.length;
  customer.cancelledVisits = cancelled.length;
  customer.loyaltyVisitsProgress = completed.length % 10;
  customer.loyaltyPoints = completed.length * 10;
  customer.totalSpend = totalSpend;

  await customer.save();
  return customer;
}

async function validateBookingRelations({ location, service, barber }) {
  const [selectedLocation, selectedService, selectedBarber] = await Promise.all([
    Location.findById(location),
    Service.findById(service),
    User.findById(barber).select("isActive isBookableBarber locationIds")
  ]);

  if (!selectedLocation || !selectedLocation.isActive) {
    return { ok: false, status: 404, message: "Location not found" };
  }

  if (!selectedService || !selectedService.isActive) {
    return { ok: false, status: 404, message: "Service not found" };
  }

  if (!selectedBarber || !selectedBarber.isActive || !selectedBarber.isBookableBarber) {
    return { ok: false, status: 404, message: "Barber not found or not bookable" };
  }

  const barberLocationIds = Array.isArray(selectedBarber.locationIds)
    ? selectedBarber.locationIds.map((id) => String(id))
    : [];

  if (!barberLocationIds.includes(String(location))) {
    return {
      ok: false,
      status: 400,
      message: "Selected barber is not assigned to this location"
    };
  }

  if (
    Array.isArray(selectedService.locationIds) &&
    selectedService.locationIds.length > 0 &&
    !selectedService.locationIds.map((id) => String(id)).includes(String(location))
  ) {
    return {
      ok: false,
      status: 400,
      message: "Selected service is not available at this location"
    };
  }

  return {
    ok: true,
    selectedLocation,
    selectedService,
    selectedBarber
  };
}

async function ensureCustomerCanBook({ customerEmail, customerPhone }) {
  const email = customerEmail ? String(customerEmail).trim().toLowerCase() : "";
  const phone = customerPhone ? String(customerPhone).trim() : "";

  const match = buildCustomerMatch({ email, phone });
  if (!match) return { ok: true };

  const customer = await Customer.findOne(match);

  if (!customer) return { ok: true };

  if (customer.isActive === false) {
    return {
      ok: false,
      status: 403,
      message: "This customer account is currently blocked from making bookings."
    };
  }

  return { ok: true, customer };
}

router.get("/", async (_req, res) => {
  try {
    const bookings = await Booking.find()
      .populate("location", "name slug phone email")
      .populate("service", "name slug price durationMinutes")
      .populate("barber", "fullName barberDisplayName name barberSpecialty")
      .sort({ bookingDate: 1, bookingTime: 1, createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch bookings",
      error: error.message
    });
  }
});

router.get("/availability", async (req, res) => {
  try {
    const { barber, bookingDate, location } = req.query;

    if (!barber || !bookingDate || !location) {
      return res.status(400).json({
        message: "barber, location and bookingDate are required",
        bookedSlots: [],
        availableSlots: []
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

    const [selectedLocation, selectedBarber] = await Promise.all([
      Location.findById(location),
      User.findById(barber).select("isActive isBookableBarber locationIds")
    ]);

    if (!selectedLocation || !selectedLocation.isActive) {
      return res.status(404).json({
        message: "Location not found",
        bookedSlots: [],
        availableSlots: []
      });
    }

    if (!selectedBarber || !selectedBarber.isActive || !selectedBarber.isBookableBarber) {
      return res.status(404).json({
        message: "Barber not found or not bookable",
        bookedSlots: [],
        availableSlots: []
      });
    }

    const barberLocationIds = (selectedBarber.locationIds || []).map((id) => String(id));
    if (!barberLocationIds.includes(String(location))) {
      return res.status(400).json({
        message: "Selected barber is not assigned to this location",
        bookedSlots: [],
        availableSlots: []
      });
    }

    const blockedDates = (selectedLocation.blockedDates || [])
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") return item.slice(0, 10);
        return formatDateToISO(new Date(item));
      })
      .filter(Boolean);

    if (blockedDates.includes(bookingDate)) {
      return res.json({
        barber,
        bookingDate,
        bookedSlots: [],
        availableSlots: [],
        blocked: true,
        closed: true,
        reason: "blocked_date"
      });
    }

    const dayName = getDayNameFromDate(bookingDate);
    const customSlots = getCustomSlotsForDate(selectedLocation, bookingDate, dayName);

    let availableSlots = [];

    if (customSlots && customSlots.length > 0) {
      availableSlots = customSlots;
    } else {
      const dayConfig = (selectedLocation.openingHours || []).find(
        (item) => item.day === dayName
      );

      if (!dayConfig || !dayConfig.isActive) {
        return res.json({
          barber,
          bookingDate,
          bookedSlots: [],
          availableSlots: [],
          blocked: true,
          closed: true,
          reason: "closed_day"
        });
      }

      availableSlots = generateTimeSlots(
        dayConfig.open,
        dayConfig.close,
        selectedLocation.slotIntervalMinutes || 30
      );
    }

    const bookings = await Booking.find({
      barber,
      location,
      bookingDate,
      status: { $in: ["pending", "confirmed"] }
    }).select("bookingTime");

    const bookedSlots = bookings
      .map((item) => normalizeTimeLabel(item.bookingTime))
      .filter(Boolean);

    const remainingAvailableSlots = availableSlots.filter(
      (slot) => !bookedSlots.includes(slot)
    );

    res.json({
      barber,
      bookingDate,
      bookedSlots,
      availableSlots: remainingAvailableSlots,
      blocked: false,
      closed: false
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch slot availability",
      error: error.message,
      bookedSlots: [],
      availableSlots: []
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const booking = await getPopulatedBookingById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.json(booking);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch booking",
      error: error.message
    });
  }
});

router.post("/", async (req, res) => {
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
      phoneVerified,
      emailVerified,
      verificationMethod
    } = req.body;

    if (
      !location ||
      !service ||
      !barber ||
      !bookingDate ||
      !bookingTime ||
      !customerName ||
      (!customerPhone && !customerEmail)
    ) {
      return res.status(400).json({
        message: "Please fill in all required booking fields"
      });
    }

    if (!phoneVerified && !emailVerified) {
      return res.status(400).json({
        message: "Phone or email must be verified before booking"
      });
    }

    const customerCheck = await ensureCustomerCanBook({
      customerEmail,
      customerPhone
    });

    if (!customerCheck.ok) {
      return res.status(customerCheck.status).json({
        message: customerCheck.message
      });
    }

    const relationCheck = await validateBookingRelations({
      location,
      service,
      barber
    });

    if (!relationCheck.ok) {
      return res.status(relationCheck.status).json({
        message: relationCheck.message
      });
    }

    const normalizedBookingTime = normalizeTimeLabel(bookingTime);

    const existingBooking = await Booking.findOne({
      barber,
      location,
      bookingDate,
      bookingTime: normalizedBookingTime,
      status: { $in: ["pending", "confirmed"] }
    });

    if (existingBooking) {
      return res.status(409).json({
        message: "This time slot is already booked for that barber"
      });
    }

    const booking = await Booking.create({
      location,
      service,
      barber,
      bookingDate,
      bookingTime: normalizedBookingTime,
      customerName,
      customerPhone,
      customerEmail: customerEmail || "",
      notes: notes || "",
      phoneVerified: Boolean(phoneVerified),
      emailVerified: Boolean(emailVerified),
      verificationMethod: verificationMethod || (phoneVerified ? "phone" : "email")
    });

    const populatedBooking = await getPopulatedBookingById(booking._id);

    res.status(201).json({
      message: "Booking created successfully",
      booking: populatedBooking || booking
    });

    createOrUpdateCustomerFromBooking(booking).catch((customerError) => {
      console.error("Customer sync failed:", customerError.message);
    });

    sendBookingRequestReceivedEmail(populatedBooking || booking).catch((mailError) => {
      console.error("Request received email failed:", mailError.message);
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to create booking",
      error: error.message
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const existingBooking = await Booking.findById(req.params.id);

    if (!existingBooking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    const {
      customerName,
      customerPhone,
      customerEmail,
      bookingDate,
      bookingTime,
      status,
      location,
      service,
      barber,
      notes
    } = req.body;

    const nextLocation = location || String(existingBooking.location);
    const nextService = service || String(existingBooking.service);
    const nextBarber = barber || String(existingBooking.barber);
    const nextBookingDate = bookingDate || existingBooking.bookingDate;
    const nextBookingTime = normalizeTimeLabel(
      bookingTime || existingBooking.bookingTime
    );
    const nextStatus = status || existingBooking.status;

    if (
      !customerName ||
      !customerPhone ||
      !nextBookingDate ||
      !nextBookingTime ||
      !nextLocation ||
      !nextService ||
      !nextBarber
    ) {
      return res.status(400).json({
        message: "Please fill in all required booking fields"
      });
    }

    const allowedStatuses = ["pending", "confirmed", "completed", "cancelled"];
    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({
        message: "Invalid booking status"
      });
    }

    const relationCheck = await validateBookingRelations({
      location: nextLocation,
      service: nextService,
      barber: nextBarber
    });

    if (!relationCheck.ok) {
      return res.status(relationCheck.status).json({
        message: relationCheck.message
      });
    }

    const conflictingBooking = await Booking.findOne({
      _id: { $ne: existingBooking._id },
      barber: nextBarber,
      location: nextLocation,
      bookingDate: nextBookingDate,
      bookingTime: nextBookingTime,
      status: { $in: ["pending", "confirmed"] }
    });

    if (conflictingBooking) {
      return res.status(409).json({
        message: "This time slot is already booked for that barber"
      });
    }

    existingBooking.customerName = customerName;
    existingBooking.customerPhone = customerPhone;
    existingBooking.customerEmail = customerEmail || "";
    existingBooking.bookingDate = nextBookingDate;
    existingBooking.bookingTime = nextBookingTime;
    existingBooking.status = nextStatus;
    existingBooking.location = nextLocation;
    existingBooking.service = nextService;
    existingBooking.barber = nextBarber;
    existingBooking.notes = notes || "";

    await existingBooking.save();

    const updatedBooking = await getPopulatedBookingById(existingBooking._id);

    createOrUpdateCustomerFromBooking(existingBooking).catch((customerError) => {
      console.error("Customer sync failed:", customerError.message);
    });

    res.json({
      message: "Booking updated successfully",
      booking: updatedBooking || existingBooking
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update booking",
      error: error.message
    });
  }
});

router.put("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const allowedStatuses = ["pending", "confirmed", "completed", "cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid booking status"
      });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: "after" }
    );

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const populatedBooking = await getPopulatedBookingById(booking._id);

    res.json({
      message: "Booking status updated",
      booking: populatedBooking || booking
    });

    createOrUpdateCustomerFromBooking(booking).catch((customerError) => {
      console.error("Customer sync failed:", customerError.message);
    });

    if (status === "confirmed") {
      sendBookingConfirmedEmail(populatedBooking || booking).catch((mailError) => {
        console.error("Confirmed email failed:", mailError.message);
      });
    }

    if (status === "cancelled") {
      sendBookingCancelledEmail(populatedBooking || booking).catch((mailError) => {
        console.error("Cancelled email failed:", mailError.message);
      });
    }

    if (status === "completed") {
      sendBookingCompletedFeedbackEmail(populatedBooking || booking).catch((mailError) => {
        console.error("Feedback email failed:", mailError.message);
      });
    }
  } catch (error) {
    res.status(500).json({
      message: "Failed to update booking status",
      error: error.message
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

    createOrUpdateCustomerFromBooking(booking).catch((customerError) => {
      console.error("Customer sync failed after delete:", customerError.message);
    });

    res.json({
      message: "Booking deleted successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete booking",
      error: error.message
    });
  }
});

export default router;