#!/bin/bash

# 996ers Near Me - Deployment Script for Hetzner
# This script automates the deployment process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="996ers-app"
APP_DIR="/opt/996ers-near-me"
SERVICE_USER="996ers"
DOMAIN=""
EMAIL=""

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

# Get user input
get_config() {
    read -p "Enter your domain name (e.g., 996ers.yourdomain.com): " DOMAIN
    read -p "Enter your email for Let's Encrypt: " EMAIL
    
    if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
        log_error "Domain and email are required"
        exit 1
    fi
}

# Update system
update_system() {
    log_info "Updating system packages..."
    apt update && apt upgrade -y
    log_success "System updated"
}

# Install dependencies
install_dependencies() {
    log_info "Installing dependencies..."
    
    # Install basic packages
    apt install -y curl wget git unzip software-properties-common apt-transport-https ca-certificates gnupg lsb-release
    
    # Install Node.js 20
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    
    # Install PM2
    npm install -g pm2
    
    # Install Docker (optional)
    if command -v docker &> /dev/null; then
        log_info "Docker already installed"
    else
        log_info "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        rm get-docker.sh
    fi
    
    # Install Docker Compose
    apt install -y docker-compose-plugin
    
    # Install Nginx
    apt install -y nginx
    
    # Install Certbot
    apt install -y certbot python3-certbot-nginx
    
    log_success "Dependencies installed"
}

# Create application user
create_user() {
    log_info "Creating application user..."
    
    if id "$SERVICE_USER" &>/dev/null; then
        log_info "User $SERVICE_USER already exists"
    else
        useradd -r -s /bin/false -d $APP_DIR $SERVICE_USER
        log_success "User $SERVICE_USER created"
    fi
}

# Setup application directory
setup_app_directory() {
    log_info "Setting up application directory..."
    
    mkdir -p $APP_DIR
    cd $APP_DIR
    
    # Clone repository (you'll need to update this with your actual repo)
    if [[ -d ".git" ]]; then
        log_info "Repository already exists, pulling latest changes..."
        git pull
    else
        log_info "Cloning repository..."
        # Clone your repository
        git clone https://github.com/anihakutin/996.git .
    fi
    
    # Install dependencies
    npm ci --only=production
    
    # Set ownership
    chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR
    
    log_success "Application directory setup complete"
}

# Setup PostgreSQL
setup_postgresql() {
    log_info "Setting up PostgreSQL..."
    
    # Install PostgreSQL
    apt install -y postgresql postgresql-contrib
    
    # Start and enable PostgreSQL
    systemctl start postgresql
    systemctl enable postgresql
    
    # Create database and user
    sudo -u postgres psql << EOF
CREATE DATABASE 996ers;
CREATE USER 996ers_user WITH PASSWORD '$(openssl rand -base64 32)';
GRANT ALL PRIVILEGES ON DATABASE 996ers TO 996ers_user;
\q
EOF
    
    # Run database migrations
    sudo -u $SERVICE_USER psql $DATABASE_URL -f db.sql
    
    log_success "PostgreSQL setup complete"
}

# Setup environment variables
setup_environment() {
    log_info "Setting up environment variables..."
    
    # Generate secure password
    DB_PASSWORD=$(openssl rand -base64 32)
    
    # Create .env file
    cat > $APP_DIR/.env << EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://996ers_user:$DB_PASSWORD@localhost:5432/996ers
ORIGIN=https://$DOMAIN
EOF
    
    # Set ownership
    chown $SERVICE_USER:$SERVICE_USER $APP_DIR/.env
    chmod 600 $APP_DIR/.env
    
    log_success "Environment variables setup complete"
}

# Setup PM2
setup_pm2() {
    log_info "Setting up PM2..."
    
    # Create PM2 ecosystem file
    cat > $APP_DIR/ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: '$APP_NAME',
    script: 'server.js',
    cwd: '$APP_DIR',
    user: '$SERVICE_USER',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/$APP_NAME-error.log',
    out_file: '/var/log/pm2/$APP_NAME-out.log',
    log_file: '/var/log/pm2/$APP_NAME-combined.log',
    time: true
  }]
};
EOF
    
    # Create log directory
    mkdir -p /var/log/pm2
    chown $SERVICE_USER:$SERVICE_USER /var/log/pm2
    
    # Start application with PM2
    sudo -u $SERVICE_USER pm2 start $APP_DIR/ecosystem.config.js
    
    # Save PM2 configuration
    sudo -u $SERVICE_USER pm2 save
    
    # Setup PM2 startup script
    sudo -u $SERVICE_USER pm2 startup systemd -u $SERVICE_USER --hp $APP_DIR
    
    log_success "PM2 setup complete"
}

# Setup Nginx
setup_nginx() {
    log_info "Setting up Nginx..."
    
    # Create Nginx configuration
    cat > /etc/nginx/sites-available/$APP_NAME << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test configuration
    nginx -t
    
    # Restart Nginx
    systemctl restart nginx
    systemctl enable nginx
    
    log_success "Nginx setup complete"
}

# Setup SSL
setup_ssl() {
    log_info "Setting up SSL certificate..."
    
    # Get SSL certificate
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --non-interactive
    
    # Setup auto-renewal
    systemctl enable certbot.timer
    systemctl start certbot.timer
    
    log_success "SSL certificate setup complete"
}

# Setup firewall
setup_firewall() {
    log_info "Setting up firewall..."
    
    # Install UFW
    apt install -y ufw
    
    # Configure firewall
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow ssh
    ufw allow 'Nginx Full'
    ufw --force enable
    
    log_success "Firewall setup complete"
}

# Setup monitoring
setup_monitoring() {
    log_info "Setting up monitoring..."
    
    # Install PM2 monitoring
    sudo -u $SERVICE_USER pm2 install pm2-logrotate
    
    # Setup log rotation
    cat > /etc/logrotate.d/pm2 << EOF
/var/log/pm2/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $SERVICE_USER $SERVICE_USER
    postrotate
        sudo -u $SERVICE_USER pm2 reloadLogs
    endscript
}
EOF
    
    log_success "Monitoring setup complete"
}

# Main deployment function
main() {
    log_info "Starting deployment of 996ers Near Me..."
    
    check_root
    get_config
    update_system
    install_dependencies
    create_user
    setup_app_directory
    setup_postgresql
    setup_environment
    setup_pm2
    setup_nginx
    setup_ssl
    setup_firewall
    setup_monitoring
    
    log_success "Deployment completed successfully!"
    log_info "Your application is now running at: https://$DOMAIN"
    log_info "You can monitor it with: pm2 monit"
    log_info "View logs with: pm2 logs $APP_NAME"
}

# Run main function
main "$@"
