import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

dotenv.config();
const { Pool } = pkg;

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: process.env.ORIGIN || true }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });


// Simple haversine (meters)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// No more auto-deletion - just filter by lock-in time

async function getAllLive() {
  const { rows } = await pool.query(
    "SELECT * FROM live_users WHERE is_active=true AND updated_at > NOW() - INTERVAL '1 hour' ORDER BY updated_at DESC"
  );
  return rows;
}

// Lock in (create/update)
app.post("/api/lockin", async (req, res) => {
  try {
    const {
      id, name, x_handle, photo_url, what_working_on, lat, lon, is_venue, venue_name
    } = req.body;

    if (!name || typeof lat !== "number" || typeof lon !== "number") {
      return res.status(400).json({ error: "name, lat, lon required" });
    }

    let uid = id;

    // If no ID provided, try to find existing user by x_handle
    if (!uid && x_handle) {
      const { rows: existing } = await pool.query(
        "SELECT id FROM live_users WHERE x_handle = $1 LIMIT 1",
        [x_handle]
      );
      if (existing.length > 0) {
        uid = existing[0].id;
      }
    }

    // Generate new ID if still none
    if (!uid) {
      uid = uuidv4();
    }

    const upsert = `
      INSERT INTO live_users (id, name, x_handle, photo_url, what_working_on, lat, lon, is_venue, venue_name, updated_at, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),true)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        x_handle = EXCLUDED.x_handle,
        photo_url = EXCLUDED.photo_url,
        what_working_on = EXCLUDED.what_working_on,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        is_venue = EXCLUDED.is_venue,
        venue_name = EXCLUDED.venue_name,
        updated_at = NOW(),
        is_active = true
      RETURNING *;
    `;
    const { rows } = await pool.query(upsert, [
      uid, name, x_handle || null, photo_url || null, what_working_on || null,
      lat, lon, is_venue || false, venue_name || null
    ]);

    // Broadcast presence delta
    io.emit("presence:update", rows[0]);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "lockin failed" });
  }
});

// Done (mark inactive)
app.post("/api/done", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });
    const { rows } = await pool.query("UPDATE live_users SET is_active=false WHERE id=$1 RETURNING id", [id]);
    if (rows.length) io.emit("presence:remove", { id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "done failed" });
  }
});

// Initial presence load
app.get("/api/active", async (req, res) => {
  const nearby = req.query.nearby === 'true';
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (nearby && (Number.isNaN(lat) || Number.isNaN(lon))) {
    return res.status(400).json({ error: "lat/lon required for nearby filter" });
  }

  if (nearby) {
    // Use SQL-based distance calculation for nearby users (100 feet)
    const { rows } = await pool.query(`
      SELECT *,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance
      FROM live_users
      WHERE is_active = true
        AND updated_at > NOW() - INTERVAL '1 hour'
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          30.48
        )
      ORDER BY distance ASC
    `, [lon, lat]);
    res.json(rows);
  } else {
    // Show all users within 5 miles (8046.72 meters) - never truly "all"
    const { rows } = await pool.query(`
      SELECT *,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance
      FROM live_users
      WHERE is_active = true
        AND updated_at > NOW() - INTERVAL '1 hour'
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          8046.72
        )
      ORDER BY distance ASC
    `, [lon, lat]);
    res.json(rows);
  }
});

// Nearby within 100 ft (30.48m)
app.get("/api/nearby", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: "lat/lon required" });
  }
  const { rows } = await pool.query(
    "SELECT * FROM live_users WHERE is_active=true AND updated_at > NOW() - INTERVAL '1 hour'"
  );
  const within = rows.filter(r => haversine(lat, lon, r.lat, r.lon) <= 30.48);
  res.json(within);
});

// Café check via Overpass (OSM)
app.get("/api/cafes", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: "lat/lon required" });
  }
  // Search 30m radius for amenity=cafe
  const radius = 30;
  const query = `
    [out:json][timeout:10];
    (
      node["amenity"="cafe"](around:${radius},${lat},${lon});
      way["amenity"="cafe"](around:${radius},${lat},${lon});
      relation["amenity"="cafe"](around:${radius},${lat},${lon});
    );
    out center tags;
  `.trim();

  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query
    });
    const data = await r.json();
    const cafes = (data.elements || []).map(el => ({
      id: el.id,
      name: el.tags?.name || "Unnamed Café",
      lat: el.lat || el.center?.lat,
      lon: el.lon || el.center?.lon
    })).filter(c => c.lat && c.lon);

    res.json(cafes);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "overpass failed" });
  }
});

io.on("connection", async (socket) => {
  socket.emit("presence:full", await getAllLive());
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`996'ers Near Me running on http://localhost:${port}`);
});
