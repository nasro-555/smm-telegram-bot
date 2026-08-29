export const LIKEE_PANELS = [
  {
    code: "lkv",
    platformSlug: "likee",
    categorySlug: "views",
    label: "Likee Views",
    emoji: "👁",
    panelName: "Likee Views",
    pricing: { mode: "multiply", value: 3 },
    ids: [7589, 7591]
  },
  {
    code: "lkc",
    platformSlug: "likee",
    categorySlug: "comments",
    label: "Likee Comments",
    emoji: "💬",
    panelName: "Likee Comments",
    pricing: { mode: "multiply", value: 3 },
    ids: [7592, 7593, 7595],
    serviceLabels: {
      7592: "Random Comments",
      7593: "Custom Comments",
      7595: "Custom Comments HQ & Real"
    }
  },
  {
    code: "lkf",
    platformSlug: "likee",
    categorySlug: "followers",
    label: "Likee Followers",
    emoji: "👥",
    panelName: "Likee Followers",
    pricing: { mode: "multiply", value: 3 },
    ids: [7594],
    serviceLabels: { 7594: "Likee Followers" }
  }
];
