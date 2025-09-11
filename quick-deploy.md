# Quick Deploy Guide for Hetzner

## Option 1: Automated Deployment (Recommended)

1. **Create a Hetzner Cloud Server:**
   - Ubuntu 22.04
   - CX21 or higher
   - Add your SSH key

2. **Run the deployment script:**
```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Download and run the deployment script
wget https://raw.githubusercontent.com/anihakutin/996/main/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

3. **Follow the prompts:**
   - Enter your domain name
   - Enter your email for SSL certificate

## Option 2: Docker Deployment

1. **Create a Hetzner Cloud Server:**
   - Ubuntu 22.04
   - CX21 or higher

2. **Install Docker:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose-plugin -y
```

3. **Deploy with Docker Compose:**
```bash
# Clone your repository
git clone https://github.com/anihakutin/996.git
cd 996

# Copy environment template
cp env.example .env
# Edit .env with your settings

# Start services
docker compose up -d
```

## Option 3: Manual Deployment

Follow the detailed steps in `DEPLOYMENT.md` for manual setup.

## Post-Deployment

1. **Test your application:**
   - Visit `https://yourdomain.com`
   - Check that the API endpoints work
   - Test real-time features

2. **Monitor your application:**
```bash
# View application logs
pm2 logs 996ers-app

# Monitor system resources
pm2 monit

# Check system status
systemctl status nginx
systemctl status postgresql
```

3. **Set up backups:**
```bash
# Create backup script
nano /usr/local/bin/backup-996ers.sh
# Add backup commands from DEPLOYMENT.md

# Schedule daily backups
crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-996ers.sh
```

## Troubleshooting

- **Application not starting:** Check `pm2 logs 996ers-app`
- **Database issues:** Check PostgreSQL logs with `journalctl -u postgresql`
- **Nginx issues:** Check `nginx -t` and `/var/log/nginx/error.log`
- **SSL issues:** Check certificate with `certbot certificates`

## Cost Estimate

- **CX21 Server:** ~€4.90/month
- **Domain:** ~€10-15/year
- **Total:** ~€5-6/month

Your 996ers Near Me app should be live! 🚀
