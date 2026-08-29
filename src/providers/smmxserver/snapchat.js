export const SNAPCHAT_PANELS = [
  {
    code: "scf",
    platformSlug: "snapchat",
    categorySlug: "followers",
    label: "Snapchat Followers",
    emoji: "👥",
    panelName: "Snapchat Followers",
    pricing: { mode: "add", value: 1.00 },
    ids: [6577, 4027, 4028],
    serviceLabels: {
      6577: "Arab 🇸🇦",
      4027: "Worldwide 🌍 - 30 Days",
      4028: "Worldwide 🌍 - 60 Days"
    }
  },
  {
    code: "scl",
    platformSlug: "snapchat",
    categorySlug: "likes",
    label: "Snapchat Likes",
    emoji: "❤️",
    panelName: "Snapchat Likes",
    pricing: { mode: "multiply", value: 3 },
    ids: [6576],
    serviceLabels: { 6576: "Arab 🇸🇦" }
  }
];
