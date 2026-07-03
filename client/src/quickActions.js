export const QUICK_ACTIONS = [
  {
    key: "home",
    title: "Home",
    description: "Go back to dashboard.",
    path: "/",
    roles: ["student", "caretaker"],
    sidebarOnly: true,
  },
  {
    key: "resources",
    title: "Resource Sharing",
    description: "Request or respond to hostel resource needs.",
    path: "/resources",
    roles: ["student", "caretaker"],
  },
  {
    key: "lost-found",
    title: "Lost and Found",
    description: "Report lost or found items and claim matches.",
    path: "/lost-found",
    roles: ["student", "caretaker"],
  },
  {
    key: "attendance",
    title: "Attendance",
    description: "Mark and review daily hostel attendance.",
    path: "/attendance",
    roles: ["student", "caretaker"],
  },
  {
    key: "complaints",
    title: "Complaints",
    description: "Submit maintenance or hostel complaints.",
    path: "/complaints",
    roles: ["student", "caretaker"],
  },
  {
    key: "guest-room-book",
    title: "Book Guest Room",
    description: "Create a new guest room booking request.",
    path: "/guest-room/book",
    roles: ["student", "caretaker"],
  },
  {
    key: "guest-room-list",
    title: "Guest Bookings",
    description: "Track booking status and room details.",
    path: "/guest-room/my-bookings",
    roles: ["caretaker"],
  },
  {
    key: "attendance-list",
    title: "Attendance List",
    description: "View marked and unmarked students today.",
    path: "/attendance/today",
    roles: ["caretaker"],
  },
  {
    key: "complaint-queue",
    title: "Complaint List",
    description: "Prioritize and resolve student complaints.",
    path: "/complaints/list",
    roles: ["caretaker"],
  },
  {
    key: "apply-fine",
    title: "Apply Fine",
    description: "Create hostel fines for violations.",
    path: "/apply-fine",
    roles: ["caretaker"],
  },
  {
    key: "fine-list",
    title: "Fine List",
    description: "Review all fines and payment states.",
    path: "/fine-list",
    roles: ["caretaker"],
  },
];

export const getQuickActionsForUser = (user) => {
  if (!user?.role) return [];
  return QUICK_ACTIONS.filter((item) => item.roles.includes(user.role));
};

export const getHomeQuickActionsForUser = (user) => {
  return getQuickActionsForUser(user).filter((item) => !item.sidebarOnly);
};
