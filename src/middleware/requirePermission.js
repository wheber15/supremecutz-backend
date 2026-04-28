import { hasPermission } from "../utils/getResolvedPermissions.js";

export default function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (user.role === "founder") {
      return next();
    }

    if (hasPermission(user, permission)) {
      return next();
    }

    return res.status(403).json({
      message: `Missing permission: ${permission}`
    });
  };
}