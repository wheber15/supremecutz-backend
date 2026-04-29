import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY, {
  baseUrl: "https://api.eu.resend.com"
});

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const EMAIL_FROM =
  process.env.EMAIL_FROM || "Supreme Cutz <onboarding@resend.dev>";

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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getBookingDetails(booking) {
  return {
    id: booking._id,
    location: getName(booking.location, "Supreme Cutz"),
    service: getName(booking.service, "Selected service"),
    barber: getName(booking.barber, "Selected barber"),
    date: formatDisplayDate(booking.bookingDate),
    time: booking.bookingTime || "",
    customerName: booking.customerName || "Customer",
    email: booking.customerEmail || ""
  };
}

function button(text, url) {
  return `
    <a href="${url}" style="
      display:inline-block;
      background:#d4af37;
      color:#050505;
      text-decoration:none;
      font-weight:800;
      padding:14px 22px;
      border-radius:999px;
      margin-top:18px;
    ">
      ${text}
    </a>
  `;
}

function emailLayout({ badge, title, intro, detailsHtml, actionHtml = "", footer = "" }) {
  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;color:#ffffff;">
      <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
        <div style="border:1px solid rgba(212,175,55,0.28);border-radius:28px;background:#0b0b10;padding:28px;">
          <p style="margin:0 0 14px;color:#d4af37;letter-spacing:5px;font-size:12px;font-weight:800;text-transform:uppercase;">
            ${badge}
          </p>

          <h1 style="margin:0 0 16px;font-size:34px;line-height:1.05;color:#ffffff;">
            ${title}
          </h1>

          <p style="margin:0 0 24px;color:#d7d7d7;font-size:16px;line-height:1.7;">
            ${intro}
          </p>

          <div style="border:1px solid rgba(255,255,255,0.1);border-radius:22px;background:#111117;padding:18px;margin:20px 0;">
            ${detailsHtml}
          </div>

          ${actionHtml}

          ${
            footer
              ? `<p style="margin:24px 0 0;color:#a5a5a5;font-size:14px;line-height:1.6;">${footer}</p>`
              : ""
          }
        </div>

        <p style="text-align:center;color:#777;font-size:12px;margin-top:18px;">
          Supreme Cutz · Premium Barber Experience
        </p>
      </div>
    </body>
  </html>
  `;
}

function bookingDetailsBlock(d) {
  return `
    <p style="margin:0 0 10px;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:2px;">Appointment</p>
    <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#ffffff;">${escapeHtml(d.service)}</p>
    <p style="margin:0 0 8px;color:#d4af37;font-weight:700;">${escapeHtml(d.date)} at ${escapeHtml(d.time)}</p>
    <p style="margin:0;color:#cfcfcf;">Location: ${escapeHtml(d.location)}</p>
    <p style="margin:8px 0 0;color:#cfcfcf;">Barber: ${escapeHtml(d.barber)}</p>
  `;
}

async function sendEmail({ to, subject, html }) {
  if (!to) return;

  try {
    await resend.emails.send({
      from: EMAIL_FROM,
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
   BOOKING EMAILS
========================= */

export async function sendBookingRequestReceivedEmail(booking) {
  const d = getBookingDetails(booking);

  await sendEmail({
    to: d.email,
    subject: "Booking Request Received — Supreme Cutz",
    html: emailLayout({
      badge: "Request Submitted",
      title: "Booking request received",
      intro: `Hi ${escapeHtml(d.customerName)}, your appointment request has been received and is now pending review.`,
      detailsHtml: bookingDetailsBlock(d),
      footer: "The team will review your requested slot. You will receive another email once your booking is confirmed."
    })
  });
}

export async function sendBookingConfirmedEmail(booking) {
  const d = getBookingDetails(booking);

  await sendEmail({
    to: d.email,
    subject: "Booking Confirmed — Supreme Cutz",
    html: emailLayout({
      badge: "Confirmed",
      title: "Your booking is confirmed",
      intro: `Hi ${escapeHtml(d.customerName)}, your Supreme Cutz appointment is confirmed.`,
      detailsHtml: bookingDetailsBlock(d),
      footer: "Please arrive a few minutes early. If you need to cancel or change your booking, contact the shop."
    })
  });
}

export async function sendBookingCancelledEmail(booking) {
  const d = getBookingDetails(booking);

  await sendEmail({
    to: d.email,
    subject: "Booking Cancelled — Supreme Cutz",
    html: emailLayout({
      badge: "Cancelled",
      title: "Your booking was cancelled",
      intro: `Hi ${escapeHtml(d.customerName)}, your appointment has been cancelled.`,
      detailsHtml: bookingDetailsBlock(d),
      actionHtml: button("Book Again", `${CLIENT_URL}/book`),
      footer: "You can book another appointment anytime using our booking page."
    })
  });
}

export async function sendBookingCompletedFeedbackEmail(booking) {
  const d = getBookingDetails(booking);
  const feedbackUrl = `${CLIENT_URL}/feedback/${booking._id}`;

  await sendEmail({
    to: d.email,
    subject: "How was your visit? — Supreme Cutz",
    html: emailLayout({
      badge: "Completed",
      title: "Thanks for visiting",
      intro: `Hi ${escapeHtml(d.customerName)}, thanks for visiting Supreme Cutz. We hope you loved the service.`,
      detailsHtml: bookingDetailsBlock(d),
      actionHtml: button("Leave Feedback", feedbackUrl),
      footer: "Your feedback helps us improve and keeps the experience premium."
    })
  });
}

/* =========================
   OTP EMAIL TEMPLATE
   Optional: use this in verifyRoutes.js
========================= */

export async function sendCustomerOtpEmail({ to, code }) {
  await sendEmail({
    to,
    subject: "Your Supreme Cutz Verification Code",
    html: emailLayout({
      badge: "Verification",
      title: "Verify your booking",
      intro: "Use the secure code below to continue your appointment booking.",
      detailsHtml: `
        <div style="text-align:center;">
          <p style="margin:0 0 12px;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:2px;">Your Code</p>
          <div style="
            display:inline-block;
            border:1px solid rgba(212,175,55,0.35);
            background:rgba(212,175,55,0.10);
            color:#d4af37;
            border-radius:22px;
            padding:18px 28px;
            font-size:42px;
            font-weight:900;
            letter-spacing:10px;
          ">
            ${escapeHtml(code)}
          </div>
        </div>
      `,
      footer: "This code expires in 10 minutes. If you did not request this code, you can safely ignore this email."
    })
  });
}