export const ROLE_DEFAULTS = {
  founder: ["*"],

  owner: [
    "dashboard.view",

    "locations.view",
    "locations.create",
    "locations.update",
    "locations.manage_hours",

    "users.view",
    "users.create",
    "users.update",
    "users.assign_locations",

    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.confirm",
    "bookings.complete",
    "bookings.assign",

    "customers.view",
    "customers.create",
    "customers.update",
    "customers.view_history",
    "customers.add_notes",

    "reviews.view",
    "reviews.view_all",

    "reports.view",
    "reports.view_location",
    "reports.view_global",

    "campaigns.view",
    "campaigns.create",
    "campaigns.send",

    "loyalty.view",
    "loyalty.manage",

    "pos.use",
    "pos.create_walkin",
    "pos.take_payment",

    "settings.view",
    "audit.view"
  ],

  manager: [
    "dashboard.view",

    "locations.view",
    "locations.update",
    "locations.manage_hours",

    "users.view",
    "users.create",
    "users.update",
    "users.assign_locations",

    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.confirm",
    "bookings.complete",
    "bookings.assign",

    "customers.view",
    "customers.create",
    "customers.update",
    "customers.view_history",
    "customers.add_notes",

    "reviews.view",
    "reports.view",
    "reports.view_location",

    "campaigns.view",

    "loyalty.view",

    "pos.use",
    "pos.create_walkin",
    "pos.take_payment"
  ],

  supervisor: [
    "dashboard.view",

    "locations.view",

    "users.view",
    "users.create",
    "users.update",

    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.confirm",
    "bookings.complete",

    "customers.view",
    "customers.view_history",
    "customers.add_notes",

    "reviews.view",
    "reports.view",
    "reports.view_location",

    "pos.use",
    "pos.create_walkin"
  ],

  reception: [
    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.confirm",

    "customers.view",
    "customers.create",
    "customers.update",
    "customers.view_history",
    "customers.add_notes",

    "pos.use",
    "pos.create_walkin",
    "pos.take_payment"
  ],

  barber: [
    "bookings.view",
    "bookings.confirm",
    "bookings.cancel",
    "bookings.complete",

    "customers.view",
    "customers.view_history",
    "customers.add_notes",

    "reviews.view"
  ],

  staff: ["bookings.view"]
};