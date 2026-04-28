export default function scopeByLocation(req, res, next) {
  const user = req.user;

  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.role === "founder" || user.permissions?.includes("*")) {
    req.allowedLocationIds = null;
    return next();
  }

  req.allowedLocationIds = (user.locationIds || []).map((loc) =>
    String(loc._id || loc)
  );

  next();
}