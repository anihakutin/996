# 996NearMe

Share your lock-in and see 996’ers nearby. Node.js + Express backend, PostgreSQL/PostGIS for geo queries, and a Leaflet map frontend.

## Requirements

- Node.js 20+
- PostgreSQL 15+
- PostGIS extension enabled
- Optional: Docker + Docker Compose

## Quick Start (Local)

1) Clone and enter the repo
```bash
git clone <your-repo-url>
cd 996
```

2) Create `.env` from the template and set your database URL
```bash
cp env.example .env
# Edit .env and set DATABASE_URL, e.g.
# DATABASE_URL=postgresql://996ers_user:your_secure_password@localhost:5432/996ers
```

3) Create database, enable PostGIS, and apply schema
```bash
createdb 996ers
psql -d 996ers -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d 996ers -f db.sql
```

4) Install dependencies and start the server
```bash
npm install
npm start
```

5) Open the app
- Visit http://localhost:3000
- Allow location access in your browser to see nearby users

Notes:
- Geolocation typically works on http://localhost without HTTPS; production should use HTTPS.
- If you see distance-query errors, ensure PostGIS is enabled in your DB.

## Quick Start (Docker Compose)

1) Copy env template and (optionally) set a Postgres password
```bash
cp env.example .env
# Optionally edit .env to set POSTGRES_PASSWORD and ORIGIN
```

2) Start services
```bash
docker compose up -d
```

3) Open the app
- Visit http://localhost:3000

Docker Compose will:
- Start Postgres 15 and initialize schema from `db.sql`
- Start the Node.js app on port 3000
- Optionally run Nginx if kept in `docker-compose.yml`

## Environment Variables

- DATABASE_URL: Postgres connection string (required for local non-Docker runs)
- PORT: App port (default: 3000)
- ORIGIN: CORS allowlist origin (set your site URL in prod)
- SITE_URL: Public site URL for share pages (defaults to request host)

## Scripts

```bash
npm start   # Start server (production mode)
npm run dev # Start in development mode
```

## Troubleshooting

- Check PostGIS:
```bash
psql -d 996ers -c "SELECT PostGIS_version();"
psql -d 996ers -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

- Database connectivity:
```bash
pg_isready
# Verify DATABASE_URL in .env and that DB exists
```

- No users visible:
- Allow location access in the browser.
- Click “Lock In” to share your own pin and verify presence.
