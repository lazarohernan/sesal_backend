# BI SESAL Backend - Guía de Despliegue

## Sistema de Business Intelligence para la Secretaría de Salud de Honduras

---

## Requisitos del Servidor

### Hardware Mínimo
- **CPU:** 2 núcleos
- **RAM:** 16GB (actual) / 32GB (futuro)
- **Almacenamiento:** 20GB SSD

### Software
- **SO:** Ubuntu 22.04/24.04 LTS
- **Node.js:** 20.x o superior
- **MySQL:** 8.x
- **Nginx:** Latest
- **PM2:** Latest

---

## Configuración de MySQL (Importante)

Para servidor con **16GB de RAM**, edite `/etc/mysql/mysql.conf.d/mysqld.cnf`:

```ini
[mysqld]
# Buffer pool - usar ~60% de la RAM disponible
innodb_buffer_pool_size = 10G

# Tamaño de archivos de log para mejor rendimiento en escrituras
innodb_log_file_size = 1G

# Conexiones máximas (debe ser mayor que MYSQL_CONNECTION_LIMIT del backend)
max_connections = 200

# Tablas temporales en memoria
tmp_table_size = 256M
max_heap_table_size = 256M

# Timeout para consultas largas (5 minutos)
wait_timeout = 300
interactive_timeout = 300
```

Para servidor con **32GB de RAM** (cuando esté disponible):

```ini
[mysqld]
innodb_buffer_pool_size = 20G
innodb_log_file_size = 2G
max_connections = 400
tmp_table_size = 512M
max_heap_table_size = 512M
wait_timeout = 300
interactive_timeout = 300
```

Reinicie MySQL después de los cambios:
```bash
sudo systemctl restart mysql
```

---

## Instalación del Backend

### 1. Clonar el Repositorio
```bash
cd /var/www
git clone https://github.com/lazarohernan/sesal_backend.git
cd sesal_backend
```

### 2. Instalar Dependencias
```bash
npm install --production
```

### 3. Configurar Variables de Entorno
Copie y edite el archivo `.env`:
```bash
cp .env.example .env
nano .env
```

Configure las siguientes variables:
```env
NODE_ENV=production
PUERTO=4000

# Base de datos MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=usuario_base_datos
MYSQL_PASSWORD=contraseña_base_datos
MYSQL_DATABASE=sesal_historico
MYSQL_CONNECTION_LIMIT=50
MYSQL_QUEUE_LIMIT=200
MYSQL_CONNECT_TIMEOUT=20000
MYSQL_CHARSET=utf8mb4
MYSQL_QUERY_TIMEOUT=300000

# CORS - Dominios permitidos
CORS_ORIGINS=https://bi.salud.gob.hn
```

### 4. Compilar el Proyecto
```bash
npm run build
```

### 5. Crear Directorio de Logs
```bash
mkdir -p logs
```

### 6. Configurar PM2
Cree el archivo `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'bisesal-backend',
    script: './dist/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '500M',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

### 7. Iniciar con PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Ejecute el comando que muestra el último paso para configurar inicio automático.

---

## Configuración de Nginx

Cree `/etc/nginx/sites-available/bisesal-api`:
```nginx
server {
    listen 80;
    server_name api.salud.gob.hn;

    access_log /var/log/nginx/bisesal-api-access.log;
    error_log /var/log/nginx/bisesal-api-error.log;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Active la configuración:
```bash
sudo ln -s /etc/nginx/sites-available/bisesal-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## Certificado SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.salud.gob.hn
```

---

## Verificación

### Verificar Backend
```bash
curl http://localhost:4000/salud
```

Debería responder:
```json
{"estado":"ok","servicio":"bi-backend","ambiente":"production"}
```

### Verificar PM2
```bash
pm2 status
pm2 logs bisesal-backend
```

---

## Comandos de Administración

### PM2
```bash
pm2 restart bisesal-backend    # Reiniciar
pm2 stop bisesal-backend       # Detener
pm2 logs bisesal-backend       # Ver logs
pm2 status                     # Ver estado
```

### Nginx
```bash
sudo systemctl restart nginx   # Reiniciar
sudo nginx -t                  # Verificar configuración
sudo tail -f /var/log/nginx/error.log  # Ver logs de error
```

---

## Características de Rendimiento

- **Pool de conexiones:** 50 conexiones simultáneas
- **Cola de espera:** 200 solicitudes
- **Rate limiting:** 10 consultas pivot/minuto por IP
- **Timeout consultas:** 5 minutos
- **Caché inteligente:** Reduce carga en consultas repetidas
- **Modo cluster:** Múltiples procesos para mejor rendimiento

---

## Monitoreo

### Estadísticas del Sistema
Acceda a `/api/pivot/cache/stats` para ver estadísticas del caché.

### Logs Importantes
- **Backend:** `pm2 logs bisesal-backend`
- **Nginx:** `/var/log/nginx/bisesal-api-*.log`
- **MySQL:** `/var/log/mysql/error.log`

---

## Soporte

Para problemas técnicos:
1. Revise los logs de PM2 y Nginx
2. Verifique la configuración de MySQL
3. Confirme las variables de entorno
4. Revise la conectividad a la base de datos

---

**Versión:** 1.0.0  
**Actualizado:** Diciembre 2025  
**Instituciones:** Secretaría de Salud (SESAL) y UNFPA Honduras
