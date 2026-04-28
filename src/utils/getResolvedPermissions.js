export function getResolvedPermissions(user) {
  if (!user) return [];

  if (user.role === "founder") {
    return ["*"];
  }

  if (Array.isArray(user.permissions)) {
    return user.permissions;
  }

  return [];
}

export function hasPermission(user, permission) {
  const permissions = getResolvedPermissions(user);

  if (permissions.includes("*")) {
    return true;
  }

  return permissions.includes(permission);
}