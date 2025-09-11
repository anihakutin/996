# Local Development Setup

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- PostGIS extension

## Quick Setup

Run the automated setup script:

```bash
./setup-local.sh
```

## Manual Setup

### 1. Install PostgreSQL and PostGIS

**macOS:**
```bash
brew install postgresql postgis
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib postgis postgresql-15-postgis-3
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Create Database

```bash
# Create database
createdb 996ers

# Connect and enable PostGIS
psql -d 996ers -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Run migrations
psql -d 996ers -f db.sql
```

### 3. Environment Setup

```bash
# Copy environment template
cp env.example .env

# Edit .env with your database URL
# DATABASE_URL=postgresql://username:password@localhost:5432/996ers
```

### 4. Install Dependencies and Start

```bash
npm install
npm start
```

## Verification

The server will check for PostGIS on startup and exit with clear error messages if it's not available.

## Troubleshooting

**PostGIS not found:**
- Ensure PostGIS is installed: `psql -d 996ers -c "SELECT PostGIS_version();"`
- Enable extension: `psql -d 996ers -c "CREATE EXTENSION IF NOT EXISTS postgis;"`

**Database connection issues:**
- Check PostgreSQL is running: `pg_isready`
- Verify DATABASE_URL in .env file
- Ensure database exists: `psql -l | grep 996ers`
