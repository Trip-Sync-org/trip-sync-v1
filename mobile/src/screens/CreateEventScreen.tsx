import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Image,
  Share,
  Switch,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import { Badge, Card } from "../components/ui";
import {
  THEMES,
  DURATIONS,
  AGE_GROUPS,
  LANGUAGES,
  TIMEZONES_DATA,
  offsetToStr,
  generateCouponCode,
} from "../constants/createEvent";
import { formatShortDate, formatTime12h, setTimeOnDate } from "../lib/createEventFormat";
import { getMapboxPublicToken, mapboxTokenConfigError } from "../lib/mapboxPublicToken";

type Props = NativeStackScreenProps<RootStackParamList, "CreateEvent">;

type PlaceSuggestion = { id: string; place_name: string; center: [number, number] };

type PickerSlot = "sd" | "st" | "ed" | "et" | null;

type CouponRow = {
  id: string;
  code: string;
  discount: number;
  limit: number;
  used: number;
  expiry: string;
  active: boolean;
  prefix: string;
};

type InviteRow = { type: "email" | "phone"; value: string };

const CREATE_EVENT_DRAFT_KEY = "tripsync_create_event_draft_v1";

function MapboxCreatePreview({
  start,
  end,
}: {
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
}) {
  const html = useMemo(() => {
    const mapboxToken = getMapboxPublicToken();
    const cfgErr = mapboxTokenConfigError(mapboxToken);
    if (cfgErr) {
      const safe = cfgErr.replace(/</g, "&lt;");
      return `<html><body style='margin:0;background:#0a0a0a;color:#fecaca;font-family:sans-serif;padding:12px;font-size:13px;line-height:1.4'>${safe}</body></html>`;
    }
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css"/><style>html,body,#map{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0a0a0a}.dot{width:12px;height:12px;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}.err{padding:12px;color:#fecaca;background:#7f1d1d;font:12px sans-serif}</style></head><body><div id="map"></div><script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"></script><script>const S=${JSON.stringify(start)},E=${JSON.stringify(end)},TOKEN=${JSON.stringify(mapboxToken)};let map=null;function mk(c){const d=document.createElement('div');d.className='dot';d.style.background=c;return d;}function showErr(m){const el=document.getElementById('map');if(el)el.innerHTML='<div class="err">'+String(m).replace(/</g,'&lt;')+'</div>';}function fit(){if(!map)return;const pts=[];if(S)pts.push([S.lng,S.lat]);if(E)pts.push([E.lng,E.lat]);if(!pts.length)return;const lats=pts.map(p=>p[1]),lngs=pts.map(p=>p[0]);if(pts.length===1){map.flyTo({center:pts[0],zoom:13,duration:700});return;}map.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:60,maxZoom:15,duration:800});}function init(){if(!window.mapboxgl){showErr("Mapbox SDK failed to load");return;}mapboxgl.accessToken=TOKEN;map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/navigation-night-v1',center:S?[S.lng,S.lat]:[78.9629,20.5937],zoom:S?11:4,attributionControl:false});map.on('load',()=>{if(S)new mapboxgl.Marker({element:mk('#22c55e')}).setLngLat([S.lng,S.lat]).addTo(map);if(E)new mapboxgl.Marker({element:mk('#ef4444')}).setLngLat([E.lng,E.lat]).addTo(map);if(S&&E){const line={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[S.lng,S.lat],[E.lng,E.lat]]}};map.addSource('route',{type:'geojson',data:line});map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#fff','line-width':8,'line-opacity':0.85}});map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#4285F4','line-width':4}});}fit();});map.on('error',e=>showErr((e&&e.error&&e.error.message)||'Mapbox map error'));}if(!TOKEN){showErr("Missing EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN")}else{init();}</script></body></html>`;
  }, [end, start]);

  return <WebView originWhitelist={["*"]} source={{ html }} style={styles.mapImage} javaScriptEnabled domStorageEnabled mixedContentMode="always" />;
}

function parseGeocodeFeatures(data: unknown): PlaceSuggestion[] {
  const raw = data as { features?: Array<Record<string, unknown>> };
  if (!Array.isArray(raw.features)) return [];
  const out: PlaceSuggestion[] = [];
  raw.features.forEach((f, i) => {
    const center = f.center as [number, number] | undefined;
    const id = String(f.id ?? `f-${i}`);
    const place_name = String(f.place_name ?? f.text ?? "Unknown");
    if (!center || center.length < 2) return;
    out.push({ id, place_name, center: [Number(center[0]), Number(center[1])] });
  });
  return out;
}

async function geocodePlace(query: string): Promise<PlaceSuggestion[]> {
  const value = query.trim();
  if (value.length < 3) return [];
  const response = await apiFetch(
    `/api/maps/geocode?query=${encodeURIComponent(value)}&limit=5`,
  );
  if (!response.ok) return [];
  const data = await response.json();
  return parseGeocodeFeatures(data);
}

function Collapsible({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionOuter}>
      <Pressable style={styles.sectionHead} onPress={onToggle}>
        <Text style={styles.sectionHeadText}>{label}</Text>
        <Text style={styles.chevron}>{open ? "▼" : "▶"}</Text>
      </Pressable>
      {open ? <View style={styles.sectionInner}>{children}</View> : null}
    </View>
  );
}

function OptionModal({
  visible,
  title,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: string[];
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.optModalWrap}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.optSheetCentered}>
          <Text style={styles.optTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="always"
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                style={styles.optRow}
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
              >
                <Text style={styles.optRowText}>{item}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

function defaultStartDate(): Date {
  const n = new Date();
  return setTimeOnDate(n, 8, 0);
}

function defaultEndDate(): Date {
  const n = new Date();
  n.setDate(n.getDate() + 1);
  return setTimeOnDate(n, 18, 0);
}

export function CreateEventScreen({ navigation }: Props) {
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [selectedThemes, setSelectedThemes] = useState<string[]>([THEMES[0] ?? "Adventure"]);
  const [duration, setDuration] = useState(DURATIONS[1] ?? "1 Day");
  const [ageGroup, setAgeGroup] = useState("18+");
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(["English"]);

  const [startDt, setStartDt] = useState(defaultStartDate);
  const [endDt, setEndDt] = useState(defaultEndDate);

  const [meetupPoint, setMeetupPoint] = useState("");
  const [endLocation, setEndLocation] = useState("");
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [endCoords, setEndCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [startSuggestions, setStartSuggestions] = useState<PlaceSuggestion[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<PlaceSuggestion[]>([]);

  const [maxParticipants, setMaxParticipants] = useState(20);
  const [price, setPrice] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);

  const [description, setDescription] = useState("");
  const [prerequisites, setPrerequisites] = useState("");
  const [terms, setTerms] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const [privacy, setPrivacy] = useState<"Public" | "Private">("Public");

  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [galleryUris, setGalleryUris] = useState<string[]>([]);

  const [couponForm, setCouponForm] = useState({
    prefix: "EVENT",
    discount: 10,
    limit: 50,
    expiry: "",
  });
  const [couponCode, setCouponCode] = useState("");
  const [couponAttachLoading, setCouponAttachLoading] = useState(false);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);

  const [inviteInput, setInviteInput] = useState("");
  const [invites, setInvites] = useState<InviteRow[]>([]);

  const [timezone, setTimezone] = useState({
    name: "India - Kolkata",
    offset: offsetToStr(330),
    city: "Kolkata",
  });
  const [showTzModal, setShowTzModal] = useState(false);
  const [tzSearch, setTzSearch] = useState("");

  const [locLoading, setLocLoading] = useState<null | "start" | "end">(null);

  const [sections, setSections] = useState({
    basic: true,
    datetime: true,
    location: true,
    checkpoints: false,
    capacity: true,
    about: true,
    requirements: false,
    contact: false,
    coupons: false,
  });

  type CpDraft = { name: string; lat: number; lng: number; xp: number; badge?: string };
  const [checkpointDrafts, setCheckpointDrafts] = useState<CpDraft[]>([]);
  const [nearbyAttractions, setNearbyAttractions] = useState<
    { id: string; name: string; description?: string | null; lat: number; lng: number }[]
  >([]);

  const toggleSection = (s: keyof typeof sections) =>
    setSections((p) => ({ ...p, [s]: !p[s] }));

  const [pickerSlot, setPickerSlot] = useState<PickerSlot>(null);

  const [durationModal, setDurationModal] = useState(false);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ImagePicker.requestMediaLibraryPermissionsAsync();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/nearby-attractions");
        if (!res.ok) return;
        const j = (await res.json()) as { attractions?: typeof nearbyAttractions };
        if (Array.isArray(j.attractions)) setNearbyAttractions(j.attractions);
      } catch {
        /* optional */
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(CREATE_EVENT_DRAFT_KEY);
        if (!raw || cancelled) return;
        const d = JSON.parse(raw) as Record<string, unknown>;
        Alert.alert("Restore draft?", "You have a saved draft for this form.", [
          { text: "Discard", style: "destructive", onPress: () => void AsyncStorage.removeItem(CREATE_EVENT_DRAFT_KEY) },
          {
            text: "Restore",
            onPress: () => {
              if (typeof d.name === "string") setName(d.name);
              if (Array.isArray(d.selectedThemes)) setSelectedThemes(d.selectedThemes.filter((x) => typeof x === "string"));
              if (typeof d.duration === "string") setDuration(d.duration);
              if (typeof d.ageGroup === "string") setAgeGroup(d.ageGroup);
              if (Array.isArray(d.selectedLanguages)) setSelectedLanguages(d.selectedLanguages.filter((x) => typeof x === "string"));
              if (typeof d.meetupPoint === "string") setMeetupPoint(d.meetupPoint);
              if (typeof d.endLocation === "string") setEndLocation(d.endLocation);
              if (d.startCoords && typeof d.startCoords === "object" && d.startCoords !== null) {
                const sc = d.startCoords as { lat?: unknown; lng?: unknown };
                if (typeof sc.lat === "number" && typeof sc.lng === "number") {
                  setStartCoords({ lat: sc.lat, lng: sc.lng });
                }
              }
              if (d.endCoords && typeof d.endCoords === "object" && d.endCoords !== null) {
                const ec = d.endCoords as { lat?: unknown; lng?: unknown };
                if (typeof ec.lat === "number" && typeof ec.lng === "number") {
                  setEndCoords({ lat: ec.lat, lng: ec.lng });
                }
              }
              if (typeof d.description === "string") setDescription(d.description);
              if (typeof d.privacy === "string" && (d.privacy === "Public" || d.privacy === "Private")) {
                setPrivacy(d.privacy);
              }
              if (typeof d.startDtIso === "string") {
                const t = new Date(d.startDtIso);
                if (!Number.isNaN(t.getTime())) setStartDt(t);
              }
              if (typeof d.endDtIso === "string") {
                const t = new Date(d.endDtIso);
                if (!Number.isNaN(t.getTime())) setEndDt(t);
              }
              if (typeof d.maxParticipants === "number") setMaxParticipants(d.maxParticipants);
              if (typeof d.price === "string") setPrice(d.price);
              if (typeof d.isFree === "boolean") setIsFree(d.isFree);
              if (typeof d.prerequisites === "string") setPrerequisites(d.prerequisites);
              if (typeof d.terms === "string") setTerms(d.terms);
              if (typeof d.contactName === "string") setContactName(d.contactName);
              if (typeof d.contactPhone === "string") setContactPhone(d.contactPhone);
              if (typeof d.contactEmail === "string") setContactEmail(d.contactEmail);
              if (d.couponForm && typeof d.couponForm === "object") {
                const cf = d.couponForm as Record<string, unknown>;
                setCouponForm((prev) => ({
                  prefix: typeof cf.prefix === "string" ? cf.prefix : prev.prefix,
                  discount: typeof cf.discount === "number" ? cf.discount : prev.discount,
                  limit: typeof cf.limit === "number" ? cf.limit : prev.limit,
                  expiry: typeof cf.expiry === "string" ? cf.expiry : prev.expiry,
                }));
              }
            },
          },
        ]);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void geocodePlace(meetupPoint).then(setStartSuggestions).catch(() => setStartSuggestions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [meetupPoint]);

  useEffect(() => {
    const t = setTimeout(() => {
      void geocodePlace(endLocation).then(setEndSuggestions).catch(() => setEndSuggestions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [endLocation]);

  const openPicker = (slot: PickerSlot) => {
    if (!slot) return;
    setPickerSlot(slot);
  };

  const onNativePickerChange = (event: { type?: string }, selected?: Date) => {
    if (Platform.OS === "android" && event.type === "dismissed") {
      setPickerSlot(null);
      return;
    }
    if (!selected) return;
    const slot = pickerSlot;
    if (slot === "sd") {
      setStartDt(setTimeOnDate(selected, startDt.getHours(), startDt.getMinutes()));
    } else if (slot === "st") {
      setStartDt(setTimeOnDate(startDt, selected.getHours(), selected.getMinutes()));
    } else if (slot === "ed") {
      setEndDt(setTimeOnDate(selected, endDt.getHours(), endDt.getMinutes()));
    } else if (slot === "et") {
      setEndDt(setTimeOnDate(endDt, selected.getHours(), selected.getMinutes()));
    }
    if (Platform.OS === "android") setPickerSlot(null);
  };

  const closeNativePicker = () => setPickerSlot(null);

  const saveDraft = async () => {
    try {
      const payload = {
        name,
        selectedThemes,
        duration,
        ageGroup,
        selectedLanguages,
        meetupPoint,
        endLocation,
        startCoords,
        endCoords,
        description,
        privacy,
        startDtIso: startDt.toISOString(),
        endDtIso: endDt.toISOString(),
        maxParticipants,
        price,
        isFree,
        prerequisites,
        terms,
        contactName,
        contactPhone,
        contactEmail,
        couponForm,
      };
      await AsyncStorage.setItem(CREATE_EVENT_DRAFT_KEY, JSON.stringify(payload));
      Alert.alert("Draft saved", "You can restore it next time you open Create Event.");
    } catch {
      Alert.alert("Could not save draft");
    }
  };

  const useCurrentLocation = async (which: "start" | "end") => {
    setLocLoading(which);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Location", "Permission is required to use your current position.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = pos.coords;
      const res = await apiFetch(
        `/api/maps/reverse?lat=${encodeURIComponent(String(latitude))}&lng=${encodeURIComponent(String(longitude))}`,
      );
      let label = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      let lng = longitude;
      let lat = latitude;
      if (res.ok) {
        const data = (await res.json()) as { features?: Array<{ place_name?: string; center?: [number, number] }> };
        const f = data.features?.[0];
        if (f?.place_name) label = f.place_name;
        if (f?.center && f.center.length >= 2) {
          lng = Number(f.center[0]);
          lat = Number(f.center[1]);
        }
      }
      Keyboard.dismiss();
      if (which === "start") {
        setMeetupPoint(label);
        setStartCoords({ lat, lng });
        setStartSuggestions([]);
      } else {
        setEndLocation(label);
        setEndCoords({ lat, lng });
        setEndSuggestions([]);
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Location", "Could not get your position. Check API URL and location services.");
    } finally {
      setLocLoading(null);
    }
  };

  const toggleTheme = (t: string) => {
    setSelectedThemes((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      return next.length === 0 ? [t] : next;
    });
  };

  const toggleLanguage = (lang: string) => {
    setSelectedLanguages((prev) => {
      const next = prev.includes(lang) ? prev.filter((x) => x !== lang) : [...prev, lang];
      return next.length === 0 ? [lang] : next;
    });
  };

  const pickBanner = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      base64: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (a.base64) {
      const mime = a.mimeType?.includes("png") ? "image/png" : "image/jpeg";
      setBannerPreview(`data:${mime};base64,${a.base64}`);
    } else if (a.uri) {
      setBannerPreview(a.uri);
    }
  };

  const addGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 10 - galleryUris.length,
      quality: 0.85,
    });
    if (r.canceled || !r.assets?.length) return;
    setGalleryUris((prev) => {
      const next = [...prev];
      for (const a of r.assets) {
        if (next.length >= 10) break;
        if (a.uri) next.push(a.uri);
      }
      return next;
    });
  };

  const addInvite = () => {
    const v = inviteInput.trim();
    if (!v || invites.some((i) => i.value === v)) return;
    const type: "email" | "phone" = v.includes("@") ? "email" : "phone";
    setInvites((p) => [...p, { type, value: v }]);
    setInviteInput("");
  };

  const publish = async () => {
    if (!user || user.role !== "organizer") {
      Alert.alert("Organizers only", "Sign in as an organizer to create events.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Event name", "Please enter an event name.");
      return;
    }
    setBusy(true);
    try {
      let resolvedStart = startCoords;
      let resolvedEnd = endCoords;

      if (!resolvedStart && meetupPoint.trim()) {
        const features = await geocodePlace(meetupPoint);
        const c0 = features[0]?.center;
        if (c0) {
          resolvedStart = { lng: Number(c0[0]), lat: Number(c0[1]) };
        }
      }

      if (!resolvedStart) {
        Alert.alert(
          "Meetup location",
          "Please choose a valid meetup location from suggestions or keep typing until you pick one.",
        );
        setBusy(false);
        return;
      }

      if (!resolvedEnd && endLocation.trim()) {
        const features = await geocodePlace(endLocation);
        const c0 = features[0]?.center;
        if (c0) {
          resolvedEnd = { lng: Number(c0[0]), lat: Number(c0[1]) };
        }
      }

      const dateLabel = formatShortDate(startDt);
      const timeLabel = formatTime12h(startDt);
      const themeJoined = selectedThemes.join(" · ");

      const tagMerge = [...new Set([...selectedThemes, ...selectedLanguages])];

      const payload = {
        organizer_id: Number(user.id) || undefined,
        name: name.trim(),
        description: description.trim(),
        theme: themeJoined,
        date: dateLabel,
        time: timeLabel,
        duration,
        price: isFree ? 0 : Number(price || 0),
        max_participants: maxParticipants,
        meetup_lat: resolvedStart.lat,
        meetup_lng: resolvedStart.lng,
        start_lat: resolvedStart.lat,
        start_lng: resolvedStart.lng,
        end_lat: resolvedEnd?.lat ?? null,
        end_lng: resolvedEnd?.lng ?? null,
        start_place_name: meetupPoint,
        start_place_address: meetupPoint,
        end_place_name: endLocation || null,
        end_place_address: endLocation || null,
        privacy: privacy.toLowerCase(),
        banner_url: bannerPreview || null,
        start_location: meetupPoint,
        end_location: endLocation,
        prerequisites: prerequisites.trim(),
        terms: terms.trim(),
        tags: tagMerge,
      };

      const res = await apiFetch("/api/trips", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await readApiErrorMessage(res);
        Alert.alert("Could not create event", body);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        id?: unknown;
        trip_id?: unknown;
      };
      const createdId = data?.id ?? data?.trip_id;
      if (createdId == null) {
        Alert.alert(
          "Created",
          "Event created, but trip id was missing in response. Open it from the Organizer dashboard.",
          [{ text: "OK", onPress: () => navigation.navigate("Main") }],
        );
        return;
      }
      if (checkpointDrafts.length > 0) {
        const cpRes = await apiFetch(`/api/trips/${createdId}/checkpoints`, {
          method: "POST",
          body: JSON.stringify({
            user_id: Number(user.id),
            checkpoints: checkpointDrafts,
          }),
        });
        if (!cpRes.ok) {
          Alert.alert("Checkpoints", await readApiErrorMessage(cpRes));
        }
      }
      navigation.replace("TripDetail", { id: String(createdId) });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Something went wrong while creating the event.");
    } finally {
      setBusy(false);
    }
  };

  const attachCoupon = async () => {
    if (!user?.id || !couponCode) return;
    setCouponAttachLoading(true);
    try {
      const res = await apiFetch(`/api/organizers/${user.id}/coupons`, {
        method: "POST",
        body: JSON.stringify({
          code: couponCode,
          prefix: couponForm.prefix,
          discount_pct: couponForm.discount,
          usage_limit: couponForm.limit,
          expiry_date: couponForm.expiry || null,
        }),
      });
      if (!res.ok) {
        Alert.alert("Coupon", await readApiErrorMessage(res));
        return;
      }
      const body = (await res.json()) as Record<string, unknown>;
      setCoupons((p) => [
        {
          id: String(body.id ?? ""),
          code: String(body.code ?? couponCode),
          discount: Number(body.discount_pct ?? couponForm.discount),
          limit: Number(body.usage_limit ?? couponForm.limit),
          used: Number(body.used_count ?? 0),
          expiry: body.expiry_date
            ? new Date(String(body.expiry_date)).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })
            : "No expiry",
          active: Boolean(body.active ?? true),
          prefix: String(body.prefix ?? couponForm.prefix),
        },
        ...p,
      ]);
      setCouponCode("");
    } catch {
      Alert.alert(
        "Network",
        "Could not reach the server. Check EXPO_PUBLIC_API_URL and that npm run dev is running.",
      );
    } finally {
      setCouponAttachLoading(false);
    }
  };

  const deleteCoupon = async (c: CouponRow) => {
    if (!user?.id) return;
    if (/^\d+$/.test(c.id)) {
      try {
        await apiFetch(`/api/organizers/${user.id}/coupons/${c.id}`, { method: "DELETE" });
      } catch {
        /* ignore */
      }
    }
    setCoupons((p) => p.filter((x) => x.id !== c.id));
  };

  const copyCoupon = async (code: string) => {
    try {
      await Share.share({ message: code });
    } catch {
      Alert.alert("Code", code);
    }
  };

  const filteredTz = useMemo(() => {
    const q = tzSearch.trim().toLowerCase();
    if (!q) return TIMEZONES_DATA;
    return TIMEZONES_DATA.filter(
      (t) =>
        t.city.toLowerCase().includes(q) || t.label.toLowerCase().includes(q),
    );
  }, [tzSearch]);

  const androidInlinePicker =
    pickerSlot && Platform.OS === "android" ? (
      <DateTimePicker
        value={pickerSlot === "sd" || pickerSlot === "st" ? startDt : endDt}
        mode={pickerSlot === "st" || pickerSlot === "et" ? "time" : "date"}
        display="default"
        onChange={onNativePickerChange}
      />
    ) : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
      >
        <Text style={styles.kicker}>Organizer Studio</Text>
        <Text style={styles.heroTitle}>Create Event</Text>
        <View style={styles.topRow}>
          <Pressable
            style={styles.pillBtn}
            onPress={() => navigation.navigate("Main")}
          >
            <Text style={styles.pillBtnText}>‹ Dashboard</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.bigName}
          placeholder="Event Name"
          placeholderTextColor="rgba(255,255,255,0.08)"
          value={name}
          onChangeText={setName}
        />

        <Pressable style={styles.bannerBox} onPress={pickBanner}>
          {bannerPreview ? (
            <Image source={{ uri: bannerPreview }} style={styles.bannerImg} />
          ) : (
            <View style={styles.bannerEmpty}>
              <Text style={styles.bannerEmptyTitle}>Upload Banner</Text>
              <Text style={styles.bannerEmptySub}>Tap to choose · PNG, JPG, WEBP</Text>
            </View>
          )}
        </Pressable>
        {bannerPreview ? (
          <View style={styles.bannerActions}>
            <Pressable onPress={pickBanner}>
              <Text style={styles.linkBtn}>Change</Text>
            </Pressable>
            <Pressable onPress={() => setBannerPreview(null)}>
              <Text style={[styles.linkBtn, { color: colors.danger }]}>Remove</Text>
            </Pressable>
          </View>
        ) : null}

        <Card style={styles.galleryCard}>
          <View style={styles.galleryHead}>
            <Text style={typography.label}>Gallery Images</Text>
            <Pressable style={styles.smallAdd} onPress={addGallery}>
              <Text style={styles.smallAddText}>+ Add Photos</Text>
            </Pressable>
          </View>
          {galleryUris.length === 0 ? (
            <Pressable style={styles.galleryEmpty} onPress={addGallery}>
              <Text style={styles.mutedXs}>Upload up to 10 photos</Text>
            </Pressable>
          ) : (
            <View style={styles.galleryGrid}>
              {galleryUris.map((uri) => (
                <View key={uri} style={styles.gThumbWrap}>
                  <Image source={{ uri }} style={styles.gThumb} />
                  <Pressable
                    style={styles.gRemove}
                    onPress={() => setGalleryUris((p) => p.filter((u) => u !== uri))}
                  >
                    <Text style={styles.gRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Collapsible
          label="Basic Info"
          open={sections.basic}
          onToggle={() => toggleSection("basic")}
        >
          <Text style={typography.label}>Theme / Category (multi-select)</Text>
          <View style={styles.chipWrap}>
            {THEMES.map((t) => (
              <Pressable
                key={t}
                onPress={() => toggleTheme(t)}
                style={[styles.chip, selectedThemes.includes(t) && styles.chipOn]}
              >
                <Text style={[styles.chipTxt, selectedThemes.includes(t) && styles.chipTxtOn]}>
                  {t}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[typography.label, { marginTop: 12 }]}>Duration</Text>
          <Pressable style={styles.selectFake} onPress={() => setDurationModal(true)}>
            <Text style={styles.selectFakeText}>{duration}</Text>
          </Pressable>
          <Text style={[typography.label, { marginTop: 12 }]}>Age Group</Text>
          <View style={styles.chipWrap}>
            {AGE_GROUPS.map((ag) => (
              <Pressable
                key={ag}
                onPress={() => setAgeGroup(ag)}
                style={[styles.chip, ageGroup === ag && styles.chipOn]}
              >
                <Text style={[styles.chipTxt, ageGroup === ag && styles.chipTxtOn]}>{ag}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[typography.label, { marginTop: 12 }]}>Languages (multi-select)</Text>
          <View style={styles.chipWrap}>
            {LANGUAGES.map((lang) => (
              <Pressable
                key={lang}
                onPress={() => toggleLanguage(lang)}
                style={[styles.chip, selectedLanguages.includes(lang) && styles.chipOn]}
              >
                <Text
                  style={[styles.chipTxt, selectedLanguages.includes(lang) && styles.chipTxtOn]}
                >
                  {lang}
                </Text>
              </Pressable>
            ))}
          </View>
        </Collapsible>

        <Collapsible
          label="Date & Time"
          open={sections.datetime}
          onToggle={() => toggleSection("datetime")}
        >
          <View style={styles.dtRow}>
            <View style={styles.dtDot} />
            <View>
              <Text style={typography.label}>Start</Text>
              <View style={styles.dtBtns}>
                <Pressable style={styles.dtChip} onPress={() => openPicker("sd")}>
                  <Text style={styles.dtChipTxt}>{formatShortDate(startDt)}</Text>
                </Pressable>
                <Pressable style={styles.dtChip} onPress={() => openPicker("st")}>
                  <Text style={styles.dtChipTxt}>{formatTime12h(startDt)}</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <View style={styles.dtRow}>
            <View style={[styles.dtDot, styles.dtDotFilled]} />
            <View style={{ flex: 1 }}>
              <Text style={typography.label}>End</Text>
              <View style={styles.dtEndRow}>
                <View style={styles.dtBtns}>
                  <Pressable style={styles.dtChip} onPress={() => openPicker("ed")}>
                    <Text style={styles.dtChipTxt}>{formatShortDate(endDt)}</Text>
                  </Pressable>
                  <Pressable style={styles.dtChip} onPress={() => openPicker("et")}>
                    <Text style={styles.dtChipTxt}>{formatTime12h(endDt)}</Text>
                  </Pressable>
                </View>
                <Pressable style={styles.tzBtn} onPress={() => setShowTzModal(true)}>
                  <Text style={styles.tzBtnTxt}>🌐 {timezone.offset}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Collapsible>

        <Collapsible
          label="Meetup Location"
          open={sections.location}
          onToggle={() => toggleSection("location")}
        >
          <Text style={typography.label}>Start / Meetup Point</Text>
          <View style={styles.locInputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="e.g. Gateway of India, Mumbai"
              placeholderTextColor={colors.muted2}
              value={meetupPoint}
              onChangeText={(t) => {
                setMeetupPoint(t);
                setStartCoords(null);
              }}
            />
            <Pressable
              style={[styles.locGpsBtn, locLoading === "start" && { opacity: 0.6 }]}
              disabled={locLoading !== null}
              onPress={() => void useCurrentLocation("start")}
            >
              <Text style={styles.locGpsBtnTxt}>{locLoading === "start" ? "…" : "📍"}</Text>
            </Pressable>
          </View>
          {startSuggestions.length > 0 ? (
            <View style={styles.suggestBox}>
              {startSuggestions.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.suggestRow}
                  onPress={() => {
                    Keyboard.dismiss();
                    setMeetupPoint(item.place_name);
                    setStartCoords({ lat: Number(item.center[1]), lng: Number(item.center[0]) });
                    setStartSuggestions([]);
                  }}
                >
                  <Text style={styles.suggestText}>{item.place_name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={[typography.label, { marginTop: 12 }]}>End / Drop-off Location</Text>
          <View style={styles.locInputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="e.g. Lonavala Station"
              placeholderTextColor={colors.muted2}
              value={endLocation}
              onChangeText={(t) => {
                setEndLocation(t);
                setEndCoords(null);
              }}
            />
            <Pressable
              style={[styles.locGpsBtn, locLoading === "end" && { opacity: 0.6 }]}
              disabled={locLoading !== null}
              onPress={() => void useCurrentLocation("end")}
            >
              <Text style={styles.locGpsBtnTxt}>{locLoading === "end" ? "…" : "📍"}</Text>
            </Pressable>
          </View>
          {endSuggestions.length > 0 ? (
            <View style={styles.suggestBox}>
              {endSuggestions.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.suggestRow}
                  onPress={() => {
                    Keyboard.dismiss();
                    setEndLocation(item.place_name);
                    setEndCoords({ lat: Number(item.center[1]), lng: Number(item.center[0]) });
                    setEndSuggestions([]);
                  }}
                >
                  <Text style={styles.suggestText}>{item.place_name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.mapPlaceholder}>
            <Text style={styles.mapPhTitle}>Map preview</Text>
            <MapboxCreatePreview start={startCoords} end={endCoords} />
            {startCoords ? (
              <Text style={styles.coordLine}>
                📍 {meetupPoint || "Start"} ({startCoords.lat.toFixed(5)}, {startCoords.lng.toFixed(5)})
              </Text>
            ) : null}
            {endCoords ? (
              <Text style={styles.coordLine}>
                🏁 {endLocation || "End"} ({endCoords.lat.toFixed(5)}, {endCoords.lng.toFixed(5)})
              </Text>
            ) : null}
          </View>
        </Collapsible>

        <Collapsible
          label="Trip checkpoints"
          open={sections.checkpoints}
          onToggle={() => toggleSection("checkpoints")}
        >
          <Text style={styles.mutedXs}>
            Add stops along the route. Tap community-saved attractions, or build the list from the web editor for
            precise pins.
          </Text>
          {nearbyAttractions.length > 0 ? (
            <>
              <Text style={[typography.label, { marginTop: 12 }]}>Nearby attractions (database)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {nearbyAttractions.map((a) => (
                  <Pressable
                    key={a.id}
                    style={styles.attrChip}
                    onPress={() => {
                      setCheckpointDrafts((p) => [
                        ...p,
                        { name: a.name, lat: a.lat, lng: a.lng, xp: 50, badge: "📍" },
                      ]);
                    }}
                  >
                    <Text style={styles.attrChipTxt} numberOfLines={2}>
                      + {a.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
          <Text style={[typography.label, { marginTop: 14 }]}>Planned checkpoints ({checkpointDrafts.length})</Text>
          {checkpointDrafts.length === 0 ? (
            <Text style={[styles.mutedXs, { marginTop: 6 }]}>None yet — tap attractions above when available.</Text>
          ) : (
            checkpointDrafts.map((c, i) => (
              <View key={`${c.name}-${i}`} style={styles.cpDraftRow}>
                <Text style={styles.cpDraftTxt} numberOfLines={2}>
                  {i + 1}. {c.name} ({c.lat.toFixed(4)}, {c.lng.toFixed(4)})
                </Text>
                <Pressable onPress={() => setCheckpointDrafts((p) => p.filter((_, j) => j !== i))}>
                  <Text style={{ color: colors.danger, fontWeight: "700" }}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </Collapsible>

        <Collapsible
          label="Capacity & Pricing"
          open={sections.capacity}
          onToggle={() => toggleSection("capacity")}
        >
          <Text style={typography.label}>Max Participants</Text>
          <View style={styles.stepRow}>
            <Pressable
              style={styles.stepBtn}
              onPress={() => setMaxParticipants((n) => Math.max(1, n - 1))}
            >
              <Text style={styles.stepBtnTxt}>−</Text>
            </Pressable>
            <TextInput
              style={styles.stepInput}
              keyboardType="number-pad"
              value={String(maxParticipants)}
              onChangeText={(t) =>
                setMaxParticipants(Math.max(1, parseInt(t.replace(/\D/g, ""), 10) || 1))
              }
            />
            <Pressable style={styles.stepBtn} onPress={() => setMaxParticipants((n) => n + 1)}>
              <Text style={styles.stepBtnTxt}>+</Text>
            </Pressable>
          </View>

          <Text style={[typography.label, { marginTop: 14 }]}>Ticket Price</Text>
          <View style={styles.freePaidRow}>
            <Pressable
              style={[styles.freePaidBtn, isFree && styles.freePaidOn]}
              onPress={() => {
                setIsFree(true);
                setPrice("");
              }}
            >
              <Text style={[styles.freePaidTxt, isFree && styles.freePaidTxtOn]}>Free</Text>
            </Pressable>
            <Pressable
              style={[styles.freePaidBtn, !isFree && styles.freePaidOn]}
              onPress={() => setIsFree(false)}
            >
              <Text style={[styles.freePaidTxt, !isFree && styles.freePaidTxtOn]}>Paid</Text>
            </Pressable>
          </View>
          {!isFree ? (
            <View style={styles.rupeeRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={[styles.input, { flex: 1, paddingLeft: 28 }]}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.muted2}
                value={price}
                onChangeText={setPrice}
              />
            </View>
          ) : null}

          <View style={styles.approvalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.approvalTitle}>Require Approval</Text>
              <Text style={styles.mutedXs}>Manually approve joiners before payment</Text>
            </View>
            <Switch
              value={requireApproval}
              onValueChange={setRequireApproval}
              trackColor={{ false: "rgba(255,255,255,0.15)", true: colors.text }}
              thumbColor={requireApproval ? colors.bg : "rgba(255,255,255,0.4)"}
            />
          </View>
        </Collapsible>

        <Collapsible
          label="About the Event"
          open={sections.about}
          onToggle={() => toggleSection("about")}
        >
          <TextInput
            style={styles.textarea}
            multiline
            placeholder="Describe your expedition…"
            placeholderTextColor={colors.muted2}
            value={description}
            onChangeText={setDescription}
          />
        </Collapsible>

        <Collapsible
          label="Prerequisites & Terms"
          open={sections.requirements}
          onToggle={() => toggleSection("requirements")}
        >
          <Text style={typography.label}>Prerequisites</Text>
          <TextInput
            style={styles.textareaSm}
            multiline
            placeholder="Valid license, own gear…"
            placeholderTextColor={colors.muted2}
            value={prerequisites}
            onChangeText={setPrerequisites}
          />
          <Text style={[typography.label, { marginTop: 12 }]}>Terms & Conditions</Text>
          <TextInput
            style={styles.textareaSm}
            multiline
            placeholder="No refunds within 24h, helmet mandatory…"
            placeholderTextColor={colors.muted2}
            value={terms}
            onChangeText={setTerms}
          />
        </Collapsible>

        <Collapsible
          label="Organizer Contact"
          open={sections.contact}
          onToggle={() => toggleSection("contact")}
        >
          <Text style={typography.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="John Doe"
            placeholderTextColor={colors.muted2}
            value={contactName}
            onChangeText={setContactName}
          />
          <Text style={[typography.label, { marginTop: 10 }]}>Phone</Text>
          <TextInput
            style={styles.input}
            placeholder="+91 98765 43210"
            placeholderTextColor={colors.muted2}
            keyboardType="phone-pad"
            value={contactPhone}
            onChangeText={setContactPhone}
          />
          <Text style={[typography.label, { marginTop: 10 }]}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="organizer@email.com"
            placeholderTextColor={colors.muted2}
            keyboardType="email-address"
            autoCapitalize="none"
            value={contactEmail}
            onChangeText={setContactEmail}
          />
        </Collapsible>

        <Collapsible
          label="Coupon Generator"
          open={sections.coupons}
          onToggle={() => toggleSection("coupons")}
        >
          <View style={styles.couponGrid}>
            <View style={{ flex: 1 }}>
              <Text style={typography.label}>Prefix</Text>
              <TextInput
                style={styles.input}
                value={couponForm.prefix}
                onChangeText={(t) =>
                  setCouponForm((p) => ({ ...p, prefix: t.toUpperCase().slice(0, 8) }))
                }
                maxLength={8}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={typography.label}>Discount %</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={String(couponForm.discount)}
                onChangeText={(t) =>
                  setCouponForm((p) => ({
                    ...p,
                    discount: Math.min(100, Math.max(1, parseInt(t, 10) || 1)),
                  }))
                }
              />
            </View>
          </View>
          <View style={styles.couponGrid}>
            <View style={{ flex: 1 }}>
              <Text style={typography.label}>Usage Limit</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={String(couponForm.limit)}
                onChangeText={(t) =>
                  setCouponForm((p) => ({
                    ...p,
                    limit: Math.max(1, parseInt(t, 10) || 1),
                  }))
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={typography.label}>Expires (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                placeholder="optional"
                placeholderTextColor={colors.muted2}
                value={couponForm.expiry}
                onChangeText={(t) => setCouponForm((p) => ({ ...p, expiry: t }))}
              />
            </View>
          </View>
          {couponCode ? (
            <View style={styles.couponCodeBar}>
              <Text style={styles.couponCodeTxt} selectable>
                {couponCode}
              </Text>
              <Pressable onPress={() => void copyCoupon(couponCode)}>
                <Text style={styles.couponShareLink}>Share</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.couponActions}>
            <Pressable
              style={styles.outlineBtn}
              onPress={() => setCouponCode(generateCouponCode(couponForm.prefix))}
            >
              <Text style={styles.outlineBtnTxt}>
                {couponCode ? "New Code" : "Generate"}
              </Text>
            </Pressable>
            {couponCode ? (
              <Pressable
                style={[styles.outlineBtn, styles.attachBtn]}
                disabled={couponAttachLoading}
                onPress={() => void attachCoupon()}
              >
                {couponAttachLoading ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.attachBtnTxt}>Attach</Text>
                )}
              </Pressable>
            ) : null}
          </View>
          {coupons.length > 0 ? (
            <View style={{ marginTop: 12 }}>
              <Text style={typography.label}>
                {coupons.length} coupon{coupons.length > 1 ? "s" : ""} attached
              </Text>
              {coupons.map((c) => (
                <View key={c.id} style={styles.couponCard}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={styles.couponCardCode}>{c.code}</Text>
                      <Badge variant={c.active ? "success" : "default"}>
                        {c.active ? "Active" : "Paused"}
                      </Badge>
                    </View>
                    <Text style={styles.mutedXs}>
                      {c.discount}% off · {c.used}/{c.limit} used · {c.expiry}
                    </Text>
                  </View>
                  <Pressable onPress={() => void deleteCoupon(c)}>
                    <Text style={{ color: colors.danger, fontWeight: "700" }}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </Collapsible>

        {privacy === "Private" ? (
          <View style={styles.privateBox}>
            <View style={styles.privateHead}>
              <Text style={styles.privateTitle}>🔒 Private Invite List</Text>
              {invites.length > 0 ? (
                <Text style={styles.inviteCount}>{invites.length} invites</Text>
              ) : null}
            </View>
            <Text style={styles.mutedXs}>
              Add participants by phone number or email. They will receive an exclusive access link.
            </Text>
            <View style={styles.inviteRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Phone number or email…"
                placeholderTextColor={colors.muted2}
                value={inviteInput}
                onChangeText={setInviteInput}
                onSubmitEditing={addInvite}
              />
              <Pressable style={styles.addInvBtn} onPress={addInvite}>
                <Text style={styles.addInvBtnTxt}>Add</Text>
              </Pressable>
            </View>
            {invites.length > 0 ? (
              invites.map((inv, i) => (
                <View key={`${inv.value}-${i}`} style={styles.inviteItem}>
                  <Text style={styles.inviteVal}>{inv.value}</Text>
                  <Badge variant={inv.type === "email" ? "default" : "warning"}>{inv.type}</Badge>
                  <Pressable onPress={() => setInvites((p) => p.filter((_, idx) => idx !== i))}>
                    <Text style={{ color: colors.muted }}>✕</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={[styles.mutedXs, { textAlign: "center", paddingVertical: 16 }]}>
                No invites yet
              </Text>
            )}
          </View>
        ) : null}

        <Card style={styles.previewCard}>
          <Text style={typography.label}>Event Preview</Text>
          {[
            ["Name", name || "—"],
            ["Themes", selectedThemes.join(", ") || "—"],
            ["Date", formatShortDate(startDt)],
            ["Capacity", String(maxParticipants)],
            ["Price", isFree ? "Free" : price ? `₹${price}` : "—"],
            ["Languages", selectedLanguages.join(", ") || "—"],
            ["Age Group", ageGroup],
            ["Privacy", privacy],
            ...(invites.length ? [["Invites", `${invites.length} added`] as [string, string]] : []),
            ...(coupons.length
              ? [["Coupons", `${coupons.length} active`] as [string, string]]
              : []),
          ].map(([k, v]) => (
            <View key={k} style={styles.previewRow}>
              <Text style={styles.previewK}>{k}</Text>
              <Text style={styles.previewV} numberOfLines={2}>
                {v}
              </Text>
            </View>
          ))}
        </Card>

        <View style={styles.privacyRow}>
          <Text style={typography.label}>Privacy</Text>
          <View style={styles.privacyChips}>
            <Pressable
              style={[styles.privacyChip, privacy === "Public" && styles.privacyChipOn]}
              onPress={() => setPrivacy("Public")}
            >
              <Text style={[styles.privacyChipTxt, privacy === "Public" && styles.privacyChipTxtOn]}>
                🌐 Public
              </Text>
            </Pressable>
            <Pressable
              style={[styles.privacyChip, privacy === "Private" && styles.privacyChipOn]}
              onPress={() => setPrivacy("Private")}
            >
              <Text style={[styles.privacyChipTxt, privacy === "Private" && styles.privacyChipTxtOn]}>
                🔒 Private
              </Text>
            </Pressable>
          </View>
          <Text style={styles.mutedXs}>
            Public trips appear on Explore. Private is invite-only.
          </Text>
        </View>

        <Pressable style={styles.saveDraftBottom} onPress={() => void saveDraft()}>
          <Text style={styles.saveDraftBottomTxt}>Save Draft</Text>
        </Pressable>

        <Pressable
          style={[styles.publishBtn, busy && { opacity: 0.65 }]}
          onPress={() => void publish()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.publishTxt}>✦ Publish Event</Text>
          )}
        </Pressable>
        <Text style={styles.footnote}>Event will be reviewed before going live</Text>
      </ScrollView>

      {androidInlinePicker}

      {pickerSlot !== null && Platform.OS === "ios" ? (
        <Modal transparent visible animationType="slide">
          <View style={styles.iosPickerWrap}>
            <Pressable style={styles.iosBackdrop} onPress={closeNativePicker} />
            <View style={styles.iosPickerSheet}>
              <DateTimePicker
                value={pickerSlot === "sd" || pickerSlot === "st" ? startDt : endDt}
                mode={pickerSlot === "st" || pickerSlot === "et" ? "time" : "date"}
                display="spinner"
                themeVariant="dark"
                onChange={onNativePickerChange}
              />
              <Pressable style={styles.iosPickerDone} onPress={closeNativePicker}>
                <Text style={styles.iosPickerDoneTxt}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal visible={showTzModal} transparent animationType="slide">
        <View style={styles.tzModalWrap}>
          <View style={styles.tzSheet}>
            <Text style={styles.optTitle}>Timezone</Text>
            <TextInput
              style={styles.input}
              placeholder="Search city…"
              placeholderTextColor={colors.muted2}
              value={tzSearch}
              onChangeText={setTzSearch}
            />
            <FlatList
              data={filteredTz}
              keyExtractor={(item) => item.city}
              keyboardShouldPersistTaps="always"
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const os = offsetToStr(item.offset);
                return (
                  <Pressable
                    style={styles.tzRow}
                    onPress={() => {
                      setTimezone({
                        name: `${item.label} - ${item.city}`,
                        offset: os,
                        city: item.city,
                      });
                      setShowTzModal(false);
                      setTzSearch("");
                    }}
                  >
                    <View>
                      <Text style={styles.tzCity}>{item.city}</Text>
                      <Text style={styles.tzLab}>{item.label}</Text>
                    </View>
                    <Text style={styles.tzOff}>{os}</Text>
                  </Pressable>
                );
              }}
            />
            <Pressable
              style={[styles.outlineBtn, { alignItems: "center", marginTop: 8, paddingVertical: 12 }]}
              onPress={() => setShowTzModal(false)}
            >
              <Text style={styles.outlineBtnTxt}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <OptionModal
        visible={durationModal}
        title="Duration"
        options={DURATIONS}
        onSelect={setDuration}
        onClose={() => setDurationModal(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 48, backgroundColor: colors.bg },
  kicker: { ...typography.label, marginBottom: 6 },
  heroTitle: { ...typography.hero, fontSize: 32, lineHeight: 38, marginBottom: 8 },
  topRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillBtnText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  attrChip: {
    maxWidth: 160,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginRight: 8,
  },
  attrChipTxt: { color: colors.text, fontSize: 12, fontWeight: "700" },
  cpDraftRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cpDraftTxt: { flex: 1, color: colors.text, fontSize: 13 },
  bigName: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 16,
    paddingVertical: 4,
  },
  bannerBox: {
    aspectRatio: 1,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    marginBottom: 8,
    backgroundColor: "#0a0a0a",
  },
  bannerImg: { width: "100%", height: "100%" },
  bannerEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  bannerEmptyTitle: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  bannerEmptySub: { color: colors.muted2, fontSize: 11, marginTop: 6 },
  bannerActions: { flexDirection: "row", gap: 16, marginBottom: 12 },
  linkBtn: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  galleryCard: { padding: 14, marginBottom: 12 },
  galleryHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  smallAdd: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallAddText: { fontSize: 10, fontWeight: "700", color: colors.muted },
  galleryEmpty: {
    height: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gThumbWrap: { width: "30%", aspectRatio: 1, borderRadius: 12, overflow: "hidden" },
  gThumb: { width: "100%", height: "100%" },
  gRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  gRemoveText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  sectionOuter: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
    marginBottom: 10,
    overflow: "hidden",
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionHeadText: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "700" },
  chevron: { color: colors.muted2, fontSize: 12 },
  sectionInner: { paddingHorizontal: 16, paddingBottom: 16 },
  selectFake: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  selectFakeText: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipTxt: { fontSize: 11, fontWeight: "700", color: colors.muted },
  chipTxtOn: { color: colors.bg },
  tagChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tagChipTxt: { fontSize: 10, fontWeight: "700", color: colors.muted },
  selTag: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  selTagTxt: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.6)" },
  dtRow: { flexDirection: "row", gap: 10, marginBottom: 12, alignItems: "flex-start" },
  dtDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 22,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  dtDotFilled: {
    borderWidth: 0,
    backgroundColor: "#fff",
    shadowColor: "#fff",
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  dtBtns: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  dtChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dtChipTxt: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.7)" },
  dtEndRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  tzBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tzBtnTxt: { fontSize: 11, fontWeight: "700", color: colors.muted },
  suggestBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginTop: 6,
    maxHeight: 160,
    backgroundColor: colors.surface,
    zIndex: 100,
    elevation: 12,
    overflow: "hidden",
  },
  locInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  locGpsBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  locGpsBtnTxt: { fontSize: 18 },
  suggestRow: { paddingHorizontal: 12, paddingVertical: 10 },
  suggestText: { fontSize: 12, color: "rgba(255,255,255,0.75)" },
  mapPlaceholder: {
    marginTop: 12,
    minHeight: 200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    overflow: "hidden",
  },
  mapImage: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: "#0a0a0a",
  },
  mapPhTitle: { fontWeight: "700", color: colors.muted, marginBottom: 6 },
  coordLine: { fontSize: 11, color: colors.emerald, marginTop: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  stepBtnTxt: { fontSize: 20, color: colors.muted, fontWeight: "700" },
  stepInput: {
    flex: 1,
    textAlign: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    color: colors.text,
    fontWeight: "800",
  },
  freePaidRow: { flexDirection: "row", gap: 8 },
  freePaidBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  freePaidOn: { backgroundColor: colors.text, borderColor: colors.text },
  freePaidTxt: { fontSize: 12, fontWeight: "700", color: colors.muted },
  freePaidTxtOn: { color: colors.bg },
  rupeeRow: { position: "relative", marginTop: 8 },
  rupee: {
    position: "absolute",
    left: 14,
    top: 13,
    zIndex: 1,
    fontWeight: "800",
    color: colors.muted2,
  },
  approvalRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  approvalTitle: { fontSize: 14, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  textarea: {
    minHeight: 120,
    borderWidth: 0,
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    lineHeight: 22,
  },
  textareaSm: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 12,
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
  },
  couponGrid: { flexDirection: "row", gap: 10, marginBottom: 10 },
  couponCodeBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 10,
  },
  couponCodeTxt: {
    flex: 1,
    marginRight: 8,
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 1,
  },
  couponShareLink: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  couponActions: { flexDirection: "row", gap: 8 },
  outlineBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  outlineBtnTxt: { fontSize: 12, fontWeight: "700", color: colors.muted },
  attachBtn: { backgroundColor: colors.text, borderColor: colors.text },
  attachBtnTxt: { fontSize: 12, fontWeight: "800", color: colors.bg },
  couponCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  couponCardCode: { fontWeight: "800", letterSpacing: 1 },
  privateBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    backgroundColor: "rgba(245,158,11,0.06)",
    padding: 14,
    marginBottom: 12,
  },
  privateHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  privateTitle: { fontSize: 14, fontWeight: "800", color: "rgba(255,255,255,0.85)" },
  inviteCount: { fontSize: 12, fontWeight: "800", color: colors.warn },
  inviteRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  addInvBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.text,
    justifyContent: "center",
  },
  addInvBtnTxt: { fontWeight: "800", color: colors.bg, fontSize: 12 },
  inviteItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginTop: 8,
  },
  inviteVal: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 13 },
  previewCard: { padding: 16, marginBottom: 16 },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 12,
  },
  previewK: { fontSize: 12, color: colors.muted },
  previewV: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.85)", flex: 1, textAlign: "right" },
  privacyRow: { marginBottom: 12 },
  privacyChips: { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 6 },
  privacyChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  privacyChipOn: { backgroundColor: colors.text, borderColor: colors.text },
  privacyChipTxt: { fontSize: 13, fontWeight: "700", color: colors.muted },
  privacyChipTxtOn: { color: colors.bg },
  saveDraftBottom: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  saveDraftBottomTxt: { color: colors.muted, fontWeight: "700", fontSize: 14 },
  publishBtn: {
    backgroundColor: colors.text,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 8,
  },
  publishTxt: { color: colors.bg, fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  footnote: {
    textAlign: "center",
    fontSize: 10,
    color: "rgba(255,255,255,0.2)",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 24,
  },
  mutedXs: { fontSize: 11, color: colors.muted2, lineHeight: 16 },
  optModalWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  optSheetCentered: {
    backgroundColor: "#111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    maxHeight: "80%",
  },
  optTitle: { ...typography.label, marginBottom: 8, textAlign: "center" },
  optRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  optRowText: { color: colors.text, fontSize: 14 },
  iosPickerWrap: { flex: 1, justifyContent: "flex-end" },
  iosBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  iosPickerSheet: {
    backgroundColor: "#111",
    paddingBottom: 28,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
  },
  iosPickerDone: { alignItems: "center", paddingVertical: 14 },
  iosPickerDoneTxt: { color: colors.text, fontWeight: "800", fontSize: 16 },
  tzModalWrap: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  tzSheet: {
    backgroundColor: "#111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  tzRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  tzCity: { fontSize: 14, fontWeight: "600", color: colors.text },
  tzLab: { fontSize: 10, color: colors.muted2, marginTop: 2 },
  tzOff: { fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: colors.muted2 },
});
