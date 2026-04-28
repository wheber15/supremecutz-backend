import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail })
      .populate("locationIds", "name slug")
      .populate("primaryLocationId", "name slug");

    console.log("Login attempt:", normalizedEmail);
    console.log(
      "User found:",
      user
        ? {
            id: String(user._id),
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            canLogin: user.canLogin,
            isActiveType: typeof user.isActive,
            canLoginType: typeof user.canLogin
          }
        : null
    );

    if (!user) {
      console.log("Login branch: no user");
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    const isFounder = user.role === "founder";
    const isActive = user.isActive !== false;
    const canLogin = user.canLogin !== false;

    console.log("Computed login flags:", {
      isFounder,
      isActive,
      canLogin
    });

    if (!isFounder && (!isActive || !canLogin)) {
      console.log("Login branch: blocked account");
      return res.status(403).json({
        message: "This account is disabled"
      });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    console.log("Password match:", passwordOk);

    if (!passwordOk) {
      console.log("Login branch: invalid password");
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT_SECRET is missing in .env"
      });
    }

    const resolvedPermissions =
      user.role === "founder" ? ["*"] : Array.isArray(user.permissions) ? user.permissions : [];

    const token = jwt.sign(
      {
        userId: String(user._id),
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("Login branch: success");

    return res.json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName || user.name || "",
        name: user.name || user.fullName || "",
        email: user.email,
        role: user.role,
        phone: user.phone || "",
        locationIds: user.locationIds || [],
        primaryLocationId: user.primaryLocationId || null,
        permissions: resolvedPermissions
      }
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({
      message: "Login failed",
      error: error.message
    });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  return res.json({
    user: req.user
  });
});

export default router;