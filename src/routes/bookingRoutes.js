// server/src/routes/bookingRoutes.js

import express from "express";
import jwt from "jsonwebtoken";
import Booking from "../models/Booking.js";
import Location from "../models/Location.js";
import User from "../models/User.js";
import Service from "../models/Service.js";
import Customer from "../models/Customer.js";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  sendBookingRequestReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingApprovedEmail,
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

function normalizeIrishPhone(phone) {
  if (!phone) return "";

  let value = String(phone)
    .trim()
    .replace(/[\s().-]/g, "");

  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (value.startsWith("0")) value = `+353${value.slice(1)}`;
  if (value.startsWith("353")) value = `+${value}`;

  return value;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}


function getVerifiedCustomerQuery(verificationCheck) {
  if (verificationCheck.method === "email" && verificationCheck.verifiedContact) {
    return { email: normalizeEmail(verificationCheck.verifiedContact) };
  }

  if (verificationCheck.method === "phone" && verificationCheck.verifiedContact) {
    return { phone: normalizeIrishPhone(verificationCheck.verifiedContact) };
  }

  return null;
}

function findMatchingCustomer({ phone, email }) {
  const safePhone = normalizeIrishPhone(phone);
  const safeEmail = normalizeEmail(email);
  const conditions = [];

  if (safePhone) conditions.push({ phone: safePhone });
  if (safeEmail) conditions.push({ email: safeEmail });

  if (!conditions.length) return null;
  return Customer.findOne(conditions.length === 1 ? conditions[0] : { $or: conditions });
}

function contactMatchesCustomer(customer, { phone, email }) {
  const safePhone = normalizeIrishPhone(phone);
  const safeEmail = normalizeEmail(email);

  if (safePhone && customer.phone && safePhone !== customer.phone) {
    return false;
  }

  if (safeEmail && customer.email && safeEmail !== customer.email) {
    return false;
  }

  return true;
}

function verifySingleBookingToken({ token, expectedPhone = "", expectedEmail = "", requiredMethod = "" }) {
  if (!token || !process.env.JWT_SECRET) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== "booking_verification") return null;
    if (requiredMethod && decoded.method !== requiredMethod) return null;

    if (decoded.method === "phone") {
      const safePhone = normalizeIrishPhone(expectedPhone);
      if (!decoded.phone || decoded.phone !== safePhone) return null;
      return { method: "phone", verifiedContact: decoded.phone };
    }

    if (decoded.method === "email") {
      const safeEmail = normalizeEmail(expectedEmail);
      if (!decoded.email || decoded.email !== safeEmail) return null;
      return { method: "email", verifiedContact: decoded.email };
    }

    return null;
  } catch {
    return null;
  }
}

async function getOrCreateVerifiedCustomer({
  verificationCheck,
  customerName,
  customerPhone,
  customerEmail,
  barber,
  location
}) {
  const safeEmail = normalizeEmail(customerEmail);
  const safePhone = normalizeIrishPhone(customerPhone);

  if (!safePhone || !safeEmail) {
    return {
      ok: false,
      status: 400,
      message: "Phone number and email address are both required for booking."
    };
  }

  let customer = await findMatchingCustomer({ phone: safePhone, email: safeEmail });

  if (customer?.isActive === false) {
    return {
      ok: false,
      status: 403,
      message: "This customer account is currently blocked from making bookings."
    };
  }

  if (customer && !contactMatchesCustomer(customer, { phone: safePhone, email: safeEmail })) {
    return {
      ok: false,
      status: 409,
      message: "This phone or email already belongs to an existing customer account. Please use the original saved phone and email, or login to your customer account."
    };
  }

  // New customers must verify BOTH phone and email.
  // Returning customers can keep using their saved phone/email, but the booking contact must match the saved account.
  if (!customer) {
    if (!verificationCheck.phoneVerified || !verificationCheck.emailVerified) {
      return {
        ok: false,
        status: 401,
        message: "First booking requires both phone and email verification."
      };
    }

    customer = await Customer.create({
      fullName: String(customerName || "Customer").trim(),
      phone: safePhone,
      email: safeEmail,
      preferredBarber: barber ? String(barber) : "",
      preferredLocationId: location || null,
      marketingEmailOptIn: false,
      marketingSmsOptIn: false,
      notes: "",
      completedVisits: 0,
      cancelledVisits: 0,
      noShowCount: 0,
      loyaltyPoints: 0,
      loyaltyVisitsProgress: 0,
      totalSpend: 0,
      isActive: true,
      phoneVerified: true,
      emailVerified: true,
      lastVerifiedMethod: "phone_email",
      lastVerifiedAt: new Date()
    });
  } else {
    const verifiedSavedPhone =
      verificationCheck.phoneVerified && verificationCheck.verifiedPhone === customer.phone;
    const verifiedSavedEmail =
      verificationCheck.emailVerified && verificationCheck.verifiedEmail === customer.email;

    if (!verifiedSavedPhone && !verifiedSavedEmail) {
      return {
        ok: false,
        status: 401,
        message: "Please verify the saved phone or email for this customer account before booking."
      };
    }

    // Do NOT overwrite the original customer account name/email/phone.
    // Booking.customerName can be different per appointment, but Customer.fullName remains the first saved name.
    customer.preferredBarber = customer.preferredBarber || (barber ? String(barber) : "");
    customer.preferredLocationId = customer.preferredLocationId || location || null;
    customer.phoneVerified = customer.phoneVerified || verifiedSavedPhone;
    customer.emailVerified = customer.emailVerified || verifiedSavedEmail;
    customer.lastVerifiedMethod = verifiedSavedPhone && verifiedSavedEmail ? "phone_email" : verifiedSavedPhone ? "phone" : "email";
    customer.lastVerifiedAt = new Date();

    await customer.save();
  }

  return { ok: true, customer };
}

async function recalculateCustomerStatsById(customerId) {
  if (!customerId) return null;

  const customer = await Customer.findById(customerId);
  if (!customer) return null;

  const bookings = await Booking.find({ customer: customer._id })
    .populate("service", "price")
    .sort({ createdAt: -1 });

  const completed = bookings.filter((item) => item.status === "completed");
  const cancelled = bookings.filter((item) => item.status === "cancelled");

  customer.completedVisits = completed.length;
  customer.cancelledVisits = cancelled.length;
  customer.loyaltyVisitsProgress = completed.length % 10;
  customer.totalSpend = completed.reduce((sum, item) => {
    return sum + Number(item.service?.price || 0);
  }, 0);

  if (typeof customer.loyaltyPoints !== "number") {
    customer.loyaltyPoints = 0;
  }

  await customer.save();
  return customer;
}

function verifyBookingToken({
  verificationToken,
  phoneVerificationToken,
  emailVerificationToken,
  customerPhone,
  customerEmail
}) {
  const phoneCheck = verifySingleBookingToken({
    token: phoneVerificationToken || verificationToken,
    expectedPhone: customerPhone,
    requiredMethod: phoneVerificationToken ? "phone" : ""
  });

  const emailCheck = verifySingleBookingToken({
    token: emailVerificationToken || verificationToken,
    expectedEmail: customerEmail,
    requiredMethod: emailVerificationToken ? "email" : ""
  });

  if (!phoneCheck && !emailCheck) {
    return {
      ok: false,
      status: 401,
      message: "Secure phone or email verification is required before booking."
    };
  }

  return {
    ok: true,
    method: phoneCheck && emailCheck ? "phone_email" : phoneCheck ? "phone" : "email",
    verifiedContact: phoneCheck?.verifiedContact || emailCheck?.verifiedContact || "",
    verifiedPhone: phoneCheck?.verifiedContact || "",
    verifiedEmail: emailCheck?.verifiedContact || "",
    phoneVerified: Boolean(phoneCheck),
    emailVerified: Boolean(emailCheck)
  };
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
    .populate("barber", "fullName barberDisplayName name barberSpecialty")
    .populate("customer", "fullName email phone loyaltyPoints isActive")
    .populate("approvedBy", "fullName name barberDisplayName role");
}

async function createOrUpdateCustomerFromBooking(bookingInput) {
  const booking = await Booking.findById(bookingInput._id || bookingInput.id || bookingInput);

  if (!booking?.customer) return null;

  // SECURITY FIX:
  // Customer statistics are now calculated only from Booking.customer.
  // Never calculate history by loose email/phone matching, because shared phone
  // numbers can leak booking history between different customers.
  return recalculateCustomerStatsById(booking.customer);
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
      .populate("customer", "fullName email phone loyaltyPoints isActive")
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
      status: { $in: ["pending", "confirmed", "in_progress"] }
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



/* =========================
   AUTHENTICATED BARBER APP
   Barber role only sees their own bookings. Managers/owners/founder can use this as staff mode too.
========================= */
router.get("/barber/me", authMiddleware, async (req, res) => {
  try {
    const date = req.query.date || formatDateToISO(new Date());
    const tab = String(req.query.tab || "today");
    const user = req.user;

    const allowedRoles = ["barber", "staff", "manager", "supervisor", "owner", "founder"];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: "Staff access required" });
    }

    const query = {};

    if (user.role === "barber") {
      query.barber = user._id;
    } else if (user.primaryLocationId?._id || user.primaryLocationId) {
      query.location = user.primaryLocationId?._id || user.primaryLocationId;
    }

    if (tab === "history") {
      query.status = { $in: ["completed", "cancelled", "no_show"] };
      if (req.query.date) query.bookingDate = date;
    } else {
      query.bookingDate = date;
      query.status = { $in: ["pending", "confirmed", "in_progress"] };
    }

    const bookings = await Booking.find(query)
      .populate("location", "name slug phone email")
      .populate("service", "name slug price durationMinutes")
      .populate("barber", "fullName barberDisplayName name barberSpecialty")
      .populate("customer", "fullName email phone loyaltyPoints isActive")
      .sort(tab === "history" ? { bookingDate: -1, bookingTime: -1, createdAt: -1 } : { bookingTime: 1, createdAt: -1 });

    res.json({
      date,
      tab,
      staff: user,
      count: bookings.length,
      bookings
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch barber bookings",
      error: error.message
    });
  }
});

router.put("/barber/:id/status", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid booking status" });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (req.user.role === "barber" && String(booking.barber) !== String(req.user._id)) {
      return res.status(403).json({ message: "This booking is not assigned to you" });
    }

    const previousStatus = booking.status;
    booking.status = status;

    if (status === "confirmed" && previousStatus !== "confirmed") {
      booking.approvedBy = req.user?._id || req.user?.id || null;
      booking.approvedAt = new Date();
    }

    await booking.save();

    const populatedBooking = await getPopulatedBookingById(booking._id);

    createOrUpdateCustomerFromBooking(booking).catch((customerError) => {
      console.error("Customer sync failed:", customerError.message);
    });

    if (status === "confirmed") {
      const approverName = req.user?.fullName || req.user?.name || req.user?.barberDisplayName || "Supreme Cutz team";
      sendBookingApprovedEmail(populatedBooking || booking, { approvedByName: approverName }).catch((mailError) => {
        console.error("Approved email failed:", mailError.message);
      });
    }

    if (status === "completed") {
      sendBookingCompletedFeedbackEmail(populatedBooking || booking).catch((mailError) => {
        console.error("Feedback email failed:", mailError.message);
      });
    }

    res.json({
      message: "Booking status updated",
      booking: populatedBooking || booking
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update booking status",
      error: error.message
    });
  }
});

/* =========================
   BARBER / STAFF DASHBOARD
   Returns today's bookings with populated customer/service/location/barber names.
   Keep this BEFORE /:id so Express does not treat "barber" as an id.
========================= */
router.get("/barber/today", async (req, res) => {
  try {
    const date = req.query.date || formatDateToISO(new Date());
    const barber = req.query.barber || "";
    const location = req.query.location || "";

    const query = { bookingDate: date };

    if (barber) query.barber = barber;
    if (location) query.location = location;

    // By default show active shop workflow for the day. Completed can still show
    // if showCompleted=true is passed from the dashboard.
    if (req.query.showCompleted !== "true") {
      query.status = { $in: ["pending", "confirmed", "in_progress"] };
    }

    const bookings = await Booking.find(query)
      .populate("location", "name slug phone email")
      .populate("service", "name slug price durationMinutes")
      .populate("barber", "fullName barberDisplayName name barberSpecialty")
      .populate("customer", "fullName email phone loyaltyPoints isActive")
      .sort({ bookingTime: 1, createdAt: -1 });

    res.json({
      date,
      count: bookings.length,
      bookings
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch barber bookings",
      error: error.message
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
      verificationMethod,
      verificationToken,
      phoneVerificationToken,
      emailVerificationToken
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

    const verificationCheck = verifyBookingToken({
      verificationToken,
      phoneVerificationToken,
      emailVerificationToken,
      customerPhone,
      customerEmail
    });

    if (!verificationCheck.ok) {
      return res.status(verificationCheck.status).json({
        message: verificationCheck.message
      });
    }

    const customerCheck = await getOrCreateVerifiedCustomer({
      verificationCheck,
      customerName,
      customerPhone,
      customerEmail,
      barber,
      location
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
      status: { $in: ["pending", "confirmed", "in_progress"] }
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
      customerPhone: normalizeIrishPhone(customerPhone),
      customerEmail: normalizeEmail(customerEmail),
      customer: customerCheck.customer._id,
      notes: notes || "",
      phoneVerified: verificationCheck.phoneVerified,
      emailVerified: verificationCheck.emailVerified,
      verificationMethod: verificationCheck.method,
      verifiedContact: verificationCheck.verifiedContact,
      verifiedAt: new Date()
    });

    await recalculateCustomerStatsById(customerCheck.customer._id);

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

    const allowedStatuses = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"];
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
      status: { $in: ["pending", "confirmed", "in_progress"] }
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

    const allowedStatuses = ["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid booking status"
      });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const previousStatus = booking.status;
    booking.status = status;
    if (status === "confirmed" && previousStatus !== "confirmed") {
      booking.approvedBy = req.user?._id || req.user?.id || null;
      booking.approvedAt = new Date();
    }
    await booking.save();

    const populatedBooking = await getPopulatedBookingById(booking._id);

    res.json({
      message: "Booking status updated",
      booking: populatedBooking || booking
    });

    createOrUpdateCustomerFromBooking(booking).catch((customerError) => {
      console.error("Customer sync failed:", customerError.message);
    });

    if (status === "confirmed") {
      const approverName = populatedBooking?.approvedBy?.fullName || populatedBooking?.approvedBy?.name || "Supreme Cutz team";
      sendBookingApprovedEmail(populatedBooking || booking, { approvedByName: approverName }).catch((mailError) => {
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