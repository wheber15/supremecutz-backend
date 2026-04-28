import createTransporter from "../config/mailer.js";

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

function buildLayout({ title, subtitle, content }) {
  return `
    <div style="margin:0;padding:0;background:#0b0b0f;font-family:Arial,sans-serif;color:#ffffff;">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <div style="background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
          <div style="padding:28px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#d4af37;margin-bottom:10px;">Supreme Cutz</div>
            <h1 style="margin:0 0 10px 0;font-size:28px;color:#ffffff;">${title}</h1>
            <p style="margin:0;color:rgba(255,255,255,0.72);font-size:15px;line-height:1.6;">${subtitle}</p>
          </div>
          <div style="padding:28px;">${content}</div>
        </div>
        <p style="margin:18px 0 0 0;text-align:center;color:rgba(255,255,255,0.42);font-size:12px;">© Supreme Cutz</p>
      </div>
    </div>
  `;
}

function bookingDetailsTable(booking) {
  const details = getBookingDetails(booking);

  return `
    <table style="width:100%;border-collapse:collapse;">
      ${row("Location", details.location)}
      ${row("Service", details.service)}
      ${row("Barber", details.barber)}
      ${row("Date", details.date)}
      ${row("Time", details.time, true)}
    </table>
  `;
}

function row(label, value, last = false) {
  return `
    <tr>
      <td style="padding:12px;${last ? "" : "border-bottom:1px solid rgba(255,255,255,0.08);"}color:rgba(255,255,255,0.6);">${label}</td>
      <td style="padding:12px;${last ? "" : "border-bottom:1px solid rgba(255,255,255,0.08);"}text-align:right;color:#ffffff;">${value}</td>
    </tr>
  `;
}

async function sendTrackedMail({ to, subject, html, text }) {
  const transporter = createTransporter();

  const safeTo = String(to || "").trim();

  if (!safeTo) {
    console.log("No recipient email provided, skipping email");
    return null;
  }

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"Supreme Cutz" <${process.env.EMAIL_USER}>`,
    to: safeTo,
    replyTo: process.env.EMAIL_USER,
    subject,
    text,
    html
  });

  console.log("Mail result:", {
    to: safeTo,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response
  });

  return info;
}

export async function sendBookingRequestReceivedEmail(booking) {
  if (!booking.customerEmail) return console.log("No customer email provided");

  const d = getBookingDetails(booking);

  await sendTrackedMail({
    to: d.email,
    subject: "Booking Request Received — Supreme Cutz",
    text: `Hi ${d.customerName}, we received your booking request for ${d.service} on ${d.date} at ${d.time}. This is not confirmed yet.`,
    html: buildLayout({
      title: "Booking Request Received",
      subtitle: "We have received your booking request. This slot is not confirmed yet.",
      content: `
        <p style="color:rgba(255,255,255,0.8);font-size:15px;">Hi ${d.customerName},</p>
        <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.7;">
          Thanks for booking with Supreme Cutz. Your request is currently pending confirmation.
        </p>
        <div style="background:#0b0b0f;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          ${bookingDetailsTable(booking)}
        </div>
      `
    })
  });
}

export async function sendBookingConfirmedEmail(booking) {
  if (!booking.customerEmail) return console.log("No customer email provided");

  const d = getBookingDetails(booking);

  await sendTrackedMail({
    to: d.email,
    subject: "Your Booking is Confirmed — Supreme Cutz",
    text: `Hi ${d.customerName}, your booking for ${d.service} on ${d.date} at ${d.time} is confirmed.`,
    html: buildLayout({
      title: "Your Booking is Confirmed",
      subtitle: "Your appointment has been approved and confirmed by the shop.",
      content: `
        <p style="color:rgba(255,255,255,0.8);font-size:15px;">Hi ${d.customerName},</p>
        <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.7;">Your booking is now confirmed. We look forward to seeing you.</p>
        <div style="background:#0b0b0f;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          ${bookingDetailsTable(booking)}
        </div>
      `
    })
  });
}

export async function sendBookingCancelledEmail(booking) {
  if (!booking.customerEmail) return console.log("No customer email provided");

  const d = getBookingDetails(booking);

  await sendTrackedMail({
    to: d.email,
    subject: "Booking Cancelled — Supreme Cutz",
    text: `Hi ${d.customerName}, your booking for ${d.service} on ${d.date} at ${d.time} has been cancelled.`,
    html: buildLayout({
      title: "Booking Cancelled",
      subtitle: "There has been an update to your appointment request.",
      content: `
        <p style="color:rgba(255,255,255,0.8);font-size:15px;">Hi ${d.customerName},</p>
        <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.7;">Unfortunately, this booking could not be confirmed.</p>
        <div style="background:#0b0b0f;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          ${bookingDetailsTable(booking)}
        </div>
      `
    })
  });
}

export async function sendBookingCompletedFeedbackEmail(booking) {
  if (!booking.customerEmail) return console.log("No customer email provided");

  const d = getBookingDetails(booking);
  const feedbackUrl = `${CLIENT_URL}/feedback/${booking._id}`;

  await sendTrackedMail({
    to: d.email,
    subject: "How Was Your Haircut? — Supreme Cutz",
    text: `Hi ${d.customerName}, please leave feedback here: ${feedbackUrl}`,
    html: buildLayout({
      title: "How Was Your Haircut?",
      subtitle: "Your appointment has been marked as completed.",
      content: `
        <p style="color:rgba(255,255,255,0.8);font-size:15px;">Hi ${d.customerName},</p>
        <p style="color:rgba(255,255,255,0.72);font-size:15px;line-height:1.7;">Thanks for visiting Supreme Cutz. We'd love your feedback.</p>
        <div style="background:#0b0b0f;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;margin-bottom:22px;">
          ${bookingDetailsTable(booking)}
        </div>
        <a href="${feedbackUrl}" style="display:inline-block;background:#d4af37;color:#000;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:bold;">
          Leave Feedback
        </a>
      `
    })
  });
}