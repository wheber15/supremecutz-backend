import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

function getName(value, fallback = "") {
  if (!value) return fallback;
  if (typeof value === "string") return value;

  return (
    value.name ||
    value.fullName ||
    value.barberDisplayName ||
    value.slug ||
    fallback
  );
}

function formatDisplayDate(dateString) {
  if (!dateString) return "";
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-IE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function getBookingDetails(booking) {
  return {
    location: getName(booking.location, "Supreme Cutz"),
    service: getName(booking.service, "Selected service"),
    barber: getName(booking.barber, "Selected barber"),
    date: formatDisplayDate(booking.bookingDate),
    time: booking.bookingTime || "",
    customerName: booking.customerName || "Customer",
    email: booking.customerEmail || ""
  };
}

async function sendEmail({ to, subject, html }) {
  if (!to) return;

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Supreme Cutz <onboarding@resend.dev>",
      to,
      subject,
      html
    });

    console.log("Email sent to:", to);
  } catch (error) {
    console.error("Resend error:", error.message);
  }
}

/* =========================
   EMAILS
========================= */

export async function sendBookingRequestReceivedEmail(booking) {
  const d = getBookingDetails(booking);

  await sendEmail({
    to: d.email,
    subject: "Booking Request Received — Supreme Cutz",
    html: `
      <h2>Booking Received</h2>
      <p>Hi ${d.customerName},</p>
      <p>Your booking is pending review.</p>
      <p>${d.service} - ${d.date} at ${d.time}</p>
    `
  });
}

export async function sendBookingConfirmedEmail(booking) {
  const d = getBookingDetails(booking);

  await sendEmail({
    to: d.email,
    subject: "Booking Confirmed — Supreme Cutz",
    html: `
      <h2>Booking Confirmed</h2>
      <p>Hi ${d.customerName},</p>
      <p>Your appointment is confirmed.</p>
      <p>${d.service} - ${d.date} at ${d.time}</p>
    `
  });
}

export async function sendBookingCancelledEmail(booking) {
  const d = getBookingDetails(booking);

  await sendEmail({
    to: d.email,
    subject: "Booking Cancelled — Supreme Cutz",
    html: `
      <h2>Booking Cancelled</h2>
      <p>Hi ${d.customerName},</p>
      <p>Your booking has been cancelled.</p>
    `
  });
}

export async function sendBookingCompletedFeedbackEmail(booking) {
  const d = getBookingDetails(booking);
  const feedbackUrl = `${CLIENT_URL}/feedback/${booking._id}`;

  await sendEmail({
    to: d.email,
    subject: "How was your visit? — Supreme Cutz",
    html: `
      <h2>Thanks for visiting</h2>
      <p>Hi ${d.customerName},</p>
      <p>Leave feedback:</p>
      <a href="${feedbackUrl}">Click here</a>
    `
  });
}