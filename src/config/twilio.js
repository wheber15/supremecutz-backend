import twilio from "twilio";

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  console.log("Twilio config check:", {
    TWILIO_ACCOUNT_SID: accountSid ? "loaded" : "missing",
    TWILIO_AUTH_TOKEN: authToken ? "loaded" : "missing",
    TWILIO_VERIFY_SERVICE_SID: verifyServiceSid ? "loaded" : "missing"
  });

  return { accountSid, authToken, verifyServiceSid };
}

export function createTwilioClient() {
  const { accountSid, authToken } = getTwilioConfig();
  return twilio(accountSid, authToken);
}

export function getVerifyServiceSid() {
  return process.env.TWILIO_VERIFY_SERVICE_SID;
}