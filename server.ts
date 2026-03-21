import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { createSupabaseServerClient } from "./src/lib/supabaseServerClient";

const app = express();
dotenv.config();

async function startServer() {
  const supabase = createSupabaseServerClient();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // Auth API (Supabase)
  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name, role } = req.body;
    console.log("Signup attempt:", { email, name, role });

    try {
      // Create auth user
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
        });

      if (signUpError || !signUpData.user) {
        console.error("Supabase signup error:", signUpError?.message);
        return res.status(400).json({ error: "Unable to sign up user" });
      }

      const authUser = signUpData.user;

      // Create profile row in public.users
      const { data: userRow, error: userError } = await supabase
        .from("users")
        .insert({ email, name, role })
        .select()
        .single();

      if (userError) {
        console.error("Supabase users insert error:", userError.message);
        return res
          .status(400)
          .json({ error: "Unable to create user profile" });
      }

      console.log("Signup success:", userRow.id, authUser.id);
      res.json({ ...userRow, auth_user_id: authUser.id });
    } catch (e: any) {
      console.error("Signup error details:", e);
      res.status(400).json({ error: "Signup failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password, role } = req.body;
    console.log("Login attempt:", { email, role });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      console.log("Login failed:", error?.message);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { data: userRow, error: profileError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("role", role)
      .single();

    if (profileError || !userRow) {
      console.log("Login failed: role mismatch or profile missing");
      return res
        .status(401)
        .json({ error: "Invalid credentials or role mismatch" });
    }

    console.log("Login success:", userRow.id);
    res.json({
      ...userRow,
      auth_user_id: data.user.id,
      access_token: data.session?.access_token,
    });
  });

  // Sync authenticated Supabase user into public.users (for OAuth like Google)
  app.post("/api/auth/sync", async (req, res) => {
    const { email, name, role } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    try {
      const { data, error } = await supabase
        .from("users")
        .upsert(
          {
            email,
            name,
            role: role || "user",
          },
          { onConflict: "email,role" }
        )
        .select()
        .single();

      if (error || !data) {
        console.error("Supabase auth sync error:", error?.message);
        return res.status(400).json({ error: "Failed to sync user profile" });
      }

      return res.json(data);
    } catch (e: any) {
      console.error("Auth sync error:", e);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  // Trips API (Supabase)
  app.get("/api/trips", async (req, res) => {
    const { theme, privacy } = req.query;

    let query = supabase.from("trips").select("*");

    if (privacy) {
      query = query.eq("privacy", privacy);
    } else {
      query = query.eq("privacy", "public");
    }

    if (theme) {
      query = query.eq("theme", theme);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase get trips error:", error.message);
      return res.status(500).json({ error: "Failed to fetch trips" });
    }

    res.json(data ?? []);
  });

  app.get("/api/trips/:id", async (req, res) => {
    const tripId = Number(req.params.id);
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    const { data: checkpoints, error: cpError } = await supabase
      .from("checkpoints")
      .select("*")
      .eq("trip_id", tripId);

    if (cpError) {
      console.error("Supabase checkpoints error:", cpError.message);
      return res.status(500).json({ error: "Failed to fetch checkpoints" });
    }

    res.json({ ...trip, checkpoints: checkpoints ?? [] });
  });

  app.post("/api/trips", async (req, res) => {
    const {
      organizer_id,
      name,
      description,
      theme,
      date,
      time,
      duration,
      price,
      max_participants,
      meetup_lat,
      meetup_lng,
      privacy,
      banner_url,
      start_location,
      end_location,
      prerequisites,
      terms,
      tags,
    } = req.body;

    const { data, error } = await supabase
      .from("trips")
      .insert({
        organizer_id,
        name,
        description,
        theme,
        date,
        time,
        duration,
        price,
        max_participants,
        meetup_lat,
        meetup_lng,
        privacy,
        banner_url,
        start_location,
        end_location,
        prerequisites,
        terms,
        tags: typeof tags === "string" ? tags : JSON.stringify(tags),
      })
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase create trip error:", error?.message);
      return res.status(400).json({ error: "Failed to create trip" });
    }

    res.json({ id: data.id });
  });

  app.patch("/api/trips/:id/status", async (req, res) => {
    const tripId = Number(req.params.id);
    const { status } = req.body;

    const { error } = await supabase
      .from("trips")
      .update({ status })
      .eq("id", tripId);

    if (error) {
      console.error("Supabase update trip status error:", error.message);
      return res.status(400).json({ error: "Failed to update status" });
    }

    res.json({ success: true });
  });

  // Bookings API (Supabase)
  app.post("/api/bookings", async (req, res) => {
    const { trip_id, user_id } = req.body;
    const { data, error } = await supabase
      .from("bookings")
      .insert({ trip_id, user_id })
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase create booking error:", error?.message);
      return res.status(400).json({ error: "Failed to create booking" });
    }

    res.json({ id: data.id });
  });

  app.get("/api/users/:id/bookings", async (req, res) => {
    const userId = Number(req.params.id);

    const { data, error } = await supabase
      .from("bookings_with_trip")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      console.error("Supabase user bookings error:", error.message);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    res.json(data ?? []);
  });

  // Real-time Socket Logic
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-trip", (tripId) => {
      socket.join(`trip-${tripId}`);
      console.log(`Socket ${socket.id} joined trip-${tripId}`);
    });

    socket.on("update-location", ({ tripId, userId, lat, lng }) => {
      io.to(`trip-${tripId}`).emit("location-updated", { userId, lat, lng });
    });

    socket.on("send-message", ({ tripId, userId, message }) => {
      io.to(`trip-${tripId}`).emit("new-message", { userId, message, timestamp: new Date() });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
  // Trip messages (Group Chat) API
  app.get("/api/trips/:id/messages", async (req, res) => {
    const tripId = Number(req.params.id);

    const { data, error } = await supabase
      .from("trip_messages")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("Supabase get messages error:", error.message);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }

    res.json(data ?? []);
  });

  app.post("/api/trips/:id/messages", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: "user_id and message are required" });
    }

    const { data, error } = await supabase
      .from("trip_messages")
      .insert({ trip_id: tripId, user_id, message })
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase create message error:", error?.message);
      return res.status(400).json({ error: "Failed to send message" });
    }

    res.json(data);
  });
