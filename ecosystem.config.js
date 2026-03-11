/**
 * Configuración PM2 para BI SESAL Backend
 * Modo cluster con 2 instancias para alta disponibilidad
 */
module.exports = {
  apps: [{
    name: 'bisesal-backend',
    script: './dist/server.js',
    instances: 'max', // Usar todos los cores disponibles
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    // Logs
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Gestión de memoria
    max_memory_restart: '500M',
    
    // Comportamiento
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Variables de entorno adicionales
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};








