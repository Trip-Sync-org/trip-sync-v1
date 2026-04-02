import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  MapPin, Calendar, Users, Shield, Zap, Award,
  ChevronRight, ChevronLeft, Search, LayoutDashboard,
  Settings, LogOut, Plus, BarChart3, Ticket, Wallet,
  Navigation, MessageSquare, AlertTriangle, Cloud,
  Camera, Star, TrendingUp, Leaf, Trophy, X, Sparkles,
  Bell, ChevronDown, ChevronUp, Globe, FileText, UserCheck,
  Upload, ImagePlus, Trash2, Tag, Phone, Mail,
  Eye, Copy, Check, Lock, Unlock, DollarSign,
  ArrowUpRight, ArrowDownRight, Filter, Edit2,
  RefreshCw, Download, Clock, UserCircle, Image,
  Hash, Percent, List, ShoppingBag, Activity, Target, Users2,
  Heart, Share2, Bookmark, SlidersHorizontal,
  Compass, Map, Gift, Flame, BadgeCheck, CreditCard,
  Percent as PercentIcon, CheckCircle, AlertCircle, Info,
  ThumbsUp, MessageCircle, CornerDownRight, Send, Menu,
  Crosshair, Play, Pause, Radio, BellRing, ListOrdered, Sun, Moon,
  Minus, Expand,
} from 'lucide-react';
import { signInWithGoogle } from "./lib/auth";
import { supabase } from "./lib/supabaseClient";
import RoutePreviewMap from "./components/RoutePreviewMap";
import LiveTripMap, {
  readLiveMapStoredTheme,
  type LiveTripMapRef,
  type LiveUserGeo,
  type MapTheme,
} from "./components/LiveTripMap";
import { io } from "socket.io-client";

// ─── UTILS ──────────────────────────────────────────────────
type User = { id: string; name: string; email: string; role: 'user' | 'organizer'; level?: number; xp?: number };
type Trip = { id: string; name: string; theme?: string; banner_url?: string; banner?: string; date?: string; price?: number; isFree?: boolean; meetupPoint?: string; endLocation?: string; duration?: string; ageGroup?: string; language?: string; description?: string; prerequisites?: string; terms?: string; maxParticipants?: number; joinedCount?: number; organizer?: string; tags?: string[]; rating?: number; reviews?: Review[]; endDate?: string; time?: string; privacy?: string; meetupLat?: number; meetupLng?: number; endLat?: number; endLng?: number; status?: string };
type Review = { id: string; user: string; avatar: string; rating: number; text: string; date: string; likes: number };
type PlaceSuggestion = { id: string; place_name: string; center: [number, number] };

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── CONSTANTS ──────────────────────────────────────────────
const TRIP_TAGS: Record<string, string[]> = {
  '🌍 PRIMARY TRIP THEMES': ['Adventure','Highway Trip','Road Trip','Bike Ride','Trekking','Camping','Backpacking','Nature Escape','Cultural','Heritage Walk','Food Trail','Spiritual','Photography','Wildlife','Beach Trip','Mountain Trip','Desert Ride','Festival Special','Night Ride','Weekend Getaway'],
  '🚗 TRAVEL MODE': ['Bike','Car','SUV Convoy','Self-Drive','Public Transport','Flight Included','Train Journey','Off-Road','4x4 Experience','EV Friendly'],
  '⏳ DURATION': ['1 Day','Half Day','Weekend','2–3 Days','4–7 Days','7+ Days','Sunrise Ride','Sunset Ride','Overnight'],
  '👥 GROUP TYPE': ['Solo Friendly','Couples','Friends Group','Family Friendly','Women Only','Men Only','Student Special','Corporate','Open Group','Private Invite'],
  '🎮 EXPERIENCE STYLE': ['Challenge Based','Checkpoint Hunt','Digital Stamp Collection','Leaderboard Enabled','Competitive Ride','Chill & Explore','Guided Tour','Self-Exploration','Storytelling Trip'],
  '🧭 DIFFICULTY': ['Beginner Friendly','Moderate','Advanced','Expert Only','High Endurance','Casual Ride'],
  '🏕️ ACTIVITIES': ['Bonfire','Waterfall Visit','River Crossing','Paragliding','Scuba Diving','Snorkeling','ATV Ride','Zipline','Stargazing','Temple Visit','Local Market','Camping Games'],
  '🛡️ SAFETY & LOGISTICS': ['Medical Support','Backup Vehicle','Mechanic Support','First Aid Available','GPS Tracked','Insurance Covered','Helmet Mandatory','Fuel Stops Planned'],
  '💰 PRICE CATEGORY': ['Free','Budget','Premium','Luxury','Early Bird','Limited Slots','Coupon Available'],
  '🌦️ SEASONAL': ['Monsoon Special','Winter Ride','Summer Escape','Festive Edition','New Year Special','Independence Ride','Full Moon Trip'],
  '🌱 IMPACT': ['Eco Friendly','Carbon Saving','Tree Plantation','Clean-Up Drive','Community Support','Sustainable Travel'],
  '🔥 MARKETPLACE': ['Trending','Most Booked','Highly Rated','New Listing','Almost Full','Verified Organizer','Instant Confirmation'],
};
const THEMES = ['Adventure','Highway Trip','Road Trip','Bike Ride','Trekking','Camping','Backpacking','Nature Escape','Cultural','Heritage Walk','Food Trail','Spiritual','Photography','Wildlife','Beach Trip','Mountain Trip','Desert Ride','Night Ride','Weekend Getaway'];
const LANGUAGES = ['English','Hindi','Marathi','Tamil','Telugu','Kannada','Bengali','Gujarati','Punjabi','Malayalam'];
const AGE_GROUPS = ['All Ages','18–25','25–35','35–50','50+','18+','21+'];
const DURATIONS = ['Half Day (4–6 hrs)','1 Day','Overnight','2 Days / 1 Night','3 Days / 2 Nights','4–7 Days','7+ Days','Custom'];
const TIMEZONES_DATA = [
  {label:'Hawaii',city:'Honolulu',offset:-600},{label:'Pacific Time',city:'Los Angeles',offset:-480},
  {label:'Eastern Time',city:'New York',offset:-300},{label:'UTC / GMT',city:'London',offset:0},
  {label:'Central European',city:'Paris',offset:60},{label:'Moscow',city:'Moscow',offset:180},
  {label:'Gulf Standard',city:'Dubai',offset:240},{label:'India',city:'Kolkata',offset:330},
  {label:'Singapore',city:'Singapore',offset:480},{label:'Japan / Korea',city:'Tokyo',offset:540},
  {label:'AEST',city:'Sydney',offset:600},{label:'New Zealand',city:'Auckland',offset:720},
];
const CAL_DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const MOCK_TRIPS: Trip[] = [
  {id:'1',name:'Coastal Bike Expedition',theme:'Bike Ride',banner:'trip1',date:'Sat, 26 Oct 2024',endDate:'Sun, 27 Oct 2024',time:'08:00 AM',duration:'1 Day',ageGroup:'18+',language:'English',price:1200,isFree:false,meetupPoint:'Gateway of India, Mumbai',endLocation:'Alibaug Beach',maxParticipants:20,joinedCount:12,organizer:'Adventure Club',description:'An epic coastal ride from the city to the serene beaches of Alibaug. Experience the thrill of riding along the coastline with stunning sea views, fresh ocean breeze, and an unforgettable sunset at the beach.',prerequisites:'Valid riding license, own bike 150cc+, basic fitness level, helmet mandatory',terms:'No refunds within 24h, helmet mandatory, age 18+, no alcohol during the ride',rating:4.8,tags:['Bike','Adventure','Beach Trip','Weekend Getaway','Guided Tour'],reviews:[{id:'r1',user:'Rahul M.',avatar:'felix',rating:5,text:'Absolutely incredible experience! The coastal route was breathtaking and the organizer was super professional.',date:'Oct 15, 2024',likes:12},{id:'r2',user:'Priya S.',avatar:'lola',rating:5,text:'My first group ride and it was amazing. Well organized, great people, and stunning views!',date:'Oct 12, 2024',likes:8},{id:'r3',user:'Aakash T.',avatar:'sam',rating:4,text:'Great ride overall. Could improve the refreshment stops but the route was fantastic.',date:'Oct 8, 2024',likes:5}]},
  {id:'2',name:'Himalayan Ridge Trek',theme:'Trekking',banner:'trip2',date:'Fri, 8 Nov 2024',endDate:'Sun, 10 Nov 2024',time:'06:00 AM',duration:'2 Days / 1 Night',ageGroup:'18–35',language:'Hindi',price:3500,isFree:false,meetupPoint:'Shimla Bus Stand',endLocation:'Kufri Peak',maxParticipants:15,joinedCount:8,organizer:'Peak Seekers',description:'A challenging 2-day trek through the majestic Himalayan ridges near Shimla. Camp under stars, witness breathtaking valley views, and conquer the Kufri Peak at 2600m altitude.',prerequisites:'Good physical fitness, own trekking shoes, warm clothing, no knee issues',terms:'No refunds after booking, weather-dependent trip, follow guide instructions',rating:4.9,tags:['Trekking','Mountain Trip','Camping','Advanced','Bonfire','Stargazing'],reviews:[{id:'r4',user:'Sneha K.',avatar:'adventurous',rating:5,text:'Life-changing trek! The ridge views at sunrise were absolutely magical.',date:'Oct 20, 2024',likes:18},{id:'r5',user:'Vikram P.',avatar:'nomad',rating:5,text:'Peak Seekers are pros. Safety-first approach, great food, excellent camping setup.',date:'Oct 18, 2024',likes:11}]},
  {id:'3',name:'Desert Night Ride',theme:'Night Ride',banner:'trip3',date:'Sat, 15 Nov 2024',endDate:'Sat, 15 Nov 2024',time:'08:00 PM',duration:'Overnight',ageGroup:'21+',language:'English',price:0,isFree:true,meetupPoint:'Jaisalmer Fort Gate',endLocation:'Sam Sand Dunes',maxParticipants:12,joinedCount:6,organizer:'Desert Nomads',description:'Ride through the golden sands of Jaisalmer under a canopy of a million stars. Experience the magic of the Thar Desert at night with a bonfire, folk music, and camel rides at Sam Sand Dunes.',prerequisites:'Own bike or car, experience with night driving, warm clothes for desert cold',terms:'BYOB (bring your own vehicle), follow convoy rules, no littering in desert',rating:4.7,tags:['Night Ride','Desert Ride','Free','Bonfire','Stargazing','Adventure'],reviews:[{id:'r6',user:'Dev R.',avatar:'desert',rating:5,text:'Free trip with premium experience! The stargazing was out of this world.',date:'Oct 5, 2024',likes:22}]},
  {id:'4',name:'Western Ghats Food Trail',theme:'Food Trail',banner:'trip4',date:'Sun, 24 Nov 2024',endDate:'Sun, 24 Nov 2024',time:'09:00 AM',duration:'1 Day',ageGroup:'All Ages',language:'Marathi',price:800,isFree:false,meetupPoint:'Pune Station',endLocation:'Kolhapur Market',maxParticipants:18,joinedCount:14,organizer:'Taste Voyagers',description:'A culinary journey through the Western Ghats, exploring local markets, heritage restaurants, and authentic Maharashtrian cuisine. From Kolhapuri misal to Modak, taste the soul of Maharashtra.',prerequisites:'None - all food lovers welcome! Let us know about any allergies.',terms:'Food costs included in ticket, transportation extra, no refunds',rating:4.6,tags:['Food Trail','Cultural','Family Friendly','Beginner Friendly','Local Market'],reviews:[{id:'r7',user:'Meera N.',avatar:'foodie',rating:5,text:'Best food tour ever! 12 restaurants in one day - my stomach has never been happier.',date:'Nov 1, 2024',likes:15}]},
  {id:'5',name:'Valley of Flowers Trek',theme:'Nature Escape',banner:'nature1',date:'Fri, 6 Dec 2024',endDate:'Mon, 9 Dec 2024',time:'05:00 AM',duration:'4–7 Days',ageGroup:'18–50',language:'English',price:6500,isFree:false,meetupPoint:'Haridwar Railway Station',endLocation:'Ghangaria Village',maxParticipants:10,joinedCount:3,organizer:'Himalayan Soul',description:'A UNESCO World Heritage trek through the legendary Valley of Flowers in Uttarakhand. Witness over 300 species of wildflowers, glacial rivers, and pristine Himalayan landscapes in this once-in-a-lifetime expedition.',prerequisites:'High fitness level, acclimatization needed, prior trekking experience of 3+ treks',terms:'No refunds after trip start, travel insurance mandatory, guide instructions final',rating:5.0,tags:['Trekking','Nature Escape','Wildlife','Photography','Expert Only','High Endurance'],reviews:[{id:'r8',user:'Ananya V.',avatar:'hiker',rating:5,text:'This is THE trek of a lifetime. Himalayan Soul are absolutely incredible guides.',date:'Nov 10, 2024',likes:30}]},
  {id:'6',name:'Heritage Walk – Old Delhi',theme:'Heritage Walk',banner:'heritage1',date:'Sat, 30 Nov 2024',endDate:'Sat, 30 Nov 2024',time:'07:00 AM',duration:'Half Day (4–6 hrs)',ageGroup:'All Ages',language:'Hindi',price:350,isFree:false,meetupPoint:'Red Fort Metro Exit 2',endLocation:'Chandni Chowk',maxParticipants:25,joinedCount:20,organizer:'Delhi Heritage Walks',description:'Step back in time with a guided walk through the lanes of Old Delhi. From Mughal architecture to street food legends, explore the 400-year history of Shahjahanabad with expert local storytellers.',prerequisites:'Comfortable walking shoes, no physical restrictions',terms:'Children under 12 free, group photography encouraged, storytelling in Hindi/English',rating:4.5,tags:['Heritage Walk','Cultural','Family Friendly','Guided Tour','Storytelling Trip','Beginner Friendly'],reviews:[{id:'r9',user:'Rohan B.',avatar:'walker',rating:4,text:'Fascinating history brought to life! Guides were very knowledgeable.',date:'Oct 28, 2024',likes:9}]},
];

function offsetToStr(min: number): string {
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  return `GMT${sign}${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`;
}
function generateCouponCode(prefix = 'NOMAD'): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return prefix + Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}

function asNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Readable message from a failed fetch (JSON `error`/`details` or short HTML/text). */
async function readApiErrorMessage(res: Response): Promise<string> {
  try {
    const text = (await res.clone().text()).trim();
    if (text.startsWith("{")) {
      const j = JSON.parse(text) as {
        error?: unknown;
        details?: unknown;
        hint?: unknown;
        message?: unknown;
      };
      const parts = [j.error, j.details, j.hint, j.message].filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      );
      if (parts.length) return parts.join(" — ");
    } else if (text.length > 0 && text.length < 600) {
      return text.replace(/\s+/g, " ").slice(0, 400);
    }
  } catch {
    /* ignore */
  }
  return `Request failed (HTTP ${res.status})`;
}

/** Match server `tripScopeFromDate` — local calendar day, no UTC drift. */
function parseDateOnlyLocal(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfTodayLocalClient(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function tripDateVsToday(dateStr: string | undefined): "today" | "future" | "past" | "unknown" {
  const d = parseDateOnlyLocal(dateStr);
  if (!d) return "unknown";
  const t0 = startOfTodayLocalClient().getTime();
  const t1 = d.getTime();
  if (t1 === t0) return "today";
  if (t1 < t0) return "past";
  return "future";
}

function isBookingCancelledOrCompleted(t: Trip): boolean {
  const s = String(t.status || "").toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "completed" || s === "refunded";
}

function isPrivateTrip(t: Trip): boolean {
  return String(t.privacy || "").toLowerCase() === "private";
}

function normalizeTripFromApi(raw: any): Trip {
  const tags = typeof raw?.tags === 'string'
    ? (() => {
        try {
          const parsed = JSON.parse(raw.tags);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : Array.isArray(raw?.tags)
      ? raw.tags
      : [];

  const normalizedReviews: Review[] = Array.isArray(raw?.reviews)
    ? raw.reviews.map((r: any, idx: number) => ({
        id: String(r?.id ?? `review-${idx}`),
        user: r?.user_name || r?.user || "Explorer",
        avatar: r?.avatar || r?.user_name || "explorer",
        rating: Number(r?.rating) || 0,
        text: r?.text || "",
        date: r?.created_at
          ? new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "Recent",
        likes: Number(r?.likes) || 0,
      }))
    : [];

  return {
    id: String(raw?.trip_id ?? raw?.id),
    name: raw?.trip_name || raw?.name || 'Untitled Trip',
    theme: raw?.trip_theme || raw?.theme || 'Adventure',
    banner_url: raw?.banner_url || undefined,
    date: raw?.trip_date || raw?.date || undefined,
    time: raw?.trip_time || raw?.time || undefined,
    duration: raw?.trip_duration || raw?.duration || undefined,
    price: asNum(raw?.trip_price ?? raw?.price ?? raw?.amount_paid) || 0,
    isFree: (asNum(raw?.trip_price ?? raw?.price ?? raw?.amount_paid) || 0) <= 0,
    meetupPoint: raw?.trip_start_location || raw?.start_location || undefined,
    endLocation: raw?.trip_end_location || raw?.end_location || undefined,
    description: raw?.trip_description || raw?.description || undefined,
    prerequisites: raw?.prerequisites || undefined,
    terms: raw?.terms || undefined,
    maxParticipants: asNum(raw?.trip_max_participants ?? raw?.max_participants),
    joinedCount: asNum(raw?.joined_count) ?? asNum(raw?.participant_count) ?? 0,
    organizer: raw?.organizer_name || 'Organizer',
    tags,
    reviews: normalizedReviews,
    rating: normalizedReviews.length
      ? Number((normalizedReviews.reduce((sum, review) => sum + review.rating, 0) / normalizedReviews.length).toFixed(1))
      : asNum(raw?.rating),
    privacy: raw?.privacy || undefined,
    status: raw?.trip_status || raw?.status || raw?.booking_status || undefined,
    banner:
      (typeof raw?.banner === "string" && raw.banner) ||
      (raw?.banner_url ? String(raw.banner_url).replace(/\W/g, "").slice(-20) : undefined) ||
      `trip-${raw?.trip_id ?? raw?.id ?? "x"}`,
    meetupLat: asNum(raw?.meetup_lat) ?? asNum(raw?.start_lat),
    meetupLng: asNum(raw?.meetup_lng) ?? asNum(raw?.start_lng),
    endLat: asNum(raw?.end_lat),
    endLng: asNum(raw?.end_lng),
  };
}

type CouponType = {id:string;code:string;discount:number;limit:number;used:number;expiry:string;active:boolean;prefix:string};
type InviteType = {type:'phone'|'email';value:string};

type OrgDashEvent = {
  id: number;
  name: string;
  date: string;
  theme: string;
  joined: number;
  max: number;
  revenue: number;
  status: string;
  scope: "today" | "upcoming" | "past";
  banner: string;
  privacy: "public" | "private";
};

// ─── SHARED COMPONENTS ──────────────────────────────────────
const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'outline'|'ghost'|'danger';size?:'sm'|'md'|'lg'}>(
  ({className,variant='primary',size='md',...props},ref) => {
    const v = {primary:'bg-white text-black hover:bg-gray-200',secondary:'bg-white/10 text-white hover:bg-white/20',outline:'border border-white/20 text-white hover:bg-white/5',ghost:'text-white/60 hover:text-white hover:bg-white/5',danger:'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'};
    const s = {sm:'px-3 py-1.5 text-sm',md:'px-6 py-3',lg:'px-8 py-4 text-lg'};
    return <button ref={ref} className={cn('inline-flex items-center justify-center rounded-full font-medium transition-all duration-200 active:scale-95 disabled:opacity-50',v[variant],s[size],className)} {...props}/>;
  }
);

const Card = ({children,className,hover=true,...props}:{children:React.ReactNode;className?:string;hover?:boolean}&React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={cn('bg-white/[0.04] border border-white/10 rounded-2xl transition-all duration-300',hover&&'hover:border-white/25 hover:bg-white/[0.06]',className)}>{children}</div>
);

const Badge = ({children,variant='default'}:{children:React.ReactNode;variant?:'default'|'success'|'warning'|'danger'|'info'}) => {
  const v = {default:'bg-white/10 text-white/80',success:'bg-emerald-500/20 text-emerald-400',warning:'bg-amber-500/20 text-amber-400',danger:'bg-red-500/20 text-red-400',info:'bg-blue-500/20 text-blue-400'};
  return <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',v[variant])}>{children}</span>;
};

const StarRating = ({rating,size=14}:{rating:number;size?:number}) => (
  <div className="flex items-center gap-0.5">
    {[1,2,3,4,5].map(i => (
      <Star key={i} size={size} className={cn(i<=Math.round(rating)?'text-amber-400 fill-amber-400':'text-white/20')}/>
    ))}
  </div>
);

// ─── NOTIFICATION DATA ───────────────────────────────────────
type Notification = { id: string; type: 'booking' | 'invite' | 'reward' | 'reminder' | 'system'; title: string; body: string; time: string; read: boolean; avatar?: string; action?: string };

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', type: 'booking', title: 'Booking Confirmed 🎉', body: 'Your spot for Coastal Bike Expedition is confirmed!', time: '2m ago', read: false, avatar: 'trip1', action: '/trip/1' },
  { id: 'n2', type: 'invite', title: 'Private Invite 🔒', body: 'Wave Riders invited you to Goa Secret Beaches (Dec 12)', time: '1h ago', read: false, avatar: 'goa', action: '/dashboard' },
  { id: 'n3', type: 'reward', title: 'XP Earned ⚡', body: 'You earned 250 XP for completing Desert Night Ride!', time: '3h ago', read: false, action: '/dashboard' },
  { id: 'n4', type: 'reminder', title: 'Trip Tomorrow 🏔️', body: 'Himalayan Ridge Trek starts at 6:00 AM from Shimla Bus Stand', time: '5h ago', read: true, avatar: 'trip2', action: '/trip/2' },
  { id: 'n5', type: 'system', title: 'New Coupon Available', body: 'Use EARLYBIRD25 for 25% off any trip this weekend!', time: '1d ago', read: true, action: '/explore' },
  { id: 'n6', type: 'booking', title: 'Waitlist Update', body: 'A slot opened up for Valley of Flowers Trek!', time: '2d ago', read: true, action: '/trip/5' },
];

const SEARCH_SUGGESTIONS = [
  { type: 'trip', label: 'Coastal Bike Expedition', sub: 'Oct 26 · Mumbai', id: '1' },
  { type: 'trip', label: 'Himalayan Ridge Trek', sub: 'Nov 8 · Shimla', id: '2' },
  { type: 'trip', label: 'Desert Night Ride', sub: 'Nov 15 · Jaisalmer · FREE', id: '3' },
  { type: 'theme', label: 'Adventure', sub: '12 trips available' },
  { type: 'theme', label: 'Trekking', sub: '8 trips available' },
  { type: 'theme', label: 'Beach Trip', sub: '5 trips available' },
  { type: 'location', label: 'Mumbai', sub: '6 trips nearby' },
  { type: 'location', label: 'Shimla', sub: '3 trips nearby' },
];

// ─── APP NAVBAR ─────────────────────────────────────────────
const AppNav = ({ user, onLogout }: { user?: User | null; onLogout?: () => void }) => {
  const navigate = useNavigate();
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS);
  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter(n => !n.read).length;

  const filtered = searchQuery.length > 0
    ? SEARCH_SUGGESTIONS.filter(s =>
        s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.sub || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : SEARCH_SUGGESTIONS;

  const markAllRead = () => setNotifications(p => p.map(n => ({ ...n, read: true })));
  const markRead = (id: string) => setNotifications(p => p.map(n => n.id === id ? { ...n, read: true } : n));
  const deleteNotif = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotifications(p => p.filter(n => n.id !== id));
  };

  const closeAll = () => { setShowSearch(false); setShowNotifs(false); setShowProfile(false); setShowMobileMenu(false); };

  useEffect(() => {
    if (showSearch) setTimeout(() => searchRef.current?.focus(), 50);
  }, [showSearch]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const notifIcon = (type: Notification['type']) => {
    const icons: Record<string, { icon: React.ReactNode; bg: string }> = {
      booking: { icon: <CheckCircle size={14} className="text-emerald-400" />, bg: 'bg-emerald-500/15' },
      invite:  { icon: <Lock size={14} className="text-amber-400" />, bg: 'bg-amber-500/15' },
      reward:  { icon: <Zap size={14} className="text-yellow-400" />, bg: 'bg-yellow-500/15' },
      reminder:{ icon: <Bell size={14} className="text-blue-400" />, bg: 'bg-blue-500/15' },
      system:  { icon: <Tag size={14} className="text-purple-400" />, bg: 'bg-purple-500/15' },
    };
    return icons[type] || icons.system;
  };

  const searchTypeIcon = (type: string) => {
    if (type === 'trip') return <Navigation size={13} className="text-white/40" />;
    if (type === 'theme') return <Compass size={13} className="text-white/40" />;
    return <MapPin size={13} className="text-white/40" />;
  };

  const navLinks = user?.role === 'organizer'
    ? [
        { to: '/organizer', label: 'Dashboard' },
        { to: '/organizer/create', label: 'Create Event' },
        { to: '/explore', label: 'Marketplace' },
      ]
    : [
        { to: '/explore', label: 'Explore' },
        { to: '/dashboard', label: 'My Trips' },
        { to: '/', label: 'How it works' },
      ];

  return (
    <>
      {/* Overlay for mobile menu */}
      <AnimatePresence>
        {showMobileMenu && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setShowMobileMenu(false)}
          />
        )}
      </AnimatePresence>

      <nav ref={navRef} className="fixed top-0 z-50 w-full safe-pt safe-px px-4 md:px-6 py-3.5 flex justify-between items-center bg-black/85 backdrop-blur-2xl border-b border-white/[0.07]"
        style={{ boxShadow: '0 1px 40px rgba(0,0,0,0.5)' }}>

        {/* ── LOGO ── */}
        <Link to="/" onClick={closeAll} className="flex items-center gap-2.5 flex-shrink-0">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.15)]">
            <Navigation className="text-black w-5 h-5" />
          </motion.div>
          <span className="text-lg font-bold tracking-tight hidden sm:block">NOMAD</span>
        </Link>

        {/* ── DESKTOP NAV LINKS ── */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(link => (
            <Link key={link.to} to={link.to} onClick={closeAll}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white/55 hover:text-white hover:bg-white/[0.07] transition-all duration-150">
              {link.label}
            </Link>
          ))}
        </div>

        {/* ── RIGHT CONTROLS ── */}
        <div className="flex items-center gap-1.5">

          {/* Search */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => { setShowSearch(!showSearch); setShowNotifs(false); setShowProfile(false); }}
              className={cn(
                'w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150',
                showSearch ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/[0.08]'
              )}>
              <Search size={17} />
            </motion.button>

            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-0 top-full mt-3 w-[340px] md:w-[420px] bg-[#0c0c0c] border border-white/10 rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.9)]">

                  {/* Search input */}
                  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
                    <Search size={15} className="text-white/30 flex-shrink-0" />
                    <input
                      ref={searchRef}
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && searchQuery.trim()) {
                          navigate(`/explore?q=${encodeURIComponent(searchQuery)}`);
                          closeAll();
                          setSearchQuery('');
                        }
                        if (e.key === 'Escape') closeAll();
                      }}
                      placeholder="Search trips, locations, themes…"
                      className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="text-white/20 hover:text-white transition-colors">
                        <X size={14} />
                      </button>
                    )}
                    <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 bg-white/[0.06] border border-white/[0.08] rounded text-[10px] text-white/20 font-mono">esc</kbd>
                  </div>

                  {/* Results */}
                  <div className="max-h-[360px] overflow-y-auto">
                    {!searchQuery && (
                      <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold text-white/20 uppercase tracking-widest">Quick Access</p>
                    )}
                    {searchQuery && filtered.length === 0 && (
                      <div className="py-10 text-center">
                        <p className="text-sm text-white/30">No results for "<span className="text-white/50">{searchQuery}</span>"</p>
                        <button onClick={() => { navigate('/explore'); closeAll(); setSearchQuery(''); }}
                          className="mt-3 text-xs text-white/40 hover:text-white underline transition-colors">Browse all trips</button>
                      </div>
                    )}
                    {filtered.map((item, i) => (
                      <motion.button
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => {
                          if (item.type === 'trip' && item.id) navigate(`/trip/${item.id}`);
                          else navigate('/explore');
                          closeAll(); setSearchQuery('');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.05] transition-colors text-left group">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.07] flex items-center justify-center flex-shrink-0">
                          {searchTypeIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white/85 truncate">{item.label}</p>
                          <p className="text-[11px] text-white/30 truncate">{item.sub}</p>
                        </div>
                        <ChevronRight size={13} className="text-white/15 group-hover:text-white/40 transition-colors flex-shrink-0" />
                      </motion.button>
                    ))}
                  </div>

                  <div className="px-4 py-2.5 border-t border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
                    <span className="text-[10px] text-white/20">Press Enter to search all trips</span>
                    <button onClick={() => { navigate('/explore'); closeAll(); setSearchQuery(''); }}
                      className="text-[10px] text-white/40 hover:text-white transition-colors flex items-center gap-1">
                      All trips <ChevronRight size={10} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Notifications */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => { setShowNotifs(!showNotifs); setShowSearch(false); setShowProfile(false); }}
              className={cn(
                'relative w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150',
                showNotifs ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/[0.08]'
              )}>
              <Bell size={17} />
              {unread > 0 && (
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-white rounded-full flex items-center justify-center px-1">
                  <span className="text-[9px] font-black text-black leading-none">{unread > 9 ? '9+' : unread}</span>
                </motion.div>
              )}
            </motion.button>

            <AnimatePresence>
              {showNotifs && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-0 top-full mt-3 w-[340px] md:w-[380px] bg-[#0c0c0c] border border-white/10 rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.9)]">

                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-white">Notifications</span>
                      {unread > 0 && (
                        <span className="px-1.5 py-0.5 bg-white text-black text-[10px] font-black rounded-full leading-none">{unread}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {unread > 0 && (
                        <button onClick={markAllRead}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/40 hover:text-white hover:bg-white/[0.06] transition-all">
                          Mark all read
                        </button>
                      )}
                      <button onClick={() => setNotifications([])}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all">
                        Clear all
                      </button>
                    </div>
                  </div>

                  {/* Notification list */}
                  <div className="max-h-[400px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="py-14 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mx-auto mb-3">
                          <Bell size={20} className="text-white/20" />
                        </div>
                        <p className="text-sm text-white/30 font-medium">All caught up!</p>
                        <p className="text-xs text-white/15 mt-1">No new notifications</p>
                      </div>
                    ) : (
                      <AnimatePresence initial={false}>
                        {notifications.map((n, i) => {
                          const ni = notifIcon(n.type);
                          return (
                            <motion.div
                              key={n.id}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0, x: 20 }}
                              transition={{ duration: 0.2 }}
                              className={cn(
                                'relative group cursor-pointer transition-colors border-b border-white/[0.04] last:border-0',
                                !n.read ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'
                              )}
                              onClick={() => { markRead(n.id); if (n.action) { navigate(n.action); closeAll(); } }}>
                              {/* Unread dot */}
                              {!n.read && (
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full" />
                              )}
                              <div className={cn('flex items-start gap-3 px-4 py-3.5', !n.read && 'pl-6')}>
                                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', ni.bg)}>
                                  {ni.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={cn('text-sm font-semibold truncate', n.read ? 'text-white/60' : 'text-white')}>{n.title}</p>
                                  <p className="text-[12px] text-white/35 leading-relaxed mt-0.5 line-clamp-2">{n.body}</p>
                                  <p className="text-[10px] text-white/20 mt-1.5 font-medium">{n.time}</p>
                                </div>
                                <button
                                  onClick={(e) => deleteNotif(n.id, e)}
                                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg bg-white/[0.06] flex items-center justify-center text-white/25 hover:text-white hover:bg-white/10 transition-all flex-shrink-0 mt-0.5">
                                  <X size={11} />
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    )}
                  </div>

                  <div className="px-4 py-2.5 border-t border-white/[0.06] bg-white/[0.02]">
                    <button onClick={() => { navigate('/dashboard'); closeAll(); }}
                      className="w-full text-center text-[11px] text-white/30 hover:text-white transition-colors py-0.5">
                      View all activity →
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Auth section */}
          {user ? (
            <div className="relative">
              <motion.button
                whileTap={{ scale: 0.93 }}
                onClick={() => { setShowProfile(!showProfile); setShowSearch(false); setShowNotifs(false); }}
                className={cn(
                  'flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl transition-all duration-150 border',
                  showProfile
                    ? 'bg-white/10 border-white/20'
                    : 'border-transparent hover:bg-white/[0.07] hover:border-white/10'
                )}>
                <div className="relative w-7 h-7 rounded-lg overflow-hidden bg-white/10 border border-white/20 flex-shrink-0">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} alt="Profile" className="w-full h-full object-cover" />
                  <div className="absolute bottom-0 right-0 w-2 h-2 bg-emerald-400 rounded-full border border-black" />
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold text-white/90 leading-tight max-w-[80px] truncate">{user.name}</p>
                  <p className="text-[9px] text-white/30 leading-tight capitalize">{user.role}</p>
                </div>
                <ChevronDown size={12} className={cn('text-white/30 hidden sm:block transition-transform duration-200', showProfile && 'rotate-180')} />
              </motion.button>

              <AnimatePresence>
                {showProfile && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.96 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 top-full mt-3 w-72 bg-[#0c0c0c] border border-white/10 rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.9)]">

                    {/* Profile header */}
                    <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="relative">
                          <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 border border-white/15">
                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#0c0c0c]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white truncate">{user.name}</p>
                          <p className="text-xs text-white/40 truncate">{user.email}</p>
                        </div>
                      </div>
                      {/* Level / XP bar */}
                      {user.role === 'user' && (
                        <div className="p-2.5 bg-white/[0.04] rounded-xl border border-white/[0.06]">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Trophy size={11} className="text-amber-400" />
                              <span className="text-[11px] font-bold text-amber-400">Level {user.level} Explorer</span>
                            </div>
                            <span className="text-[10px] text-white/30">{user.xp} XP</span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }} animate={{ width: `${((user.xp || 0) % 1000) / 10}%` }}
                              transition={{ duration: 0.8, delay: 0.2 }}
                              className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
                          </div>
                        </div>
                      )}
                      {user.role === 'organizer' && (
                        <div className="flex items-center gap-2 p-2 bg-emerald-500/[0.08] rounded-xl border border-emerald-500/15">
                          <BadgeCheck size={13} className="text-emerald-400" />
                          <span className="text-[11px] font-semibold text-emerald-400">Verified Organizer</span>
                        </div>
                      )}
                    </div>

                    {/* Menu items */}
                    <div className="p-2">
                      {(user.role === 'user' ? [
                        { icon: LayoutDashboard, label: 'My Dashboard', sub: 'Trips, rewards, history', to: '/dashboard' },
                        { icon: Compass, label: 'Explore Trips', sub: 'Find your next adventure', to: '/explore' },
                        { icon: Bookmark, label: 'Saved Trips', sub: '3 trips bookmarked', to: '/dashboard' },
                        { icon: Wallet, label: 'Wallet & Rewards', sub: '₹420 available', to: '/dashboard' },
                        { icon: Settings, label: 'Settings', sub: 'Account & preferences', to: '/dashboard' },
                      ] : [
                        { icon: LayoutDashboard, label: 'Organizer Dashboard', sub: 'Events & analytics', to: '/organizer' },
                        { icon: Plus, label: 'Create New Event', sub: 'Launch an expedition', to: '/organizer/create' },
                        { icon: Compass, label: 'Marketplace', sub: 'Browse all listings', to: '/explore' },
                        { icon: BarChart3, label: 'Revenue & Analytics', sub: '₹52,800 total earnings', to: '/organizer' },
                        { icon: Settings, label: 'Account Settings', sub: 'Profile & preferences', to: '/organizer' },
                      ]).map((item) => (
                        <button
                          key={item.to + item.label}
                          onClick={() => { navigate(item.to); closeAll(); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] transition-all text-left group">
                          <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.07] flex items-center justify-center flex-shrink-0 group-hover:bg-white/[0.08] transition-colors">
                            <item.icon size={14} className="text-white/40 group-hover:text-white/70 transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{item.label}</p>
                            <p className="text-[10px] text-white/25 truncate">{item.sub}</p>
                          </div>
                          <ChevronRight size={12} className="text-white/10 group-hover:text-white/30 transition-colors flex-shrink-0" />
                        </button>
                      ))}
                    </div>

                    {/* Footer */}
                    <div className="p-2 border-t border-white/[0.06]">
                      <button
                        onClick={() => { onLogout?.(); closeAll(); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-500/[0.08] transition-all group text-left">
                        <div className="w-8 h-8 rounded-lg bg-red-500/[0.08] border border-red-500/[0.12] flex items-center justify-center flex-shrink-0">
                          <LogOut size={14} className="text-red-400/70 group-hover:text-red-400 transition-colors" />
                        </div>
                        <span className="text-sm font-semibold text-red-400/60 group-hover:text-red-400 transition-colors">Sign Out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" onClick={closeAll}>
                <motion.button whileTap={{ scale: 0.94 }}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.07] transition-all">
                  Login
                </motion.button>
              </Link>
              <Link to="/signup" onClick={closeAll}>
                <motion.button whileTap={{ scale: 0.94 }}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-white text-black hover:bg-white/90 transition-all">
                  Get Started
                </motion.button>
              </Link>
            </div>
          )}

          {/* Mobile hamburger */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => { setShowMobileMenu(!showMobileMenu); setShowSearch(false); setShowNotifs(false); setShowProfile(false); }}
            className="md:hidden w-9 h-9 rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-white/[0.07] transition-all ml-1">
            <motion.span animate={{ rotate: showMobileMenu ? 45 : 0, y: showMobileMenu ? 7 : 0 }} className="w-5 h-[1.5px] bg-white/60 rounded-full block" />
            <motion.span animate={{ opacity: showMobileMenu ? 0 : 1 }} className="w-4 h-[1.5px] bg-white/60 rounded-full block self-start ml-0.5" />
            <motion.span animate={{ rotate: showMobileMenu ? -45 : 0, y: showMobileMenu ? -7 : 0 }} className="w-5 h-[1.5px] bg-white/60 rounded-full block" />
          </motion.button>
        </div>
      </nav>

      {/* ── MOBILE MENU ── */}
      <AnimatePresence>
        {showMobileMenu && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed left-0 right-0 z-40 md:hidden bg-[#080808] border-b border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.8)] top-[calc(3.5rem+env(safe-area-inset-top,0px))] max-h-[min(70dvh,calc(100dvh-3.5rem-env(safe-area-inset-top,0px)))] overflow-y-auto">
            <div className="p-4 space-y-1">
              {/* Mobile nav links */}
              {navLinks.map(link => (
                <Link key={link.to} to={link.to}
                  onClick={() => setShowMobileMenu(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/60 hover:text-white hover:bg-white/[0.06] transition-all font-medium">
                  {link.label}
                </Link>
              ))}

              {/* Mobile user section */}
              {user && (
                <div className="pt-3 mt-3 border-t border-white/[0.06]">
                  <div className="flex items-center gap-3 px-4 py-3 mb-2">
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/10 border border-white/15">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{user.name}</p>
                      <p className="text-xs text-white/40">{user.email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { onLogout?.(); setShowMobileMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-500/[0.08] transition-all">
                    <LogOut size={16} />
                    <span className="font-semibold text-sm">Sign Out</span>
                  </button>
                </div>
              )}
              {!user && (
                <div className="pt-3 mt-3 border-t border-white/[0.06] flex gap-2">
                  <Link to="/login" onClick={() => setShowMobileMenu(false)} className="flex-1">
                    <button className="w-full py-3 rounded-xl border border-white/15 text-sm font-semibold text-white/60 hover:text-white hover:border-white/30 transition-all">Login</button>
                  </Link>
                  <Link to="/signup" onClick={() => setShowMobileMenu(false)} className="flex-1">
                    <button className="w-full py-3 rounded-xl bg-white text-black text-sm font-bold hover:bg-white/90 transition-all">Get Started</button>
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// ─── DATE PICKER ────────────────────────────────────────────
const DatePicker = ({value,onChange,onClose}:{value:string;onChange:(v:string)=>void;onClose:()=>void}) => {
  const [vd,setVd] = useState(()=>{const t=new Date();return new Date(t.getFullYear(),t.getMonth(),1);});
  const y=vd.getFullYear(),m=vd.getMonth();
  const fd=new Date(y,m,1).getDay(),dim=new Date(y,m+1,0).getDate(),pd=new Date(y,m,0).getDate();
  const tr=(7-((fd+dim)%7))%7,today=new Date();
  const isSel=(d:number)=>value===new Date(y,m,d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  const pick=(d:number)=>{onChange(new Date(y,m,d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}));onClose();};
  return (
    <><div className="fixed inset-0 z-[55]" onClick={onClose}/>
    <motion.div initial={{opacity:0,y:10,scale:0.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10,scale:0.95}} className="absolute top-full left-0 mt-2 w-72 bg-[#0d0d0d] border border-white/10 rounded-2xl p-5 shadow-[0_8px_40px_rgba(0,0,0,0.8)] z-[60]">
      <div className="flex items-center justify-between mb-5">
        <button type="button" onClick={()=>setVd(new Date(y,m-1,1))} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"><ChevronLeft size={16}/></button>
        <span className="text-sm font-bold text-white">{CAL_MONTHS[m]} {y}</span>
        <button type="button" onClick={()=>setVd(new Date(y,m+1,1))} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"><ChevronRight size={16}/></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-2">{CAL_DAYS.map(d=><div key={d} className="text-center text-[10px] font-bold text-white/30 py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({length:fd},(_,i)=><div key={`p${i}`} className="h-9 flex items-center justify-center text-xs text-white/10">{pd-fd+i+1}</div>)}
        {Array.from({length:dim},(_,i)=>{const d=i+1,sel=isSel(d),isT=today.getFullYear()===y&&today.getMonth()===m&&today.getDate()===d;return <button key={d} type="button" onClick={()=>pick(d)} className={cn('h-9 flex items-center justify-center rounded-xl text-xs font-bold transition-all',sel?'bg-white text-black':isT?'text-white border border-white/30 hover:bg-white/10':'text-white/60 hover:bg-white/10 hover:text-white')}>{d}</button>;})}
        {Array.from({length:tr},(_,i)=><div key={`n${i}`} className="h-9 flex items-center justify-center text-xs text-white/10">{i+1}</div>)}
      </div>
    </motion.div></>
  );
};

// ─── TIME PICKER ────────────────────────────────────────────
const TimePicker = ({value,onChange,onClose}:{value:string;onChange:(v:string)=>void;onClose:()=>void}) => {
  const parse=(v:string)=>{const p=v.split(' ');const [h,m]=(p[0]||'12:00').split(':');return{h:parseInt(h)||12,m:parseInt(m)||0,ap:p[1]||'AM'};};
  const [sel,setSel]=useState(()=>parse(value));
  const col='flex-1 max-h-[144px] overflow-y-auto scrollbar-hide rounded-xl bg-white/[0.04] border border-white/[0.08]';
  const item=(a:boolean)=>cn('w-full py-2.5 text-center text-sm font-bold cursor-pointer select-none transition-all',a?'bg-white/15 text-white':'text-white/35 hover:bg-white/[0.06] hover:text-white/80');
  const fmt=(s:typeof sel)=>`${String(s.h).padStart(2,'0')}:${String(s.m).padStart(2,'0')} ${s.ap}`;
  return (
    <><div className="fixed inset-0 z-[55]" onClick={onClose}/>
    <motion.div initial={{opacity:0,y:10,scale:0.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10,scale:0.95}} className="absolute top-full left-0 mt-2 w-56 bg-[#0d0d0d] border border-white/10 rounded-2xl p-4 shadow-[0_8px_40px_rgba(0,0,0,0.8)] z-[60]">
      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Select Time</p>
      <div className="flex items-center gap-2">
        <div className={col}>{Array.from({length:12},(_,i)=>i+1).map(h=><div key={h} className={item(sel.h===h)} onClick={()=>setSel(s=>({...s,h}))}>{String(h).padStart(2,'0')}</div>)}</div>
        <span className="text-white/40 font-bold text-lg">:</span>
        <div className={col}>{Array.from({length:12},(_,i)=>i*5).map(m=><div key={m} className={item(sel.m===m)} onClick={()=>setSel(s=>({...s,m}))}>{String(m).padStart(2,'0')}</div>)}</div>
        <div className={col}>{['AM','PM'].map(ap=><div key={ap} className={item(sel.ap===ap)} onClick={()=>setSel(s=>({...s,ap}))}>{ap}</div>)}</div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-white/10">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/40 hover:text-white hover:bg-white/5">Cancel</button>
        <button type="button" onClick={()=>{onChange(fmt(sel));onClose();}} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-white text-black">Done</button>
      </div>
    </motion.div></>
  );
};

// ─── TIMEZONE PICKER ────────────────────────────────────────
const TimezonePicker = ({value,onChange,onClose}:{value:string;onChange:(v:{name:string;offset:string;city:string})=>void;onClose:()=>void}) => {
  const [s,setS]=useState('');
  const f=TIMEZONES_DATA.filter(tz=>tz.city.toLowerCase().includes(s.toLowerCase())||tz.label.toLowerCase().includes(s.toLowerCase()));
  return (
    <><div className="fixed inset-0 z-[55]" onClick={onClose}/>
    <motion.div initial={{opacity:0,y:10,scale:0.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10,scale:0.95}} className="absolute top-full right-0 mt-2 w-80 bg-[#0d0d0d] border border-white/10 rounded-2xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.8)] z-[60]">
      <div className="p-3 border-b border-white/5 bg-white/5"><input autoFocus type="text" placeholder="Search city…" value={s} onChange={e=>setS(e.target.value)} className="w-full bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"/></div>
      <div className="max-h-72 overflow-y-auto scrollbar-hide p-2">
        {f.map(tz=>{const os=offsetToStr(tz.offset);return(
          <button key={tz.city} type="button" onClick={()=>{onChange({name:`${tz.label} - ${tz.city}`,offset:os,city:tz.city});onClose();}} className={cn('w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm transition-all text-left',value===os?'bg-white/10 text-white':'text-white/50 hover:bg-white/[0.06] hover:text-white')}>
            <div><p className="font-medium">{tz.city}</p><p className="text-[10px] text-white/30">{tz.label}</p></div>
            <span className="text-xs font-mono text-white/30">{os}</span>
          </button>
        );})}
      </div>
    </motion.div></>
  );
};

// ─── COUPON CARD ────────────────────────────────────────────
const CouponCard = ({coupon,onDelete,onToggle}:{coupon:CouponType;onDelete?:()=>void;onToggle?:()=>void}) => {
  const [copied,setCopied]=useState(false);
  const copy=()=>{navigator.clipboard.writeText(coupon.code);setCopied(true);setTimeout(()=>setCopied(false),2000);};
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex items-center gap-4 hover:border-white/20 transition-all">
      <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0"><Tag size={18} className="text-white/50"/></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5"><span className="font-bold text-white font-mono tracking-wider text-sm">{coupon.code}</span><Badge variant={coupon.active?'success':'default'}>{coupon.active?'Active':'Paused'}</Badge></div>
        <p className="text-[11px] text-white/40">{coupon.discount}% off · {coupon.used}/{coupon.limit} used · Expires {coupon.expiry}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={copy} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all">{copied?<Check size={13} className="text-emerald-400"/>:<Copy size={13}/>}</button>
        {onToggle&&<button onClick={onToggle} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all">{coupon.active?<Lock size={13}/>:<Unlock size={13}/>}</button>}
        {onDelete&&<button onClick={onDelete} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"><Trash2 size={13}/></button>}
      </div>
    </div>
  );
};

// ─── TRIP CARD (Marketplace) ─────────────────────────────────
const TripCard = ({trip,saved,onSave}:{trip:Trip;saved?:boolean;onSave?:()=>void}) => {
  const navigate = useNavigate();
  const slots = trip.maxParticipants && trip.joinedCount ? trip.maxParticipants - trip.joinedCount : null;
  const pct = trip.maxParticipants && trip.joinedCount ? Math.round((trip.joinedCount/trip.maxParticipants)*100) : 0;
  return (
    <motion.div whileHover={{y:-4}} transition={{duration:0.2}} className="group cursor-pointer" onClick={()=>navigate(`/trip/${trip.id}`)}>
      <Card className="p-0 overflow-hidden flex flex-col h-full">
        <div className="relative h-52 overflow-hidden">
          <img src={`https://picsum.photos/seed/${trip.banner||trip.id}/800/500`} alt={trip.name} className="w-full h-full object-cover opacity-70 group-hover:opacity-90 group-hover:scale-105 transition-all duration-500" referrerPolicy="no-referrer"/>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"/>
          <div className="absolute top-3 left-3 flex gap-2">
            {trip.isFree && <Badge variant="success">FREE</Badge>}
            {trip.theme && <Badge>{trip.theme}</Badge>}
            {slots !== null && slots <= 3 && <Badge variant="danger">Only {slots} left!</Badge>}
          </div>
          <button onClick={e=>{e.stopPropagation();onSave?.();}} className={cn('absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm border transition-all',saved?'bg-white/20 border-white/40 text-white':'bg-black/30 border-white/20 text-white/50 hover:text-white hover:border-white/40')}>
            <Bookmark size={14} className={saved?'fill-white':''}/>
          </button>
          <div className="absolute bottom-3 left-3">
            {trip.rating && <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-lg"><Star size={11} className="text-amber-400 fill-amber-400"/><span className="text-xs font-bold text-white">{trip.rating}</span><span className="text-[10px] text-white/50">({trip.reviews?.length||0})</span></div>}
          </div>
        </div>
        <div className="p-5 flex flex-col flex-1">
          <h3 className="font-bold text-white text-lg mb-1 leading-tight">{trip.name}</h3>
          <div className="flex items-center gap-1.5 text-white/40 text-xs mb-3">
            <MapPin size={11}/><span className="truncate">{trip.meetupPoint||'Location TBA'}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/50 mb-3">
            <span className="flex items-center gap-1"><Calendar size={11}/> {trip.date?.split(',')[0]||'TBA'}</span>
            <span className="flex items-center gap-1"><Clock size={11}/> {trip.duration||'1 Day'}</span>
            <span className="flex items-center gap-1"><Globe size={11}/> {trip.language||'English'}</span>
          </div>
          {trip.maxParticipants && <div className="mb-4">
            <div className="flex justify-between text-[10px] text-white/30 mb-1"><span>{trip.joinedCount||0} joined</span><span>{slots} slots left</span></div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-white/40 rounded-full" style={{width:`${pct}%`}}/></div>
          </div>}
          <div className="mt-auto flex items-center justify-between">
            <div>{trip.isFree ? <span className="text-emerald-400 font-bold text-lg">FREE</span> : <span className="text-white font-bold text-xl">₹{trip.price?.toLocaleString()}</span>}</div>
            <Button size="sm" className="text-xs">View Details</Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

// ─── LANDING PAGE ────────────────────────────────────────────
const LandingPage = () => (
  <div className="min-h-dvh bg-black overflow-hidden">
    <AppNav/>
    <section className="relative pt-32 pb-20 px-6 flex flex-col items-center text-center">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[600px] opacity-20 -z-10" style={{background:'radial-gradient(ellipse at center top, rgba(255,255,255,0.3) 0%, transparent 70%)'}}/>
      <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.8}}>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-xs font-semibold text-white/60 mb-8"><Sparkles size={12} className="text-amber-400"/> New: Gamified Group Expeditions</div>
        <h1 className="text-6xl md:text-8xl font-bold leading-tight tracking-tight">Explore the World,<br/><span className="bg-gradient-to-r from-white via-white/70 to-white/40 bg-clip-text text-transparent italic">Gamified.</span></h1>
        <p className="mt-6 text-xl text-white/50 max-w-2xl mx-auto leading-relaxed">The premium platform for curated travel experiences. Join public expeditions or create your own private journey with real-time tracking and rewards.</p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/explore"><Button size="lg">Explore Trips</Button></Link>
          <Link to="/signup?role=organizer"><Button variant="outline" size="lg">Become an Organizer</Button></Link>
        </div>
      </motion.div>
      <div className="mt-20 w-full max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-6">
        {[{icon:Zap,title:'Real-time Sync',desc:'Live GPS tracking and member sync for a safer, more connected journey.'},{icon:Award,title:'Earn Rewards',desc:'Collect digital stamps, level up your profile, and earn exclusive travel perks.'},{icon:Shield,title:'Verified Hosts',desc:'Every organizer is vetted to ensure premium quality and safety for all participants.'}].map((c,i)=>(
          <motion.div key={c.title} initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{delay:0.3+i*0.1}}>
            <Card className="text-left p-6"><div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4"><c.icon className="text-white w-6 h-6"/></div><h3 className="text-xl font-bold mb-2">{c.title}</h3><p className="text-white/50 text-sm">{c.desc}</p></Card>
          </motion.div>
        ))}
      </div>
    </section>
  </div>
);

// ─── LOGIN PAGE ──────────────────────────────────────────────
const LoginPage = ({setUser}:{setUser:(u:User)=>void}) => {
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [role,setRole]=useState<'user'|'organizer'>('user');const [loading,setLoading]=useState(false);const [error,setError]=useState<string|undefined>();const navigate=useNavigate();
  const handleLogin=async(e:React.FormEvent)=>{e.preventDefault();setLoading(true);setError(undefined);try{const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,role})});if(!res.ok){const body=await res.json().catch(()=>({}));setError(body.error||'Login failed');setLoading(false);return;}const data=await res.json();const user:User={id:String(data.id??data.auth_user_id??email),name:data.name||email.split('@')[0]||'Explorer',email:data.email||email,role:data.role||role,level:data.level??1,xp:data.xp??0};setUser(user);navigate((data.role||role)==='organizer'?'/organizer':'/dashboard');}catch(err:any){console.error('Login error',err);setError('Something went wrong, please try again.');}finally{setLoading(false);}};
  return(
    <div className="min-h-dvh flex items-center justify-center px-6 bg-black">
      <div className="w-full max-w-md">
        <div className="text-center mb-10"><Link to="/" className="inline-flex w-16 h-16 bg-white rounded-2xl items-center justify-center mx-auto mb-6 hover:scale-105 transition-transform"><Navigation className="text-black w-8 h-8"/></Link><h1 className="text-3xl font-bold mb-2">Welcome Back</h1><p className="text-white/50">Sign in to your Nomad account</p></div>
        <Card className="p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="flex p-1 bg-white/5 rounded-xl mb-6">{['user','organizer'].map(r=><button key={r} type="button" onClick={()=>setRole(r as any)} className={cn('flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize',role===r?'bg-white text-black':'text-white/40')}>{r==='user'?'Explorer':'Organizer'}</button>)}</div>
            {[{label:'Email',type:'email',val:email,set:setEmail,ph:'name@example.com'},{label:'Password',type:'password',val:password,set:setPassword,ph:'••••••••'}].map(f=>(
              <div key={f.label}><label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-2">{f.label}</label><input type={f.type} value={f.val} onChange={e=>f.set(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 transition-colors text-white" placeholder={f.ph} required/></div>
            ))}
            {error&&<p className="text-red-400 text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading?'Signing in...':'Sign In'}</Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full mt-2"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError(undefined);
                try {
                  await signInWithGoogle();
                } catch (err:any) {
                  console.error("Google login error", err);
                  setError(err.message ?? "Google sign-in failed");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Continue with Google
            </Button>
          </form>
          <div className="mt-8 pt-8 border-t border-white/10 text-center"><p className="text-sm text-white/40">Don't have an account? <Link to="/signup" className="text-white hover:underline">Sign up</Link></p></div>
        </Card>
      </div>
    </div>
  );
};

// ─── SIGNUP PAGE ─────────────────────────────────────────────
const SignupPage = ({setUser}:{setUser:(u:User)=>void}) => {
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [name,setName]=useState('');const [role,setRole]=useState<'user'|'organizer'>('user');const [loading,setLoading]=useState(false);const [error,setError]=useState<string|undefined>();const navigate=useNavigate();
  const handleSignup=async(e:React.FormEvent)=>{e.preventDefault();setLoading(true);setError(undefined);try{const res=await fetch('/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,name,role})});if(!res.ok){const body=await res.json().catch(()=>({}));const msg=[body.error,body.hint].filter(Boolean).join(' — ')||'Sign up failed';setError(msg);setLoading(false);return;}const data=await res.json();const user:User={id:String(data.id??data.auth_user_id??email),name:data.name||name||email.split('@')[0]||'Explorer',email:data.email||email,role:data.role||role,level:data.level??1,xp:data.xp??0};setUser(user);navigate((data.role||role)==='organizer'?'/organizer':'/dashboard');}catch(err:any){console.error('Signup error',err);setError('Something went wrong, please try again.');}finally{setLoading(false);}};
  return(
    <div className="min-h-dvh flex items-center justify-center px-6 bg-black">
      <div className="w-full max-w-md">
        <div className="text-center mb-10"><h1 className="text-3xl font-bold mb-2">Create Account</h1><p className="text-white/50">Join the community of explorers</p></div>
        <Card className="p-8">
          <form onSubmit={handleSignup} className="space-y-6">
            <div className="flex p-1 bg-white/5 rounded-xl mb-6">{['user','organizer'].map(r=><button key={r} type="button" onClick={()=>setRole(r as any)} className={cn('flex-1 py-2 text-sm font-medium rounded-lg transition-all',role===r?'bg-white text-black':'text-white/40')}>{r==='user'?'Explorer':'Organizer'}</button>)}</div>
            {[{label:'Full Name',type:'text',val:name,set:setName,ph:'John Doe'},{label:'Email Address',type:'email',val:email,set:setEmail,ph:'name@example.com'},{label:'Password',type:'password',val:password,set:setPassword,ph:'••••••••'}].map(f=>(
              <div key={f.label}><label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-2">{f.label}</label><input type={f.type} value={f.val} onChange={e=>f.set(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-white/30 transition-colors text-white" placeholder={f.ph} required/></div>
            ))}
            {error&&<p className="text-red-400 text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>{loading?'Creating...':'Create Account'}</Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full mt-2"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError(undefined);
                try {
                  await signInWithGoogle();
                } catch (err:any) {
                  console.error("Google signup/login error", err);
                  setError(err.message ?? "Google sign-in failed");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Continue with Google
            </Button>
          </form>
          <div className="mt-8 pt-8 border-t border-white/10 text-center"><p className="text-sm text-white/40">Already have an account? <Link to="/login" className="text-white hover:underline">Sign in</Link></p></div>
        </Card>
      </div>
    </div>
  );
};

// ─── USER DASHBOARD ──────────────────────────────────────────
const UserDashboard = ({user,onLogout}:{user:User;onLogout:()=>void}) => {
  const [activeTab,setActiveTab]=useState('upcoming');
  const navigate=useNavigate();
  const [savedTrips,setSavedTrips]=useState<string[]>(['1','3']);
  const [bookings, setBookings] = useState<Trip[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [exploreTrips, setExploreTrips] = useState<Trip[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setBookingsLoading(true);
        const key =
          user.id && /^\d+$/.test(String(user.id).trim())
            ? String(user.id).trim()
            : user.email || user.id;
        if (!key) {
          if (mounted) setBookings([]);
          return;
        }
        const res = await fetch(`/api/users/${encodeURIComponent(key)}/bookings`);
        if (!res.ok) return;
        const rows = await res.json();
        if (!mounted) return;
        const mapped = (rows || []).map((r: any) => normalizeTripFromApi(r));
        setBookings(mapped);
      } catch {
        if (mounted) setBookings([]);
      } finally {
        if (mounted) setBookingsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user.id, user.email]);

  const upcomingList = bookings.filter(
    (t) =>
      !isBookingCancelledOrCompleted(t) &&
      tripDateVsToday(t.date) !== "past" &&
      !isPrivateTrip(t),
  );
  const pastList = bookings.filter(
    (t) => isBookingCancelledOrCompleted(t) || tripDateVsToday(t.date) === "past",
  );
  const invitesList = bookings.filter(
    (t) =>
      !isBookingCancelledOrCompleted(t) &&
      tripDateVsToday(t.date) !== "past" &&
      isPrivateTrip(t),
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/trips');
        if (!res.ok) return;
        const rows = await res.json();
        setExploreTrips((rows || []).map((r: any) => normalizeTripFromApi(r)));
      } catch {
        setExploreTrips([]);
      }
    })();
  }, []);

  const TABS=[{id:'upcoming',label:'Upcoming',icon:Calendar},{id:'past',label:'Past Trips',icon:Clock},{id:'explore',label:'Explore',icon:Compass},{id:'invites',label:'Invites',icon:Mail},{id:'rewards',label:'Rewards',icon:Trophy},{id:'profile',label:'Profile',icon:UserCircle}];

  const xpPct = ((user.xp||0) % 1000) / 10;

  const renderContent = () => {
    switch(activeTab) {
      case 'upcoming': return (
        <div className="space-y-5">
          {bookingsLoading && (
            <Card className="p-6 text-sm text-white/50">Loading your booked trips...</Card>
          )}
          {upcomingList.map(trip=>(
            <Card key={trip.id} className="p-0 overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="md:w-48 h-40 md:h-auto relative flex-shrink-0">
                  <img src={`https://picsum.photos/seed/${trip.banner || trip.id}/400/300`} alt={trip.name} className="w-full h-full object-cover opacity-70" referrerPolicy="no-referrer"/>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/40"/>
                  <div className="absolute top-3 left-3"><Badge variant="success">Upcoming</Badge></div>
                </div>
                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-xl mb-2">{trip.name}</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm text-white/50 mb-4">
                      <span className="flex items-center gap-2"><Calendar size={14} className="text-white/30"/> {trip.date}</span>
                      <span className="flex items-center gap-2"><Clock size={14} className="text-white/30"/> {trip.time}</span>
                      <span className="flex items-center gap-2"><MapPin size={14} className="text-white/30"/> {trip.meetupPoint}</span>
                      <span className="flex items-center gap-2"><Users size={14} className="text-white/30"/> {trip.joinedCount}/{trip.maxParticipants} joined</span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button size="sm" onClick={()=>navigate(`/trip/${trip.id}/live`)}>Go Live</Button>
                    <Button variant="outline" size="sm" onClick={()=>navigate(`/trip/${trip.id}`)}>View Details</Button>
                    <Button variant="ghost" size="sm" onClick={()=>navigate(`/trip/${trip.id}`)}>Manage</Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {!bookingsLoading && upcomingList.length===0 && (
            <div className="py-20 text-center">
              <Calendar size={40} className="text-white/20 mx-auto mb-4"/>
              <p className="text-white/40 font-medium mb-4">No upcoming trips</p>
              <Button onClick={()=>navigate('/explore')}>Explore Trips</Button>
            </div>
          )}
        </div>
      );
      case 'past': return (
        <div className="space-y-4">
          {bookingsLoading && (
            <Card className="p-6 text-sm text-white/50">Loading past trips...</Card>
          )}
          {!bookingsLoading && pastList.map(trip=>(
            <Card key={trip.id} className="p-5 flex items-center gap-5">
              <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0"><img src={`https://picsum.photos/seed/${trip.banner || trip.id}/200/200`} alt="" className="w-full h-full object-cover opacity-60" referrerPolicy="no-referrer"/></div>
              <div className="flex-1">
                <h3 className="font-bold mb-1">{trip.name}</h3>
                <p className="text-sm text-white/40 mb-2">{trip.date || "—"} · {trip.duration || "—"}</p>
                <StarRating rating={trip.rating ?? 0}/>
              </div>
              <div className="flex flex-col gap-2 items-end">
                <Badge variant="default">Completed</Badge>
                <button type="button" onClick={()=>navigate(`/trip/${trip.id}`)} className="text-xs text-white/40 hover:text-white flex items-center gap-1"><MessageCircle size={11}/> Write Review</button>
              </div>
            </Card>
          ))}
          {!bookingsLoading && pastList.length===0 && (
            <div className="py-20 text-center">
              <Clock size={40} className="text-white/20 mx-auto mb-4"/>
              <p className="text-white/40 font-medium mb-4">No past trips yet</p>
              <Button onClick={()=>navigate('/explore')}>Explore Trips</Button>
            </div>
          )}
        </div>
      );
      case 'explore': return (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {exploreTrips.slice(0,6).map(trip=>(
              <TripCard key={trip.id} trip={trip} saved={savedTrips.includes(trip.id)} onSave={()=>setSavedTrips(p=>p.includes(trip.id)?p.filter(x=>x!==trip.id):[...p,trip.id])}/>
            ))}
          </div>
          <div className="mt-6 text-center"><Button variant="outline" onClick={()=>navigate('/explore')}>View All Trips</Button></div>
        </div>
      );
      case 'invites': return (
        <div className="space-y-4">
          {bookingsLoading && (
            <Card className="p-6 text-sm text-white/50">Loading invites...</Card>
          )}
          {!bookingsLoading && invitesList.map(trip=>(
            <Card key={trip.id} className="p-0 overflow-hidden">
              <div className="flex">
                <div className="w-32 h-32 flex-shrink-0 relative">
                  <img src={`https://picsum.photos/seed/${trip.banner || trip.id}/300/300`} alt="" className="w-full h-full object-cover opacity-60" referrerPolicy="no-referrer"/>
                  <div className="absolute inset-0 flex items-center justify-center"><Lock size={20} className="text-amber-400"/></div>
                </div>
                <div className="p-5 flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div><h3 className="font-bold">{trip.name}</h3><p className="text-sm text-white/40">by {trip.organizer || "Organizer"}</p></div>
                    <Badge variant="warning">Private</Badge>
                  </div>
                  <p className="text-xs text-white/40 mb-3"><Calendar size={11} className="inline mr-1"/>{trip.date || "TBA"}{typeof trip.maxParticipants === "number" && trip.maxParticipants > 0 ? ` · ${Math.max(0, trip.maxParticipants - (trip.joinedCount || 0))} slots left` : ""}</p>
                  <div className="flex gap-2">
                    <Button size="sm" className="text-xs" onClick={()=>navigate(`/trip/${trip.id}`)}>View trip</Button>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={()=>navigate(`/trip/${trip.id}/live`)}>Go Live</Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {!bookingsLoading && invitesList.length===0 && (
            <div className="py-20 text-center">
              <Mail size={40} className="text-white/20 mx-auto mb-4"/>
              <p className="text-white/40">No private bookings yet. Invite-only trips appear here once you book.</p>
            </div>
          )}
        </div>
      );
      case 'rewards': return (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div><h3 className="text-2xl font-bold">Level {user.level}</h3><p className="text-white/40 text-sm">Explorer</p></div>
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-600/10 border border-amber-500/30 flex items-center justify-center"><Trophy size={28} className="text-amber-400"/></div>
            </div>
            <div className="mb-2 flex justify-between text-xs text-white/40"><span>{user.xp} XP</span><span>{(Math.ceil((user.xp||0)/1000)*1000)} XP to Level {(user.level||0)+1}</span></div>
            <div className="h-2 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-400 to-amber-600 rounded-full transition-all" style={{width:`${xpPct}%`}}/></div>
          </Card>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[{icon:Map,label:'Trips Completed',value:'8',color:'text-blue-400',bg:'bg-blue-500/10'},{icon:Star,label:'Reviews Given',value:'6',color:'text-amber-400',bg:'bg-amber-500/10'},{icon:Users2,label:'Friends Referred',value:'3',color:'text-emerald-400',bg:'bg-emerald-500/10'},{icon:Flame,label:'Current Streak',value:'12d',color:'text-orange-400',bg:'bg-orange-500/10'}].map(s=>(
              <Card key={s.label} className="p-4 text-center">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3',s.bg)}><s.icon size={18} className={s.color}/></div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-[10px] text-white/40 mt-0.5">{s.label}</p>
              </Card>
            ))}
          </div>
          <Card className="p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2"><Gift size={16} className="text-white/40"/> Rewards Wallet</h3>
            <div className="text-4xl font-bold mb-1">₹420<span className="text-xl text-white/40">.50</span></div>
            <p className="text-white/40 text-sm mb-5">Available cashback rewards</p>
            <div className="flex gap-3">
              <Button size="sm">Redeem Now</Button>
              <Button variant="outline" size="sm">View History</Button>
            </div>
          </Card>
          <div>
            <h3 className="font-bold mb-4 flex items-center gap-2"><Award size={16} className="text-white/40"/> Badges Earned</h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[{emoji:'🏔️',label:'Mountain Man'},{emoji:'🏖️',label:'Beach Bum'},{emoji:'🌙',label:'Night Owl'},{emoji:'🌿',label:'Eco Warrior'},{emoji:'📸',label:'Photographer'},{emoji:'⭐',label:'Top Rated',locked:true}].map(b=>(
                <div key={b.label} className={cn('flex flex-col items-center gap-2 p-3 rounded-2xl border',b.locked?'border-white/5 opacity-30':'border-white/10 bg-white/[0.03]')}>
                  <span className="text-2xl">{b.emoji}</span>
                  <p className="text-[9px] font-bold text-white/50 text-center leading-tight">{b.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
      case 'profile': return (
        <div className="max-w-lg space-y-4">
          <Card className="p-6">
            <div className="flex items-center gap-5 mb-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-white/10 border border-white/20"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} alt="" className="w-full h-full object-cover"/></div>
                <button className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center"><Camera size={11}/></button>
              </div>
              <div><h3 className="font-bold text-lg">{user.name}</h3><p className="text-white/40 text-sm">{user.email}</p><div className="flex items-center gap-2 mt-2"><Badge variant="success">Level {user.level} Explorer</Badge><Badge>{user.xp} XP</Badge></div></div>
            </div>
            <div className="space-y-3">
              {[{label:'Full Name',value:user.name},{label:'Email',value:user.email},{label:'Phone',value:'+91 98765 43210'},{label:'Location',value:'Mumbai, India'}].map(f=>(
                <div key={f.label} className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-white/30">{f.label}</p><p className="text-sm font-semibold mt-0.5">{f.value}</p></div>
                  <button className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/[0.04] text-white/30 hover:text-white transition-all"><Edit2 size={12}/></button>
                </div>
              ))}
            </div>
          </Card>
          <Button variant="danger" className="w-full rounded-xl" onClick={onLogout}><LogOut size={16} className="mr-2"/> Sign Out</Button>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div className="min-h-dvh bg-black text-white">
      <AppNav user={user} onLogout={onLogout}/>
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-24 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-white/40 text-sm">Welcome back,</p>
            <h1 className="text-3xl font-bold">{user.name} 👋</h1>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <div className="text-right"><p className="text-[10px] text-white/30 uppercase tracking-widest">Your XP</p><p className="font-bold text-lg">{user.xp?.toLocaleString()} XP</p></div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400/20 to-transparent border border-amber-500/30 flex items-center justify-center"><Trophy size={20} className="text-amber-400"/></div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[{label:'Trips Taken',value:'8',icon:Map,trend:'+2 this month'},{label:'XP Earned',value:(user.xp||0).toLocaleString(),icon:Zap,trend:'Level '+user.level},{label:'Wallet Balance',value:'₹420',icon:Wallet,trend:'2 coupons'},{label:'Invites Pending',value:'1',icon:Bell,trend:'Expires soon'}].map(s=>(
            <Card key={s.label} className="p-4">
              <div className="flex items-center justify-between mb-2"><s.icon size={15} className="text-white/30"/><span className="text-[10px] text-white/30">{s.trend}</span></div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wider">{s.label}</p>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-2xl mb-8 overflow-x-auto">
          {TABS.map(({id,label,icon:Icon})=>(
            <button key={id} onClick={()=>setActiveTab(id)} className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap flex-shrink-0',activeTab===id?'bg-white text-black':'text-white/40 hover:text-white hover:bg-white/5')}>
              <Icon size={14}/> {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

// ─── MARKETPLACE PAGE ────────────────────────────────────────
const MarketplacePage = ({user}:{user:User|null}) => {
  const [search,setSearch]=useState('');
  const [theme,setTheme]=useState('');
  const [priceRange,setPriceRange]=useState('');
  const [duration,setDuration]=useState('');
  const [language,setLanguage]=useState('');
  const [ageGroup,setAgeGroup]=useState('');
  const [sortBy,setSortBy]=useState('trending');
  const [showFilters,setShowFilters]=useState(false);
  const [savedTrips,setSavedTrips]=useState<string[]>([]);
  const [marketTrips, setMarketTrips] = useState<Trip[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setMarketLoading(true);
        const res = await fetch('/api/trips');
        if (!res.ok) return;
        const rows = await res.json();
        setMarketTrips((rows || []).map((r: any) => normalizeTripFromApi(r)));
      } catch {
        setMarketTrips([]);
      } finally {
        setMarketLoading(false);
      }
    })();
  }, []);

  const filtered = marketTrips.filter(t=>{
    if(search && !t.name.toLowerCase().includes(search.toLowerCase()) && !(t.meetupPoint||'').toLowerCase().includes(search.toLowerCase())) return false;
    if(theme && t.theme!==theme) return false;
    if(language && t.language!==language) return false;
    if(ageGroup && t.ageGroup!==ageGroup) return false;
    if(priceRange==='free' && !t.isFree) return false;
    if(priceRange==='paid' && t.isFree) return false;
    if(priceRange==='budget' && (t.isFree || (t.price||0)>2000)) return false;
    if(priceRange==='premium' && (t.price||0)<=2000) return false;
    return true;
  });

  const sorted = [...filtered].sort((a,b)=>{
    if(sortBy==='price-asc') return (a.price||0)-(b.price||0);
    if(sortBy==='price-desc') return (b.price||0)-(a.price||0);
    if(sortBy==='rating') return (b.rating||0)-(a.rating||0);
    return (b.joinedCount||0)-(a.joinedCount||0);
  });

  const activeFiltersCount = [theme,priceRange,duration,language,ageGroup].filter(Boolean).length;

  return (
    <div className="min-h-dvh bg-black text-white">
      <AppNav user={user}/>
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-24 pb-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Explore Expeditions</h1>
          <p className="text-white/40">Find your next adventure from our curated marketplace</p>
        </div>

        {/* Search + Filter bar */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="flex-1 min-w-64 flex items-center gap-3 px-4 py-3 bg-white/[0.04] border border-white/10 rounded-2xl focus-within:border-white/30 transition-colors">
            <Search size={16} className="text-white/30 flex-shrink-0"/>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search trips, locations…" className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"/>
            {search && <button onClick={()=>setSearch('')}><X size={14} className="text-white/30 hover:text-white"/></button>}
          </div>
          <button onClick={()=>setShowFilters(!showFilters)} className={cn('flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all',showFilters||activeFiltersCount>0?'bg-white text-black border-white':'bg-white/[0.04] border-white/10 text-white/60 hover:text-white hover:border-white/30')}>
            <SlidersHorizontal size={15}/> Filters {activeFiltersCount>0&&<span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-bold',showFilters?'bg-black/20':'bg-black/10')}>{activeFiltersCount}</span>}
          </button>
          <div className="flex items-center gap-2">
            <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="px-4 py-3 bg-white/[0.04] border border-white/10 rounded-2xl text-sm font-medium text-white/60 focus:outline-none focus:border-white/30 appearance-none cursor-pointer">
              <option value="trending" className="bg-[#111]">Trending</option>
              <option value="rating" className="bg-[#111]">Top Rated</option>
              <option value="price-asc" className="bg-[#111]">Price: Low to High</option>
              <option value="price-desc" className="bg-[#111]">Price: High to Low</option>
            </select>
          </div>
        </div>

        {/* Filter Panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="overflow-hidden mb-6">
              <Card className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">Theme</label>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                      {['',... THEMES.slice(0,8)].map(t=><button key={t} type="button" onClick={()=>setTheme(t)} className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all',theme===t?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white')}>{t||'All'}</button>)}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">Price</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[{v:'',l:'All'},{v:'free',l:'Free'},{v:'budget',l:'Budget <₹2K'},{v:'premium',l:'Premium'}].map(p=><button key={p.v} type="button" onClick={()=>setPriceRange(p.v)} className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all',priceRange===p.v?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white')}>{p.l}</button>)}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">Language</label>
                    <div className="flex flex-wrap gap-1.5">
                      {['',...LANGUAGES.slice(0,5)].map(l=><button key={l} type="button" onClick={()=>setLanguage(l)} className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all',language===l?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white')}>{l||'All'}</button>)}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">Age Group</label>
                    <div className="flex flex-wrap gap-1.5">
                      {['',...AGE_GROUPS].map(a=><button key={a} type="button" onClick={()=>setAgeGroup(a)} className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all',ageGroup===a?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white')}>{a||'All'}</button>)}
                    </div>
                  </div>
                  <div className="flex flex-col justify-end">
                    <button onClick={()=>{setTheme('');setPriceRange('');setDuration('');setLanguage('');setAgeGroup('');}} className="px-4 py-2 rounded-xl border border-white/10 text-xs font-semibold text-white/40 hover:text-white hover:border-white/30 transition-all">Clear All Filters</button>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick filter pills */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {['All','Adventure','Trekking','Bike Ride','Cultural','Food Trail','Night Ride','Nature Escape','Beach Trip'].map(t=>(
            <button key={t} onClick={()=>setTheme(t==='All'?'':t)} className={cn('px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-all flex-shrink-0',theme===(t==='All'?'':t)?'bg-white text-black border-white':'bg-white/[0.03] border-white/10 text-white/50 hover:text-white hover:border-white/30')}>{t}</button>
          ))}
        </div>

        {/* Results */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-white/40">{sorted.length} expeditions found</p>
        </div>
        {marketLoading && <Card className="p-5 text-sm text-white/50">Loading trips...</Card>}
        {sorted.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sorted.map(trip=>(
              <TripCard key={trip.id} trip={trip} saved={savedTrips.includes(trip.id)} onSave={()=>setSavedTrips(p=>p.includes(trip.id)?p.filter(x=>x!==trip.id):[...p,trip.id])}/>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <Search size={40} className="text-white/20 mx-auto mb-4"/>
            <p className="text-white/40 font-medium mb-2">No trips found</p>
            <p className="text-white/20 text-sm">Try adjusting your filters or search</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── TRIP DETAIL PAGE ─────────────────────────────────────────
const TripDetailPage = ({user}:{user:User|null}) => {
  const {id}=useParams();
  const navigate=useNavigate();
  const [dbTrip, setDbTrip] = useState<Trip | null>(null);
  const [tripLoading, setTripLoading] = useState(false);
  const trip = dbTrip;
  const [couponInput,setCouponInput]=useState('');
  const [appliedCoupon,setAppliedCoupon]=useState<{code:string;discount:number;coupon_id?:number}|null>(null);
  const [couponError,setCouponError]=useState('');
  const [couponApplying, setCouponApplying] = useState(false);
  const [showBooking,setShowBooking]=useState(false);
  const [booked,setBooked]=useState(false);
  const [bookingStep,setBookingStep]=useState(1);
  const [participants,setParticipants]=useState(1);
  const [saved,setSaved]=useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [liveReviews, setLiveReviews] = useState<Review[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setTripLoading(true);
        const res = await fetch(`/api/trips/${id}`);
        if (!res.ok) return;
        const raw = await res.json();
        setDbTrip(normalizeTripFromApi(raw));
      } catch {
        setDbTrip(null);
      } finally {
        setTripLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/reviews`);
        if (!res.ok) return;
        const data = await res.json();
        const mapped: Review[] = Array.isArray(data)
          ? data.map((r: any, idx: number) => ({
              id: String(r?.id ?? `review-${idx}`),
              user: r?.user_name || r?.user || "Explorer",
              avatar: r?.avatar || r?.user_name || "explorer",
              rating: Number(r?.rating) || 0,
              text: r?.text || "",
              date: r?.created_at
                ? new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "Recent",
              likes: Number(r?.likes) || 0,
            }))
          : [];
        setLiveReviews(mapped);
      } catch {
        setLiveReviews([]);
      }
    })();
  }, [id]);

  useEffect(() => {
    setAppliedCoupon(null);
    setCouponError('');
  }, [participants]);

  if(!trip || tripLoading) return (
    <div className="min-h-dvh bg-black flex items-center justify-center">
      <div className="text-center"><div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4"/><p className="text-white/40">Loading…</p></div>
    </div>
  );

  const applyCoupon = async () => {
    if (!id || trip?.isFree) return;
    const code = couponInput.trim();
    if (!code) {
      setCouponError('Enter a coupon code');
      return;
    }
    setCouponApplying(true);
    setCouponError('');
    try {
      const res = await fetch(`/api/trips/${id}/coupons/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, participants }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.valid === false) {
        setAppliedCoupon(null);
        setCouponError(typeof body?.error === 'string' ? body.error : 'Invalid coupon code');
        return;
      }
      setAppliedCoupon({
        code: String(body.code || code).toUpperCase(),
        discount: Number(body.discount_pct) || 0,
        coupon_id: typeof body.coupon_id === 'number' ? body.coupon_id : undefined,
      });
    } catch {
      setCouponError('Could not validate coupon');
      setAppliedCoupon(null);
    } finally {
      setCouponApplying(false);
    }
  };

  const currentReviews = liveReviews.length ? liveReviews : (trip.reviews || []);
  const ratingAvg = currentReviews.length
    ? Number((currentReviews.reduce((sum, r) => sum + r.rating, 0) / currentReviews.length).toFixed(1))
    : (trip.rating || 0);
  const basePrice = trip.isFree ? 0 : (trip.price||0) * participants;
  const discount = appliedCoupon ? Math.round(basePrice * appliedCoupon.discount / 100) : 0;
  const finalPrice = basePrice - discount;
  const slots = (trip.maxParticipants||20) - (trip.joinedCount||0);

  const confirmBooking = async () => {
    if (!user || !id) return;
    setBookingSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: Number(id),
          user_id: Number(user.id),
          participants,
          ...(appliedCoupon ? { coupon_code: appliedCoupon.code } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCouponError(body.error || 'Booking failed');
        return;
      }
      setBooked(true);
      setCouponError('');
    } catch {
      setCouponError('Booking failed');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const submitReview = async () => {
    if (!user || !id) return;
    if (!reviewRating) {
      setReviewError('Please select a rating');
      return;
    }
    if (!reviewText.trim()) {
      setReviewError('Please write a review');
      return;
    }
    setReviewSubmitting(true);
    setReviewError('');
    try {
      const res = await fetch(`/api/trips/${id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: Number(user.id),
          rating: reviewRating,
          text: reviewText.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReviewError(body.error || 'Failed to submit review');
        return;
      }
      const newReview: Review = {
        id: String(body.id || Date.now()),
        user: user.name,
        avatar: user.name,
        rating: reviewRating,
        text: reviewText.trim(),
        date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        likes: 0,
      };
      setLiveReviews(prev => [newReview, ...prev]);
      setReviewRating(0);
      setReviewText('');
    } catch {
      setReviewError('Failed to submit review');
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-black text-white">
      <AppNav user={user}/>

      {/* Hero Banner */}
      <div className="relative h-[50vh] min-h-[400px] pt-20">
        <img src={`https://picsum.photos/seed/${trip.banner||trip.id}/1920/800`} alt={trip.name} className="w-full h-full object-cover opacity-60" referrerPolicy="no-referrer"/>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent"/>
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-7xl mx-auto w-full px-4 md:px-8 pb-10">
            <div className="flex flex-wrap gap-2 mb-4">
              {trip.isFree&&<Badge variant="success">FREE EVENT</Badge>}
              <Badge>{trip.theme}</Badge>
              {slots<=3&&<Badge variant="danger">Only {slots} slots left!</Badge>}
              {trip.privacy==='Private'&&<Badge variant="warning">Private Event</Badge>}
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-3">{trip.name}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-white/60">
              <span className="flex items-center gap-1.5"><BadgeCheck size={14} className="text-emerald-400"/>{trip.organizer}</span>
              <span className="flex items-center gap-1.5"><Star size={14} className="text-amber-400 fill-amber-400"/>{ratingAvg} ({currentReviews.length} reviews)</span>
              <span className="flex items-center gap-1.5"><Users size={14}/>{trip.joinedCount}/{trip.maxParticipants} joined</span>
            </div>
          </div>
        </div>
        <div className="absolute top-24 right-6 flex gap-2">
          <button onClick={()=>setSaved(!saved)} className={cn('w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-sm border transition-all',saved?'bg-white/20 border-white/40':'bg-black/40 border-white/20 hover:bg-white/10')}>
            <Bookmark size={16} className={saved?'fill-white text-white':'text-white/70'}/>
          </button>
          <button className="w-10 h-10 rounded-xl flex items-center justify-center bg-black/40 border border-white/20 hover:bg-white/10 backdrop-blur-sm transition-all"><Share2 size={16} className="text-white/70"/></button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
          {/* LEFT */}
          <div className="space-y-8">
            {/* Trip Highlights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[{icon:Calendar,label:'Date',value:trip.date||'TBA'},{icon:Clock,label:'Duration',value:trip.duration||'1 Day'},{icon:Globe,label:'Language',value:trip.language||'English'},{icon:Users,label:'Age Group',value:trip.ageGroup||'All Ages'}].map(s=>(
                <Card key={s.label} className="p-4 text-center">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center mx-auto mb-2"><s.icon size={16} className="text-white/50"/></div>
                  <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1">{s.label}</p>
                  <p className="text-sm font-bold text-white/90">{s.value}</p>
                </Card>
              ))}
            </div>

            {/* About */}
            <div>
              <h2 className="text-2xl font-bold mb-4">About This Expedition</h2>
              <p className="text-white/60 leading-relaxed text-[15px]">{trip.description}</p>
            </div>

            {/* Meetup Location */}
            <div>
              <h2 className="text-2xl font-bold mb-4">Meetup & Route</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="flex items-start gap-3 p-4 bg-white/[0.03] border border-white/10 rounded-2xl">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0"><MapPin size={16} className="text-emerald-400"/></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">Start / Meetup Point</p><p className="font-semibold text-sm">{trip.meetupPoint}</p></div>
                </div>
                {trip.endLocation&&<div className="flex items-start gap-3 p-4 bg-white/[0.03] border border-white/10 rounded-2xl">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0"><MapPin size={16} className="text-white/50"/></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-1">End / Drop-off</p><p className="font-semibold text-sm">{trip.endLocation}</p></div>
                </div>}
              </div>
              <div className="rounded-2xl overflow-hidden border border-white/10 h-52 bg-[#0a0a0a] relative">
                <RoutePreviewMap
                  className="h-52"
                  start={trip.meetupLat !== undefined && trip.meetupLng !== undefined ? { lat: trip.meetupLat, lng: trip.meetupLng } : null}
                  end={trip.endLat !== undefined && trip.endLng !== undefined ? { lat: trip.endLat, lng: trip.endLng } : null}
                />
              </div>
            </div>

            {/* Tags */}
            {trip.tags && trip.tags.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-4">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {trip.tags.map(tag=><span key={tag} className="px-3 py-1.5 bg-white/[0.04] border border-white/10 rounded-full text-xs font-semibold text-white/60">{tag}</span>)}
                </div>
              </div>
            )}

            {/* Prerequisites */}
            {trip.prerequisites && (
              <div>
                <h2 className="text-2xl font-bold mb-4">Prerequisites</h2>
                <div className="p-5 bg-amber-500/[0.04] border border-amber-500/15 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5"/>
                    <p className="text-white/60 text-sm leading-relaxed">{trip.prerequisites}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Terms */}
            {trip.terms && (
              <div>
                <h2 className="text-2xl font-bold mb-4">Terms & Conditions</h2>
                <div className="p-5 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
                  <div className="flex items-start gap-3">
                    <Shield size={18} className="text-white/30 flex-shrink-0 mt-0.5"/>
                    <p className="text-white/50 text-sm leading-relaxed">{trip.terms}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Organizer */}
            <div>
              <h2 className="text-2xl font-bold mb-4">Organizer</h2>
              <Card className="p-5 flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-white/10 flex-shrink-0"><img src={`https://api.dicebear.com/7.x/initials/svg?seed=${trip.organizer}`} alt="" className="w-full h-full object-cover"/></div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1"><p className="font-bold">{trip.organizer}</p><BadgeCheck size={14} className="text-emerald-400"/></div>
                  <div className="flex items-center gap-1 mb-2"><Star size={12} className="text-amber-400 fill-amber-400"/><span className="text-sm font-bold text-amber-400">4.9</span><span className="text-xs text-white/30 ml-1">· 42 events hosted</span></div>
                  <p className="text-sm text-white/40">Professional trip organizer with 3+ years of experience</p>
                </div>
                <Button variant="outline" size="sm">Contact</Button>
              </Card>
            </div>

            {/* Reviews */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Reviews</h2>
                <div className="flex items-center gap-2"><Star size={18} className="text-amber-400 fill-amber-400"/><span className="text-2xl font-bold">{ratingAvg}</span><span className="text-white/40">/ 5</span></div>
              </div>
              {/* Rating breakdown */}
              <div className="mb-6 space-y-2">
                {[5,4,3,2,1].map(stars=>{
                  const count = currentReviews.filter(r=>r.rating===stars).length;
                  const pct = currentReviews.length > 0 ? (count/currentReviews.length)*100 : 0;
                  return (
                    <div key={stars} className="flex items-center gap-3">
                      <div className="flex items-center gap-1 w-16 flex-shrink-0"><span className="text-xs text-white/40">{stars}</span><Star size={10} className="text-amber-400 fill-amber-400"/></div>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-amber-400/60 rounded-full" style={{width:`${pct}%`}}/></div>
                      <span className="text-xs text-white/30 w-4">{count}</span>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-5">
                {currentReviews.map(rev=>(
                  <div key={rev.id} className="p-5 bg-white/[0.03] border border-white/[0.06] rounded-2xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${rev.avatar}`} alt="" className="w-full h-full object-cover"/></div>
                        <div><p className="font-bold text-sm">{rev.user}</p><p className="text-[10px] text-white/30">{rev.date}</p></div>
                      </div>
                      <StarRating rating={rev.rating} size={12}/>
                    </div>
                    <p className="text-sm text-white/60 leading-relaxed mb-3">{rev.text}</p>
                    <button className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white transition-colors"><ThumbsUp size={11}/> {rev.likes} helpful</button>
                  </div>
                ))}
              </div>
              {user && (
                <div className="mt-5 p-5 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
                  <p className="text-sm font-semibold mb-3">Write a Review</p>
                  <div className="flex gap-1 mb-3">{[1,2,3,4,5].map(s=><button key={s} onClick={()=>setReviewRating(s)} className="text-amber-400 hover:scale-110 transition-transform"><Star size={20} className={cn(s<=reviewRating?'fill-amber-400':'fill-amber-400/20')}/></button>)}</div>
                  <textarea value={reviewText} onChange={e=>setReviewText(e.target.value)} placeholder="Share your experience…" className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none min-h-[80px]"/>
                  {reviewError && <p className="text-xs text-red-400 mt-2">{reviewError}</p>}
                  <Button size="sm" className="mt-3 text-xs flex items-center gap-2" onClick={submitReview} disabled={reviewSubmitting}><Send size={12}/> {reviewSubmitting?'Submitting...':'Submit Review'}</Button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Booking Card */}
          <div className="lg:sticky lg:top-24 lg:self-start space-y-4">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <div>{trip.isFree?<p className="text-3xl font-bold text-emerald-400">FREE</p>:<div className="flex items-end gap-2"><p className="text-3xl font-bold">₹{trip.price?.toLocaleString()}</p><p className="text-white/40 text-sm pb-1">per person</p></div>}</div>
                {trip.rating&&<div className="flex items-center gap-1"><Star size={14} className="text-amber-400 fill-amber-400"/><span className="font-bold">{trip.rating}</span></div>}
              </div>
              <div className="flex items-center gap-2 mb-5">
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-white/40 rounded-full" style={{width:`${((trip.joinedCount||0)/(trip.maxParticipants||20))*100}%`}}/></div>
                <span className="text-xs text-white/40 whitespace-nowrap">{slots} slots left</span>
              </div>

              {/* Participants */}
              {!trip.isFree && (
                <div className="mb-5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">Number of Participants</label>
                  <div className="flex items-center gap-3">
                    <button onClick={()=>setParticipants(Math.max(1,participants-1))} className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 text-white hover:bg-white/10 flex items-center justify-center text-lg font-bold transition-all">−</button>
                    <span className="flex-1 text-center font-bold text-lg">{participants}</span>
                    <button onClick={()=>setParticipants(Math.min(slots,participants+1))} className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 text-white hover:bg-white/10 flex items-center justify-center text-lg font-bold transition-all">+</button>
                  </div>
                </div>
              )}

              {/* Coupon */}
              {!trip.isFree && (
                <div className="mb-5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">Coupon Code</label>
                  {appliedCoupon ? (
                    <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <CheckCircle size={16} className="text-emerald-400 flex-shrink-0"/>
                      <div className="flex-1"><p className="text-xs font-bold text-emerald-400">{appliedCoupon.code}</p><p className="text-[10px] text-emerald-400/60">{appliedCoupon.discount}% discount applied</p></div>
                      <button onClick={()=>setAppliedCoupon(null)} className="text-white/30 hover:text-white"><X size={13}/></button>
                    </div>
                  ):(
                    <div className="flex gap-2">
                      <input type="text" value={couponInput} onChange={e=>{setCouponInput(e.target.value.toUpperCase());setCouponError('');}} placeholder="Enter coupon code" className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 uppercase"/>
                      <button
                        type="button"
                        disabled={couponApplying}
                        onClick={() => void applyCoupon()}
                        className="px-4 py-2 rounded-xl bg-white/10 border border-white/15 text-xs font-bold text-white hover:bg-white/20 transition-all disabled:opacity-50"
                      >
                        {couponApplying ? '…' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {couponError&&<p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle size={11}/>{couponError}</p>}
                  <p className="text-[10px] text-white/20 mt-1.5">Use a code from the trip organizer&apos;s dashboard.</p>
                </div>
              )}

              {/* Price Summary */}
              {!trip.isFree && (
                <div className="space-y-2 mb-5 p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
                  <div className="flex justify-between text-sm text-white/50"><span>₹{trip.price?.toLocaleString()} × {participants}</span><span>₹{basePrice.toLocaleString()}</span></div>
                  {appliedCoupon&&<div className="flex justify-between text-sm text-emerald-400"><span>Coupon ({appliedCoupon.discount}% off)</span><span>−₹{discount.toLocaleString()}</span></div>}
                  <div className="flex justify-between font-bold text-white pt-2 border-t border-white/[0.06]"><span>Total</span><span>₹{finalPrice.toLocaleString()}</span></div>
                </div>
              )}

              <Button className="w-full flex items-center gap-2 py-4 text-base" onClick={()=>{if(!user){navigate('/login');return;}setShowBooking(true);}}>
                {slots===0?'Join Waiting List':<><CreditCard size={16}/> {trip.isFree?'Request to Join':'Book Now'}</>}
              </Button>

              <div className="mt-4 space-y-2 text-xs text-white/30">
                <div className="flex items-center gap-2"><Shield size={12}/> Secure payment · SSL encrypted</div>
                <div className="flex items-center gap-2"><CheckCircle size={12}/> Instant booking confirmation</div>
                {trip.joinedCount&&trip.joinedCount>5&&<div className="flex items-center gap-2"><Users size={12}/> {trip.joinedCount} people already joined</div>}
              </div>
            </Card>

            {/* Trip Info Summary */}
            <Card className="p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-4">Trip Details</p>
              <div className="space-y-3">
                {[{icon:Calendar,label:'Date',val:trip.date||'TBA'},{icon:Calendar,label:'End Date',val:trip.endDate||'TBA'},{icon:Clock,label:'Time',val:trip.time||'TBA'},{icon:Clock,label:'Duration',val:trip.duration||'1 Day'},{icon:MapPin,label:'Start',val:trip.meetupPoint||'TBA'},{icon:MapPin,label:'End',val:trip.endLocation||'TBA'},{icon:Globe,label:'Language',val:trip.language||'English'},{icon:Users,label:'Age',val:trip.ageGroup||'All Ages'}].map(({icon:Icon,label,val})=>(
                  <div key={label} className="flex items-start gap-3">
                    <Icon size={13} className="text-white/30 flex-shrink-0 mt-0.5"/>
                    <div><p className="text-[10px] text-white/30">{label}</p><p className="text-sm font-semibold text-white/80">{val}</p></div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Booking Modal */}
      <AnimatePresence>
        {showBooking && (
          <>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]" onClick={()=>{if(!booked)setShowBooking(false);}}/>
            <motion.div initial={{opacity:0,y:60,scale:0.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:60,scale:0.95}} className="fixed inset-x-4 bottom-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-md bg-[#0d0d0d] border border-white/15 rounded-3xl p-8 z-[101] shadow-[0_40px_100px_rgba(0,0,0,0.9)]">
              {booked ? (
                <div className="text-center py-4">
                  <motion.div initial={{scale:0}} animate={{scale:1}} transition={{type:'spring',bounce:0.5}} className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6"><CheckCircle size={36} className="text-emerald-400"/></motion.div>
                  <h2 className="text-2xl font-bold mb-2">You're In! 🎉</h2>
                  <p className="text-white/50 mb-6">Your booking for <strong className="text-white">{trip.name}</strong> is confirmed. Check your dashboard for details.</p>
                  <div className="p-4 bg-white/[0.04] rounded-2xl mb-6 text-sm text-white/50">Booking ID: <strong className="text-white font-mono">NMD-{Math.random().toString(36).substr(2,8).toUpperCase()}</strong></div>
                  <div className="flex gap-3">
                    <Button className="flex-1" onClick={()=>{setShowBooking(false);navigate('/dashboard');}}>Go to Dashboard</Button>
                    <Button variant="outline" className="flex-1" onClick={()=>setShowBooking(false)}>Stay Here</Button>
                  </div>
                </div>
              ):(
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">{trip.isFree?'Request to Join':'Complete Booking'}</h2>
                    <button onClick={()=>setShowBooking(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"><X size={15}/></button>
                  </div>
                  <div className="p-4 bg-white/[0.03] rounded-2xl mb-6 flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0"><img src={`https://picsum.photos/seed/${trip.banner}/200/200`} alt="" className="w-full h-full object-cover opacity-70" referrerPolicy="no-referrer"/></div>
                    <div><p className="font-bold text-sm">{trip.name}</p><p className="text-xs text-white/40 mt-0.5">{trip.date}</p><p className="text-xs text-white/40">{trip.meetupPoint}</p></div>
                  </div>
                  {!trip.isFree&&(
                    <div className="p-4 bg-white/[0.03] rounded-2xl mb-6 space-y-2 text-sm">
                      <div className="flex justify-between text-white/50"><span>₹{trip.price?.toLocaleString()} × {participants} person{participants>1?'s':''}</span><span>₹{basePrice.toLocaleString()}</span></div>
                      {appliedCoupon&&<div className="flex justify-between text-emerald-400"><span>Coupon savings</span><span>−₹{discount.toLocaleString()}</span></div>}
                      <div className="flex justify-between font-bold text-white pt-2 border-t border-white/[0.06]"><span>Total Amount</span><span>₹{finalPrice.toLocaleString()}</span></div>
                    </div>
                  )}
                  <div className="space-y-3 mb-6">
                    {[{icon:CreditCard,label:'Credit / Debit Card'},{icon:DollarSign,label:'UPI Payment'},{icon:Wallet,label:'NOMAD Wallet (₹420 available)'}].map((m,i)=>(
                      <label key={i} className="flex items-center gap-3 p-3.5 rounded-xl border border-white/10 hover:border-white/25 cursor-pointer transition-all">
                        <input type="radio" name="payment" defaultChecked={i===0} className="accent-white"/>
                        <m.icon size={15} className="text-white/50"/><span className="text-sm font-medium text-white/80">{m.label}</span>
                      </label>
                    ))}
                  </div>
                  <Button className="w-full py-4 text-base flex items-center gap-2" onClick={confirmBooking} disabled={bookingSubmitting}>
                    <CheckCircle size={16}/> {bookingSubmitting ? 'Processing...' : (trip.isFree?'Confirm Request':`Pay ₹${finalPrice.toLocaleString()}`)}
                  </Button>
                  <p className="text-center text-[10px] text-white/20 mt-3">Secured by 256-bit SSL encryption</p>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── ORGANIZER DASHBOARD ─────────────────────────────────────
const OrganizerDashboard = ({user,onLogout}:{user:User;onLogout:()=>void}) => {
  const [activeTab,setActiveTab]=useState("Today's Events");
  const [showMobileOrganizerTabs, setShowMobileOrganizerTabs] = useState(false);
  const navigate=useNavigate();
  const TABS=[
    {id:"Today's Events",icon:Clock},{id:'Upcoming Events',icon:Calendar},
    {id:'Create Event',icon:Plus},{id:'Manage Events',icon:Settings},
    {id:'Marketplace Listings',icon:ShoppingBag},{id:'Revenue Analytics',icon:BarChart3},
    {id:'Coupons',icon:Tag},{id:'Profile',icon:UserCircle},
  ];
  const [events,setEvents]=useState<OrgDashEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [coupons,setCoupons]=useState<CouponType[]>([]);
  const [couponsFetchError, setCouponsFetchError] = useState<string | null>(null);
  const [summary,setSummary]=useState({totalRevenue:0,participants:0,eventsHosted:0,successRate:0,activeCoupons:0,expiringCoupons:0});
  const [revenueRows,setRevenueRows]=useState<{id:number;name:string;participants:number;revenue:number;perPerson:number}[]>([]);
  const [monthlyRevenue,setMonthlyRevenue]=useState<number[]>(Array.from({length:12},()=>0));
  const [profile,setProfile]=useState({name:user.name,email:user.email,phone:'',eventsHosted:0,avgRating:null as number|null});
  const [savingProfile,setSavingProfile]=useState(false);
  const [newCoupon,setNewCoupon]=useState({prefix:'NOMAD',discount:10,limit:50,expiry:''});
  const [genCode,setGenCode]=useState('');
  const cc='bg-white/[0.03] border border-white/10 rounded-2xl hover:border-white/20 transition-colors';

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setEventsLoading(true);
        const res = await fetch(`/api/organizers/${user.id}/events`);
        if (!res.ok) return;
        const rows = await res.json();
        if (!mounted) return;
        const mapped: OrgDashEvent[] = (rows || []).map((row: any) => {
          const scope = (row.scope || "upcoming") as OrgDashEvent["scope"];
          const d = row.date ? parseDateOnlyLocal(String(row.date)) : null;
          const dateShort = d
            ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
            : "TBA";
          const dateLabel = scope === "today" ? `Today, ${dateShort}` : dateShort;
          return {
            id: Number(row.id),
            name: row.name || "Untitled Event",
            date: dateLabel,
            theme: row.theme || "Adventure",
            joined: Number(row.joined_count || 0),
            max: Number(row.max_participants || 0),
            revenue: Number(row.revenue || 0),
            status: scope === "today" ? "active" : scope === "past" ? "completed" : "upcoming",
            scope,
            banner: row.banner_url || row.banner || `trip-${row.id}`,
            privacy: row.privacy === "private" ? "private" : "public",
          };
        });
        setEvents(mapped);
      } catch {
        if (mounted) setEvents([]);
      } finally {
        if (mounted) setEventsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [summaryRes, revenueRes, monthRes, couponRes, profileRes] = await Promise.all([
          fetch(`/api/organizers/${user.id}/dashboard-summary`),
          fetch(`/api/organizers/${user.id}/revenue-by-event`),
          fetch(`/api/organizers/${user.id}/monthly-revenue`),
          fetch(`/api/organizers/${user.id}/coupons`),
          fetch(`/api/organizers/${user.id}/profile`),
        ]);
        if (mounted && summaryRes.ok) {
          const s = await summaryRes.json();
          setSummary({
            totalRevenue: Number(s.totalRevenue || 0),
            participants: Number(s.participants || 0),
            eventsHosted: Number(s.eventsHosted || 0),
            successRate: Number(s.successRate || 0),
            activeCoupons: Number(s.activeCoupons || 0),
            expiringCoupons: Number(s.expiringCoupons || 0),
          });
        }
        if (mounted && revenueRes.ok) {
          const rows = await revenueRes.json();
          setRevenueRows((rows || []).map((r:any)=>({
            id:Number(r.id),name:String(r.name||'Untitled'),
            participants:Number(r.participants||0),
            revenue:Number(r.revenue||0),
            perPerson:Number(r.perPerson||0),
          })));
        }
        if (mounted && monthRes.ok) {
          const rows = await monthRes.json();
          const arr = Array.from({ length: 12 }, () => 0);
          for (const row of rows || []) {
            const i = Number((row as any).month);
            if (Number.isFinite(i) && i >= 0 && i < 12) arr[i] = Number((row as any).revenue || 0);
          }
          setMonthlyRevenue(arr);
        }
        if (mounted) {
          if (couponRes.ok) {
            setCouponsFetchError(null);
            const rows = await couponRes.json();
            setCoupons((rows || []).map((c: any) => ({
              id: String(c.id),
              code: String(c.code),
              discount: Number(c.discount_pct || 0),
              limit: Number(c.usage_limit || 0),
              used: Number(c.used_count || 0),
              expiry: c.expiry_date
                ? new Date(c.expiry_date).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                  })
                : "No expiry",
              active: Boolean(c.active),
              prefix: String(c.prefix || ""),
            })));
          } else {
            setCouponsFetchError(await readApiErrorMessage(couponRes));
          }
        }
        if (mounted && profileRes.ok) {
          const p = await profileRes.json();
          setProfile({
            name: String(p.name || user.name),
            email: String(p.email || user.email),
            phone: String(p.phone || ''),
            eventsHosted: Number(p.events_hosted || 0),
            avgRating: Number.isFinite(Number(p.avg_rating)) ? Number(p.avg_rating) : null,
          });
        }
      } catch {
        // keep UI usable with existing loaded state
      }
    })();
    return () => { mounted = false; };
  }, [user.id, user.name, user.email]);

  const renderTab=()=>{
    switch(activeTab){
      case"Today's Events":case'Upcoming Events':{
        const list=events.filter(t=>
          activeTab==="Today's Events" ? t.scope==="today" : t.scope==="upcoming",
        );
        return(
          <div className="space-y-4">
            {eventsLoading && <Card className="p-4 text-sm text-white/50">Loading events...</Card>}
            {list.length===0?(
              <div className="py-24 text-center bg-white/[0.02] rounded-2xl border border-white/[0.06]">
                <Calendar size={32} className="text-white/20 mx-auto mb-4"/>
                <p className="text-white/40 font-medium">No events for this period</p>
                <button onClick={()=>navigate('/organizer/create')} className="mt-4 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-all">+ Create an Event</button>
              </div>
            ):list.map(trip=>(
              <div key={trip.id} className={cn(cc,'p-5 flex items-center gap-5')}>
                <div className="w-20 h-20 bg-gray-800 rounded-xl overflow-hidden flex-shrink-0"><img src={`https://picsum.photos/seed/${trip.banner}/200/200`} alt="" className="w-full h-full object-cover opacity-70" referrerPolicy="no-referrer"/></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-white truncate">{trip.name}</h3>
                    <Badge variant={trip.scope==='today'?'success':'default'}>{trip.scope==='today'?'Today':trip.scope==='past'?'Completed':'Upcoming'}</Badge>
                    <Badge variant={trip.privacy==='public'?'info':'warning'}>
                      {trip.privacy==='public' ? 'Public' : 'Private'}
                    </Badge>
                  </div>
                  <p className="text-sm text-white/40">{trip.date} · {trip.theme}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-white/40"><Users size={11} className="inline mr-1"/>{trip.joined}/{trip.max} joined</span>
                    <span className="text-xs text-emerald-400">₹{trip.revenue.toLocaleString()} earned</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() =>
                      setEvents(prev =>
                        prev.map(e =>
                          e.id===trip.id
                            ? {...e,privacy:e.privacy==='public'?'private':'public'}
                            : e
                        )
                      )
                    }
                  >
                    {trip.privacy==='public' ? 'Make Private' : 'Make Public'}
                  </Button>
                  <Button size="sm" className="text-xs" onClick={()=>navigate(`/trip/${trip.id}/live`)}>Go Live</Button>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case'Create Event':return(
        <div className="py-12 text-center max-w-md mx-auto">
          <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6"><Plus size={32} className="text-white/40"/></div>
          <h3 className="text-2xl font-bold mb-2">Create a New Event</h3>
          <p className="text-white/40 mb-8">Launch a public expedition or a private invite-only journey.</p>
          <Button onClick={()=>navigate('/organizer/create')} className="mx-auto flex items-center gap-2"><Sparkles size={16}/> Open Event Builder</Button>
        </div>
      );
      case'Manage Events':return(
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl"><Search size={14} className="text-white/30"/><input type="text" placeholder="Search events…" className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 focus:outline-none"/></div>
            <button className="px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm text-white/50 hover:text-white hover:border-white/30 flex items-center gap-2 transition-all"><Filter size={14}/> Filter</button>
          </div>
          {events.map(trip=>(
            <div key={trip.id} className={cn(cc,'p-5 flex items-center gap-5')}>
              <div className="w-16 h-16 bg-gray-800 rounded-xl overflow-hidden flex-shrink-0"><img src={`https://picsum.photos/seed/${trip.banner}/200/200`} alt="" className="w-full h-full object-cover opacity-70" referrerPolicy="no-referrer"/></div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-white truncate mb-1">{trip.name}</h3>
                <p className="text-xs text-white/40">{trip.date} · {trip.joined}/{trip.max} participants</p>
                <div className="mt-2 w-full h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-white" style={{width:`${trip.max > 0 ? Math.min(100, (trip.joined/trip.max)*100) : 0}%`}}/></div>
              </div>
              <Badge variant={trip.status==='active'?'success':trip.status==='completed'?'warning':'default'}>{trip.status}</Badge>
              <div className="flex gap-1.5 flex-shrink-0">
                <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all"><Edit2 size={13}/></button>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all"><Eye size={13}/></button>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"><Trash2 size={13}/></button>
              </div>
            </div>
          ))}
        </div>
      );
      case'Marketplace Listings':return(
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[{label:'Listed Events',value:'4',icon:List,color:'text-blue-400',bg:'bg-blue-500/10'},{label:'Total Views',value:'2.4K',icon:Eye,color:'text-purple-400',bg:'bg-purple-500/10'},{label:'Conversion Rate',value:'18%',icon:Target,color:'text-emerald-400',bg:'bg-emerald-500/10'}].map(s=>(
              <div key={s.label} className={cn(cc,'p-5')}>
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3',s.bg)}><s.icon size={18} className={s.color}/></div>
                <p className="text-2xl font-bold mb-1">{s.value}</p><p className="text-xs text-white/40">{s.label}</p>
              </div>
            ))}
          </div>
          {events.filter(t=>t.privacy==='public'&&t.scope!=='past').map(trip=>(
            <div key={trip.id} className={cn(cc,'p-5 flex items-center gap-4')}>
              <div className="w-14 h-14 bg-gray-800 rounded-xl overflow-hidden flex-shrink-0"><img src={`https://picsum.photos/seed/${trip.banner}/200/200`} alt="" className="w-full h-full object-cover opacity-70" referrerPolicy="no-referrer"/></div>
              <div className="flex-1"><h3 className="font-bold text-sm mb-0.5">{trip.name}</h3><p className="text-xs text-white/40">{trip.joined} booked{trip.max > 0 ? ` · ${Math.max(0, trip.max - trip.joined)} slots left` : ""}</p></div>
              <div className="flex items-center gap-2">
                <Badge variant="success">Public</Badge>
                <button type="button" onClick={()=>navigate(`/trip/${trip.id}`)} className="px-3 py-1.5 text-xs font-semibold border border-white/10 rounded-lg text-white/50 hover:text-white hover:border-white/30 transition-all flex items-center gap-1"><Eye size={12}/> Preview</button>
                <button type="button" onClick={()=>navigate(`/organizer/create`)} className="px-3 py-1.5 text-xs font-semibold border border-white/10 rounded-lg text-white/50 hover:text-white hover:border-white/30 transition-all flex items-center gap-1"><Edit2 size={12}/> Edit</button>
              </div>
            </div>
          ))}
          {events.filter(t=>t.privacy==='public'&&t.scope!=='past').length===0 && !eventsLoading && (
            <div className="py-12 text-center text-white/40 text-sm">No public listings yet. Create a public event to appear in the marketplace.</div>
          )}
        </div>
      );
      case'Revenue Analytics':return(
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[{label:'Total Revenue',value:`₹${summary.totalRevenue.toLocaleString()}`,change:`${summary.successRate}% success`,up:true,icon:DollarSign},{label:'This Month',value:`₹${(monthlyRevenue[new Date().getMonth()]||0).toLocaleString()}`,change:'live',up:true,icon:TrendingUp},{label:'Avg per Event',value:`₹${Math.round(summary.eventsHosted?summary.totalRevenue/summary.eventsHosted:0).toLocaleString()}`,change:'auto',up:true,icon:Activity},{label:'Participants',value:summary.participants.toLocaleString(),change:'live',up:true,icon:Users2}].map(s=>(
              <div key={s.label} className={cn(cc,'p-5')}>
                <div className="flex items-center justify-between mb-3"><div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center"><s.icon size={15} className="text-white/50"/></div><span className={cn('flex items-center gap-0.5 text-xs font-bold',s.up?'text-emerald-400':'text-red-400')}>{s.up?<ArrowUpRight size={12}/>:<ArrowDownRight size={12}/>}{s.change}</span></div>
                <p className="text-2xl font-bold">{s.value}</p><p className="text-[10px] text-white/30 mt-1 uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>
          <div className={cn(cc,'p-6')}>
            <div className="flex items-center justify-between mb-6"><h3 className="font-bold">Revenue by Event</h3><button className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white"><Download size={13}/> Export</button></div>
            <div className="space-y-5">
              {revenueRows.map(trip=>(
                <div key={trip.id}>
                  <div className="flex items-center justify-between mb-1.5"><span className="text-sm font-medium text-white/80">{trip.name}</span><span className="text-sm font-bold">₹{trip.revenue.toLocaleString()}</span></div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-white rounded-full" style={{width:`${Math.min(100, summary.totalRevenue>0 ? (trip.revenue/summary.totalRevenue)*100 : 0)}%`}}/></div>
                  <div className="flex justify-between mt-1"><span className="text-[10px] text-white/30">{trip.participants} participants</span><span className="text-[10px] text-white/30">₹{trip.perPerson.toLocaleString()}/person</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className={cn(cc,'p-6')}>
            <h3 className="font-bold mb-6">Monthly Overview</h3>
            <div className="flex items-end gap-1.5 h-32">
              {monthlyRevenue.map((value,i)=>{
                const max = Math.max(...monthlyRevenue, 1);
                const h = Math.max(8, Math.round((value / max) * 100));
                return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-lg bg-white/20 hover:bg-white/40 transition-colors cursor-pointer" style={{height:`${h}%`}}/>
                  <span className="text-[8px] text-white/20">{CAL_MONTHS[i].slice(0,3)}</span>
                </div>
              )})}
            </div>
          </div>
        </div>
      );
      case'Coupons':return(
        <div className="space-y-6">
          <div className={cn(cc,'p-6')}>
            <h3 className="font-bold mb-5 flex items-center gap-2"><Tag size={16} className="text-white/40"/> Generate New Coupon</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[{label:'Code Prefix',key:'prefix',type:'text',max:8},{label:'Discount %',key:'discount',type:'number'},{label:'Usage Limit',key:'limit',type:'number'},{label:'Expires',key:'expiry',type:'date'}].map(f=>(
                <div key={f.key}>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">{f.label}</label>
                  <input type={f.type} value={(newCoupon as any)[f.key]} maxLength={f.max}
                    onChange={e=>setNewCoupon(p=>({...p,[f.key]:f.key==='prefix'?e.target.value.toUpperCase():f.key==='expiry'?e.target.value:Math.max(1,parseInt(e.target.value)||1)}))}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-white/30 font-mono scheme-dark"/>
                </div>
              ))}
            </div>
            {genCode&&(
              <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} className="mb-4 p-4 bg-white/5 border border-white/15 rounded-xl flex items-center justify-between">
                <span className="font-mono font-bold text-xl tracking-widest text-white">{genCode}</span>
                <button onClick={()=>navigator.clipboard.writeText(genCode)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"><Copy size={14}/></button>
              </motion.div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={()=>setGenCode(generateCouponCode(newCoupon.prefix))} className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/15 text-sm font-semibold text-white/70 hover:text-white hover:border-white/40 bg-white/[0.03] transition-all"><RefreshCw size={14}/> {genCode?'Regenerate':'Generate Code'}</button>
              {genCode&&(
                <button type="button" onClick={async()=>{try{const res=await fetch(`/api/organizers/${user.id}/coupons`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:genCode,prefix:newCoupon.prefix,discount_pct:newCoupon.discount,usage_limit:newCoupon.limit,expiry_date:newCoupon.expiry||null})});if(!res.ok){alert(await readApiErrorMessage(res));return;}const body=await res.json();setCoupons(p=>[{id:String(body.id),code:String(body.code),discount:Number(body.discount_pct||newCoupon.discount),limit:Number(body.usage_limit||newCoupon.limit),used:Number(body.used_count||0),expiry:body.expiry_date?new Date(body.expiry_date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'No expiry',active:Boolean(body.active),prefix:String(body.prefix||newCoupon.prefix)},...p]);setSummary(s=>({...s,activeCoupons:s.activeCoupons+1}));setGenCode('');setNewCoupon({prefix:'NOMAD',discount:10,limit:50,expiry:''});setCouponsFetchError(null);}catch{alert('Could not reach the server. Use npm run dev on port 3000.')}}} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black text-sm font-bold hover:bg-white/90 transition-all"><Check size={14}/> Save Coupon</button>
              )}
            </div>
          </div>
          <div>
            {couponsFetchError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {couponsFetchError}
              </div>
            )}
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4">All Coupons ({coupons.length})</p>
            <div className="space-y-3">{coupons.map(c=><CouponCard key={c.id} coupon={c} onDelete={async()=>{try{await fetch(`/api/organizers/${user.id}/coupons/${c.id}`,{method:'DELETE'});}catch{}setCoupons(p=>p.filter(x=>x.id!==c.id));}} onToggle={async()=>{const next=!c.active;try{const res=await fetch(`/api/organizers/${user.id}/coupons/${c.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:next})});if(!res.ok)return;}catch{return;}setCoupons(p=>p.map(x=>x.id===c.id?{...x,active:next}:x));}}/>)}</div>
          </div>
        </div>
      );
      case'Profile':return(
        <div className="max-w-2xl space-y-5">
          <div className={cn(cc,'p-6 flex items-center gap-5')}>
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-white/10 border border-white/20"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} alt="" className="w-full h-full object-cover"/></div>
              <button className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center"><Camera size={11}/></button>
            </div>
            <div><h3 className="font-bold text-lg">{profile.name}</h3><p className="text-white/40 text-sm">Verified Organizer</p><div className="flex items-center gap-1 mt-1"><Star size={12} className="text-amber-400 fill-amber-400"/><span className="text-xs font-bold text-amber-400">{profile.avgRating ?? '--'}</span><span className="text-xs text-white/30 ml-1">· {profile.eventsHosted} events hosted</span></div></div>
          </div>
          {[{label:'Full Name',key:'name',value:profile.name,icon:UserCircle},{label:'Email',key:'email',value:profile.email||'organizer@nomad.com',icon:Mail},{label:'Phone',key:'phone',value:profile.phone||'+91 00000 00000',icon:Settings}].map(f=>(
            <div key={f.label} className={cn(cc,'p-5 flex items-center gap-4')}>
              <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center"><f.icon size={16} className="text-white/40"/></div>
              <div className="flex-1"><p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-0.5">{f.label}</p><input value={f.value} onChange={e=>setProfile(p=>({...p,[f.key]:e.target.value}))} className="w-full bg-transparent text-sm font-semibold focus:outline-none"/></div>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all"><Edit2 size={13}/></button>
            </div>
          ))}
          <button disabled={savingProfile} onClick={async()=>{try{setSavingProfile(true);const res=await fetch(`/api/organizers/${user.id}/profile`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:profile.name,email:profile.email,phone:profile.phone})});const body=await res.json().catch(()=>({}));if(!res.ok){alert(body.error||'Failed to save profile');return;}setProfile(p=>({...p,name:body.name??p.name,email:body.email??p.email,phone:body.phone??p.phone}));}catch{alert('Failed to save profile');}finally{setSavingProfile(false);}}} className="w-full py-3 rounded-2xl border border-white/10 text-sm font-semibold text-white/50 hover:text-white hover:border-white/30 transition-all">{savingProfile?'Saving...':'Save Changes'}</button>
          <button onClick={onLogout} className="w-full py-3 rounded-2xl border border-red-500/20 text-sm font-semibold text-red-400 hover:bg-red-500/10 transition-all flex items-center justify-center gap-2"><LogOut size={14}/> Sign Out</button>
        </div>
      );
      default:return null;
    }
  };

  return(
    <div className="min-h-dvh bg-black text-white">
      <AppNav user={user} onLogout={onLogout}/>
      <div className="pt-20 flex">
        <aside className="w-64 border-r border-white/[0.06] fixed top-20 bottom-0 left-0 hidden lg:flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto py-6 px-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 px-3 mb-3">Organizer Menu</p>
            <nav className="space-y-0.5">
              {TABS.map(({id,icon:Icon})=>(
                <button key={id} onClick={()=>{if(id==='Create Event')navigate('/organizer/create');else setActiveTab(id);}}
                  className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left',activeTab===id?'bg-white text-black':'text-white/50 hover:text-white hover:bg-white/5')}>
                  <Icon size={16}/> {id}
                </button>
              ))}
            </nav>
          </div>
          <div className="p-4 border-t border-white/[0.06]"><button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-white/30 hover:text-white hover:bg-white/5 cursor-pointer transition-all text-sm"><LogOut size={16}/> Logout</button></div>
        </aside>
        <main className="flex-1 lg:ml-64 p-6 lg:p-10 min-h-dvh">
          {activeTab!=='Create Event'&&(
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[{label:'Total Revenue',value:`₹${summary.totalRevenue.toLocaleString()}`,trend:'live',icon:DollarSign},{label:'Participants',value:summary.participants.toLocaleString(),trend:'live',icon:Users},{label:'Events Hosted',value:String(summary.eventsHosted),trend:`${summary.successRate}% success`,icon:Calendar},{label:'Active Coupons',value:String(summary.activeCoupons),trend:`${summary.expiringCoupons} expiring`,icon:Tag}].map(s=>(
                <div key={s.label} className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-colors">
                  <div className="flex items-center justify-between mb-2"><s.icon size={15} className="text-white/30"/><span className="text-[10px] font-bold text-emerald-400">{s.trend}</span></div>
                  <p className="text-xl font-bold">{s.value}</p><p className="text-[10px] text-white/30 mt-0.5 uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          {/* Mobile organizer tabs: bottom sheet selector (big tap targets) */}
          <div className="md:hidden mb-4">
            <button
              type="button"
              onClick={() => setShowMobileOrganizerTabs(true)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-white/70 hover:text-white hover:border-white/20 transition-all touch-manipulation"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.04] border border-white/10 text-white/40">
                  <span className="text-base">≡</span>
                </span>
                <span className="text-sm font-bold truncate">{activeTab}</span>
              </div>
              <ChevronDown size={16} className="text-white/30" />
            </button>
          </div>

          {showMobileOrganizerTabs && (
            <>
              <div
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] md:hidden"
                onClick={() => setShowMobileOrganizerTabs(false)}
              />
              <div className="fixed left-0 right-0 bottom-0 z-[101] md:hidden bg-[#0d0d0d] border-t border-white/10 rounded-t-3xl shadow-[0_-20px_60px_rgba(0,0,0,0.8)]">
                <div className="safe-pb p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-white/80">Organizer options</p>
                    <button
                      type="button"
                      onClick={() => setShowMobileOrganizerTabs(false)}
                      className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                      aria-label="Close"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {TABS.map(({ id, icon: Icon }) => {
                      const isActive = activeTab === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setShowMobileOrganizerTabs(false);
                            if (id === "Create Event") navigate("/organizer/create");
                            else setActiveTab(id);
                          }}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition-all touch-manipulation",
                            isActive
                              ? "bg-white text-black border-white"
                              : "bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20",
                          )}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <span
                              className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
                                isActive ? "bg-black/10 border-black/20" : "bg-white/[0.04] border-white/10",
                              )}
                            >
                              <Icon size={16} className={isActive ? "" : "text-white/50"} />
                            </span>
                            <span className="text-sm font-bold truncate">
                              {id === "Today's Events"
                                ? "Today"
                                : id === "Upcoming Events"
                                  ? "Upcoming"
                                  : id === "Manage Events"
                                    ? "Manage"
                                    : id === "Marketplace Listings"
                                      ? "Market"
                                      : id === "Revenue Analytics"
                                        ? "Revenue"
                                        : id === "Coupons"
                                          ? "Coupons"
                                          : id === "Profile"
                                            ? "Profile"
                                            : "Create"}
                            </span>
                          </span>
                          <span className="text-xs font-bold text-white/40">{isActive ? "Active" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
          <div className="flex items-center justify-between mb-6">
            <div><h1 className="text-2xl font-bold">{activeTab}</h1><p className="text-white/40 text-sm mt-0.5">Manage your {activeTab.toLowerCase()}</p></div>
            <Button onClick={()=>navigate('/organizer/create')} size="sm" className="flex items-center gap-1.5"><Plus size={14}/> New Event</Button>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.2}}>
              {renderTab()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

// ─── CREATE EVENT PAGE ───────────────────────────────────────
const CreateEventPage = ({user}:{user:User}) => {
  const navigate = useNavigate();
  const [form,setForm] = useState({
    name:'',theme:'Adventure',date:'Mon, 23 Feb',time:'08:00 AM',
    endDate:'Tue, 24 Feb',endTime:'06:00 PM',duration:'1 Day',
    ageGroup:'18+',language:'English',meetupPoint:'',endLocation:'',
    maxParticipants:20,price:'',isFree:false,
    description:'',prerequisites:'',terms:'',
    contactName:'',contactPhone:'',contactEmail:'',
    privacy:'Public',requireApproval:false,selectedTags:[] as string[],
  });
  const [bannerPreview,setBannerPreview]=useState<string|null>(null);
  const [galleryFiles,setGalleryFiles]=useState<{file:File;preview:string}[]>([]);
  const [isDragging,setIsDragging]=useState(false);
  const bannerRef=useRef<HTMLInputElement>(null);
  const galleryRef=useRef<HTMLInputElement>(null);
  const [coupons,setCoupons]=useState<CouponType[]>([]);
  const [couponForm,setCouponForm]=useState({prefix:'EVENT',discount:10,limit:50,expiry:''});
  const [couponCode,setCouponCode]=useState('');
  const [couponAttachLoading, setCouponAttachLoading] = useState(false);
  const [inviteInput,setInviteInput]=useState('');
  const [invites,setInvites]=useState<InviteType[]>([]);
  const [activePicker,setActivePicker]=useState<string|null>(null);
  const [timezone,setTimezone]=useState({name:'India - Kolkata',offset:'GMT+05:30',city:'Kolkata'});
  const [showPrivacyDrop,setShowPrivacyDrop]=useState(false);
  const [activeTagCat,setActiveTagCat]=useState(Object.keys(TRIP_TAGS)[0]);
  const [sections,setSections]=useState({basic:true,datetime:true,location:true,capacity:true,about:true,requirements:false,contact:false,coupons:false,tags:false});
  const [startSuggestions, setStartSuggestions] = useState<PlaceSuggestion[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<PlaceSuggestion[]>([]);
  const [startCoords, setStartCoords] = useState<{lat:number;lng:number} | null>(null);
  const [endCoords, setEndCoords] = useState<{lat:number;lng:number} | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const toggle=(s:keyof typeof sections)=>setSections(p=>({...p,[s]:!p[s]}));

  const geocodePlace = async (query: string): Promise<PlaceSuggestion[]> => {
    const value = query.trim();
    if (value.length < 3) return [];
    const response = await fetch(`/api/maps/geocode?query=${encodeURIComponent(value)}&limit=5`);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.features) ? data.features : [];
  };

  const handleBanner=(file:File)=>{
    if(!file.type.startsWith('image/'))return;
    const r=new FileReader();r.onload=e=>setBannerPreview(e.target?.result as string);r.readAsDataURL(file);
  };
  const handleGallery=(files:FileList|null)=>{
    if(!files)return;
    Array.from(files).forEach(file=>{if(!file.type.startsWith('image/'))return;const r=new FileReader();r.onload=e=>setGalleryFiles(p=>[...p,{file,preview:e.target?.result as string}]);r.readAsDataURL(file);});
  };
  const toggleTag=(tag:string)=>setForm(p=>({...p,selectedTags:p.selectedTags.includes(tag)?p.selectedTags.filter(t=>t!==tag):[...p.selectedTags,tag]}));
  const addInvite=()=>{const v=inviteInput.trim();if(!v||invites.find(i=>i.value===v))return;setInvites(p=>[...p,{type:v.includes('@')?'email':'phone',value:v}]);setInviteInput('');};

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const results = await geocodePlace(form.meetupPoint);
        setStartSuggestions(results);
      } catch {
        setStartSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [form.meetupPoint]);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const results = await geocodePlace(form.endLocation);
        setEndSuggestions(results);
      } catch {
        setEndSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [form.endLocation]);

  const cc='bg-white/[0.03] border border-white/10 rounded-2xl hover:border-white/20 transition-colors';
  const SH=({label,section,icon:Icon}:{label:string;section:keyof typeof sections;icon:React.ElementType})=>(
    <button type="button" onClick={()=>toggle(section)} className="w-full flex items-center justify-between py-3.5 px-5 hover:bg-white/[0.02] transition-colors rounded-t-2xl">
      <div className="flex items-center gap-3"><div className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center"><Icon size={13} className="text-white/40"/></div><span className="text-sm font-bold text-white/80">{label}</span></div>
      <ChevronDown size={13} className={cn('text-white/30 transition-transform duration-200',sections[section]&&'rotate-180')}/>
    </button>
  );

  return (
    <div className="min-h-dvh bg-black text-white">
      <AppNav user={user}/>
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-28 pb-6 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-2">Organizer Studio</p><h1 className="text-3xl md:text-4xl font-bold tracking-tight">Create Event</h1></div>
          <button type="button" className="hidden md:flex px-4 py-2 rounded-xl border border-white/10 text-sm font-medium text-white/50 hover:text-white hover:border-white/30 transition-all">Save Draft</button>
        </div>
      </div>
      <main className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <form
          onSubmit={async e => {
            e.preventDefault();
            try {
              setMapLoading(true);
              let resolvedStart = startCoords;
              let resolvedEnd = endCoords;

              if (!resolvedStart && form.meetupPoint.trim()) {
                const features = await geocodePlace(form.meetupPoint);
                if (features[0]?.center) {
                  resolvedStart = {
                    lng: Number(features[0].center[0]),
                    lat: Number(features[0].center[1]),
                  };
                }
              }

              if (!resolvedStart) {
                alert("Please choose a valid meetup location from suggestions.");
                setMapLoading(false);
                return;
              }

              if (!resolvedEnd && form.endLocation.trim()) {
                const features = await geocodePlace(form.endLocation);
                if (features[0]?.center) {
                  resolvedEnd = {
                    lng: Number(features[0].center[0]),
                    lat: Number(features[0].center[1]),
                  };
                }
              }

              const payload = {
                organizer_id: Number(user.id) || undefined,
                name: form.name,
                description: form.description,
                theme: form.theme,
                date: form.date,
                time: form.time,
                duration: form.duration,
                price: form.isFree ? 0 : Number(form.price || 0),
                max_participants: form.maxParticipants,
                meetup_lat: resolvedStart?.lat ?? null,
                meetup_lng: resolvedStart?.lng ?? null,
                start_lat: resolvedStart?.lat ?? null,
                start_lng: resolvedStart?.lng ?? null,
                end_lat: resolvedEnd?.lat ?? null,
                end_lng: resolvedEnd?.lng ?? null,
                start_place_name: form.meetupPoint,
                start_place_address: form.meetupPoint,
                end_place_name: form.endLocation || null,
                end_place_address: form.endLocation || null,
                privacy: form.privacy.toLowerCase(),
                banner_url: bannerPreview || null,
                start_location: form.meetupPoint,
                end_location: form.endLocation,
                prerequisites: form.prerequisites,
                terms: form.terms,
                tags: form.selectedTags,
              };

              const res = await fetch("/api/trips", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });

              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const msg = [body.error, body.details, body.hint].filter(Boolean).join("\n");
                alert(msg || "Failed to create event");
                return;
              }

              const data = await res.json().catch(() => ({}));
              const createdId = data?.id ?? data?.trip_id;
              if (!createdId) {
                alert("Event created, but trip id was missing in response. Open it from Organizer Dashboard.");
                navigate("/organizer");
                return;
              }
              navigate(`/trip/${createdId}`);
            } catch (err) {
              console.error("Create event error", err);
              alert("Something went wrong while creating the event.");
            } finally {
              setMapLoading(false);
            }
          }}
          className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8"
        >
          <div className="space-y-4">
            {/* Privacy bar */}
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/organizer" className="flex items-center gap-2 px-3.5 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/[0.08] hover:border-white/25 transition-all"><ChevronLeft size={13}/> Dashboard</Link>
              <div className="relative">
                <button type="button" onClick={()=>setShowPrivacyDrop(!showPrivacyDrop)} className="flex items-center gap-2 px-3.5 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs font-semibold text-white/60 hover:text-white hover:bg-white/[0.08] hover:border-white/25 transition-all">
                  {form.privacy==='Public'?<Globe size={13}/>:<Lock size={13}/>} {form.privacy} <ChevronDown size={12} className={cn('text-white/30 transition-transform',showPrivacyDrop&&'rotate-180')}/>
                </button>
                <AnimatePresence>
                  {showPrivacyDrop&&(<>
                    <div className="fixed inset-0 z-10" onClick={()=>setShowPrivacyDrop(false)}/>
                    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}} className="absolute top-full left-0 mt-2 w-52 bg-[#111] border border-white/10 rounded-2xl p-2 shadow-2xl z-20">
                      {[{label:'Public',icon:Globe,desc:'Listed on marketplace'},{label:'Private',icon:Lock,desc:'Invite-only access'}].map(({label,icon:Icon,desc})=>(
                        <button key={label} type="button" onClick={()=>{setForm(p=>({...p,privacy:label}));setShowPrivacyDrop(false);}} className={cn('w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-xs transition-all text-left',form.privacy===label?'bg-white text-black':'text-white/50 hover:bg-white/[0.06] hover:text-white')}>
                          <Icon size={13} className="mt-0.5 flex-shrink-0"/><div><p className="font-semibold">{label}</p><p className={cn('text-[10px] mt-0.5',form.privacy===label?'text-black/50':'text-white/30')}>{desc}</p></div>
                        </button>
                      ))}
                    </motion.div>
                  </>)}
                </AnimatePresence>
              </div>
            </div>
            {/* Event Name */}
            <div className="border-b border-white/[0.06] pb-6">
              <input type="text" placeholder="Event Name" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required className="w-full bg-transparent text-4xl md:text-5xl font-bold placeholder:text-white/[0.08] focus:outline-none tracking-tight"/>
            </div>
            {/* BASIC INFO */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Basic Info" section="basic" icon={FileText}/>
              <AnimatePresence>{sections.basic&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Theme / Category</label><div className="relative"><select value={form.theme} onChange={e=>setForm(p=>({...p,theme:e.target.value}))} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold appearance-none focus:outline-none focus:border-white/30 text-white/80">{THEMES.map(t=><option key={t} value={t} className="bg-[#111]">{t}</option>)}</select><ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"/></div></div>
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Duration</label><div className="relative"><select value={form.duration} onChange={e=>setForm(p=>({...p,duration:e.target.value}))} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold appearance-none focus:outline-none focus:border-white/30 text-white/80">{DURATIONS.map(d=><option key={d} value={d} className="bg-[#111]">{d}</option>)}</select><ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"/></div></div>
                </div>
                <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2 block">Age Group</label><div className="flex flex-wrap gap-1.5">{AGE_GROUPS.map(ag=><button key={ag} type="button" onClick={()=>setForm(p=>({...p,ageGroup:ag}))} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',form.ageGroup===ag?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80')}>{ag}</button>)}</div></div>
                <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2 block">Language</label><div className="flex flex-wrap gap-1.5">{LANGUAGES.map(lang=><button key={lang} type="button" onClick={()=>setForm(p=>({...p,language:lang}))} className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',form.language===lang?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80')}>{lang}</button>)}</div></div>
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* DATE & TIME */}
            <div className={cn(cc,'overflow-visible')}>
              <SH label="Date & Time" section="datetime" icon={Calendar}/>
              <AnimatePresence>{sections.datetime&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-visible"><div className="px-5 pb-5 pt-1 space-y-4">
                {[{label:'Start',dk:'sd',tk:'st',dv:form.date,tv:form.time,dd:'date',td:'time',dot:false},{label:'End',dk:'ed',tk:'et',dv:form.endDate,tv:form.endTime,dd:'endDate',td:'endTime',dot:true}].map(row=>(
                  <div key={row.label} className="flex items-center gap-3 flex-wrap">
                    <div className={cn('w-3 h-3 rounded-full flex-shrink-0',row.dot?'bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]':'border-2 border-white/30 bg-white/[0.06]')}/>
                    <div><p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">{row.label}</p>
                      <div className="flex gap-2 flex-wrap">
                        <div className="relative"><button type="button" onClick={()=>setActivePicker(activePicker===row.dk?null:row.dk)} className={cn('bg-white/[0.04] border px-3 py-1.5 rounded-lg text-xs font-semibold w-[110px] text-left text-white/70 hover:bg-white/[0.08] transition-all',activePicker===row.dk&&'border-white/40')}>{row.dv}</button><AnimatePresence>{activePicker===row.dk&&<DatePicker value={row.dv} onChange={v=>setForm(p=>({...p,[row.dd]:v}))} onClose={()=>setActivePicker(null)}/>}</AnimatePresence></div>
                        <div className="relative"><button type="button" onClick={()=>setActivePicker(activePicker===row.tk?null:row.tk)} className={cn('bg-white/[0.04] border px-3 py-1.5 rounded-lg text-xs font-semibold w-[88px] text-left text-white/70 hover:bg-white/[0.08] transition-all',activePicker===row.tk&&'border-white/40')}>{row.tv}</button><AnimatePresence>{activePicker===row.tk&&<TimePicker value={row.tv} onChange={v=>setForm(p=>({...p,[row.td]:v}))} onClose={()=>setActivePicker(null)}/>}</AnimatePresence></div>
                      </div>
                    </div>
                    {row.dot&&(<div className="relative ml-auto"><button type="button" onClick={()=>setActivePicker(activePicker==='tz'?null:'tz')} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-semibold text-white/50 hover:text-white hover:border-white/30 transition-all"><Globe size={12}/> {timezone.offset}</button><AnimatePresence>{activePicker==='tz'&&<TimezonePicker value={timezone.offset} onChange={tz=>{setTimezone(tz);setActivePicker(null);}} onClose={()=>setActivePicker(null)}/>}</AnimatePresence></div>)}
                  </div>
                ))}
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* LOCATION */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Meetup Location" section="location" icon={MapPin}/>
              <AnimatePresence>{sections.location&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Start / Meetup Point</label>
                    <input
                      type="text"
                      placeholder="e.g. Gateway of India, Mumbai"
                      value={form.meetupPoint}
                      onChange={e => {
                        const value = e.target.value;
                        setForm(p => ({ ...p, meetupPoint: value }));
                        setStartCoords(null);
                      }}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold placeholder:text-white/15 focus:outline-none focus:border-white/30 text-white/90"
                    />
                    {startSuggestions.length > 0 && (
                      <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/10 bg-[#111] max-h-44 overflow-y-auto">
                        {startSuggestions.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setForm(p => ({ ...p, meetupPoint: item.place_name }));
                              setStartCoords({ lat: Number(item.center[1]), lng: Number(item.center[0]) });
                              setStartSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-white/75 hover:bg-white/10 transition-colors"
                          >
                            {item.place_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">End / Drop-off Location</label>
                    <input
                      type="text"
                      placeholder="e.g. Lonavala Station"
                      value={form.endLocation}
                      onChange={e => {
                        const value = e.target.value;
                        setForm(p => ({ ...p, endLocation: value }));
                        setEndCoords(null);
                      }}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold placeholder:text-white/15 focus:outline-none focus:border-white/30 text-white/90"
                    />
                    {endSuggestions.length > 0 && (
                      <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/10 bg-[#111] max-h-44 overflow-y-auto">
                        {endSuggestions.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setForm(p => ({ ...p, endLocation: item.place_name }));
                              setEndCoords({ lat: Number(item.center[1]), lng: Number(item.center[0]) });
                              setEndSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-white/75 hover:bg-white/10 transition-colors"
                          >
                            {item.place_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <RoutePreviewMap className="h-44 rounded-2xl overflow-hidden border border-white/10" start={startCoords} end={endCoords} />
                {startCoords && (
                  <div className="px-3 py-2 bg-black/70 backdrop-blur-sm rounded-xl border border-white/10">
                    <p className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                      <MapPin size={11} className="text-emerald-400"/>
                      {form.meetupPoint} ({startCoords.lat.toFixed(5)}, {startCoords.lng.toFixed(5)})
                    </p>
                  </div>
                )}
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* CAPACITY & PRICING */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Capacity & Pricing" section="capacity" icon={Users}/>
              <AnimatePresence>{sections.capacity&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Max Participants</label><div className="flex items-center gap-2"><button type="button" onClick={()=>setForm(p=>({...p,maxParticipants:Math.max(1,p.maxParticipants-1)}))} className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center text-lg font-bold">−</button><input type="number" min={1} value={form.maxParticipants} onChange={e=>setForm(p=>({...p,maxParticipants:Math.max(1,parseInt(e.target.value)||1)}))} className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2 text-sm font-bold text-white text-center focus:outline-none focus:border-white/30"/><button type="button" onClick={()=>setForm(p=>({...p,maxParticipants:p.maxParticipants+1}))} className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center text-lg font-bold">+</button></div></div>
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Ticket Price</label><div className="flex gap-2 mb-2"><button type="button" onClick={()=>setForm(p=>({...p,isFree:true,price:''}))} className={cn('flex-1 py-2 rounded-xl text-xs font-semibold border transition-all',form.isFree?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20')}>Free</button><button type="button" onClick={()=>setForm(p=>({...p,isFree:false}))} className={cn('flex-1 py-2 rounded-xl text-xs font-semibold border transition-all',!form.isFree?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20')}>Paid</button></div>{!form.isFree&&(<div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-white/30">₹</span><input type="number" min={1} placeholder="0" value={form.price} onChange={e=>setForm(p=>({...p,price:e.target.value}))} className="w-full pl-8 bg-white/[0.04] border border-white/10 rounded-xl py-2.5 text-sm font-bold text-white focus:outline-none focus:border-white/30"/></div>)}</div>
                </div>
                <div className="flex items-center justify-between py-3 border-t border-white/[0.05]">
                  <div><p className="text-sm font-semibold text-white/80">Require Approval</p><p className="text-[10px] text-white/30">Manually approve joiners before payment</p></div>
                  <button type="button" onClick={()=>setForm(p=>({...p,requireApproval:!p.requireApproval}))} className={cn('relative w-11 h-6 rounded-full transition-all duration-200',form.requireApproval?'bg-white':'bg-white/10 hover:bg-white/15')}><div className={cn('absolute top-1 w-4 h-4 rounded-full transition-all shadow-sm',form.requireApproval?'right-1 bg-black':'left-1 bg-white/40')}/></button>
                </div>
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* ABOUT */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="About the Event" section="about" icon={FileText}/>
              <AnimatePresence>{sections.about&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1"><textarea placeholder="Describe your expedition…" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} className="w-full bg-transparent text-sm font-medium placeholder:text-white/15 focus:outline-none min-h-[120px] resize-none text-white/80 leading-relaxed"/></div></motion.div>)}</AnimatePresence>
            </div>
            {/* PREREQUISITES */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Prerequisites & Terms" section="requirements" icon={Shield}/>
              <AnimatePresence>{sections.requirements&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Prerequisites</label><textarea placeholder="Valid license, own gear…" value={form.prerequisites} onChange={e=>setForm(p=>({...p,prerequisites:e.target.value}))} className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 text-xs font-medium placeholder:text-white/15 focus:outline-none focus:border-white/20 min-h-[90px] resize-none text-white/70 leading-relaxed"/></div>
                <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Terms & Conditions</label><textarea placeholder="No refunds within 24h, helmet mandatory…" value={form.terms} onChange={e=>setForm(p=>({...p,terms:e.target.value}))} className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 text-xs font-medium placeholder:text-white/15 focus:outline-none focus:border-white/20 min-h-[90px] resize-none text-white/70 leading-relaxed"/></div>
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* CONTACT */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Organizer Contact" section="contact" icon={Phone}/>
              <AnimatePresence>{sections.contact&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[{label:'Name',key:'contactName',type:'text',ph:'John Doe'},{label:'Phone',key:'contactPhone',type:'tel',ph:'+91 98765 43210'},{label:'Email',key:'contactEmail',type:'email',ph:'organizer@email.com'}].map(f=>(
                  <div key={f.key}><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">{f.label}</label><input type={f.type} placeholder={f.ph} value={(form as any)[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm font-semibold placeholder:text-white/15 focus:outline-none focus:border-white/30 text-white/90"/></div>
                ))}
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* COUPON GENERATOR */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Coupon Generator" section="coupons" icon={Tag}/>
              <AnimatePresence>{sections.coupons&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Prefix</label><input type="text" value={couponForm.prefix} onChange={e=>setCouponForm(p=>({...p,prefix:e.target.value.toUpperCase()}))} maxLength={8} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm font-mono font-bold text-white focus:outline-none focus:border-white/30"/></div>
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Discount %</label><input type="number" value={couponForm.discount} onChange={e=>setCouponForm(p=>({...p,discount:Math.min(100,Math.max(1,parseInt(e.target.value)||1))}))} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-white/30"/></div>
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Usage Limit</label><input type="number" value={couponForm.limit} onChange={e=>setCouponForm(p=>({...p,limit:Math.max(1,parseInt(e.target.value)||1)}))} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-white/30"/></div>
                  <div><label className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5 block">Expires</label><input type="date" value={couponForm.expiry} onChange={e=>setCouponForm(p=>({...p,expiry:e.target.value}))} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white scheme-dark focus:outline-none focus:border-white/30"/></div>
                </div>
                {couponCode&&(<motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} className="p-3 bg-white/5 border border-white/15 rounded-xl flex items-center justify-between"><span className="font-mono font-bold tracking-widest text-white">{couponCode}</span><button type="button" onClick={()=>navigator.clipboard.writeText(couponCode)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"><Copy size={13}/></button></motion.div>)}
                <div className="flex gap-2">
                  <button type="button" onClick={()=>setCouponCode(generateCouponCode(couponForm.prefix))} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-xs font-semibold text-white/60 hover:text-white hover:border-white/40 bg-white/[0.03] transition-all"><RefreshCw size={12}/> {couponCode?'New Code':'Generate'}</button>
                  {couponCode&&(
                    <button
                      type="button"
                      disabled={couponAttachLoading}
                      onClick={async () => {
                        setCouponAttachLoading(true);
                        try {
                          const res = await fetch(`/api/organizers/${user.id}/coupons`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              code: couponCode,
                              prefix: couponForm.prefix,
                              discount_pct: couponForm.discount,
                              usage_limit: couponForm.limit,
                              expiry_date: couponForm.expiry || null,
                            }),
                          });
                          if (!res.ok) {
                            alert(await readApiErrorMessage(res));
                            return;
                          }
                          const body = await res.json();
                          setCoupons((p) => [
                            {
                              id: String(body.id),
                              code: String(body.code),
                              discount: Number(body.discount_pct ?? couponForm.discount),
                              limit: Number(body.usage_limit ?? couponForm.limit),
                              used: Number(body.used_count ?? 0),
                              expiry: body.expiry_date
                                ? new Date(body.expiry_date).toLocaleDateString("en-IN", {
                                    day: "numeric",
                                    month: "short",
                                  })
                                : "No expiry",
                              active: Boolean(body.active),
                              prefix: String(body.prefix ?? couponForm.prefix),
                            },
                            ...p,
                          ]);
                          setCouponCode("");
                        } catch {
                          alert(
                            "Could not reach the server. Use npm run dev on port 3000 so /api works.",
                          );
                        } finally {
                          setCouponAttachLoading(false);
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 transition-all disabled:opacity-50"
                    >
                      {couponAttachLoading ? "…" : (
                        <>
                          <Check size={12} /> Attach
                        </>
                      )}
                    </button>
                  )}
                </div>
                {coupons.length>0&&(<div className="space-y-2 pt-2 border-t border-white/[0.06]"><p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{coupons.length} coupon{coupons.length>1?'s':''} attached</p>{coupons.map(c=><CouponCard key={c.id} coupon={c} onDelete={async()=>{if(/^\d+$/.test(c.id)){try{await fetch(`/api/organizers/${user.id}/coupons/${c.id}`,{method:'DELETE'});}catch{}}setCoupons(p=>p.filter(x=>x.id!==c.id));}}/>)}</div>)}
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* TRIP TAGS */}
            <div className={cn(cc,'overflow-hidden')}>
              <SH label="Trip Tags" section="tags" icon={Hash}/>
              <AnimatePresence>{sections.tags&&(<motion.div initial={{height:0}} animate={{height:'auto'}} exit={{height:0}} className="overflow-hidden"><div className="px-5 pb-5 pt-1 space-y-4">
                <div className="relative"><select value={activeTagCat} onChange={e=>setActiveTagCat(e.target.value)} className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-xs font-semibold appearance-none focus:outline-none text-white/80">{Object.keys(TRIP_TAGS).map(cat=><option key={cat} value={cat} className="bg-[#111]">{cat}</option>)}</select><ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"/></div>
                <div className="flex flex-wrap gap-1.5">{TRIP_TAGS[activeTagCat].map(tag=><button key={tag} type="button" onClick={()=>toggleTag(tag)} className={cn('px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all',form.selectedTags.includes(tag)?'bg-white text-black border-white':'bg-white/[0.03] border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80')}>{tag}</button>)}</div>
                {form.selectedTags.length>0&&(<div className="pt-3 border-t border-white/[0.06]"><p className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-2">Selected ({form.selectedTags.length})</p><div className="flex flex-wrap gap-1.5">{form.selectedTags.map(tag=><span key={tag} onClick={()=>toggleTag(tag)} className="px-2 py-1 bg-white/[0.06] border border-white/10 rounded-lg text-[9px] font-bold text-white/60 cursor-pointer hover:bg-white/10 flex items-center gap-1">{tag}<X size={9} className="opacity-50"/></span>)}</div></div>)}
              </div></motion.div>)}</AnimatePresence>
            </div>
            {/* PRIVATE INVITES */}
            <AnimatePresence>
              {form.privacy==='Private'&&(
                <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>
                  <div className="bg-amber-500/[0.04] border border-amber-500/20 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between py-3.5 px-5 border-b border-amber-500/10">
                      <div className="flex items-center gap-3"><div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center"><Lock size={13} className="text-amber-400"/></div><span className="text-sm font-bold text-white/80">Private Invite List</span></div>
                      {invites.length>0&&<span className="text-xs font-bold text-amber-400">{invites.length} invite{invites.length>1?'s':''}</span>}
                    </div>
                    <div className="px-5 pb-5 pt-4 space-y-4">
                      <p className="text-xs text-white/40 leading-relaxed">Add participants by phone number or email. They'll receive an exclusive access link.</p>
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-white/30 transition-colors"><Phone size={13} className="text-white/30 flex-shrink-0"/><input type="text" value={inviteInput} onChange={e=>setInviteInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(e.preventDefault(),addInvite())} placeholder="Phone number or email address…" className="flex-1 bg-transparent text-sm font-medium placeholder:text-white/15 focus:outline-none text-white/90"/></div>
                        <button type="button" onClick={addInvite} className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 transition-all">Add</button>
                      </div>
                      {invites.length>0?(<div className="space-y-2">{invites.map((inv,i)=>(<div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl"><div className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center flex-shrink-0">{inv.type==='email'?<Mail size={12} className="text-white/40"/>:<Phone size={12} className="text-white/40"/>}</div><span className="flex-1 text-sm font-medium text-white/80">{inv.value}</span><Badge variant={inv.type==='email'?'default':'warning'}>{inv.type}</Badge><button type="button" onClick={()=>setInvites(p=>p.filter((_,idx)=>idx!==i))} className="w-6 h-6 flex items-center justify-center rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"><X size={11}/></button></div>))}</div>):(
                        <div className="text-center py-6 border border-dashed border-white/10 rounded-2xl"><Users size={22} className="text-white/20 mx-auto mb-2"/><p className="text-xs text-white/30">No invites yet</p></div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {/* SUBMIT */}
            <div className="pt-2 pb-10">
              <button type="submit" disabled={mapLoading} className={cn("w-full py-4 bg-white text-black rounded-2xl font-bold text-base tracking-wide hover:bg-gray-100 active:scale-[0.99] transition-all relative overflow-hidden group shadow-[0_0_40px_rgba(255,255,255,0.08)]", mapLoading && "opacity-60 cursor-not-allowed")}>
                <span className="relative z-10 flex items-center justify-center gap-2"><Sparkles size={16}/> {mapLoading ? "Publishing..." : "Publish Event"}</span>
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-black/5 to-transparent"/>
              </button>
              <p className="text-center text-[10px] text-white/20 mt-3 uppercase tracking-[0.15em]">Event will be reviewed before going live</p>
            </div>
          </div>
          {/* RIGHT COLUMN */}
          <div className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleBanner(f);}}/>
            <div onClick={()=>!bannerPreview&&bannerRef.current?.click()} onDragOver={e=>{e.preventDefault();setIsDragging(true);}} onDragLeave={()=>setIsDragging(false)} onDrop={e=>{e.preventDefault();setIsDragging(false);const f=e.dataTransfer.files[0];if(f)handleBanner(f);}} className={cn('relative aspect-square rounded-3xl border overflow-hidden group shadow-2xl transition-all duration-300',bannerPreview?'cursor-default border-white/15':'cursor-pointer border-dashed hover:border-white/40',isDragging?'border-white/60 scale-[1.01]':'border-white/15')} style={{background:bannerPreview?'transparent':'linear-gradient(145deg, #141414 0%, #0a0a0a 50%, #161616 100%)'}}>
              {bannerPreview?(<>
                <img src={bannerPreview} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30"/>
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-all">
                  <button type="button" onClick={e=>{e.stopPropagation();bannerRef.current?.click();}} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-[11px] font-bold text-white hover:bg-white/20"><Camera size={12}/> Change</button>
                  <button type="button" onClick={e=>{e.stopPropagation();setBannerPreview(null);}} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-[11px] font-bold text-white hover:bg-red-500/20"><Trash2 size={12}/> Remove</button>
                </div>
              </>):(<>
                <div className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{backgroundImage:'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',backgroundSize:'40px 40px'}}/>
                <motion.div animate={{y:isDragging?-8:0,scale:isDragging?1.1:1}} className="absolute inset-0 flex flex-col items-center justify-center gap-5">
                  <div className={cn('w-16 h-16 rounded-2xl border flex items-center justify-center transition-all duration-300',isDragging?'bg-white/15 border-white/40':'bg-white/[0.04] border-white/[0.12]')}>{isDragging?<ImagePlus size={26} className="text-white"/>:<Upload size={24} className="text-white/40"/>}</div>
                  <div className="text-center px-6"><p className={cn('text-sm font-bold mb-1.5',isDragging?'text-white':'text-white/50')}>{isDragging?'Drop image here':'Upload Banner'}</p><p className="text-[11px] text-white/20">Drag & drop or click · PNG, JPG, WEBP</p></div>
                </motion.div>
              </>)}
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between mb-3"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/30 flex items-center gap-1.5"><Image size={12}/> Gallery Images</p><button type="button" onClick={()=>galleryRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-bold text-white/50 hover:text-white hover:border-white/30 bg-white/[0.02] transition-all"><Plus size={11}/> Add Photos</button></div>
              <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>handleGallery(e.target.files)}/>
              {galleryFiles.length>0?(<div className="grid grid-cols-3 gap-2">{galleryFiles.map((g,i)=>(<div key={i} className="relative aspect-square rounded-xl overflow-hidden group"><img src={g.preview} alt="" className="w-full h-full object-cover"/><button type="button" onClick={()=>setGalleryFiles(p=>p.filter((_,idx)=>idx!==i))} className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={10}/></button></div>))}<button type="button" onClick={()=>galleryRef.current?.click()} className="aspect-square rounded-xl border border-dashed border-white/10 hover:border-white/30 flex items-center justify-center text-white/20 hover:text-white/50 transition-all"><Plus size={20}/></button></div>):(
                <div onClick={()=>galleryRef.current?.click()} className="h-24 rounded-xl border border-dashed border-white/10 hover:border-white/30 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"><ImagePlus size={20} className="text-white/20"/><p className="text-[10px] text-white/30">Upload up to 10 photos</p></div>
              )}
            </div>
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">
                Event Preview
              </p>
              <div className="space-y-2 text-xs text-white/50">
                {[
                  ['Name', form.name || '—'],
                  ['Theme', form.theme],
                  ['Date', form.date],
                  ['Capacity', String(form.maxParticipants)],
                  ['Price', form.isFree ? 'Free' : form.price ? `₹${form.price}` : '—'],
                  ['Language', form.language],
                  ['Age Group', form.ageGroup],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span className="font-semibold text-white/80 truncate max-w-[150px]">
                      {v}
                    </span>
                  </div>
                ))}

                {/* Dedicated visibility control */}
                <div className="flex items-center justify-between gap-3">
                  <span>Privacy</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white/80">
                      {form.privacy}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setForm(p => ({
                          ...p,
                          privacy: p.privacy === 'Public' ? 'Private' : 'Public',
                        }))
                      }
                      className="px-2.5 py-1 rounded-full border border-white/15 text-[10px] font-semibold text-white/70 hover:border-white/40 hover:text-white transition-colors"
                    >
                      Set {form.privacy === 'Public' ? 'Private' : 'Public'}
                    </button>
                  </div>
                </div>

                {form.selectedTags.length > 0 && (
                  <div className="flex justify-between">
                    <span>Tags</span>
                    <span className="font-semibold text-white/80">
                      {form.selectedTags.length} selected
                    </span>
                  </div>
                )}
                {invites.length > 0 && (
                  <div className="flex justify-between">
                    <span>Invites</span>
                    <span className="font-semibold text-amber-400">
                      {invites.length} added
                    </span>
                  </div>
                )}
                {coupons.length > 0 && (
                  <div className="flex justify-between">
                    <span>Coupons</span>
                    <span className="font-semibold text-emerald-400">
                      {coupons.length} active
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
};

// ─── GAMIFIED LIVE TRIP SYSTEM ───────────────────────────────
// Phase types: 'waiting' | 'live' | 'ended' | 'post'

type TripPhase = 'waiting' | 'live' | 'ended' | 'post';
type MemberStatus = 'arrived' | 'on-way' | 'absent';
type MemberRole = 'organizer' | 'co-admin' | 'moderator' | 'member';
type ChatMode = 'all' | 'admin-only';
type LiveMember = {
  id: string; name: string; avatar: string; status: MemberStatus;
  role: MemberRole; muted: boolean; blocked: boolean;
  speed: number; distanceCovered: number; checkpoints: number; xpGained: number;
  lat: number; lng: number;
};

type Checkpoint = { id: string; name: string; lat: number; lng: number; reached: boolean; badge: string; xp: number };
type MapPin = { id: string; type: 'parking' | 'fuel' | 'attraction' | 'hazard' | 'road-damage'; lat: number; lng: number; label: string; addedBy: string };
type WeatherAlert = { type: 'rain' | 'wind' | 'fog' | 'clear'; message: string; severity: 'low' | 'medium' | 'high' };

const MOCK_MEMBERS: LiveMember[] = [
  { id:'m1',name:'Arjun Mehta',avatar:'arjun',status:'arrived',role:'organizer',muted:false,blocked:false,speed:0,distanceCovered:0,checkpoints:0,xpGained:0,lat:18.922,lng:72.834 },
  { id:'m2',name:'Priya Sharma',avatar:'priya',status:'arrived',role:'co-admin',muted:false,blocked:false,speed:42,distanceCovered:12.4,checkpoints:2,xpGained:240,lat:18.921,lng:72.832 },
  { id:'m3',name:'Rahul Dev',avatar:'rahul',status:'arrived',role:'member',muted:false,blocked:false,speed:38,distanceCovered:11.8,checkpoints:2,xpGained:220,lat:18.923,lng:72.836 },
  { id:'m4',name:'Sneha Kulkarni',avatar:'sneha',status:'on-way',role:'member',muted:false,blocked:false,speed:55,distanceCovered:8.2,checkpoints:1,xpGained:150,lat:18.918,lng:72.828 },
  { id:'m5',name:'Vikram Nair',avatar:'vikram',status:'arrived',role:'moderator',muted:false,blocked:false,speed:45,distanceCovered:13.1,checkpoints:2,xpGained:260,lat:18.924,lng:72.838 },
  { id:'m6',name:'Kavya Reddy',avatar:'kavya',status:'on-way',role:'member',muted:true,blocked:false,speed:30,distanceCovered:5.6,checkpoints:0,xpGained:80,lat:18.915,lng:72.825 },
  { id:'m7',name:'Aditya Singh',avatar:'aditya',status:'arrived',role:'member',muted:false,blocked:false,speed:48,distanceCovered:14.2,checkpoints:3,xpGained:310,lat:18.925,lng:72.840 },
  { id:'m8',name:'Meera Joshi',avatar:'meera',status:'absent',role:'member',muted:false,blocked:false,speed:0,distanceCovered:0,checkpoints:0,xpGained:0,lat:18.910,lng:72.820 },
];

const MOCK_CHECKPOINTS: Checkpoint[] = [
  { id:'cp1',name:'Gateway Start',lat:18.922,lng:72.834,reached:true,badge:'🚀',xp:50 },
  { id:'cp2',name:'Panvel Toll',lat:18.985,lng:73.112,reached:true,badge:'🛣️',xp:75 },
  { id:'cp3',name:'Khopoli Viewpoint',lat:18.782,lng:73.341,reached:false,badge:'🏔️',xp:100 },
  { id:'cp4',name:'Alibaug Beach',lat:18.641,lng:72.872,reached:false,badge:'🏖️',xp:150 },
];

const MOCK_MAP_PINS: MapPin[] = [
  { id:'p1',type:'parking',lat:18.985,lng:73.112,label:'HP Parking — Panvel',addedBy:'Arjun Mehta' },
  { id:'p2',type:'fuel',lat:18.985,lng:73.115,label:'HP Petrol Pump',addedBy:'Priya Sharma' },
  { id:'p3',type:'attraction',lat:18.782,lng:73.341,label:'Khopoli Viewpoint',addedBy:'Vikram Nair' },
  { id:'p4',type:'road-damage',lat:18.860,lng:73.200,label:'Pothole — Slow down',addedBy:'Rahul Dev' },
];

const WEATHER: WeatherAlert = { type:'clear',message:'Clear skies, 28°C — Perfect riding weather!',severity:'low' };

/** Vertical swipe distance (px) to expand/collapse live bottom sheet */
const LIVE_SHEET_SWIPE_PX = 52;

// Trip stats for post-trip
type TripStats = { distanceCovered: number; duration: string; carbonSaved: number; checkpointsReached: number; totalXP: number; avgSpeed: number };

const LiveTripPage = ({ user }: { user: User }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripLoading, setTripLoading] = useState(true);

  // ─── PHASE STATE ───────────────────────────────────────────
  const [phase, setPhase] = useState<TripPhase>('waiting');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [tripStats, setTripStats] = useState<TripStats>({
    distanceCovered: 87.4, duration: '3h 42m', carbonSaved: 4.2,
    checkpointsReached: 3, totalXP: 1240, avgSpeed: 42,
  });

  // ─── WAITING ROOM STATE ────────────────────────────────────
  const [members, setMembers] = useState<LiveMember[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>('all');
  const [stickersEnabled, setStickersEnabled] = useState(true);
  const [videoCallActive, setVideoCallActive] = useState(false);
  // ─── GROUP COMMS (VOICE) ───────────────────────────────────
  type VoiceMode = "open" | "ptt" | "controlled";
  // Default: staff talk (admin / co-admin / moderator). Members must request to speak.
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("controlled");
  const [pttHeld, setPttHeld] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafSpeakingRef = useRef<number | null>(null);
  const lastSpokeAtRef = useRef<number>(0);
  const [micError, setMicError] = useState<string | null>(null);
  // Zoom-style speaking permissions for controlled mode
  const [speakRequests, setSpeakRequests] = useState<string[]>([]);
  const [approvedSpeakers, setApprovedSpeakers] = useState<string[]>([]);
  const [attendanceTab, setAttendanceTab] = useState<'all' | 'arrived' | 'pending'>('all');

  // ─── LIVE MAP STATE ────────────────────────────────────────
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [showSOS, setShowSOS] = useState(false);
  const [showAddPin, setShowAddPin] = useState(false);
  const [newPinType, setNewPinType] = useState<MapPin['type']>('parking');
  const [newPinLabel, setNewPinLabel] = useState('');
  const [liveTab, setLiveTab] = useState<'members' | 'checkpoints' | 'leaderboard'>('members');
  const [tripPaused, setTripPaused] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mapSelected, setMapSelected] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const liveMapRef = useRef<LiveTripMapRef>(null);
  const [liveMapTheme, setLiveMapTheme] = useState<MapTheme>(() => readLiveMapStoredTheme());
  /** When true, 6:00–19:00 → light map, else dark (until user picks manual theme). */
  const [liveMapThemeAuto, setLiveMapThemeAuto] = useState(true);
  const [myGeo, setMyGeo] = useState<LiveUserGeo | null>(null);
  const lastMapGeoEmitRef = useRef(0);
  const [heatmapLiveOn, setHeatmapLiveOn] = useState(false);
  const [trafficLiveOn, setTrafficLiveOn] = useState(false);
  const [mapBearingHud, setMapBearingHud] = useState(0);
  const didFitConvoyOnLiveRef = useRef(false);
  const [stravaShareLive, setStravaShareLive] = useState(false);
  const [stravaTrackLaps, setStravaTrackLaps] = useState(false);
  /** Peek = map-first driving view; expanded = full convoy controls. */
  const [liveSheetSnap, setLiveSheetSnap] = useState<"peek" | "expanded">("peek");

  const sheetHandlePtr = useRef<{ y: number; pid: number | null }>({ y: 0, pid: null });
  const peekSwipePtr = useRef<{ y: number; pid: number | null }>({ y: 0, pid: null });

  const onSheetHandlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    sheetHandlePtr.current = { y: e.clientY, pid: e.pointerId };
  }, []);

  const onSheetHandlePointerUp = useCallback((e: React.PointerEvent) => {
    if (sheetHandlePtr.current.pid !== e.pointerId) return;
    const dy = e.clientY - sheetHandlePtr.current.y;
    sheetHandlePtr.current.pid = null;
    const thr = LIVE_SHEET_SWIPE_PX;
    if (Math.abs(dy) < thr) {
      setLiveSheetSnap((s) => (s === "peek" ? "expanded" : "peek"));
    } else if (dy < -thr) {
      setLiveSheetSnap("expanded");
    } else if (dy > thr) {
      setLiveSheetSnap("peek");
    }
  }, []);

  const onSheetHandlePointerCancel = useCallback(() => {
    sheetHandlePtr.current.pid = null;
  }, []);

  const onPeekSwipePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    peekSwipePtr.current = { y: e.clientY, pid: e.pointerId };
  }, []);

  const onPeekSwipePointerUp = useCallback((e: React.PointerEvent) => {
    if (peekSwipePtr.current.pid !== e.pointerId) return;
    const dy = e.clientY - peekSwipePtr.current.y;
    peekSwipePtr.current.pid = null;
    if (dy < -LIVE_SHEET_SWIPE_PX) setLiveSheetSnap("expanded");
  }, []);

  const onPeekSwipePointerCancel = useCallback(() => {
    peekSwipePtr.current.pid = null;
  }, []);

  // ─── POST-TRIP STATE ───────────────────────────────────────
  const [postRating, setPostRating] = useState(0);
  const [postReview, setPostReview] = useState('');
  const [postShared, setPostShared] = useState(false);
  const [postSubmitted, setPostSubmitted] = useState(false);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessDenied, setAccessDenied] = useState('');
  const [endingTrip, setEndingTrip] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setTripLoading(true);
        const res = await fetch(`/api/trips/${id}`);
        if (!res.ok) {
          setTrip(null);
          return;
        }
        const raw = await res.json();
        setTrip(normalizeTripFromApi(raw));
      } catch {
        setTrip(null);
      } finally {
        setTripLoading(false);
      }
    })();
  }, [id]);

  /** Keep demo rider dots near this trip’s meetup so the live map matches the route. */
  const snappedMeetupForTripRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || trip?.meetupLat == null || trip?.meetupLng == null) return;
    if (snappedMeetupForTripRef.current === id) return;
    snappedMeetupForTripRef.current = id;
    const lat0 = trip.meetupLat;
    const lng0 = trip.meetupLng;
    setMembers((prev) =>
      prev.map((m, i) => ({
        ...m,
        lat: lat0 + Math.sin(i * 1.3) * 0.01,
        lng: lng0 + Math.cos(i * 1.1) * 0.01,
      })),
    );
  }, [id, trip?.meetupLat, trip?.meetupLng]);

  // ─── GROUP COMMS (LOCAL MIC + SPEAKING DETECTION) ─────────────────────────
  const userName = (user.name ?? "").trim().toLowerCase();
  const userFirst = userName.split(" ")[0] || "";

  // Local member matching:
  // - Prefer explicit member id like "m1"
  // - Fall back to numeric ids like "1" -> "m1"
  // - Finally match by name prefix (mock waiting room uses full names)
  const localMemberById =
    typeof user.id === "string" && /^m\d+$/.test(user.id)
      ? user.id
      : Number.isFinite(Number(user.id))
        ? `m${Number(user.id)}`
        : null;

  const localMember =
    (localMemberById ? members.find((m) => m.id === localMemberById) : null) ??
    (members.find((m) => m.name.trim().toLowerCase() === userName) ??
      members.find((m) => userFirst && m.name.trim().toLowerCase().startsWith(userFirst))) ??
    null;

  const localMemberId = localMember?.id ?? null;
  const localRole = localMember?.role ?? "member";
  // Fallback for real users: organizer profile should be able to switch to Talk All even
  // if the mock waiting-room member matching fails.
  const canModerateVoice =
    localRole === "organizer" ||
    localRole === "co-admin" ||
    localRole === "moderator" ||
    user.role === "organizer";
  const localMuted = localMember?.muted ?? true;
  const localAllowedInControlled =
    voiceMode !== "controlled" ||
    canModerateVoice ||
    (localMemberId ? approvedSpeakers.includes(localMemberId) : false);

  // Start/stop microphone when the voice channel is connected.
  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      try {
        if (rafSpeakingRef.current != null) {
          cancelAnimationFrame(rafSpeakingRef.current);
          rafSpeakingRef.current = null;
        }
        lastSpokeAtRef.current = 0;
        setLocalSpeaking(false);
        setMicError(null);
      } catch {
        // noop
      }

      try {
        micTrackRef.current?.stop();
      } catch {
        // noop
      }
      micTrackRef.current = null;

      try {
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        // noop
      }
      micStreamRef.current = null;

      try {
        if (audioCtxRef.current) {
          audioCtxRef.current.close();
        }
      } catch {
        // noop
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
    };

    if (!videoCallActive) {
      cleanup();
      return;
    }

    // If already connected, don't re-init.
    if (micStreamRef.current) return;

    (async () => {
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        micStreamRef.current = stream;
        micTrackRef.current = stream.getAudioTracks()[0] ?? null;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AudioCtx();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.85;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Float32Array(analyser.fftSize);
        const threshold = 0.02; // local speaking threshold (tune if needed)
        const holdMs = 350;

        const tick = () => {
          const trackEnabled = micTrackRef.current?.enabled ?? false;
          if (!trackEnabled || !analyserRef.current) {
            setLocalSpeaking((prev) => (prev ? false : prev));
            rafSpeakingRef.current = requestAnimationFrame(tick);
            return;
          }

          analyserRef.current.getFloatTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length);

          const now = Date.now();
          if (rms > threshold) lastSpokeAtRef.current = now;
          const speaking = now - lastSpokeAtRef.current <= holdMs;
          setLocalSpeaking((prev) => (prev === speaking ? prev : speaking));

          rafSpeakingRef.current = requestAnimationFrame(tick);
        };

        rafSpeakingRef.current = requestAnimationFrame(tick);
      } catch (e) {
        console.error("Mic permission / setup failed:", e);
        if (!cancelled) {
          setMicError("Microphone access failed. Please allow mic permission and try Join again.");
          setVideoCallActive(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoCallActive]);

  // Enable/disable the local mic track depending on mode + mute + permissions.
  useEffect(() => {
    const track = micTrackRef.current;
    if (!track) return;

    if (!videoCallActive) {
      track.enabled = false;
      setLocalSpeaking(false);
      return;
    }

    const allowed = localAllowedInControlled;
    const shouldEnable =
      allowed &&
      !localMuted &&
      (voiceMode !== "ptt" ? true : pttHeld);

    track.enabled = shouldEnable;
    if (!shouldEnable) setLocalSpeaking(false);
  }, [videoCallActive, voiceMode, pttHeld, localAllowedInControlled, localMuted]);

  // When switching comm scope:
  // - controlled (staff talk): staff unmuted, members muted unless explicitly approved
  // - open (all talk): everyone unmuted, clear requests/approvals
  useEffect(() => {
    if (!videoCallActive) return;

    setSpeakRequests([]);
    setApprovedSpeakers([]);
    setPttHeld(false);
    setLocalSpeaking(false);

    setMembers((prev) =>
      prev.map((m) => {
        const isStaff = m.role === "organizer" || m.role === "co-admin" || m.role === "moderator";
        if (voiceMode === "controlled") {
          return isStaff ? { ...m, muted: false } : { ...m, muted: true };
        }
        // open mode
        return { ...m, muted: false };
      }),
    );
  }, [voiceMode, videoCallActive]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setAccessChecking(true);
        const res = await fetch(`/api/trips/${id}/live-access?user_id=${encodeURIComponent(user.id)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.allowed !== true) {
          setAccessDenied(body.error || "You do not have permission to access this trip live room.");
          return;
        }
        setAccessDenied('');
      } catch {
        setAccessDenied('Could not validate live access right now.');
      } finally {
        setAccessChecking(false);
      }
    })();
  }, [id, user.id]);

  useEffect(() => {
    if (!id || accessDenied) return;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${id}/live-state?user_id=${encodeURIComponent(user.id)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const serverMembers = Array.isArray(body.members) ? body.members : [];
        const serverCheckpoints = Array.isArray(body.checkpoints) ? body.checkpoints : [];
        const serverPins = Array.isArray(body.mapPins) ? body.mapPins : [];
        if (serverMembers.length > 0) setMembers(serverMembers);
        setCheckpoints(serverCheckpoints);
        setMapPins(serverPins);
      } catch {
        // Keep UI stable; real-time sockets can still populate movement.
      }
    })();
  }, [id, user.id, accessDenied]);


  // Timer for live phase
  useEffect(() => {
    if (phase !== 'live' || tripPaused) return;
    const t = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase, tripPaused]);

  const formatTime = (s: number) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  /** Strava-style clock (mm:ss or h:mm:ss). */
  const formatElapsedStrava = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const formatPaceMinPerKm = (elapsedSec: number, distKm: number) => {
    if (distKm < 0.01) return '--:--';
    const secPerKm = elapsedSec / distKm;
    const m = Math.floor(secPerKm / 60);
    const s = Math.floor(secPerKm % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const arrivedCount = members.filter(m => m.status === 'arrived').length;
  const totalCount = members.length;
  const myDistanceKm = localMember?.distanceCovered ?? 0;

  const toggleMute = (id: string) => setMembers(p => p.map(m => m.id === id ? { ...m, muted: !m.muted } : m));
  const toggleMuteWithVoiceRules = (targetId: string) => {
    if (!localMemberId) {
      toggleMute(targetId);
      return;
    }
    const isSelf = targetId === localMemberId;
    // In controlled mode, only allowed speakers can unmute themselves.
    if (voiceMode === "controlled" && isSelf && localMuted && !localAllowedInControlled) return;
    // In any mode, only moderators can mute/unmute other users.
    if (!canModerateVoice && !isSelf) return;
    toggleMute(targetId);
  };

  // Zoom-style "raise hand" for controlled (staff talk) mode.
  const requestToSpeak = () => {
    if (!localMemberId) return;
    // If already approved or already requested, ignore.
    if (localAllowedInControlled) return;
    setSpeakRequests((prev) => (prev.includes(localMemberId) ? prev : [...prev, localMemberId]));
    // Keep them muted until staff approves.
    setMembers((prev) =>
      prev.map((m) => (m.id === localMemberId ? { ...m, muted: true } : m)),
    );
  };

  const allowSpeaker = (targetId: string) => {
    setApprovedSpeakers((prev) =>
      prev.includes(targetId) ? prev : [...prev, targetId],
    );
    setSpeakRequests((prev) => prev.filter((id) => id !== targetId));
    setMembers((prev) => prev.map((m) => (m.id === targetId ? { ...m, muted: false } : m)));
  };

  const denySpeaker = (targetId: string) => {
    setApprovedSpeakers((prev) => prev.filter((id) => id !== targetId));
    setSpeakRequests((prev) => prev.filter((id) => id !== targetId));
    setMembers((prev) => prev.map((m) => (m.id === targetId ? { ...m, muted: true } : m)));
  };
  const toggleBlock = (id: string) => setMembers(p => p.map(m => m.id === id ? { ...m, blocked: !m.blocked } : m));
  const assignRole = (id: string, role: MemberRole) => setMembers(p => p.map(m => m.id === id ? { ...m, role } : m));

  // Realtime socket integration for live location updates.
  useEffect(() => {
    if (!id) return;
    const socket = io("/", {
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 500,
    });
    socketRef.current = socket;
    socket.emit("join-trip", Number(id));

    socket.on("location-updated", (payload: { userId: number; lat: number; lng: number; speed?: number }) => {
      setMembers(prev =>
        prev.map(m =>
          Number(m.id.replace("m", "")) === payload.userId
            ? {
                ...m,
                lat: payload.lat,
                lng: payload.lng,
                speed: payload.speed ?? m.speed,
              }
            : m
        )
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    if (!id || phase !== "live") return;
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        socketRef.current?.emit("update-location", {
          tripId: Number(id),
          userId: Number(user.id),
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          recordedAt: new Date(position.timestamp).toISOString(),
        });
        const now = Date.now();
        if (now - lastMapGeoEmitRef.current >= 1000) {
          lastMapGeoEmitRef.current = now;
          let h = position.coords.heading;
          if (h != null && !Number.isNaN(h) && h < 0) h = h + 360;
          setMyGeo({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: position.coords.accuracy ?? undefined,
            headingDeg: h ?? null,
            speedMps: position.coords.speed ?? null,
          });
        }
      },
      () => {
        // silently ignore permission/position errors
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [id, phase, user.id]);

  useEffect(() => {
    if (!liveMapThemeAuto || phase !== "live") return;
    const apply = () => {
      const h = new Date().getHours();
      const light = h >= 6 && h < 19;
      setLiveMapTheme(light ? "light" : "dark");
    };
    apply();
    const t = window.setInterval(apply, 60_000);
    return () => clearInterval(t);
  }, [liveMapThemeAuto, phase]);

  useEffect(() => {
    if (phase !== "live") {
      didFitConvoyOnLiveRef.current = false;
      return;
    }
    if (didFitConvoyOnLiveRef.current) return;
    const timer = window.setTimeout(() => {
      liveMapRef.current?.fitConvoy();
      didFitConvoyOnLiveRef.current = true;
    }, 900);
    return () => clearTimeout(timer);
  }, [phase, id]);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = window.setInterval(() => {
      setMapBearingHud(liveMapRef.current?.getBearing() ?? 0);
    }, 400);
    return () => clearInterval(timer);
  }, [phase]);

  const addPin = async () => {
    if (!id || !newPinLabel.trim()) return;
    const lat = localMember?.lat ?? trip?.meetupLat ?? 0;
    const lng = localMember?.lng ?? trip?.meetupLng ?? 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      alert("Current location unavailable. Move the convoy or allow location first.");
      return;
    }
    try {
      const res = await fetch(`/api/trips/${id}/map-pins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(user.id),
          type: newPinType,
          label: newPinLabel.trim(),
          lat,
          lng,
          added_by: user.name,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || "Failed to add map pin");
        return;
      }
      const pin: MapPin = {
        id: String(body.id ?? Date.now()),
        type: body.type ?? newPinType,
        lat: Number(body.lat ?? lat),
        lng: Number(body.lng ?? lng),
        label: String(body.label ?? newPinLabel.trim()),
        addedBy: String(body.addedBy ?? user.name),
      };
      setMapPins((p) => [...p, pin]);
      setNewPinLabel('');
      setShowAddPin(false);
    } catch {
      alert("Failed to add map pin");
    }
  };

  const endTrip = async () => {
    if (!id) return;
    setEndingTrip(true);
    try {
      const res = await fetch(`/api/trips/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          user_id: Number(user.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || "Unable to end trip");
        return;
      }
      setPhase('ended');
      setTimeout(() => setPhase('post'), 2800);
    } finally {
      setEndingTrip(false);
    }
  };

  const submitPostTripReview = async () => {
    if (!id) return;
    if (!postRating || !postReview.trim()) {
      alert("Please provide a rating and review.");
      return;
    }
    try {
      const res = await fetch(`/api/trips/${id}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(user.id),
          rating: postRating,
          text: postReview.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || "Failed to submit review");
        return;
      }
      setPostSubmitted(true);
    } catch {
      alert("Failed to submit review");
    }
  };
  if (accessChecking) return (
    <div className="min-h-dvh bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4"/>
        <p className="text-white/40">Checking trip permissions...</p>
      </div>
    </div>
  );

  if (tripLoading || !trip) return (
    <div className="min-h-dvh bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4"/>
        <p className="text-white/40">{tripLoading ? "Loading trip..." : "Trip not found"}</p>
      </div>
    </div>
  );

  if (accessDenied) return (
    <div className="min-h-dvh bg-black text-white flex items-center justify-center px-4">
      <Card className="p-6 max-w-md text-center">
        <AlertTriangle size={22} className="text-amber-400 mx-auto mb-3"/>
        <p className="font-semibold mb-2">Live access denied</p>
        <p className="text-sm text-white/50 mb-4">{accessDenied}</p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => navigate(`/trip/${id}`)}>Go to Trip</Button>
          <Button variant="outline" onClick={() => navigate(user.role === 'organizer' ? '/organizer' : '/dashboard')}>Back</Button>
        </div>
      </Card>
    </div>
  );


  const roleColor = (role: MemberRole) => ({
    organizer: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    'co-admin': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    moderator: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    member: 'text-white/40 bg-white/[0.04] border-white/[0.08]',
  }[role]);

  const pinIcon = (type: MapPin['type']) => ({
    parking:'🅿️', fuel:'⛽', attraction:'📸', hazard:'⚠️', 'road-damage':'🚧',
  }[type]);

  const sortedLeaderboard = [...members].filter(m => m.status !== 'absent').sort((a,b) => b.distanceCovered - a.distanceCovered);

  // ─── EXIT GUARD ────────────────────────────────────────────
  if (showExitConfirm) return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      <motion.div initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} className="bg-[#111] border border-white/15 rounded-3xl p-8 max-w-sm w-full mx-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5"><AlertTriangle size={28} className="text-red-400"/></div>
        <h2 className="text-xl font-bold mb-2">Exit Trip Mode?</h2>
        <p className="text-white/40 text-sm mb-6">You're in an active trip. You can only exit by pausing or ending the trip.</p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setTripPaused(true);
              setShowExitConfirm(false);
            }}
            className="flex-1 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold text-sm hover:bg-amber-500/20 transition-all"
          >
            Pause Trip
          </button>
          <button
            onClick={endTrip}
            disabled={endingTrip}
            className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-sm hover:bg-red-500/20 transition-all"
          >
            {endingTrip ? 'Ending...' : 'End Trip'}
          </button>
        </div>
        <button
          onClick={() => {
            setShowExitConfirm(false);
          }}
          className="mt-3 w-full py-2 text-sm text-white/30 hover:text-white transition-colors"
        >
          Stay in Trip
        </button>
      </motion.div>
    </div>
  );

  // ─── ENDED TRANSITION ──────────────────────────────────────
  if (phase === 'ended') return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="text-center">
        <motion.div initial={{scale:0}} animate={{scale:[0,1.2,1]}} transition={{duration:0.6,times:[0,0.7,1]}}
          className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={44} className="text-emerald-400"/>
        </motion.div>
        <motion.h1 initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{delay:0.4}} className="text-4xl font-bold mb-2">Trip Complete!</motion.h1>
        <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.7}} className="text-white/40">Generating your trip summary…</motion.p>
        <motion.div initial={{width:0}} animate={{width:'100%'}} transition={{delay:0.8,duration:1.8}} className="h-0.5 bg-emerald-400/60 mt-8 mx-auto max-w-xs rounded-full"/>
      </div>
    </div>
  );

  // ─── POST-TRIP ─────────────────────────────────────────────
  if (phase === 'post') return (
    <div className="min-h-dvh bg-black text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs font-bold text-emerald-400 mb-4">
            <CheckCircle size={12}/> Trip Completed · {new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short'})}
          </div>
          <h1 className="text-3xl font-bold mb-1">{trip.name}</h1>
          <p className="text-white/40 text-sm">Thanks for riding with NOMAD! Here's your trip recap.</p>
        </motion.div>

        {/* XP Gained Banner */}
        <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} transition={{delay:0.1}}
          className="bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent border border-amber-500/20 rounded-2xl p-5 mb-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <Trophy size={26} className="text-amber-400"/>
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/60 mb-1">XP Earned This Trip</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-amber-400">+{tripStats.totalXP}</span>
              <span className="text-white/40 text-sm pb-1">XP</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-white/30">New Level</p>
            <p className="text-2xl font-bold text-white">Lvl {(user.level||0)+1}</p>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.2}}
          className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          {[
            { icon:'📍',label:'Distance',value:`${tripStats.distanceCovered} km` },
            { icon:'⏱️',label:'Duration',value:tripStats.duration },
            { icon:'🏁',label:'Checkpoints',value:`${tripStats.checkpointsReached}/${Math.max(checkpoints.length, 1)}` },
            { icon:'⚡',label:'Avg Speed',value:`${tripStats.avgSpeed} km/h` },
            { icon:'🌿',label:'Carbon Saved',value:`${tripStats.carbonSaved} kg CO₂` },
            { icon:'👥',label:'Riders',value:`${arrivedCount} joined` },
          ].map(s => (
            <div key={s.label} className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
              <div className="text-2xl mb-2">{s.icon}</div>
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider mt-0.5">{s.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Badges Earned */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.25}}
          className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-3">Badges Earned</p>
          <div className="flex gap-3 flex-wrap">
            {checkpoints.filter(cp => cp.reached).map(cp => (
              <div key={cp.id} className="flex flex-col items-center gap-1.5 p-3 bg-white/[0.04] border border-white/10 rounded-xl min-w-[60px]">
                <span className="text-2xl">{cp.badge}</span>
                <p className="text-[9px] font-bold text-white/50 text-center leading-tight">{cp.name}</p>
                <span className="text-[9px] font-bold text-amber-400">+{cp.xp} XP</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-1.5 p-3 bg-emerald-500/[0.08] border border-emerald-500/15 rounded-xl min-w-[60px]">
              <span className="text-2xl">🌿</span>
              <p className="text-[9px] font-bold text-emerald-400 text-center leading-tight">Eco Rider</p>
              <span className="text-[9px] font-bold text-emerald-400">+50 XP</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 p-3 bg-blue-500/[0.08] border border-blue-500/15 rounded-xl min-w-[60px]">
              <span className="text-2xl">👥</span>
              <p className="text-[9px] font-bold text-blue-400 text-center leading-tight">Team Player</p>
              <span className="text-[9px] font-bold text-blue-400">+75 XP</span>
            </div>
          </div>
        </motion.div>

        {/* Leaderboard Recap */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.3}}
          className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-3">Final Leaderboard</p>
          <div className="space-y-2">
            {sortedLeaderboard.slice(0,5).map((m,i) => (
              <div key={m.id} className={cn('flex items-center gap-3 p-3 rounded-xl border transition-all', i===0?'bg-amber-500/[0.08] border-amber-500/20':i===1?'bg-white/[0.04] border-white/10':i===2?'bg-orange-500/[0.06] border-orange-500/15':'bg-white/[0.02] border-white/[0.05]')}>
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0', i===0?'bg-amber-500/20 text-amber-400':i===1?'bg-white/10 text-white/60':i===2?'bg-orange-500/15 text-orange-400':'bg-white/5 text-white/30')}>{i+1}</div>
                <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-white/10">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${m.avatar}`} alt="" className="w-full h-full object-cover"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{m.name}{m.id==='m1'?' (You)':''}</p>
                  <p className="text-[10px] text-white/30">{m.distanceCovered.toFixed(1)} km · {m.checkpoints} checkpoints</p>
                </div>
                <span className="text-sm font-bold text-amber-400">+{m.xpGained} XP</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Rate & Review */}
        {!postSubmitted ? (
          <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.35}}
            className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 mb-4">
            <p className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">Rate This Trip</p>
            <div className="flex gap-2 mb-4">
              {[1,2,3,4,5].map(s => (
                <button key={s} onClick={() => setPostRating(s)}
                  className={cn('flex-1 py-3 rounded-xl border text-xl transition-all',
                    s <= postRating ? 'bg-amber-500/15 border-amber-500/30' : 'bg-white/[0.03] border-white/10 hover:border-amber-500/20')}>
                  ⭐
                </button>
              ))}
            </div>
            <textarea
              value={postReview}
              onChange={e => setPostReview(e.target.value)}
              placeholder="Share your experience — what made this trip special?"
              className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-sm text-white placeholder:text-white/15 focus:outline-none focus:border-white/20 resize-none min-h-[90px] mb-4"
            />
            <Button className="w-full flex items-center justify-center gap-2" onClick={submitPostTripReview}>
              <Send size={14}/> Submit Review
            </Button>
          </motion.div>
        ) : (
          <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}}
            className="bg-emerald-500/[0.08] border border-emerald-500/20 rounded-2xl p-5 mb-4 text-center">
            <CheckCircle size={24} className="text-emerald-400 mx-auto mb-2"/>
            <p className="font-bold text-emerald-400">Review Submitted!</p>
            <p className="text-xs text-white/40 mt-1">+25 XP for your contribution</p>
          </motion.div>
        )}

        {/* Share */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.4}} className="mb-6">
          {!postShared ? (
            <button onClick={() => setPostShared(true)}
              className="w-full py-3.5 rounded-2xl border border-white/15 text-sm font-bold text-white/60 hover:text-white hover:border-white/30 flex items-center justify-center gap-2 transition-all">
              <Share2 size={15}/> Share Your Trip Story
            </button>
          ) : (
            <div className="bg-blue-500/[0.08] border border-blue-500/20 rounded-2xl p-4 text-center">
              <p className="text-sm font-bold text-blue-400 flex items-center justify-center gap-2"><Share2 size={14}/> Shared to your profile!</p>
              <p className="text-[11px] text-white/30 mt-1">Your friends can now see your epic {trip.name} journey</p>
            </div>
          )}
        </motion.div>

        {/* Actions */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            className="flex-1 min-h-12 touch-manipulation"
            onClick={() => navigate(user.role === "organizer" ? "/organizer" : "/dashboard")}
          >
            {user.role === "organizer" ? "Organizer dashboard" : "Go to Dashboard"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 min-h-12 touch-manipulation"
            onClick={() => navigate(user.role === "organizer" ? "/organizer" : "/explore")}
          >
            {user.role === "organizer" ? "Manage events" : "Find Next Trip"}
          </Button>
        </div>
      </div>
    </div>
  );

  // ─── WAITING ROOM ──────────────────────────────────────────
  if (phase === 'waiting') return (
    <div className="fixed inset-0 bg-black text-white overflow-y-auto flex flex-col safe-pt safe-pb safe-px">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5 sm:py-3.5 bg-black/90 backdrop-blur-xl border-b border-white/[0.07] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"/>
          <span className="text-sm font-bold">Waiting Room</span>
          <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-[10px] font-bold text-amber-400">PRE-TRIP</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40">{arrivedCount}/{totalCount} at meetup</span>
          <button onClick={() => setShowExitConfirm(true)} className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/40 hover:text-red-400 hover:border-red-500/20 transition-all">
            <X size={14}/>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* LEFT: Trip Info + Controls */}
        <div className="w-full lg:w-80 border-r border-white/[0.06] flex flex-col flex-shrink-0">
          {/* Trip Banner */}
          <div className="relative h-36 flex-shrink-0 overflow-hidden">
            <img src={`https://picsum.photos/seed/${trip.banner}/800/300`} alt="" className="w-full h-full object-cover opacity-50" referrerPolicy="no-referrer"/>
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"/>
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">{trip.theme}</p>
              <h2 className="font-bold text-white text-sm leading-tight">{trip.name}</h2>
              <p className="text-[11px] text-white/50 mt-0.5 flex items-center gap-1"><MapPin size={10}/>{trip.meetupPoint}</p>
            </div>
          </div>

          {/* Organizer Controls */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/20">Organizer Controls</p>
            
            {/* Group Comms (Voice Channel) */}
            <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1">Group Comms</p>
                  <p className="text-[11px] text-white/55">
                    {members.filter((m) => m.status !== "absent").length} members active
                  </p>
                </div>
                <div
                  className={cn(
                    "px-2 py-1 rounded-lg border text-[10px] font-bold whitespace-nowrap",
                    videoCallActive
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-white/[0.03] border-white/10 text-white/50",
                  )}
                >
                  {videoCallActive ? "Voice Connected" : "Not Connected"}
                </div>
              </div>
              {micError && (
                <p className="text-[10px] text-red-400 leading-tight">
                  {micError}
                </p>
              )}

              {/* Mode selector: staff talk vs open talk */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!canModerateVoice}
                  onClick={() => setVoiceMode("open")}
                  className={cn(
                    "py-2 rounded-xl border text-[10px] font-bold transition-all touch-manipulation",
                    voiceMode === "open"
                      ? "bg-white text-black border-white"
                      : "bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/[0.06] hover:border-white/20",
                    !canModerateVoice && "opacity-40 cursor-not-allowed",
                  )}
                >
                  Talk All
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceMode("controlled")}
                  className={cn(
                    "py-2 rounded-xl border text-[10px] font-bold transition-all touch-manipulation",
                    voiceMode === "controlled"
                      ? "bg-white text-black border-white"
                      : "bg-white/[0.03] border-white/10 text-white/50 hover:bg-white/[0.06] hover:border-white/20",
                  )}
                >
                  Staff Talk
                </button>
              </div>

              {/* Join / Disconnect */}
              <div className="flex items-center gap-2">
                {!videoCallActive ? (
                  <button
                    type="button"
                    onClick={() => setVideoCallActive(true)}
                    className="flex-1 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/20 transition-all touch-manipulation"
                  >
                    Join Voice Channel
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPttHeld(false);
                        setVideoCallActive(false);
                      }}
                      className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/10 text-white/70 text-xs font-bold hover:bg-white/10 transition-all touch-manipulation"
                    >
                      Disconnect
                    </button>
                    <button
                      type="button"
                      disabled={localMuted && !localAllowedInControlled}
                      onClick={() => {
                        if (localMuted && !localAllowedInControlled) return;
                        if (!localMemberId) return;
                        setMembers((prev) =>
                          prev.map((mm) =>
                            mm.id === localMemberId ? { ...mm, muted: !mm.muted } : mm,
                          ),
                        );
                      }}
                      className={cn(
                        "py-3 px-3 rounded-xl border text-xs font-bold touch-manipulation",
                        localMuted
                          ? "bg-white/[0.04] border-white/10 text-white/70 hover:border-white/20 disabled:opacity-40 disabled:hover:border-white/10"
                          : "bg-red-500/10 border-red-500/20 text-red-300 hover:bg-red-500/20 disabled:opacity-40 disabled:hover:bg-red-500/10",
                      )}
                    >
                      {localMuted ? "Unmute" : "Mute"}
                    </button>
                  </>
                )}
              </div>

              {/* Raise hand / Requests (Zoom style) in Staff Talk mode */}
              {videoCallActive && voiceMode === "controlled" && (
                <>
                  {!canModerateVoice ? (
                    localMemberId ? (
                      <button
                        type="button"
                        disabled={localAllowedInControlled || speakRequests.includes(localMemberId)}
                        onClick={requestToSpeak}
                        className={cn(
                          "w-full py-3 rounded-xl border text-xs font-bold touch-manipulation transition-all",
                          localAllowedInControlled
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                            : speakRequests.includes(localMemberId)
                              ? "bg-white/[0.03] border-white/10 text-white/50 cursor-not-allowed"
                              : "bg-black/40 border-white/15 text-white/70 hover:border-white/25",
                        )}
                      >
                        {localAllowedInControlled
                          ? "Approved to speak"
                          : speakRequests.includes(localMemberId)
                            ? "Request Sent"
                            : "Raise Hand (Request to Speak)"}
                      </button>
                    ) : null
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                        Speak Requests
                      </p>
                      {speakRequests.length === 0 ? (
                        <div className="py-4 text-center text-[10px] text-white/35 border border-white/10 rounded-xl bg-white/[0.02]">
                          No requests yet
                        </div>
                      ) : (
                        <div className="max-h-[150px] overflow-y-auto space-y-2">
                          {speakRequests.map((rid) => {
                            const rm = members.find((m) => m.id === rid);
                            if (!rm) return null;
                            return (
                              <div
                                key={rid}
                                className="flex items-center gap-2 p-2 rounded-xl border border-white/10 bg-white/[0.02]"
                              >
                                <div className="w-9 h-9 rounded-xl overflow-hidden bg-white/10 border border-white/10 flex-shrink-0">
                                  <img
                                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${rm.avatar}`}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold truncate">{rm.name}</p>
                                  <p className="text-[9px] text-white/30">Requested to speak</p>
                                </div>
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => allowSpeaker(rid)}
                                    className="px-2 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-bold touch-manipulation"
                                  >
                                    Allow
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => denySpeaker(rid)}
                                    className="px-2 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[10px] font-bold touch-manipulation"
                                  >
                                    Deny
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Push-to-talk control */}
              {videoCallActive && voiceMode === "ptt" && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    if (localMuted) return;
                    setPttHeld(true);
                  }}
                  onPointerUp={() => setPttHeld(false)}
                  onPointerCancel={() => setPttHeld(false)}
                  disabled={localMuted || (localMuted && !localAllowedInControlled)}
                  className={cn(
                    "w-full py-3 rounded-xl border text-xs font-bold touch-manipulation transition-all",
                    localMuted
                      ? "bg-white/[0.03] border-white/10 text-white/40 disabled:opacity-40"
                      : "bg-black/40 border-white/15 text-white/70 hover:border-white/25 active:opacity-90",
                  )}
                >
                  {pttHeld ? "Speaking..." : "Hold to Talk"}
                </button>
              )}

              {/* Participant cards */}
              <div className="max-h-[240px] overflow-y-auto pr-1 space-y-2">
                {members
                  .filter((m) => m.status !== "absent")
                  .map((m) => {
                    const isLocal = localMemberId && m.id === localMemberId;
                    const isSpeaking = !!isLocal && localSpeaking && !m.muted && videoCallActive;
                    const isStaffMember =
                      m.role === "organizer" || m.role === "co-admin" || m.role === "moderator";
                    const requested =
                      voiceMode === "controlled" &&
                      !isStaffMember &&
                      speakRequests.includes(m.id);
                    const micLabel = isSpeaking ? "Speaking" : requested ? "Requested" : m.muted ? "Muted" : "Idle";
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-2xl border backdrop-blur-sm",
                          isSpeaking
                            ? "bg-emerald-500/10 border-emerald-500/25 shadow-[0_0_30px_rgba(16,185,129,0.18)]"
                            : "bg-white/[0.03] border-white/10",
                        )}
                      >
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/10 border border-white/10 flex-shrink-0">
                          <img
                            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${m.avatar}`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-bold truncate">{m.name}</p>
                            <span
                              className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
                                roleColor(m.role),
                              )}
                            >
                              {m.role}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className={cn(
                                "text-[9px] font-bold",
                                isSpeaking ? "text-emerald-300" : m.muted ? "text-white/40" : "text-white/40",
                              )}
                            >
                              {isSpeaking ? "🎙️" : m.muted ? "🔇" : "●"} {micLabel}
                            </span>
                            {isLocal && (
                              <span className="text-[9px] text-white/25 ml-auto whitespace-nowrap">
                                {voiceMode === "controlled" ? "Staff Talk" : "All Talk"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {videoCallActive && voiceMode === "controlled" && (
                <p className="text-[10px] text-white/35">
                  Staff Talk: only Admin / Co-Admin / Moderator (and approved speakers) can speak. Others can Raise Hand.
                </p>
              )}
            </div>

            {/* Checkpoints Preview */}
            <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl">
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Checkpoints ({checkpoints.length})</p>
              <div className="space-y-1.5">
                {checkpoints.map((cp, i) => (
                  <div key={cp.id} className="flex items-center gap-2">
                    <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 border', cp.reached ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-white/[0.04] border-white/10')}>{i+1}</div>
                    <span className="text-xs text-white/60 flex-1 truncate">{cp.name}</span>
                    <span className="text-[9px] text-amber-400 font-bold">+{cp.xp}XP</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Begin Journey Button */}
          <div className="p-4 border-t border-white/[0.06] flex-shrink-0">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setPhase('live')}
              className="w-full py-4 bg-white text-black rounded-2xl font-bold text-base flex items-center justify-center gap-2 hover:bg-white/90 transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)]">
              <Navigation size={18}/> Begin Journey
            </motion.button>
            <p className="text-center text-[10px] text-white/20 mt-2">{arrivedCount}/{totalCount} members ready</p>
          </div>
        </div>

        {/* RIGHT: Member List */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Attendance Tabs */}
          <div className="flex items-center gap-1 px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
            {(['all','arrived','pending'] as const).map(tab => (
              <button key={tab} onClick={() => setAttendanceTab(tab)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize',
                  attendanceTab===tab ? 'bg-white text-black' : 'text-white/40 hover:text-white hover:bg-white/5')}>
                {tab} {tab==='arrived' ? `(${arrivedCount})` : tab==='pending' ? `(${members.filter(m=>m.status==='on-way').length})` : `(${totalCount})`}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"/>
              <span className="text-[10px] font-bold text-emerald-400">{arrivedCount} LIVE</span>
            </div>
          </div>

          {/* Members Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {members.filter(m =>
                attendanceTab === 'all' ? true :
                attendanceTab === 'arrived' ? m.status === 'arrived' :
                m.status !== 'arrived'
              ).map(member => (
                <motion.div key={member.id} layout
                  className={cn(
                    'p-4 rounded-2xl border transition-all',
                    videoCallActive &&
                      localMemberId &&
                      member.id === localMemberId &&
                      localSpeaking &&
                      !member.muted
                      ? 'border-emerald-400/60 bg-emerald-500/[0.05] shadow-[0_0_30px_rgba(16,185,129,0.18)]'
                      : null,
                    member.blocked
                      ? 'opacity-40 border-red-500/20 bg-red-500/[0.03]'
                      : member.status === 'arrived'
                        ? 'bg-white/[0.03] border-white/10'
                        : member.status === 'on-way'
                          ? 'bg-amber-500/[0.03] border-amber-500/15'
                          : 'bg-white/[0.02] border-white/[0.05] opacity-50',
                  )}>
                  <div className="flex items-start gap-3">
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/10">
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${member.avatar}`} alt="" className="w-full h-full object-cover"/>
                      </div>
                      <div className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-black',
                        member.status === 'arrived' ? 'bg-emerald-400' :
                        member.status === 'on-way' ? 'bg-amber-400' : 'bg-white/20')}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-bold truncate">{member.name}</p>
                      {videoCallActive &&
                      localMemberId &&
                      member.id === localMemberId &&
                      localSpeaking &&
                      !member.muted ? (
                        <span className="text-[9px] text-emerald-400">🎙️</span>
                      ) : videoCallActive ? (
                        member.muted ? (
                          <span className="text-[9px] text-red-400">🔇</span>
                        ) : (
                          <span className="text-[9px] text-white/25">●</span>
                        )
                      ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded-full border capitalize",
                          roleColor(member.role),
                        )}
                      >
                        {member.role === "organizer"
                          ? "Admin"
                          : member.role === "co-admin"
                            ? "Co-Admin"
                            : member.role === "moderator"
                              ? "Moderator"
                              : "Member"}
                      </span>
                        <span className={cn('text-[9px] font-bold text-white/30 capitalize')}>
                          {member.status === 'arrived' ? '✓ Arrived' : member.status === 'on-way' ? '→ On Way' : '✗ Absent'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Voice Actions (mobile-friendly) */}
                  {(canModerateVoice || (localMemberId && member.id === localMemberId)) && (
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      <button
                        onClick={() => toggleMuteWithVoiceRules(member.id)}
                        className={cn(
                          "flex-1 py-1 rounded-lg text-[9px] font-bold border transition-all touch-manipulation",
                          member.muted
                            ? "bg-red-500/10 border-red-500/20 text-red-400"
                            : "bg-white/[0.04] border-white/[0.08] text-white/40 hover:border-white/20",
                        )}
                      >
                        {member.muted ? "Unmute" : "Mute"}
                      </button>

                      {canModerateVoice && (
                        <>
                          <button
                            onClick={() => toggleBlock(member.id)}
                            className={cn(
                              "flex-1 py-1 rounded-lg text-[9px] font-bold border transition-all touch-manipulation",
                              member.blocked
                                ? "bg-white/5 border-white/10 text-white/40"
                                : "bg-red-500/[0.06] border-red-500/15 text-red-400/70 hover:bg-red-500/10",
                            )}
                          >
                            {member.blocked ? "Unblock" : "Block"}
                          </button>
                          <select
                            value={member.role}
                            onChange={(e) =>
                              assignRole(member.id, e.target.value as MemberRole)
                            }
                            className="flex-1 py-1 px-1.5 rounded-lg text-[9px] font-bold bg-white/[0.04] border border-white/[0.08] text-white/40 focus:outline-none appearance-none cursor-pointer hover:border-white/20 transition-all"
                          >
                            {(["member", "moderator", "co-admin"] as MemberRole[]).map((r) => (
                              <option key={r} value={r} className="bg-[#111] capitalize">
                                {r}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── LIVE MAP PHASE (Strava-style) ─────────────────────────
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-black text-white safe-pt safe-pb">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-hidden bg-[#0a1628]">
          <LiveTripMap
            ref={liveMapRef}
            minimalChrome
            mapTheme={liveMapTheme}
            onMapThemeChange={setLiveMapTheme}
            className="absolute inset-0 z-0"
            userGeo={myGeo}
            showUserLocation
            heatmapVisible={heatmapLiveOn}
            heatmapPoints={members
              .filter((m) => m.status !== "absent" && Number.isFinite(m.lat) && Number.isFinite(m.lng))
              .map((m) => ({
                lat: m.lat,
                lng: m.lng,
                weight: Math.min(6, 1 + m.speed / 25),
              }))}
            start={
              trip?.meetupLat != null && trip?.meetupLng != null
                ? { lat: trip.meetupLat, lng: trip.meetupLng }
                : null
            }
            end={
              trip?.endLat != null && trip?.endLng != null
                ? { lat: trip.endLat, lng: trip.endLng }
                : null
            }
            riders={members
              .filter((m) => m.status !== "absent")
              .map((m) => ({
                id: m.id,
                lat: m.lat,
                lng: m.lng,
                name: m.name,
                avatar: m.avatar,
                role: m.role,
                speed: m.speed,
                distanceCovered: m.distanceCovered,
                checkpoints: m.checkpoints,
                xpGained: m.xpGained,
                memberStatus: m.status,
              }))}
            pins={mapPins}
            checkpoints={checkpoints}
            selectedRiderId={mapSelected}
            onSelectRider={setMapSelected}
          />

          {/* Strava-style top: minimize + promo pill */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-3 pt-2 safe-pt">
            <div className="pointer-events-auto flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowExitConfirm(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
                aria-label="Trip options"
              >
                <ChevronDown size={22} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => setHeatmapLiveOn((v) => !v)}
                className={cn(
                  "max-w-[min(100%,15rem)] truncate rounded-full border px-3 py-2 text-left text-[10px] font-semibold leading-snug shadow backdrop-blur-md transition sm:max-w-[20rem]",
                  heatmapLiveOn
                    ? "border-amber-400/70 bg-amber-500/25 text-white"
                    : "border-amber-500/35 bg-black/45 text-white/85 hover:border-amber-400/50",
                )}
              >
                <span className="mr-1" aria-hidden>🔥</span>
                Weekly heatmap — {heatmapLiveOn ? "on" : "tap to show"} popular routes
              </button>
              <div className="h-11 w-11 shrink-0" aria-hidden />
            </div>
          </div>

          {/* Map controls stack */}
          <div className="pointer-events-auto absolute right-3 top-[36%] z-20 flex -translate-y-1/2 flex-col gap-2 md:right-5">
            {Math.abs(mapBearingHud) > 4 && (
              <button
                type="button"
                onClick={() => liveMapRef.current?.resetNorth()}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
                title="Reset to north"
              >
                <Compass size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={() => liveMapRef.current?.zoomBy(1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
              title="Zoom in"
            >
              <Plus size={18} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => liveMapRef.current?.zoomBy(-1)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
              title="Zoom out"
            >
              <Minus size={18} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => {
                liveMapRef.current?.toggleTraffic();
                setTrafficLiveOn((v) => !v);
              }}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full border text-[9px] font-black shadow-lg backdrop-blur-md transition active:scale-95",
                trafficLiveOn
                  ? "border-emerald-400/50 bg-emerald-500/25 text-emerald-100"
                  : "border-white/18 bg-black/60 text-white hover:bg-black/70",
              )}
              title="Traffic"
            >
              <span aria-hidden>T</span>
            </button>
            <button
              type="button"
              onClick={() => liveMapRef.current?.togglePitch()}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-black/60 text-[10px] font-bold text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
              title="3D tilt"
            >
              3D
            </button>
            <button
              type="button"
              onClick={() => liveMapRef.current?.toggleHeadingUp()}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
              title="Toggle heading-up navigation"
            >
              <Navigation size={18} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      let h = pos.coords.heading;
                      if (h != null && !Number.isNaN(h) && h < 0) h = h + 360;
                      setMyGeo({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracyM: pos.coords.accuracy ?? undefined,
                        headingDeg: h ?? null,
                        speedMps: pos.coords.speed ?? null,
                      });
                      lastMapGeoEmitRef.current = Date.now();
                      liveMapRef.current?.recenterOnUser({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                      });
                    },
                    () => {
                      if (trip?.meetupLat != null && trip?.meetupLng != null) {
                        liveMapRef.current?.flyTo({
                          lat: trip.meetupLat,
                          lng: trip.meetupLng,
                          zoom: 13,
                        });
                      }
                    },
                    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
                  );
                } else if (trip?.meetupLat != null && trip?.meetupLng != null) {
                  liveMapRef.current?.flyTo({ lat: trip.meetupLat, lng: trip.meetupLng, zoom: 13 });
                }
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/18 bg-black/60 text-white shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
              title="Recenter on my location"
            >
              <Crosshair size={18} />
            </button>
            <button
              type="button"
              onClick={() => liveMapRef.current?.fitConvoy()}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-400/35 bg-black/60 text-cyan-200 shadow-lg backdrop-blur-md transition hover:bg-black/70 active:scale-95"
              title="Fit route & convoy"
            >
              <Expand size={18} />
            </button>
          </div>

          {/* Speed pill */}
          {myGeo && Number.isFinite(myGeo.lat) && (
            <div className="pointer-events-none absolute bottom-[max(5.5rem,env(safe-area-inset-bottom))] left-3 z-20 sm:bottom-28">
              <div
                className={cn(
                  "pointer-events-auto rounded-full border px-3 py-2 font-mono text-sm font-bold shadow-lg backdrop-blur-md",
                  (() => {
                    const kmh = Math.max(0, (myGeo.speedMps ?? 0) * 3.6);
                    if (kmh < 45) return "border-emerald-500/40 bg-black/70 text-emerald-200";
                    if (kmh < 85) return "border-amber-500/40 bg-black/70 text-amber-200";
                    return "border-red-500/45 bg-black/70 text-red-200";
                  })(),
                )}
              >
                {Math.round(Math.max(0, (myGeo.speedMps ?? 0) * 3.6))}{" "}
                <span className="text-[10px] font-semibold opacity-75">km/h</span>
              </div>
            </div>
          )}

          {/* Trip stats — elapsed + local distance */}
          <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-3 z-20 flex justify-center sm:left-auto sm:right-4 sm:bottom-4">
            <div className="pointer-events-auto flex gap-3 rounded-2xl border border-white/12 bg-black/65 px-4 py-2 text-[10px] text-white/80 shadow-lg backdrop-blur-md">
              <span>
                <span className="text-white/40">Time </span>
                <span className="font-mono font-semibold text-white">
                  {String(Math.floor(elapsedSec / 3600)).padStart(2, "0")}:
                  {String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, "0")}
                </span>
              </span>
              <span className="text-white/25">|</span>
              <span>
                <span className="text-white/40">You </span>
                <span className="font-mono font-semibold text-white">
                  {(localMember?.distanceCovered ?? 0).toFixed(1)} km
                </span>
              </span>
            </div>
          </div>

          {mapSelected && (() => {
            const m = members.find((x) => x.id === mapSelected);
            if (!m) return null;
            return (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 right-3 z-20 max-h-[45vh] overflow-y-auto pointer-events-auto sm:bottom-24 sm:left-4 sm:right-4 md:left-auto md:right-4 md:w-80"
              >
                <div className="border border-cyan-500/25 bg-black/90 p-4 shadow-[0_0_30px_rgba(34,211,238,0.12)] backdrop-blur-xl rounded-2xl">
                  <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-widest text-cyan-400/80">Driver telemetry</p>
                  <p className="mb-3 text-sm font-bold text-white">{m.name}</p>
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-white/55">
                    <p className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
                      <span className="text-white/35">Speed</span>
                      <br />
                      <span className="font-mono text-cyan-300">{Math.round(m.speed)} km/h</span>
                    </p>
                    <p className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
                      <span className="text-white/35">Distance</span>
                      <br />
                      <span className="font-mono text-amber-300">{m.distanceCovered.toFixed(1)} km</span>
                    </p>
                    <p className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
                      <span className="text-white/35">Gates</span>
                      <br />
                      <span className="font-mono text-white/90">{m.checkpoints}</span>
                    </p>
                    <p className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
                      <span className="text-white/35">XP</span>
                      <br />
                      <span className="font-mono text-emerald-300">{m.xpGained}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMapSelected(null)}
                    className="mt-3 w-full rounded-lg border border-white/10 py-2 text-[10px] text-white/40 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            );
          })()}

          {/* ── Map basemap theme: dark / light (Lucide — matches HUD chrome) ── */}
          <div
            className="pointer-events-auto absolute left-2 top-[42%] z-20 flex -translate-y-1/2 flex-col sm:left-4 sm:top-1/2"
            role="group"
            aria-label="Map appearance"
          >
            <div className="flex flex-col overflow-hidden rounded-2xl border border-white/18 bg-black/60 shadow-lg backdrop-blur-md">
              <button
                type="button"
                onClick={() => {
                  setLiveMapThemeAuto(false);
                  setLiveMapTheme("dark");
                }}
                aria-pressed={liveMapTheme === "dark"}
                title="Dark map"
                className={cn(
                  "flex h-11 w-11 touch-manipulation items-center justify-center transition-colors",
                  liveMapTheme === "dark"
                    ? "bg-white text-black"
                    : "text-white/45 hover:bg-white/10 hover:text-white",
                )}
              >
                <Moon size={18} strokeWidth={2.25} aria-hidden />
              </button>
              <div className="h-px bg-white/12" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  setLiveMapThemeAuto(false);
                  setLiveMapTheme("light");
                }}
                aria-pressed={liveMapTheme === "light"}
                title="Light map"
                className={cn(
                  "flex h-11 w-11 touch-manipulation items-center justify-center transition-colors",
                  liveMapTheme === "light"
                    ? "bg-white text-black"
                    : "text-white/45 hover:bg-white/10 hover:text-white",
                )}
              >
                <Sun size={18} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          </div>

          {/* SOS Modal */}
          <AnimatePresence>
            {showSOS && (
              <>
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 bg-red-950/60 backdrop-blur-sm z-40" onClick={() => setShowSOS(false)}/>
                <motion.div initial={{scale:0.8,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.8,opacity:0}} className="absolute left-1/2 top-1/2 z-50 w-[min(100%,20rem)] max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border-2 border-red-500/50 bg-[#0d0d0d] p-5 text-center shadow-[0_0_60px_rgba(239,68,68,0.3)] sm:w-80 sm:p-6">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 border-2 border-red-500/40 flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <AlertTriangle size={28} className="text-red-400"/>
                  </div>
                  <h2 className="text-xl font-bold text-red-400 mb-2">SOS Alert</h2>
                  <p className="text-white/50 text-sm mb-5">This will broadcast an emergency alert to all trip members and the organizer.</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    {['🚗 Breakdown','⚕️ Medical','🔥 Fire','❓ Other'].map(t => (
                      <button key={t} onClick={() => { setShowSOS(false); }} className="py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">{t}</button>
                    ))}
                  </div>
                  <button onClick={() => setShowSOS(false)} className="w-full py-2 text-sm text-white/30 hover:text-white transition-colors">Cancel</button>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Add Pin Modal */}
          <AnimatePresence>
            {showAddPin && (
              <>
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setShowAddPin(false)}/>
                <motion.div initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} exit={{y:20,opacity:0}} className="absolute left-1/2 top-1/2 z-50 w-[min(100%,18rem)] max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-[#0d0d0d] p-4 sm:w-72 sm:p-5">
                  <h3 className="font-bold mb-3">Add Map Pin</h3>
                  <div className="grid grid-cols-5 gap-1.5 mb-3">
                    {(['parking','fuel','attraction','hazard','road-damage'] as MapPin['type'][]).map(t => (
                      <button key={t} onClick={() => setNewPinType(t)}
                        className={cn('py-2 rounded-xl border text-base transition-all', newPinType===t ? 'bg-white/10 border-white/30' : 'bg-white/[0.03] border-white/[0.08] hover:border-white/20')}>
                        {pinIcon(t)}
                      </button>
                    ))}
                  </div>
                  <input type="text" value={newPinLabel} onChange={e => setNewPinLabel(e.target.value)} placeholder="Label (e.g. Good fuel stop)…"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 mb-3"/>
                  <div className="flex gap-2">
                    <button onClick={addPin} className="flex-1 py-2 bg-white text-black rounded-xl text-xs font-bold hover:bg-white/90 transition-all">Add Pin</button>
                    <button onClick={() => setShowAddPin(false)} className="flex-1 py-2 border border-white/10 rounded-xl text-xs font-semibold text-white/40 hover:text-white transition-all">Cancel</button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Paused banner */}
          <AnimatePresence>
            {tripPaused && (
              <motion.div initial={{y:-60,opacity:0}} animate={{y:0,opacity:1}} exit={{y:-60,opacity:0}}
                className="absolute top-20 left-1/2 z-30 flex max-w-[min(100%,22rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/20 px-5 py-3 shadow-lg backdrop-blur-sm sm:top-24">
                <div className="h-2 w-2 shrink-0 rounded-full bg-amber-400"/>
                <span className="text-sm font-bold text-amber-400">Trip paused — convoy notified</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom sheet — peek (map-first) or expanded; spring height + swipe + inner scroll */}
      <motion.div
        initial={false}
        animate={{
          maxHeight: liveSheetSnap === "peek" ? "min(32vh, 280px)" : "min(90dvh, 920px)",
        }}
        transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.82 }}
        className="relative z-30 flex shrink-0 flex-col overflow-hidden rounded-t-[22px] border border-white/10 border-b-0 bg-[#0c0c0c] shadow-[0_-8px_48px_rgba(0,0,0,0.65)] will-change-[max-height]"
      >
        <button
          type="button"
          onPointerDown={onSheetHandlePointerDown}
          onPointerUp={onSheetHandlePointerUp}
          onPointerCancel={onSheetHandlePointerCancel}
          className="flex w-full shrink-0 flex-col items-center gap-0.5 pb-1 pt-2 touch-manipulation select-none"
          aria-expanded={liveSheetSnap === "expanded"}
          aria-label={liveSheetSnap === "peek" ? "Expand trip panel" : "Collapse trip panel"}
        >
          <span className="h-1 w-10 rounded-full bg-white/30" />
          <motion.span
            animate={{ rotate: liveSheetSnap === "expanded" ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="inline-flex text-white/40"
            aria-hidden
          >
            <ChevronUp size={18} />
          </motion.span>
        </button>

        {liveSheetSnap === "peek" ? (
          <div
            className="border-b border-white/10 px-4 pb-3 pt-0 touch-pan-y"
            onPointerDown={onPeekSwipePointerDown}
            onPointerUp={onPeekSwipePointerUp}
            onPointerCancel={onPeekSwipePointerCancel}
          >
            <div className="flex items-end justify-center gap-3">
              <div className="min-w-0 flex-1 text-center">
                <p className="text-lg font-semibold tabular-nums text-white">{formatElapsedStrava(elapsedSec)}</p>
                <p className="text-[9px] font-medium uppercase tracking-wide text-white/35">Time</p>
              </div>
              <button
                type="button"
                onClick={() => setTripPaused(!tripPaused)}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FC4C02] text-white shadow-[0_8px_28px_rgba(252,76,2,0.45)] transition hover:brightness-105 active:scale-[0.98]"
                aria-label={tripPaused ? "Resume trip" : "Pause trip"}
              >
                {tripPaused ? <Play size={28} fill="currentColor" className="ml-0.5" /> : <Pause size={26} fill="currentColor" />}
              </button>
              <div className="min-w-0 flex-1 text-center">
                <p className="text-lg font-semibold tabular-nums text-white">{myDistanceKm.toFixed(1)}</p>
                <p className="text-[9px] font-medium uppercase tracking-wide text-white/35">km</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowSOS(true)}
                className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[10px] font-bold text-red-300 transition hover:bg-red-500/25"
              >
                <AlertTriangle size={12} className="shrink-0" aria-hidden />
                SOS
              </button>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold",
                  tripPaused
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-red-500/35 bg-red-500/10 text-red-300",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", tripPaused ? "bg-amber-400" : "animate-pulse bg-red-400")} />
                {tripPaused ? "PAUSED" : "LIVE"}
              </span>
              <button
                type="button"
                onClick={() => setShowExitConfirm(true)}
                className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] font-bold text-red-300 transition hover:bg-red-500/20"
              >
                End trip
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-white/25">Swipe up for convoy controls</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 scroll-smooth overflow-y-auto overscroll-y-contain px-0 [scrollbar-gutter:stable]">
        {/* Status strip */}
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/90 px-3 py-2">
          <Radio size={14} className="shrink-0 text-emerald-400" />
          <span className="text-xs font-semibold text-white/90">
            {tripPaused ? "GPS paused" : "Live GPS tracking"}
          </span>
          <span className="ml-auto text-[10px] text-white/35">Convoy sync</span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 border-b border-white/10 px-4 py-4">
          <div className="text-center">
            <p className="text-xl font-semibold tabular-nums tracking-tight text-white">{formatElapsedStrava(elapsedSec)}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-white/40">Time</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold tabular-nums tracking-tight text-white">{formatPaceMinPerKm(elapsedSec, myDistanceKm)}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-white/40">Split avg (/km)</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold tabular-nums tracking-tight text-white">{myDistanceKm.toFixed(1)}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-white/40">Distance (km)</p>
          </div>
        </div>

        {/* Primary controls: SOS → Regroup ping → Play/Pause → Add map pin → Line up formation */}
        <div className="flex items-end justify-between gap-1 px-2 pb-3 pt-1 sm:gap-2 sm:px-4">
          <button
            type="button"
            onClick={() => setShowSOS(true)}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center touch-manipulation"
            title="SOS — emergency alert"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/45 bg-red-500/15 text-red-300 shadow-inner sm:h-12 sm:w-12">
              <AlertTriangle size={22} className="sm:h-[24px] sm:w-[24px]" />
            </span>
            <span className="max-w-[4.5rem] truncate text-[9px] font-medium leading-tight text-white/50 sm:text-[10px]">SOS</span>
          </button>

          <button
            type="button"
            onClick={() => {
              socketRef.current?.emit("convoy-action", { kind: "regroup-ping", tripId: id ? Number(id) : 0 });
            }}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center touch-manipulation"
            title="Ping convoy to regroup"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-500/35 bg-amber-500/10 text-amber-200 shadow-inner sm:h-12 sm:w-12">
              <BellRing size={21} className="sm:h-[23px] sm:w-[23px]" />
            </span>
            <span className="max-w-[4.5rem] truncate text-[9px] font-medium leading-tight text-white/50 sm:text-[10px]">Regroup ping</span>
          </button>

          <button
            type="button"
            onClick={() => setTripPaused(!tripPaused)}
            className="mx-0.5 flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center rounded-full bg-[#FC4C02] text-white shadow-[0_8px_32px_rgba(252,76,2,0.45)] transition hover:brightness-105 active:scale-[0.98] sm:h-[4.75rem] sm:w-[4.75rem]"
            aria-label={tripPaused ? "Resume trip" : "Pause trip"}
          >
            {tripPaused ? <Play size={32} fill="currentColor" className="ml-0.5 sm:h-9 sm:w-9" /> : <Pause size={30} fill="currentColor" className="sm:h-8 sm:w-8" />}
          </button>

          <button
            type="button"
            onClick={() => setShowAddPin(true)}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center touch-manipulation"
            title="Add map pin — parking, fuel, attraction, caution, road quality"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-200 shadow-inner sm:h-12 sm:w-12">
              <MapPin size={20} className="sm:h-[22px] sm:w-[22px]" />
            </span>
            <span className="max-w-[4.5rem] text-balance text-[9px] font-medium leading-tight text-white/50 sm:text-[10px]">Add map pin</span>
          </button>

          <button
            type="button"
            onClick={() => {
              socketRef.current?.emit("convoy-action", { kind: "line-up-formation", tripId: id ? Number(id) : 0 });
            }}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center touch-manipulation"
            title="Ask group to line up in formation"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 shadow-inner sm:h-12 sm:w-12">
              <ListOrdered size={20} className="sm:h-[22px] sm:w-[22px]" />
            </span>
            <span className="max-w-[4.5rem] truncate text-[9px] font-medium leading-tight text-white/50 sm:text-[10px]">Line up formation</span>
          </button>
        </div>

        {/* Secondary row: end trip + live pill */}
        <div className="flex items-center justify-center gap-2 px-4 pb-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold",
              tripPaused
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-red-500/35 bg-red-500/10 text-red-300",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", tripPaused ? "bg-amber-400" : "animate-pulse bg-red-400")} />
            {tripPaused ? "PAUSED" : "LIVE"}
          </span>
          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            className="rounded-full border border-red-500/30 bg-red-500/10 px-4 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20"
          >
            End trip
          </button>
        </div>

        {/* Settings list (Strava-like) */}
        <div className="mx-3 mb-2 space-y-0 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          <button
            type="button"
            onClick={() => setStravaShareLive((v) => !v)}
            className="flex w-full items-center gap-3 border-b border-white/10 px-3 py-3 text-left transition hover:bg-white/[0.04]"
          >
            <Users2 size={18} className="shrink-0 text-white/60" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white/90">Share live location</p>
              <p className="text-[11px] text-white/35">{stravaShareLive ? "On — friends can follow" : "Off"}</p>
            </div>
            <span className={cn("text-[11px] font-bold", stravaShareLive ? "text-emerald-400" : "text-white/30")}>
              {stravaShareLive ? "On" : "Off"}
            </span>
          </button>
          <div className="flex items-center gap-3 border-b border-white/10 px-3 py-3">
            <RefreshCw size={18} className="shrink-0 text-white/60" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white/90">Track laps</p>
              <p className="text-[11px] text-white/35">Checkpoint lap times</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={stravaTrackLaps}
              onClick={() => setStravaTrackLaps((v) => !v)}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full border transition",
                stravaTrackLaps ? "border-emerald-500/40 bg-emerald-500/25" : "border-white/15 bg-white/[0.06]",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                  stravaTrackLaps ? "left-5" : "left-0.5",
                )}
              />
            </button>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/[0.04]"
          >
            <Heart size={18} className="shrink-0 text-white/60" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white/90">Add a sensor</p>
              <p className="text-[11px] text-white/35">Heart rate &amp; more</p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-white/25" />
          </button>
        </div>

        {/* Tabs + scrollable content */}
        <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
          <div className="flex shrink-0 gap-0.5 p-2">
            {(['members','checkpoints','leaderboard'] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setLiveTab(tab)}
                className={cn('flex-1 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider transition-all capitalize',
                  liveTab===tab ? 'bg-white text-black' : 'text-white/30 hover:text-white hover:bg-white/5')}>
                {tab === 'leaderboard' ? 'Podium' : tab === 'checkpoints' ? 'Route' : 'Crew'}
              </button>
            ))}
          </div>

          {liveTab === 'members' && (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4 pt-1">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="relative flex-shrink-0">
                    <div className="h-8 w-8 overflow-hidden rounded-full bg-white/10">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${m.avatar}`} alt="" className="h-full w-full object-cover"/>
                    </div>
                    <div className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-black', m.status==='arrived'?'bg-emerald-400':m.status==='on-way'?'bg-amber-400':'bg-white/20')}/>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold">{m.name}</p>
                    <p className="text-[9px] text-white/30">{Math.round(m.speed)} km/h · {m.distanceCovered.toFixed(1)}km</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-bold text-amber-400">+{m.xpGained}</p>
                    <p className="text-[8px] text-white/20">XP</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {liveTab === 'checkpoints' && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-1">
              {checkpoints.map((cp, i) => (
                <div key={cp.id} className={cn('rounded-2xl border p-4 transition-all', cp.reached ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]')}>
                  <div className="mb-2 flex items-center gap-3">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border text-xl', cp.reached ? 'border-emerald-500/25 bg-emerald-500/15' : 'border-white/10 bg-white/[0.04]')}>{cp.badge}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold">{cp.name}</p>
                        {cp.reached && <CheckCircle size={12} className="text-emerald-400"/>}
                      </div>
                      <p className="text-[10px] text-white/30">Checkpoint {i+1} · +{cp.xp} XP</p>
                    </div>
                  </div>
                  {!cp.reached && (
                    <button type="button" onClick={() => setCheckpoints(p => p.map(c => c.id===cp.id ? {...c, reached:true} : c))}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.05] py-1.5 text-[10px] font-bold text-white/50 transition hover:border-white/25 hover:text-white">
                      ✓ Check In Here
                    </button>
                  )}
                  {cp.reached && (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-500/[0.08] px-2 py-1">
                      <CheckCircle size={10} className="text-emerald-400"/>
                      <span className="text-[9px] font-bold text-emerald-400">Reached by {members.filter(m=>m.status!=='absent').length} riders</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {liveTab === 'leaderboard' && (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
              <div className="space-y-2">
                {sortedLeaderboard.map((m, i) => (
                  <div key={m.id} className={cn('flex items-center gap-3 rounded-xl border p-3 transition-all',
                    i===0 ? 'border-amber-500/20 bg-amber-500/[0.08]' : i===1 ? 'border-white/[0.08] bg-white/[0.04]' : i===2 ? 'border-orange-500/15 bg-orange-500/[0.05]' : 'border-white/[0.05] bg-white/[0.02]')}>
                    <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black',
                      i===0?'bg-amber-500/25 text-amber-400':i===1?'bg-white/10 text-white/60':i===2?'bg-orange-500/20 text-orange-400':'bg-white/5 text-white/25')}>
                      {i+1}
                    </div>
                    <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white/10">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${m.avatar}`} alt="" className="h-full w-full object-cover"/>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{m.name.split(' ')[0]}</p>
                      <div className="mt-0.5 flex gap-2">
                        <span className="text-[9px] text-white/30">📍{m.distanceCovered.toFixed(1)}km</span>
                        <span className="text-[9px] text-white/30">🏁{m.checkpoints}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-bold text-amber-400">{m.xpGained}</p>
                      <p className="text-[8px] text-white/20">XP</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Leaf size={14} className="text-emerald-400"/>
                  <p className="text-xs font-bold text-emerald-400">Group carbon savings</p>
                </div>
                <p className="text-2xl font-bold text-emerald-400">4.2 kg CO₂</p>
                <p className="mt-0.5 text-[10px] text-white/30">Saved vs solo travel</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
        )}
      </motion.div>
    </div>
  );
};

// ─── APP ROOT ─────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState<User|null>(null);

  // On first load, check if there's an authenticated Supabase user (e.g. from Google OAuth)
  // and ensure they have a profile row in public.users, then hydrate local state.
  useEffect(() => {
    (async () => {
      try {
        const { data: authData, error } = await supabase.auth.getUser();
        if (error || !authData.user) return;

        const authUser = authData.user;
        const email = authUser.email;
        if (!email) return;

        const displayName =
          (authUser.user_metadata && authUser.user_metadata.full_name) ||
          authUser.user_metadata?.name ||
          email.split("@")[0];

        const res = await fetch("/api/auth/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            name: displayName,
            role: "user",
            auth_user_id: authUser.id,
          }),
        });

        if (!res.ok) {
          return;
        }

        const profile = await res.json();
        const hydrated: User = {
          id: String(profile.id ?? authUser.id),
          name: profile.name ?? displayName,
          email: profile.email ?? email,
          role: profile.role ?? "user",
          level: profile.level ?? 1,
          xp: profile.xp ?? 0,
        };
        setUser(hydrated);
      } catch {
        // ignore on initial load
      }
    })();
  }, []);

  const handleLogout = () => setUser(null);
  return(
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage/>}/>
        <Route path="/login" element={<LoginPage setUser={setUser}/>}/>
        <Route path="/signup" element={<SignupPage setUser={setUser}/>}/>
        <Route path="/dashboard" element={user?<UserDashboard user={user} onLogout={handleLogout}/>:<Navigate to="/login"/>}/>
        <Route path="/explore" element={<MarketplacePage user={user}/>}/>
        <Route path="/organizer" element={user?.role==='organizer'?<OrganizerDashboard user={user} onLogout={handleLogout}/>:<Navigate to="/login"/>}/>
        <Route path="/organizer/create" element={user?.role==='organizer'?<CreateEventPage user={user}/>:<Navigate to="/login"/>}/>
        <Route path="/trip/:id" element={<TripDetailPage user={user}/>}/>
        <Route path="/trip/:id/live" element={user?<LiveTripPage user={user}/>:<Navigate to="/login"/>}/>
      </Routes>
    </Router>
  );
}