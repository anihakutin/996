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

  // Now require lat/lon for both nearby and 5-mile views
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: "lat/lon required for viewing others" });
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

// Link preview page that serves Open Graph / Twitter meta with a static map
app.get(["/share/:id", "/share"], async (req, res) => {
  try {
    const id = req.params.id;
    let user = null;
    if (id) {
      const r = await pool.query("SELECT * FROM live_users WHERE id=$1 AND is_active=true AND updated_at > NOW() - INTERVAL '1 hour'", [id]);
      user = r.rows[0] || null;
    }

    const siteUrl = process.env.SITE_URL || (req.protocol + '://' + req.get('host'));
    const shareUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    const title = user ? `${user.name} is locked in on 996NearMe` : `996NearMe — Lock in and meet nearby builders`;
    const desc = user ? `Join ${user.name}${user.venue_name ? ` at ${user.venue_name}` : ''} and other 996’ers nearby.` : `Share your live pin and see who is building around you.`;

    // Build a static map image URL (OSM staticmap). If no user, show NYC default.
    const lat = user?.lat ?? 40.73061;
    const lon = user?.lon ?? -73.935242;
    const zoom = user ? 16 : 12;
    const markerColor = user ? 'red1' : 'lightblue1';
    const imgUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=${zoom}&size=800x418&maptype=mapnik&markers=${lat},${lon},${markerColor}`;

    // Serve minimal HTML with OG/Twitter tags for crawlers, and redirect humans to the app
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="canonical" href="${shareUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:url" content="${shareUrl}" />
  <meta property="og:image" content="${imgUrl}" />
  <meta property="og:image:width" content="800" />
  <meta property="og:image:height" content="418" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imgUrl}" />
  <meta name="robots" content="noindex" />
</head>
<body>
  <p><a href="${siteUrl}">Open 996NearMe</a></p>
  <script>
    (function(){
      var isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|linkedinbot|slackbot/i.test(navigator.userAgent);
      if(!isBot){ setTimeout(function(){ location.replace(${JSON.stringify(siteUrl)}); }, 500); }
    })();
  </script>
</body>
</html>`);
  } catch (e) {
    console.error(e);
    res.redirect(302, "/");
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`996'ers Near Me running on http://localhost:${port}`);
});
