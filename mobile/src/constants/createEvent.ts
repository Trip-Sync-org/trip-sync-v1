/** Mirrors `src/App.tsx` Create Event constants for web parity. */

export const TRIP_TAGS: Record<string, string[]> = {
  "🌍 PRIMARY TRIP THEMES": [
    "Adventure",
    "Highway Trip",
    "Road Trip",
    "Bike Ride",
    "Trekking",
    "Camping",
    "Backpacking",
    "Nature Escape",
    "Cultural",
    "Heritage Walk",
    "Food Trail",
    "Spiritual",
    "Photography",
    "Wildlife",
    "Beach Trip",
    "Mountain Trip",
    "Desert Ride",
    "Festival Special",
    "Night Ride",
    "Weekend Getaway",
  ],
  "🚗 TRAVEL MODE": [
    "Bike",
    "Car",
    "SUV Convoy",
    "Self-Drive",
    "Public Transport",
    "Flight Included",
    "Train Journey",
    "Off-Road",
    "4x4 Experience",
    "EV Friendly",
  ],
  "⏳ DURATION": [
    "1 Day",
    "Half Day",
    "Weekend",
    "2–3 Days",
    "4–7 Days",
    "7+ Days",
    "Sunrise Ride",
    "Sunset Ride",
    "Overnight",
  ],
  "👥 GROUP TYPE": [
    "Solo Friendly",
    "Couples",
    "Friends Group",
    "Family Friendly",
    "Women Only",
    "Men Only",
    "Student Special",
    "Corporate",
    "Open Group",
    "Private Invite",
  ],
  "🎮 EXPERIENCE STYLE": [
    "Challenge Based",
    "Checkpoint Hunt",
    "Digital Stamp Collection",
    "Leaderboard Enabled",
    "Competitive Ride",
    "Chill & Explore",
    "Guided Tour",
    "Self-Exploration",
    "Storytelling Trip",
  ],
  "🧭 DIFFICULTY": [
    "Beginner Friendly",
    "Moderate",
    "Advanced",
    "Expert Only",
    "High Endurance",
    "Casual Ride",
  ],
  "🏕️ ACTIVITIES": [
    "Bonfire",
    "Waterfall Visit",
    "River Crossing",
    "Paragliding",
    "Scuba Diving",
    "Snorkeling",
    "ATV Ride",
    "Zipline",
    "Stargazing",
    "Temple Visit",
    "Local Market",
    "Camping Games",
  ],
  "🛡️ SAFETY & LOGISTICS": [
    "Medical Support",
    "Backup Vehicle",
    "Mechanic Support",
    "First Aid Available",
    "GPS Tracked",
    "Insurance Covered",
    "Helmet Mandatory",
    "Fuel Stops Planned",
  ],
  "💰 PRICE CATEGORY": [
    "Free",
    "Budget",
    "Premium",
    "Luxury",
    "Early Bird",
    "Limited Slots",
    "Coupon Available",
  ],
  "🌦️ SEASONAL": [
    "Monsoon Special",
    "Winter Ride",
    "Summer Escape",
    "Festive Edition",
    "New Year Special",
    "Independence Ride",
    "Full Moon Trip",
  ],
  "🌱 IMPACT": [
    "Eco Friendly",
    "Carbon Saving",
    "Tree Plantation",
    "Clean-Up Drive",
    "Community Support",
    "Sustainable Travel",
  ],
  "🔥 MARKETPLACE": [
    "Trending",
    "Most Booked",
    "Highly Rated",
    "New Listing",
    "Almost Full",
    "Verified Organizer",
    "Instant Confirmation",
  ],
};

export const THEMES = [
  "Adventure",
  "Highway Trip",
  "Road Trip",
  "Bike Ride",
  "Trekking",
  "Camping",
  "Backpacking",
  "Nature Escape",
  "Cultural",
  "Heritage Walk",
  "Food Trail",
  "Spiritual",
  "Photography",
  "Wildlife",
  "Beach Trip",
  "Mountain Trip",
  "Desert Ride",
  "Night Ride",
  "Weekend Getaway",
];

export const LANGUAGES = [
  "English",
  "Hindi",
  "Marathi",
  "Tamil",
  "Telugu",
  "Kannada",
  "Bengali",
  "Gujarati",
  "Punjabi",
  "Malayalam",
];

export const AGE_GROUPS = ["All Ages", "18–25", "25–35", "35–50", "50+", "18+", "21+"];

export const DURATIONS = [
  "Half Day (4–6 hrs)",
  "1 Day",
  "Overnight",
  "2 Days / 1 Night",
  "3 Days / 2 Nights",
  "4–7 Days",
  "7+ Days",
  "Custom",
];

export type TimezoneRow = { label: string; city: string; offset: number };

export const TIMEZONES_DATA: TimezoneRow[] = [
  { label: "Hawaii", city: "Honolulu", offset: -600 },
  { label: "Pacific Time", city: "Los Angeles", offset: -480 },
  { label: "Eastern Time", city: "New York", offset: -300 },
  { label: "UTC / GMT", city: "London", offset: 0 },
  { label: "Central European", city: "Paris", offset: 60 },
  { label: "Moscow", city: "Moscow", offset: 180 },
  { label: "Gulf Standard", city: "Dubai", offset: 240 },
  { label: "India", city: "Kolkata", offset: 330 },
  { label: "Singapore", city: "Singapore", offset: 480 },
  { label: "Japan / Korea", city: "Tokyo", offset: 540 },
  { label: "AEST", city: "Sydney", offset: 600 },
  { label: "New Zealand", city: "Auckland", offset: 720 },
];

export function offsetToStr(min: number): string {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function generateCouponCode(prefix = "NOMAD"): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const p = prefix.slice(0, 8).toUpperCase();
  return (
    p +
    Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  );
}
