import nodemailer from "nodemailer";

function getMailerConfig() {
  const emailHost = process.env.EMAIL_HOST || "smtp.gmail.com";
  const emailPort = Number(process.env.EMAIL_PORT || 587);
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  console.log("Mailer config check:", {
    EMAIL_HOST: emailHost,
    EMAIL_PORT: emailPort,
    EMAIL_USER: emailUser ? "loaded" : "missing",
    EMAIL_PASS: emailPass ? "loaded" : "missing"
  });

  return {
    emailHost,
    emailPort,
    emailUser,
    emailPass
  };
}

function createTransporter() {
  const { emailHost, emailPort, emailUser, emailPass } = getMailerConfig();

  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailPort === 465,
    requireTLS: emailPort === 587,
    auth: {
      user: emailUser,
      pass: emailPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

export async function verifyMailer() {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log("Mailer is ready");
  } catch (error) {
    console.error("Mailer verify failed:", error.message);
  }
}

export default createTransporter;