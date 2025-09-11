# Deploying 996ers Near Me on Hetzner

This guide will help you deploy your Node.js application on Hetzner Cloud.

## Prerequisites

- Hetzner Cloud account
- Domain name (optional, but recommended)
- Basic knowledge of Linux server administration

## Option 1: Hetzner Cloud Server (Recommended)

### Step 1: Create a Hetzner Cloud Server

1. Log into your [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Create a new project
3. Add a new server:
   - **Location**: Choose closest to your users (e.g., Nuremberg, Helsinki, Ashburn)
   - **Image**: Ubuntu 22.04
   - **Type**: CX21 (2 vCPU, 4GB RAM) or higher
   - **SSH Key**: Add your SSH public key
   - **Name**: `996ers-app`

### Step 2: Set up PostgreSQL Database

#### Option A: Managed PostgreSQL (Recommended)
1. In Hetzner Cloud Console, go to "Databases"
2. Create a new PostgreSQL database:
   - **Version**: PostgreSQL 15
   - **Location**: Same as your server
   - **Type**: db-cx11 (1 vCPU, 2GB RAM) or higher
   - **Name**: `996ers-db`

#### Option B: Self-hosted PostgreSQL
```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install PostgreSQL
apt install postgresql postgresql-contrib -y

# Start and enable PostgreSQL
systemctl start postgresql
systemctl enable postgresql

# Create database and user
sudo -u postgres psql
CREATE DATABASE 996ers;
CREATE USER 996ers_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE 996ers TO 996ers_user;
\q
```

### Step 3: Deploy Your Application

1. **Clone your repository on the server:**
```bash
# Install Git and Node.js
apt install git -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install nodejs -y

# Clone your repository
git clone https://github.com/YOUR_USERNAME/996ers-near-me.git
cd 996ers-near-me
```

2. **Set up environment variables:**
```bash
# Create .env file
nano .env
```

Add the following content:
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://996ers_user:your_secure_password@localhost:5432/996ers
ORIGIN=https://yourdomain.com
```

3. **Install dependencies and set up database:**
```bash
# Install dependencies
npm install

# Set up database schema
psql $DATABASE_URL -f db.sql
```

4. **Set up PM2 for process management:**
```bash
# Install PM2 globally
npm install -g pm2

# Start your application
pm2 start server.js --name "996ers-app"

# Save PM2 configuration
pm2 save
pm2 startup
```

### Step 4: Set up Nginx (Reverse Proxy)

```bash
# Install Nginx
apt install nginx -y

# Create Nginx configuration
nano /etc/nginx/sites-available/996ers
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support for Socket.IO
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable the site
ln -s /etc/nginx/sites-available/996ers /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

# Test and restart Nginx
nginx -t
systemctl restart nginx
systemctl enable nginx
```

### Step 5: Set up SSL with Let's Encrypt

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Get SSL certificate
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test auto-renewal
certbot renew --dry-run
```

### Step 6: Configure Firewall

```bash
# Install and configure UFW
apt install ufw -y

# Allow SSH, HTTP, and HTTPS
ufw allow ssh
ufw allow 'Nginx Full'

# Enable firewall
ufw enable
```

## Option 2: Docker Deployment

### Step 1: Create Docker Configuration

Create a `Dockerfile` in your project root:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

### Step 2: Create Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://996ers_user:password@db:5432/996ers
      - ORIGIN=https://yourdomain.com
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=996ers
      - POSTGRES_USER=996ers_user
      - POSTGRES_PASSWORD=your_secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - /etc/letsencrypt:/etc/letsencrypt
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
```

### Step 3: Deploy with Docker

```bash
# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose-plugin -y

# Clone your repository
git clone https://github.com/YOUR_USERNAME/996ers-near-me.git
cd 996ers-near-me

# Start services
docker compose up -d

# View logs
docker compose logs -f
```

## Monitoring and Maintenance

### Set up monitoring with PM2

```bash
# Install PM2 monitoring
pm2 install pm2-logrotate

# Monitor your application
pm2 monit
```

### Set up automated backups

Create a backup script:

```bash
# Create backup script
nano /usr/local/bin/backup-996ers.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
DB_NAME="996ers"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
pg_dump $DATABASE_URL > $BACKUP_DIR/db_backup_$DATE.sql

# Keep only last 7 days of backups
find $BACKUP_DIR -name "db_backup_*.sql" -mtime +7 -delete

echo "Backup completed: db_backup_$DATE.sql"
```

```bash
# Make script executable
chmod +x /usr/local/bin/backup-996ers.sh

# Add to crontab for daily backups
crontab -e
# Add this line:
0 2 * * * /usr/local/bin/backup-996ers.sh
```

## Troubleshooting

### Common Issues

1. **Application won't start:**
   ```bash
   # Check PM2 logs
   pm2 logs 996ers-app
   
   # Check if port is in use
   netstat -tlnp | grep :3000
   ```

2. **Database connection issues:**
   ```bash
   # Test database connection
   psql $DATABASE_URL -c "SELECT 1;"
   ```

3. **Nginx issues:**
   ```bash
   # Check Nginx configuration
   nginx -t
   
   # Check Nginx logs
   tail -f /var/log/nginx/error.log
   ```

### Performance Optimization

1. **Enable gzip compression in Nginx:**
```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

2. **Set up Redis for session storage (if needed):**
```bash
apt install redis-server -y
systemctl start redis-server
systemctl enable redis-server
```

## Security Considerations

1. **Keep your server updated:**
```bash
apt update && apt upgrade -y
```

2. **Configure fail2ban:**
```bash
apt install fail2ban -y
systemctl start fail2ban
systemctl enable fail2ban
```

3. **Use strong passwords and SSH keys**
4. **Regular security audits**
5. **Monitor logs for suspicious activity**

## Cost Estimation

- **CX21 Server**: ~€4.90/month
- **Managed PostgreSQL (db-cx11)**: ~€8.90/month
- **Domain name**: ~€10-15/year
- **Total**: ~€15/month

## Next Steps

1. Set up monitoring with tools like Grafana/Prometheus
2. Implement CI/CD pipeline with GitHub Actions
3. Set up staging environment
4. Configure log aggregation
5. Implement health checks and alerting

Your 996ers Near Me application should now be running on Hetzner Cloud! 🚀
