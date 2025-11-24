# Backend BI SESAL

Backend del Sistema de Business Intelligence para SESAL (Secretaría de Salud de Honduras).

## 🚀 Tecnologías

- **Node.js** con TypeScript
- **Express.js** para API REST
- **MySQL** como base de datos
- **PM2** para gestión de procesos en producción

## 📋 Prerrequisitos

- Node.js 18+
- MySQL 8.0+
- PM2 (opcional para producción)

## 🛠️ Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno:
Crear archivo `.env` con las siguientes variables:
```
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_NAME=sesal_historico
NODE_ENV=development
```

3. Compilar TypeScript:
```bash
npm run build
```

## 🏃 Ejecución

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm run build
npm start
```

### Con PM2
```bash
pm2 start ecosystem.config.js
```

## 📁 Estructura del Proyecto

```
backend/
├── src/
│   ├── server.ts              # Punto de entrada
│   ├── aplicacion.ts          # Configuración de Express
│   ├── base_datos/            # Configuración de base de datos
│   ├── configuracion/         # Configuración de entorno
│   ├── controladores/         # Controladores de rutas
│   ├── middleware/            # Middlewares
│   ├── rutas/                 # Definición de rutas
│   ├── servicios/             # Lógica de negocio
│   └── utilidades/            # Utilidades y helpers
├── scripts/                   # Scripts auxiliares
├── package.json
├── tsconfig.json
└── ecosystem.config.js        # Configuración PM2
```

## 🔌 Endpoints Principales

- `GET /health` - Health check
- `GET /api/configuracion` - Configuración del sistema
- `GET /api/reportes` - Reportes y datos
- `GET /api/pivot` - Datos para tablas dinámicas
- `GET /api/tablero` - Datos del dashboard

## 📝 Scripts Disponibles

- `npm run dev` - Ejecuta en modo desarrollo con ts-node
- `npm run build` - Compila TypeScript a JavaScript
- `npm start` - Ejecuta la versión compilada

## 🔒 Seguridad

- Helmet para headers de seguridad
- CORS configurado
- Rate limiting implementado
- Validación de entrada

## 📄 Licencia

ISC

