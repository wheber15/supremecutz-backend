import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { getResolvedPermissions } from "../utils/getResolvedPermissions.js";

export default async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT_SECRET is missing in .env" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId)
      .populate("locationIds", "name slug")
      .populate("primaryLocationId", "name slug");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const isFounder = user.role === "founder";
    const isActive = user.isActive !== false;
    const canLogin = user.canLogin !== false;

    if (!isFounder && (!isActive || !canLogin)) {
      return res.status(401).json({ message: "User is not allowed to log in" });
    }

    const safeUser = {
      _id: user._id,
      fullName: user.fullName || user.name || "",
      name: user.name || user.fullName || "",
      email: user.email,
      role: user.role,
      phone: user.phone || "",
      locationIds: user.locationIds || [],
      primaryLocationId: user.primaryLocationId || null,
      permissions: getResolvedPermissions(user)
    };

    req.user = safeUser;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
      error: error.message
    });
  }
}