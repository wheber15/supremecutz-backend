import express from "express";
import Booking from "../models/Booking.js";
import Customer from "../models/Customer.js";
import Location from "../models/Location.js";
import User from "../models/User.js";
import Service from "../models/Service.js";
import {
  sendBookingRequestReceivedEmail,
  sendBookingConfirmedEmail,
  sendBookingCancelledEmail,
  sendBookingCompletedFeedbackEmail
} from "../utils/bookingEmails.js";

const router = express.Router();

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone = "") {
  return String(phone).replace(/\s+/g, "").trim();
}

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

function buildCustomerConditions({ customerEmail, customerPhone }) {
  const email = normalizeEmail(customerEmail);
  const phone = normalizePhone(customerPhone);

  const conditions = [];

  if (email) conditions.push({ email });
  if (phone) conditions.push({ phone });

  return conditions;
}

async function findBlockedCustomer({ customerEmail, customerPhone }) {
  const conditions = buildCustomerConditions({ customerEmail, customerPhone });

  if (!conditions.length) return null;

  return Customer.findOne({
    $or: conditions,
    isActive: false
  });
}

async function createOrUpdateCustomerFromBooking(booking) {
  const email = normalizeEmail(booking.customerEmail);
  const phone = normalizePhone(booking.customerPhone);

  if (!phone && !email) return null;

  const conditions = [];
  if (email) conditions.push({ email });
  if (phone) conditions.push({ phone });

  const existingCustomer = await Customer.findOne({ $or: conditions });

  if (existingCustomer) {
    existingCustomer.fullName = booking.customerName || existingCustomer.fullName;
    existingCustomer.phone = phone || existingCustomer.phone;
    existingCustomer.email = email || existingCustomer.email;

    if (booking.location) {
      existingCustomer.preferredLocationId = booking.location;
    }

    if (booking.barber) {
      existingCustomer.preferredBarber = String(booking.barber);
    }

    await existingCustomer.save();
    return existingCustomer;
  }

  return Customer.create({
    fullName: booking.customerName,
    phone,
    email,
    preferredLocationId: booking.location || null,
    preferredBarber: booking.barber ? String(booking.barber) : "",
    isActive: true
  });
}

async function updateCustomerStatsFromBooking(booking) {
  const conditions = buildCustomerConditions({
    customerEmail: booking.customerEmail,
    customerPhone: booking.customerPhone
  });

  if (!conditions.length) return null;

  const customer = await Customer.findOne({ $or: conditions });
  if (!customer) return null;

  const customerBookings = await Booking.find({
    $or: [
      customer.email ? { customerEmail: customer.email } : null,
      customer.phone ? { customerPhone: customer.phone } : null
    ].filter(Boolean)
  }).populate("service", "price");

  const completed = customerBookings.filter((item) => item.status === "completed");
  const cancelled = customerBookings.filter((item) => item.status === "cancelled");

  customer.completedVisits = completed.length;
  customer.cancelledVisits = cancelled.length;
  customer.loyaltyVisitsProgress = completed.length % 10;
  customer.loyaltyPoints = completed.length * 10;
  customer.totalSpend = completed.reduce(
    (sum, item) => sum + Number(item.service?.price || 0),
    0
  );

  await customer.save();
  return customer;
}

async function getPopulatedBookingById(id) {
  return Booking.findById(id)
    .populate("location", "name slug phone email")
    .populate("service", "name slug price durationMinutes")
    .populate("barber", "fullName barberDisplayName name barberSpecialty");
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
        message: "Please fill in all required booking fields"
      });
    }

    if (!phoneVerified) {
      return res.status(400).json({
        message: "Phone number must be verified before booking"
      });
    }

    const blockedCustomer = await findBlockedCustomer({
      customerEmail,
      customerPhone
    });

    if (blockedCustomer) {
      return res.status(403).json({
        message:
          "This customer is currently blocked from making bookings. Please contact the shop."
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
    const normalizedCustomerPhone = normalizePhone(customerPhone);
    const normalizedCustomerEmail = normalizeEmail(customerEmail);

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
      customerPhone: normalizedCustomerPhone,
      customerEmail: normalizedCustomerEmail,
      notes: notes || "",
      phoneVerified: true
    });

    const populatedBooking = await getPopulatedBookingById(booking._id);

    try {
      await createOrUpdateCustomerFromBooking(booking);
    } catch (customerError) {
      console.error("Customer sync failed:", customerError.message);
    }

    try {
      await sendBookingRequestReceivedEmail(populatedBooking || booking);
    } catch (mailError) {
      console.error("Request received email failed:", mailError.message);
    }

    res.status(201).json({
      message: "Booking created successfully",
      booking: populatedBooking || booking
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

    const blockedCustomer = await findBlockedCustomer({
      customerEmail,
      customerPhone
    });

    if (blockedCustomer) {
      return res.status(403).json({
        message:
          "This customer is currently blocked from making bookings. Please contact the shop."
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
    existingBooking.customerPhone = normalizePhone(customerPhone);
    existingBooking.customerEmail = normalizeEmail(customerEmail);
    existingBooking.bookingDate = nextBookingDate;
    existingBooking.bookingTime = nextBookingTime;
    existingBooking.status = nextStatus;
    existingBooking.location = nextLocation;
    existingBooking.service = nextService;
    existingBooking.barber = nextBarber;
    existingBooking.notes = notes || "";

    await existingBooking.save();

    try {
      await createOrUpdateCustomerFromBooking(existingBooking);
      await updateCustomerStatsFromBooking(existingBooking);
    } catch (customerError) {
      console.error("Customer sync failed:", customerError.message);
    }

    const updatedBooking = await getPopulatedBookingById(existingBooking._id);

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

    try {
      await createOrUpdateCustomerFromBooking(booking);
      await updateCustomerStatsFromBooking(booking);
    } catch (customerError) {
      console.error("Customer stats update failed:", customerError.message);
    }

    try {
      if (status === "confirmed") {
        await sendBookingConfirmedEmail(populatedBooking || booking);
      }

      if (status === "cancelled") {
        await sendBookingCancelledEmail(populatedBooking || booking);
      }

      if (status === "completed") {
        await sendBookingCompletedFeedbackEmail(populatedBooking || booking);
      }
    } catch (mailError) {
      console.error("Status email failed:", mailError.message);
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

router.delete("/:id", async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found"
      });
    }

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