export default function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (user.role === "founder") {
      return next();
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        message: `Role ${user.role} is not allowed`
      });
    }

    next();
  };
}