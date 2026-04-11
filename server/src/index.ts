
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

dotenv.config();

// DATABASE_URL debe ser una URL de PostgreSQL (Railway la inyecta automáticamente).
if (!process.env.DATABASE_URL) {
    console.error('[startup] ERROR: DATABASE_URL no está definida. Configurá la variable de entorno con la URL de PostgreSQL.');
    process.exit(1);
}
if (!process.env.UPLOADS_DIR && process.env.RAILWAY_ENVIRONMENT) {
    process.env.UPLOADS_DIR = '/data/uploads';
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});
/** Detrás de proxy (Railway, etc.) para IPs y HTTPS correctos */
app.set('trust proxy', 1);
const prisma = new PrismaClient();
const port = Number(process.env.PORT) || 3002;
let startupReady = false;
let startupError: string | null = null;

const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Seguridad: Helmet (cabeceras HTTP de protección) ────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ── Seguridad: CORS ──────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // mobile apps, curl, server-to-server
        if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Actor-Name', 'X-Actor-Id']
}));
app.use(express.json());

// ── Seguridad: JWT ────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'r14-dev-secret-CAMBIAR-en-produccion';
const JWT_EXPIRES_IN = '30d';

function generateToken(user: { id: string; username: string; role: string; fullName: string }): string {
    return jwt.sign(
        { userId: user.id, username: user.username, role: user.role, fullName: user.fullName },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function requireAuth(req: any, res: any, next: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Autenticación requerida. Iniciá sesión.' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado. Volvé a iniciar sesión.' });
    }
}

// ── Seguridad: Rate Limiting ───────────────────────────────────────────────────
const generalLimiter = rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Intentá en un minuto.' }
});
const loginLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de login. Esperá un minuto.' }
});
const trackingLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas actualizaciones de ubicación.' }
});
app.use('/api/', generalLimiter);

// ── Seguridad: Auth middleware aplicado a rutas sensibles ──────────────────────
const PROTECTED_PREFIXES = [
    '/api/v1/users',
    '/api/v1/trips',
    '/api/v1/routes',
    '/api/v1/clients',
    '/api/v1/vehicles',
    '/api/v1/maintenance',
    '/api/v1/incidents',
    '/api/v1/audit',
    '/api/v1/salaries',
    '/api/upload-photo',
];
app.use((req: any, res: any, next: any) => {
    if (PROTECTED_PREFIXES.some(p => req.path.startsWith(p) || (req.originalUrl || '').includes(p))) {
        return requireAuth(req, res, next);
    }
    next();
});

// ── Seguridad: Bcrypt helpers ──────────────────────────────────────────────────
const BCRYPT_ROUNDS = 10;
async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
async function verifyPassword(plain: string, stored: string): Promise<boolean> {
    if (!stored.startsWith('$2')) return plain === stored; // legacy plain text
    return bcrypt.compare(plain, stored);
}
app.get('/health', (_req, res) => res.status(200).type('text/plain').send('ok'));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '../public')));
const clientDistDir = path.join(__dirname, '../../client/dist');
app.use('/app', express.static(clientDistDir));

app.get(/^\/app(?:\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'));
});

app.get('/planificacion', (_req, res) => {
    res.redirect(302, '/planificacion.html');
});

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ── Audit Log Helper ─────────────────────────────────────────────────────────
async function logAction(
    req: express.Request,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entity: string,
    entityId?: string | number | null,
    entityName?: string | null,
    before?: any,
    after?: any
) {
    try {
        const actorName = String(req.headers['x-actor-name'] || '').trim() || null;
        const actorId   = String(req.headers['x-actor-id']   || '').trim() || null;
        const ip = (req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress || '').split(',')[0].trim();
        await (prisma as any).auditLog.create({
            data: {
                userId:     actorId,
                userName:   actorName,
                action,
                entity,
                entityId:   entityId != null ? String(entityId) : null,
                entityName: entityName ?? null,
                before:     before != null ? JSON.stringify(before) : null,
                after:      after  != null ? JSON.stringify(after)  : null,
                ip:         ip || null,
            }
        });
    } catch (e) {
        // Audit never breaks the main flow
        console.warn('[audit] Error logging action:', e);
    }
}

// ── Audit Log Endpoint ───────────────────────────────────────────────────────
app.get('/api/v1/audit', async (req, res) => {
    try {
        const limit  = Math.min(Number(req.query.limit  || 200), 500);
        const offset = Number(req.query.offset || 0);
        const entity = String(req.query.entity || '').trim() || undefined;
        const user   = String(req.query.user   || '').trim() || undefined;
        const from   = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to     = req.query.to   ? new Date(String(req.query.to))   : undefined;

        const where: any = {};
        if (entity) where.entity = entity;
        if (user)   where.userName = { contains: user };
        if (from || to) {
            where.createdAt = {};
            if (from) where.createdAt.gte = from;
            if (to)   where.createdAt.lte = to;
        }

        const [logs, total] = await Promise.all([
            (prisma as any).auditLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset
            }),
            (prisma as any).auditLog.count({ where })
        ]);
        res.json({ logs, total, limit, offset });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error en audit log' });
    }
});

// Seed Initial Tenant
async function initTenant() {
    const tenantId = 'default-tenant';
    await prisma.tenant.upsert({
        where: { id: tenantId },
        update: {},
        create: { id: tenantId, name: 'Real de Catorce' }
    });
}

function runPrismaDbPush(): Promise<void> {
    return new Promise((resolve, reject) => {
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        // SIN --accept-data-loss: si Prisma detecta que va a borrar columnas/tablas, falla.
        // Esto protege los datos del operador en producción.
        const child = spawn(npxCmd, ['prisma', 'db', 'push'], {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`prisma db push failed with exit code ${code}`));
        });
    });
}

async function applyColumnMigrations() {
    // Migraciones aditivas seguras (ADD COLUMN IF NOT EXISTS): no destruyen datos.
    // Cada migración es idempotente y solo agrega lo que falta.
    const migrations: { name: string; sql: string }[] = [
        {
            name: 'DeviceLocation.isActive',
            sql: `ALTER TABLE "DeviceLocation" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true`
        },
        {
            name: 'DeviceLocation.isActive index',
            sql: `CREATE INDEX IF NOT EXISTS "DeviceLocation_isActive_timestamp_idx" ON "DeviceLocation"("isActive", "timestamp")`
        },
    ];
    for (const m of migrations) {
        try {
            await prisma.$executeRawUnsafe(m.sql);
            console.log(`[startup] Migration OK: ${m.name}`);
        } catch (e: any) {
            console.warn(`[startup] Migration skipped (${m.name}): ${e?.message?.slice(0, 100)}`);
        }
    }
}

async function ensureSchemaReady() {
    // SOLO correr db push si las tablas core no existen (DB recién creada).
    // NUNCA correr en cada arranque: aunque db push sin --accept-data-loss falla
    // ante data-loss, igual puede modificar índices o columnas opcionales.
    // Si falta una tabla, lo detectamos por el query de Tenant.
    try {
        await prisma.$queryRawUnsafe('SELECT 1 FROM "Tenant" LIMIT 1');
        // Si Tenant existe, asumimos que el schema base ya fue aplicado.
        // Aplicar solo migraciones aditivas (ADD COLUMN IF NOT EXISTS) que son seguras.
        await applyColumnMigrations();
        console.log('[startup] Schema check OK (Tenant table exists).');
    } catch (err: any) {
        const code = err?.code;
        const msg = String(err?.message || '');
        const missingTable =
            code === 'P2021' ||
            (code === 'P2010' && (
                /no such table:\s*tenant/i.test(msg) ||
                /relation "Tenant" does not exist/i.test(msg) ||
                /relation "tenant" does not exist/i.test(msg)
            ));
        if (!missingTable) {
            console.error('[startup] Unexpected DB error during schema check:', msg);
            throw err;
        }
        console.warn('[startup] Tenant table missing, running `prisma db push` (sin --accept-data-loss)...');
        await runPrismaDbPush();
        await prisma.$queryRawUnsafe('SELECT 1 FROM "Tenant" LIMIT 1');
        console.log('[startup] Prisma schema applied successfully.');
    }
}

/** Usuario chofer para rutas vinculadas a viajes semanales (username = nombre en mayúsculas). */
async function upsertDriverUserForPlanning(driverName: string | null | undefined, tenantId: string) {
    const username = String(driverName ?? '').trim().toUpperCase();
    if (!username || username === 'SIN CHOFER') {
        throw new Error('Asigná un chofer válido al viaje');
    }
    return prisma.user.upsert({
        where: { username },
        update: { fullName: username },
        create: {
            username,
            password: 'r14',
            fullName: username,
            role: 'DRIVER',
            tenantId
        }
    });
}

/**
 * Dado un Trip, resuelve QUÉ usuario de la app móvil debe recibir la ruta.
 * Prioriza trip.reparto (el username del reparto-user, nuevo modelo) sobre
 * trip.driver (legacy, nombre del chofer persona).
 * Devuelve el User correspondiente o null si no se puede resolver.
 */
async function resolveRepartoUserForTrip(trip: { reparto?: string | null; driver?: string | null }, tenantId: string) {
    // 1. Prioridad: reparto explícito (nuevo modelo)
    const repartoName = String(trip.reparto ?? '').trim();
    if (repartoName) {
        const user = await prisma.user.findFirst({
            where: { username: repartoName.toUpperCase(), role: 'DRIVER' }
        });
        if (user) return user;
    }
    // 2. Fallback legacy: el campo driver es el username del usuario móvil
    const driverName = String(trip.driver ?? '').trim();
    if (driverName && driverName.toUpperCase() !== 'SIN CHOFER') {
        // Solo hace upsert si parece un reparto-user (no una persona con role CHOFER)
        const existing = await prisma.user.findFirst({
            where: { username: driverName.toUpperCase() }
        });
        if (existing && existing.role === 'DRIVER') return existing;
        // Si no existe o tiene otro rol, usamos upsert legacy para no romper viajes viejos
        return upsertDriverUserForPlanning(driverName, tenantId);
    }
    return null;
}

// --- Página del sistema (para abrir en el navegador) ---
app.get('/', (req, res) => {
    res.type('html').send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sistema R14 - Real de Catorce Logística</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 2rem; background: #f8f9fb; color: #1c1c1e; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p { color: #6b7280; margin-bottom: 1.5rem; }
    a { color: #007AFF; font-weight: 600; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 600; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Sistema R14</h1>
  <p>Real de Catorce Logística — API en ejecución</p>
  <span class="badge">En línea</span>
  <p style="margin-top: 1.5rem;"><a href="/planificacion.html" style="font-size:1.1rem">Abrir sistema de planificación (Sistema Integral R14)</a></p>
  <p style="margin-top: 0.75rem;"><a href="/api/health">Ver estado de la API</a></p>
</body>
</html>
    `);
});

// --- NEW V1 API (SaaS / VRP) ---

// Health check (para que el cliente detecte si la API está online)
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        ready: startupReady,
        startupError,
        timestamp: new Date().toISOString()
    });
});

// Preflight operativo diario: API, Maps, choferes, credenciales y rutas de hoy.
app.get('/api/v1/preflight', async (_req, res) => {
    try {
        const now = new Date();
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        const [drivers, todayRoutes, mapsSetting] = await Promise.all([
            prisma.user.findMany({
                where: { role: { in: ['DRIVER', 'BLOCKED'] } },
                select: { id: true, username: true, role: true, password: true }
            }),
            prisma.route.findMany({
                where: { date: { gte: dayStart, lte: dayEnd } },
                select: { id: true, driverId: true }
            }),
            prisma.appSettings.findUnique({ where: { key: 'google_maps_api_key_server' }, select: { value: true } })
        ]);

        const activeDrivers = drivers.filter((d) => String(d.role).toUpperCase() === 'DRIVER');
        const blockedDrivers = drivers.filter((d) => String(d.role).toUpperCase() === 'BLOCKED');
        const routeCountByDriver = new Map<string, number>();
        for (const r of todayRoutes) {
            if (!r.driverId) continue;
            routeCountByDriver.set(r.driverId, (routeCountByDriver.get(r.driverId) || 0) + 1);
        }

        const driversWithoutRoute = activeDrivers
            .filter((d) => (routeCountByDriver.get(d.id) || 0) === 0)
            .map((d) => d.username)
            .sort((a, b) => a.localeCompare(b, 'es'));

        const driversWithoutPassword = activeDrivers
            .filter((d) => !String(d.password || '').trim())
            .map((d) => d.username)
            .sort((a, b) => a.localeCompare(b, 'es'));

        let mapsKey = '';
        try {
            const parsed = mapsSetting?.value ? JSON.parse(mapsSetting.value) : '';
            if (typeof parsed === 'string') mapsKey = parsed.trim();
        } catch {
            mapsKey = '';
        }
        if (!mapsKey) {
            mapsKey =
                process.env.GOOGLE_DIRECTIONS_API_KEY ||
                process.env.GOOGLE_MAPS_API_KEY ||
                process.env.GOOGLE_MAPS_SERVER_KEY ||
                '';
            mapsKey = String(mapsKey).trim();
        }

        let googleMapsReachable = false;
        let googleMapsMessage = '';
        if (!mapsKey) {
            googleMapsMessage = 'Sin clave configurada en settings/env.';
        } else {
            try {
                const testUrl =
                    'https://maps.googleapis.com/maps/api/geocode/json' +
                    `?address=${encodeURIComponent('Burzaco Buenos Aires')}` +
                    `&key=${encodeURIComponent(mapsKey)}`;
                const gRes = await fetch(testUrl);
                const gData = (await gRes.json().catch(() => ({}))) as { status?: string; error_message?: string };
                googleMapsReachable = gRes.ok && gData?.status === 'OK';
                googleMapsMessage = googleMapsReachable
                    ? 'Clave válida y API de Google operativa.'
                    : `Google respondió: ${gData?.status || `HTTP ${gRes.status}`}${gData?.error_message ? ` - ${gData.error_message}` : ''}`;
            } catch (e: any) {
                googleMapsReachable = false;
                googleMapsMessage = e?.message || 'No se pudo validar Google Maps.';
            }
        }

        const checks = {
            api: {
                status: startupReady ? 'pass' : 'fail',
                message: startupReady ? 'API en línea.' : `Startup no listo: ${startupError || 'sin detalle'}`
            },
            googleMaps: {
                status: googleMapsReachable ? 'pass' : 'fail',
                message: googleMapsMessage
            },
            drivers: {
                status: activeDrivers.length > 0 ? 'pass' : 'fail',
                totalActive: activeDrivers.length,
                totalBlocked: blockedDrivers.length,
                message: activeDrivers.length > 0 ? 'Choferes activos detectados.' : 'No hay choferes activos.'
            },
            credentials: {
                status: driversWithoutPassword.length === 0 ? 'pass' : 'fail',
                withoutPassword: driversWithoutPassword,
                message:
                    driversWithoutPassword.length === 0
                        ? 'Todos los choferes activos tienen contraseña.'
                        : `Choferes sin contraseña: ${driversWithoutPassword.length}`
            },
            routesToday: {
                status: driversWithoutRoute.length === 0 ? 'pass' : (todayRoutes.length > 0 ? 'warn' : 'fail'),
                totalRoutes: todayRoutes.length,
                withoutRoute: driversWithoutRoute,
                message:
                    todayRoutes.length === 0
                        ? 'No hay rutas cargadas para hoy.'
                        : driversWithoutRoute.length === 0
                            ? 'Todos los choferes activos tienen ruta hoy.'
                            : `Choferes sin ruta hoy: ${driversWithoutRoute.length}`
            }
        };

        res.json({
            ok: checks.api.status === 'pass' && checks.googleMaps.status === 'pass' && checks.drivers.status === 'pass',
            generatedAt: new Date().toISOString(),
            date: dayStart.toISOString().slice(0, 10),
            checks
        });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error ejecutando preflight operativo' });
    }
});

// Auth
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

        if (String(user.role || '').toUpperCase() === 'BLOCKED') {
            return res.status(403).json({ error: "Usuario bloqueado. Contactá al administrador." });
        }

        // Verificación: soporte de contraseñas bcrypt (hash $2*) y plain-text legacy
        let isValid = false;
        const isBcrypt = user.password.startsWith('$2');
        if (isBcrypt) {
            isValid = await verifyPassword(password, user.password).catch(() => false);
        } else {
            // Contraseña plain-text (migración legacy): comparar y luego hashear
            isValid = (password === user.password);
            if (isValid) {
                const hashed = await hashPassword(password);
                await prisma.user.update({ where: { id: user.id }, data: { password: hashed } }).catch(() => {});
            }
        }

        if (!isValid) return res.status(401).json({ error: "Credenciales inválidas" });

        const token = generateToken({ id: user.id, username: user.username, role: user.role, fullName: user.fullName });
        return res.json({
            success: true,
            token,
            user: { id: user.id, fullName: user.fullName, role: user.role, tenantId: user.tenantId }
        });
    } catch (e) {
        res.status(500).json({ error: "Error de login" });
    }
});

// --- ALERTS API ---
app.get('/api/v1/alerts', async (req, res) => {
    try {
        const alerts = await prisma.alert.findMany({
            where: { tenantId: 'default-tenant' },
            orderBy: { createdAt: 'desc' }
        });
        res.json(alerts);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
});

app.post('/api/v1/alerts', async (req, res) => {
    try {
        const alert = await prisma.alert.create({
            data: { ...req.body, tenantId: 'default-tenant' }
        });
        res.json(alert);
    } catch (e) {
        res.status(500).json({ error: "Failed to create alert" });
    }
});

app.delete('/api/v1/alerts/cleanup', async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await prisma.alert.deleteMany({
            where: {
                createdAt: { lt: twentyFourHoursAgo }
            }
        });
        res.json({ success: true, count: result.count });
    } catch (e) {
        res.status(500).json({ error: "Failed to cleanup alerts" });
    }
});

// Fleet & Clients
app.get('/api/v1/vehicles', async (req, res) => {
    res.json(await prisma.vehicle.findMany({ where: { tenantId: 'default-tenant' } }));
});

app.post('/api/v1/vehicles', async (req, res) => {
    try {
        const body = req.body || {};
        const plate = String(body.plate || '').trim();
        if (!plate) return res.status(400).json({ error: 'plate es obligatorio' });

        // Whitelist de campos del schema Vehicle. Cualquier otro campo se descarta
        // silenciosamente para no romper con "Unknown argument" de Prisma.
        const ALLOWED = [
            'model', 'capacityWeight', 'capacityVolume', 'isRefrigerated',
            'status', 'contractType', 'driverName', 'fuelType', 'insurance',
            'usefulLife', 'vehicleType', 'currentKm'
        ] as const;

        const toNum = (v: any): number | null => {
            if (v === null || v === undefined || v === '') return null;
            const n = Number(String(v).replace(/[^\d.-]/g, ''));
            return Number.isFinite(n) ? n : null;
        };

        const data: any = {};
        for (const key of ALLOWED) {
            if (body[key] === undefined) continue;
            if (key === 'capacityWeight' || key === 'capacityVolume' || key === 'currentKm') {
                data[key] = toNum(body[key]);
            } else if (key === 'isRefrigerated') {
                data[key] = !!body[key];
            } else {
                const s = String(body[key] ?? '').trim();
                data[key] = s === '' ? null : s;
            }
        }

        const tenantId = 'default-tenant';
        const vehicle = await prisma.vehicle.upsert({
            where: { plate },
            update: data,
            create: { plate, tenantId, ...data }
        });

        // Auto-crear usuario login para el chofer si el vehiculo es Propio.
        // Esto ocurre SOLO cuando el operador da de alta o actualiza un vehiculo
        // (no en cada lectura del modulo de flota).
        let driverUserCreated = false;
        if (data.contractType && String(data.contractType).toLowerCase() === 'propio'
            && data.driverName && String(data.driverName).trim() !== ''
            && String(data.driverName).trim().toUpperCase() !== 'SIN CHOFER') {
            const username = String(data.driverName).trim().toUpperCase();
            const before = await prisma.user.findUnique({ where: { username } });
            await prisma.user.upsert({
                where: { username },
                update: { fullName: username },
                create: {
                    username,
                    password: 'r14',
                    fullName: username,
                    role: 'DRIVER',
                    tenantId
                }
            });
            driverUserCreated = !before;
        }

        res.json({ ...vehicle, _meta: { driverUserCreated } });
    } catch (e: any) {
        console.error("Error saving vehicle:", e);
        const msg = e?.message || 'Error al guardar vehiculo';
        // P2002 = unique constraint, P2025 = not found
        if (e?.code === 'P2002') return res.status(409).json({ error: 'Patente duplicada' });
        res.status(500).json({ error: msg });
    }
});

app.delete('/api/v1/vehicles/:id', async (req, res) => {
    try {
        await prisma.vehicle.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Failed to delete vehicle" });
    }
});

/** Geocodificación inversa: lat/lng → dirección con calle y altura. */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'RealDeCatorce-App/1.0 (logistica; contacto@ejemplo.com)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data?.address;
    if (!addr) return null;
    const calle = (addr.road || addr.street || addr.pedestrian || addr.footway || '').trim();
    const altura = (addr.house_number || addr.house_name || '').trim() || 'S/N';
    const direccionYAltura = calle ? `${calle} ${altura}` : (altura !== 'S/N' ? altura : null);
    const resto = [
        addr.suburb || addr.neighbourhood || addr.quarter,
        addr.city || addr.town || addr.village || addr.municipality,
        addr.state,
        addr.country
    ].filter(Boolean);
    const full = direccionYAltura ? [direccionYAltura, ...resto].join(', ') : resto.join(', ');
    return full.replace(/\s+/g, ' ').trim() || data?.display_name || null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

app.post('/api/v1/clients', async (req, res) => {
    try {
        const raw = req.body || {};
        const name = String(raw.name ?? '').trim();
        if (!name) {
            return res.status(400).json({ error: 'El nombre es obligatorio' });
        }
        let serviceTime = parseInt(String(raw.serviceTime), 10);
        if (!Number.isFinite(serviceTime) || serviceTime < 1) serviceTime = 15;
        const latNum = raw.latitude != null && raw.latitude !== '' ? Number(raw.latitude) : NaN;
        const lngNum = raw.longitude != null && raw.longitude !== '' ? Number(raw.longitude) : NaN;
        const lat = Number.isFinite(latNum) ? latNum : null;
        const lng = Number.isFinite(lngNum) ? lngNum : null;
        const data: any = {
            tenantId: 'default-tenant',
            name,
            address: raw.address != null && String(raw.address).trim() ? String(raw.address).trim() : null,
            latitude: lat,
            longitude: lng,
            timeWindowStart: raw.timeWindowStart ? String(raw.timeWindowStart) : null,
            timeWindowEnd: raw.timeWindowEnd ? String(raw.timeWindowEnd) : null,
            serviceTime,
            zone: raw.zone != null && String(raw.zone).trim() ? String(raw.zone).trim() : null,
            barrio: raw.barrio != null && String(raw.barrio).trim() ? String(raw.barrio).trim() : null,
            priority: parseInt(String(raw.priority), 10) || 0
        };
        if (lat != null && lng != null && !data.address) {
            const address = await reverseGeocode(lat, lng);
            if (address) data.address = address;
        }
        const client = await prisma.client.create({ data });
        res.json(client);
    } catch (e: any) {
        console.error('POST /clients:', e);
        res.status(500).json({ error: e?.message || 'Error al crear cliente' });
    }
});

app.patch('/api/v1/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const raw = req.body || {};
        const data: any = {};
        if (raw.name !== undefined) data.name = String(raw.name).trim();
        if (raw.address !== undefined) {
            data.address = raw.address != null && String(raw.address).trim() ? String(raw.address).trim() : null;
        }
        if (raw.zone !== undefined) {
            data.zone = raw.zone != null && String(raw.zone).trim() ? String(raw.zone).trim() : null;
        }
        if (raw.barrio !== undefined) {
            data.barrio = raw.barrio != null && String(raw.barrio).trim() ? String(raw.barrio).trim() : null;
        }
        if (raw.timeWindowStart !== undefined) data.timeWindowStart = raw.timeWindowStart ? String(raw.timeWindowStart) : null;
        if (raw.timeWindowEnd !== undefined) data.timeWindowEnd = raw.timeWindowEnd ? String(raw.timeWindowEnd) : null;
        if (raw.serviceTime !== undefined) {
            const st = parseInt(String(raw.serviceTime), 10);
            data.serviceTime = Number.isFinite(st) && st > 0 ? st : 15;
        }
        if (raw.priority !== undefined) data.priority = parseInt(String(raw.priority), 10) || 0;
        if (raw.latitude !== undefined) {
            const s = raw.latitude !== null && raw.latitude !== '' ? String(raw.latitude).trim().replace(',', '.') : '';
            const n = s === '' ? NaN : Number(s);
            data.latitude = Number.isFinite(n) ? n : null;
        }
        if (raw.longitude !== undefined) {
            const s = raw.longitude !== null && raw.longitude !== '' ? String(raw.longitude).trim().replace(',', '.') : '';
            const n = s === '' ? NaN : Number(s);
            data.longitude = Number.isFinite(n) ? n : null;
        }
        const lat = data.latitude !== undefined ? data.latitude : undefined;
        const lng = data.longitude !== undefined ? data.longitude : undefined;
        const addr = data.address !== undefined ? data.address : undefined;
        if (lat != null && lng != null && (addr === undefined || !addr || !String(addr).trim())) {
            const address = await reverseGeocode(lat, lng);
            if (address) data.address = address;
        }
        if (Object.keys(data).length === 0) {
            return res.status(400).json({ error: 'Nada que actualizar' });
        }
        const updatedClient = await prisma.client.update({
            where: { id: String(id) },
            data
        });
        res.json(updatedClient);
    } catch (e: any) {
        console.error("Error updating client:", e);
        res.status(500).json({ error: e?.message || 'Failed to update client' });
    }
});

let backfillAddressesDone = false;
async function backfillAddressesFromCoords(): Promise<void> {
    if (backfillAddressesDone) return;
    backfillAddressesDone = true;
    try {
        const clients = await prisma.client.findMany({
            where: {
                tenantId: 'default-tenant',
                latitude: { not: null },
                longitude: { not: null },
                OR: [{ address: null }, { address: '' }]
            }
        });
        for (const c of clients) {
            await sleep(1100);
            const address = await reverseGeocode(c.latitude!, c.longitude!);
            if (address) await prisma.client.update({ where: { id: c.id }, data: { address } });
        }
    } catch (e) {
        console.error('Backfill addresses from coords:', e);
    }
}

app.get('/api/v1/clients', async (req, res) => {
    res.json(await prisma.client.findMany({ where: { tenantId: 'default-tenant' } }));
});

app.delete('/api/v1/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const clientId = String(id || '').trim();
        if (!clientId) return res.status(400).json({ error: 'ID inválido' });

        const linkedStops = await prisma.stop.count({ where: { clientId } });
        if (linkedStops > 0) {
            return res.status(409).json({
                error: `No se puede eliminar: el cliente está vinculado a ${linkedStops} parada(s) de rutas.`
            });
        }

        await prisma.client.delete({ where: { id: clientId } });
        return res.json({ ok: true, id: clientId });
    } catch (e: any) {
        console.error('DELETE /clients/:id:', e);
        return res.status(500).json({ error: e?.message || 'Error al eliminar cliente' });
    }
});

// --- SALARIES API ---
app.get('/api/v1/salaries', async (req, res) => {
    try {
        const salaries = await prisma.employeeSalary.findMany();
        const mapped = salaries.map(s => ({
            id: s.id,
            month: s.month,
            Nombre: s.firstName,
            Apellido: s.lastName,
            "Tipo Puesto": s.role,
            Bruto: s.grossSalary,
            Jornal: s.dailyWage,
            Antigüedad: s.seniority,
            "Escala Base": s.baseScale
        }));
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch salaries" });
    }
});

app.post('/api/v1/salaries', async (req, res) => {
    try {
        const body = req.body || {};
        const month = String(body.month || '').trim();
        const lastName = String(body.Apellido || '').trim().toUpperCase();
        if (!month) return res.status(400).json({ error: 'month es obligatorio' });
        if (!lastName) return res.status(400).json({ error: 'Apellido es obligatorio' });

        const toFloat = (v: any): number | null => {
            if (v === null || v === undefined || v === '') return null;
            const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
            return Number.isFinite(n) ? n : null;
        };
        const toInt = (v: any): number | null => {
            if (v === null || v === undefined || v === '') return null;
            const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
            return Number.isFinite(n) ? n : null;
        };

        const firstName = String(body.Nombre || '').trim() || null;
        const role = String(body['Tipo Puesto'] || '').trim() || null;
        const grossSalary = toFloat(body.Bruto);
        const dailyWage = toFloat(body.Jornal);
        const seniority = toInt(body['Antigüedad']);
        const baseScale = toFloat(body['Escala Base']);

        const salary = await prisma.employeeSalary.upsert({
            where: { month_lastName: { month, lastName } },
            update: { firstName, role, grossSalary, dailyWage, seniority, baseScale },
            create: { month, lastName, firstName, role, grossSalary, dailyWage, seniority, baseScale }
        });
        res.json(salary);
    } catch (e: any) {
        console.error("Error saving salary:", e);
        const msg = e?.message || 'Error al guardar salario';
        if (e?.code === 'P2002') return res.status(409).json({ error: 'Salario duplicado (mes + apellido)' });
        res.status(500).json({ error: msg });
    }
});

app.delete('/api/v1/salaries/:month/:lastName', async (req, res) => {
    try {
        await prisma.employeeSalary.delete({
            where: { month_lastName: { month: req.params.month, lastName: req.params.lastName.toUpperCase() } }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Failed to delete salary" });
    }
});

// --- MAINTENANCE API ---
app.get('/api/v1/maintenance', async (req, res) => {
    try {
        const records = await prisma.maintenanceRecord.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(records);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch maintenance records" });
    }
});

app.post('/api/v1/maintenance', async (req, res) => {
    try {
        const { id, ...data } = req.body;
        let record;
        if (id && id.toString().startsWith('r')) {
            const { id: _, ...createData } = req.body;
            record = await prisma.maintenanceRecord.create({ data: createData });
        } else if (id) {
            record = await prisma.maintenanceRecord.upsert({
                where: { id: id.toString() },
                update: data,
                create: { id: id.toString(), ...data }
            });
        } else {
            record = await prisma.maintenanceRecord.create({ data });
        }
        res.json(record);
    } catch (e) {
        console.error("Error saving maintenance record:", e);
        res.status(500).json({ error: "Failed to save maintenance record" });
    }
});

app.patch('/api/v1/maintenance/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const record = await prisma.maintenanceRecord.update({
            where: { id },
            data: req.body
        });
        res.json(record);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/v1/maintenance/:id', async (req, res) => {
    try {
        await prisma.maintenanceRecord.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Failed to delete maintenance record" });
    }
});

// --- SETTINGS API ---
app.get('/api/v1/settings/:key', async (req, res) => {
    try {
        const setting = await prisma.appSettings.findUnique({ where: { key: req.params.key } });
        let value = setting ? JSON.parse(setting.value) : null;
        
        if (req.params.key === 'google_maps_api_key_server' && !value) {
            value = process.env.GOOGLE_DIRECTIONS_API_KEY ||
                    process.env.GOOGLE_MAPS_API_KEY ||
                    process.env.GOOGLE_MAPS_SERVER_KEY ||
                    null;
        }
        res.json(value);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch setting" });
    }
});

app.post('/api/v1/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        const setting = await prisma.appSettings.upsert({
            where: { key },
            update: { value: JSON.stringify(value) },
            create: { key, value: JSON.stringify(value) }
        });
        res.json(setting);
    } catch (e) {
        res.status(500).json({ error: "Failed to save setting" });
    }
});

// --- RASTREO SATELITAL (app móvil choferes ↔ Torre de Control) ---
app.post('/api/v1/tracking/location', trackingLimiter, async (req, res) => {
    try {
        const { deviceId, deviceLabel, driverId, routeId, latitude, longitude, accuracy, speed, heading, capturedAt } =
            req.body || {};
        if (latitude == null || longitude == null || !deviceId) {
            return res.status(400).json({ error: 'Faltan deviceId, latitude o longitude' });
        }
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ error: 'latitude y longitude deben ser números' });
        }
        const rid = routeId != null && String(routeId).trim() !== '' && Number.isFinite(Number(routeId)) ? Number(routeId) : null;
        const did = driverId != null && String(driverId).trim() !== '' ? String(driverId).trim() : null;

        // INSERT primero — no esperar el cálculo de offRoute para responder rápido
        const record = await prisma.deviceLocation.create({
            data: {
                deviceId: String(deviceId).trim(),
                deviceLabel: deviceLabel ? String(deviceLabel).trim() : null,
                driverId: did,
                routeId: rid,
                latitude: lat,
                longitude: lng,
                accuracy: accuracy != null && Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
                speed: speed != null && Number.isFinite(Number(speed)) ? Number(speed) : null,
                heading: heading != null && Number.isFinite(Number(heading)) ? Number(heading) : null,
                offRouteMeters: null,
                capturedAt: capturedAt ? new Date(capturedAt) : null
            }
        });
        io.emit('location:update', record);
        // También emitir al room del chofer (para suscriptores específicos)
        if (record.driverId) io.to(`driver:${record.driverId}`).emit('location:own', record);
        res.json(record);

        // Calcular offRoute en background — no bloquea la respuesta HTTP
        if (rid != null) {
            setImmediate(async () => {
                try {
                    const poly = await getRoutePolylinePointsCachedOrBuild(rid);
                    if (poly && poly.length >= 2) {
                        const meters = minDistanceToPolylineMeters(lat, lng, poly);
                        await prisma.deviceLocation.update({
                            where: { id: record.id },
                            data: { offRouteMeters: meters }
                        }).catch(() => {});
                    }
                } catch { /* sin geometría o sin API key */ }
            });
        }
    } catch (e: any) {
        console.error('POST /tracking/location:', e);
        res.status(500).json({ error: e?.message || 'Error al guardar ubicación' });
    }
});

/** El chofer terminó el recorrido: marcar todas sus DeviceLocations activas como inactivas */
app.post('/api/v1/tracking/deactivate-device', async (req, res) => {
    try {
        const { deviceId } = req.body || {};
        if (!deviceId) return res.status(400).json({ error: 'deviceId requerido' });
        const result = await prisma.deviceLocation.updateMany({
            where: { deviceId: String(deviceId), isActive: true },
            data: { isActive: false }
        });
        res.json({ deactivated: result.count });
    } catch (e: any) {
        console.error('POST /tracking/deactivate-device:', e);
        res.status(500).json({ error: e?.message || 'Error al desactivar dispositivo' });
    }
});

/** Historial de posiciones para dibujar el recorrido real en el mapa (operador) */
app.get('/api/v1/tracking/history', async (req, res) => {
    try {
        const routeId = Number(req.query.routeId);
        if (!Number.isFinite(routeId)) {
            return res.status(400).json({ error: 'Query routeId requerido (número)' });
        }
        const hours = Math.min(72, Math.max(1, Number(req.query.hours) || 24));
        const since = new Date(Date.now() - hours * 3600000);
        const take = Math.min(8000, Math.max(100, Number(req.query.limit) || 4000));
        const rows = await prisma.deviceLocation.findMany({
            where: { routeId, timestamp: { gte: since } },
            orderBy: { timestamp: 'asc' },
            take,
            select: {
                latitude: true,
                longitude: true,
                timestamp: true,
                accuracy: true,
                offRouteMeters: true,
                speed: true
            }
        });
        res.json({ routeId, count: rows.length, points: rows });
    } catch (e: any) {
        console.error('GET /tracking/history:', e);
        res.status(500).json({ error: e?.message || 'Error al leer historial' });
    }
});

/** Resumen operativo: tramos entre paradas + último GPS / desvío */
app.get('/api/v1/routes/:id/live-summary', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'ID inválido' });
        const route = await prisma.route.findUnique({
            where: { id: routeId },
            include: {
                stops: { orderBy: { sequence: 'asc' }, include: { client: true } },
                driver: { select: { id: true, fullName: true, username: true } },
                vehicle: { select: { plate: true } }
            }
        });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });

        const sorted = [...(route.stops || [])].sort((a, b) => a.sequence - b.sequence);
        const stopsOut = sorted.map((s, i) => {
            const prev = i > 0 ? sorted[i - 1] : null;
            let legFromPreviousMinutes: number | null = null;
            if (prev && s.actualArrival) {
                const t0 = prev.actualDeparture
                    ? new Date(prev.actualDeparture).getTime()
                    : prev.actualArrival
                      ? new Date(prev.actualArrival).getTime()
                      : null;
                const t1 = new Date(s.actualArrival).getTime();
                if (t0 != null && t1 > t0) legFromPreviousMinutes = Math.round(((t1 - t0) / 60000) * 10) / 10;
            }
            return {
                stopId: s.id,
                sequence: s.sequence,
                name: s.client?.name || `Parada ${s.sequence}`,
                status: s.status,
                plannedEta: s.plannedEta?.toISOString() ?? null,
                actualArrival: s.actualArrival?.toISOString() ?? null,
                actualDeparture: s.actualDeparture?.toISOString() ?? null,
                observations: s.observations ?? null,
                proofPhotoUrl: s.proofPhotoUrl ?? null,
                deliveryWithoutIssues: s.deliveryWithoutIssues ?? null,
                legFromPreviousMinutes
            };
        });

        const since24 = new Date(Date.now() - 24 * 3600000);
        const lastPing = await prisma.deviceLocation.findFirst({
            where: { routeId, timestamp: { gte: since24 } },
            orderBy: { timestamp: 'desc' }
        });
        const pingCount = await prisma.deviceLocation.count({
            where: { routeId, timestamp: { gte: since24 } }
        });

        res.json({
            routeId: route.id,
            date: route.date.toISOString(),
            status: route.status,
            actualStartTime: route.actualStartTime?.toISOString() ?? null,
            actualEndTime: route.actualEndTime?.toISOString() ?? null,
            driver: route.driver,
            vehicle: route.vehicle,
            stops: stopsOut,
            tracking: lastPing
                ? {
                      lastTimestamp: lastPing.timestamp.toISOString(),
                      latitude: lastPing.latitude,
                      longitude: lastPing.longitude,
                      offRouteMeters: lastPing.offRouteMeters,
                      accuracy: lastPing.accuracy,
                      pings24h: pingCount
                  }
                : { lastTimestamp: null, pings24h: pingCount }
        });
    } catch (e: any) {
        console.error('GET /routes/:id/live-summary:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

app.get('/api/v1/tracking/locations', async (req, res) => {
    try {
        const since = new Date(Date.now() - 24 * 3600000);
        const recent = await prisma.deviceLocation.findMany({
            where: { timestamp: { gte: since } },
            orderBy: { timestamp: 'desc' }
        });
        const byDevice = new Map<string, { deviceId: string; deviceLabel: string | null; latitude: number; longitude: number; accuracy: number | null; timestamp: string }>();
        for (const r of recent) {
            if (!byDevice.has(r.deviceId)) {
                byDevice.set(r.deviceId, {
                    deviceId: r.deviceId,
                    deviceLabel: r.deviceLabel ?? null,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    accuracy: r.accuracy ?? null,
                    timestamp: r.timestamp.toISOString()
                });
            }
        }
        res.json(Array.from(byDevice.values()));
    } catch (e: any) {
        console.error('GET /tracking/locations:', e);
        res.status(500).json({ error: e?.message || 'Error al obtener ubicaciones' });
    }
});

/** Historial de posiciones de un dispositivo específico para dibujar su recorrido */
app.get('/api/v1/tracking/device-history', async (req, res) => {
    try {
        const { deviceId } = req.query;
        if (!deviceId || typeof deviceId !== 'string') {
            return res.status(400).json({ error: 'Query deviceId requerido' });
        }
        const hours = Math.min(24, Math.max(1, Number(req.query.hours) || 8));
        const since = new Date(Date.now() - hours * 3600000);
        const points = await prisma.deviceLocation.findMany({
            where: { deviceId: String(deviceId), timestamp: { gte: since } },
            orderBy: { timestamp: 'asc' },
            take: 500,
            select: { latitude: true, longitude: true, timestamp: true, accuracy: true }
        });
        res.json({ deviceId, count: points.length, points: points.map(p => ({
            latitude: p.latitude,
            longitude: p.longitude,
            accuracy: p.accuracy,
            timestamp: p.timestamp.toISOString()
        })) });
    } catch (e: any) {
        console.error('GET /tracking/device-history:', e);
        res.status(500).json({ error: e?.message || 'Error al obtener historial' });
    }
});

// --- REPARTOS (Excel: col 1 = reparto, col 2 = establecimiento) ---
const REPARTOS_EXCEL_PATHS = [
    'C:\\Users\\juanma\\Desktop\\Repartos y colegios .xlsx',
    'C:\\Users\\juanma\\Desktop\\Repartos y colegios.xlsx',
];

function getRepartosExcelPath(): string | null {
    for (const p of REPARTOS_EXCEL_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/** Orden natural: R1, R2, R3 ... R9, R10 (no R1, R10, R2) */
function naturalSort(a: string, b: string): number {
    const split = (s: string) => s.trim().toLowerCase().split(/(\d+)/).filter(Boolean);
    const partsA = split(a);
    const partsB = split(b);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const x = partsA[i] ?? '';
        const y = partsB[i] ?? '';
        const nx = parseInt(x, 10);
        const ny = parseInt(y, 10);
        if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
            if (nx !== ny) return nx - ny;
        } else {
            if (x !== y) return x.localeCompare(y);
        }
    }
    return 0;
}

const DEPOT_NAME = 'Real 14';
const DEPOT_ADDRESS = 'Ombu 1269, Burzaco';

function normalizeForMatch(s: string): string {
    return s
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ');
}

function findBestMatchingClient(excelName: string, clients: { id: string; name: string }[]): { id: string; name: string } | null {
    if (!excelName || clients.length === 0) return null;
    const normExcel = normalizeForMatch(excelName);
    const exact = clients.find(c => normalizeForMatch(c.name) === normExcel);
    if (exact) return exact;
    const contains = clients.find(c => normalizeForMatch(c.name).includes(normExcel) || normExcel.includes(normalizeForMatch(c.name)));
    if (contains) return contains;
    const byLength = clients
        .map(c => ({ c, norm: normalizeForMatch(c.name), len: Math.abs(normalizeForMatch(c.name).length - normExcel.length) }))
        .filter(x => x.norm.length > 0 && normExcel.length > 0);
    byLength.sort((a, b) => a.len - b.len);
    if (byLength[0] && byLength[0].len <= 10) return byLength[0].c;
    return null;
}

async function ensureDepotClient(): Promise<void> {
    const tenantId = 'default-tenant';
    const all = await prisma.client.findMany({ where: { tenantId } });
    const existing = all.find(c =>
        (c.name && c.name.toUpperCase().includes(DEPOT_NAME.toUpperCase())) ||
        (c.address && c.address.includes('Ombu 1269'))
    );
    if (existing) {
        await prisma.client.update({
            where: { id: existing.id },
            data: { name: DEPOT_NAME, address: DEPOT_ADDRESS }
        });
        return;
    }
    await prisma.client.create({
        data: { tenantId, name: DEPOT_NAME, address: DEPOT_ADDRESS }
    });
}

async function syncRepartosFromExcel(): Promise<void> {
    const excelPath = getRepartosExcelPath();
    if (!excelPath) return;
    await ensureDepotClient();

    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    const firstCell = rows[0]?.[0] != null ? String(rows[0][0]).trim().toLowerCase() : '';
    const looksLikeHeader = /reparto|nombre|establecimiento|colegio|escuela|columna/.test(firstCell) && rows.length > 1;
    const startRow = looksLikeHeader ? 1 : 0;
    const byReparto: Record<string, string[]> = {};
    for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const repartoName = row[0] != null ? String(row[0]).trim() : '';
        const establecimiento = row[1] != null ? String(row[1]).trim() : '';
        if (!repartoName) continue;
        if (!byReparto[repartoName]) byReparto[repartoName] = [];
        if (establecimiento) byReparto[repartoName].push(establecimiento);
    }

    await prisma.repartoEstablishment.deleteMany({});
    await prisma.reparto.deleteMany({ where: { tenantId: 'default-tenant' } });
    for (const [repartoName, establecimientos] of Object.entries(byReparto)) {
        const reparto = await prisma.reparto.create({
            data: { name: repartoName, tenantId: 'default-tenant' }
        });
        await prisma.repartoEstablishment.createMany({
            data: establecimientos.map((excelName, idx) => ({
                repartoId: reparto.id,
                excelName,
                sequence: idx + 1
            }))
        });
    }

    const clients = await prisma.client.findMany({
        where: { tenantId: 'default-tenant' },
        select: { id: true, name: true }
    });
    const uniqueExcelNames = [...new Set(Object.values(byReparto).flat())];
    const usedClientIds = new Set<string>();
    for (const excelName of uniqueExcelNames) {
        if (!excelName.trim()) continue;
        const availableClients = clients.filter(c => !usedClientIds.has(c.id));
        const client = findBestMatchingClient(excelName, availableClients);
        if (client) {
            usedClientIds.add(client.id);
            await prisma.client.update({
                where: { id: client.id },
                data: { name: excelName.trim() }
            });
            await prisma.establishmentMapping.upsert({
                where: { excelName: excelName.trim() },
                update: { clientId: client.id },
                create: { excelName: excelName.trim(), clientId: client.id }
            });
        }
    }
}

app.get('/api/v1/repartos', async (req, res) => {
    try {
        const excelPath = getRepartosExcelPath();
        if (excelPath) {
            await syncRepartosFromExcel();
        }
        const repartos = await prisma.reparto.findMany({
            where: { tenantId: 'default-tenant' },
            include: { stops: { orderBy: { sequence: 'asc' } } },
            orderBy: { name: 'asc' }
        });
        const mappings = await prisma.establishmentMapping.findMany({ include: { client: true } });
        const mapByExcelName: Record<string, { clientId: string; clientName: string; address: string | null }> = {};
        mappings.forEach(m => {
            mapByExcelName[m.excelName] = {
                clientId: m.clientId,
                clientName: m.client.name,
                address: m.client.address ?? null
            };
        });

        const result = repartos.map(r => ({
            id: r.id,
            name: r.name,
            establishments: r.stops.map((s) => ({
                excelName: s.excelName,
                sequence: s.sequence,
                displayName: mapByExcelName[s.excelName]?.clientName ?? s.excelName,
                clientId: mapByExcelName[s.excelName]?.clientId ?? null,
                address: mapByExcelName[s.excelName]?.address ?? null
            }))
        }));
        result.sort((a, b) => naturalSort(a.name, b.name));
        const allExcelNames = [...new Set(repartos.flatMap(r => r.stops.map(s => s.excelName)))];
        const unmatchedEstablishments = allExcelNames.filter(name => !mapByExcelName[name]).sort();
        res.json({ repartos: result, unmatchedEstablishments });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Failed to fetch repartos' });
    }
});

app.get('/api/v1/establishment-mappings', async (req, res) => {
    try {
        const list = await prisma.establishmentMapping.findMany({ include: { client: true } });
        res.json(list.map(m => ({ excelName: m.excelName, clientId: m.clientId, clientName: m.client.name })));
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Failed to fetch mappings' });
    }
});

app.post('/api/v1/establishment-mappings', async (req, res) => {
    try {
        const { excelName, clientId } = req.body;
        if (!excelName || !clientId) return res.status(400).json({ error: 'Faltan excelName o clientId' });
        const excelNameTrim = String(excelName).trim();
        const mapping = await prisma.establishmentMapping.upsert({
            where: { excelName: excelNameTrim },
            update: { clientId },
            create: { excelName: excelNameTrim, clientId }
        });
        const withClient = await prisma.establishmentMapping.findUnique({
            where: { id: mapping.id },
            include: { client: true }
        });
        res.json(withClient);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Failed to save mapping' });
    }
});

app.delete('/api/v1/establishment-mappings/:excelName', async (req, res) => {
    try {
        const excelName = decodeURIComponent(req.params.excelName);
        await prisma.establishmentMapping.deleteMany({ where: { excelName } });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Failed to delete mapping' });
    }
});

// Sync Salaries from Excel
app.get('/api/v1/sync-salaries-excel', (req, res) => {
    const excelPath = 'C:\\Users\\juanma\\Desktop\\Costos empleados choferes y auxiliares.xlsx';
    
    const pyScript = `
import pandas as pd
import json
import os

path = r'${excelPath}'
if not os.path.exists(path):
    print(json.dumps({"error": "File not found"}))
else:
    df = pd.read_excel(path)
    # Clean and calculate dynamic fields
    df['Bruto'] = pd.to_numeric(df['Bruto'], errors='coerce').fillna(0)
    # Estimate Jornal for Auxiliaries (Bruto / 22 days approx as fallback)
    df['Jornal'] = (df['Bruto'] / 22).round(0)
    print(df.to_json(orient='records'))
    `;

    const py = spawn('python', ['-c', pyScript]);
    let output = '';
    py.stdout.on('data', (data) => output += data.toString());
    py.stderr.on('data', (data) => console.error(`Py Error: ${data}`));
    py.on('close', () => {
        try {
            res.json(JSON.parse(output));
        } catch (e) {
            res.status(500).json({ error: "Failed to parse excel data" });
        }
    });
});

// VRP Solver Implementation
app.post('/api/v1/vrp/optimize', async (req, res) => {
    try {
        const { date, vehicleIds, clientIds } = req.body;
        
        const vehicles = await prisma.vehicle.findMany({ where: { id: { in: vehicleIds } } });
        const clients = await prisma.client.findMany({ where: { id: { in: clientIds } } });
        
        // Prepare input for Python solver
        // Depot is at R14 (lat/lng approximate or configurable)
        // Depot is at Burzaco (R14 Base)
        const depot = { id: 'depot', lat: -34.83557866183067, lng: -58.422790661558615, serviceTime: 0, timeWindowStart: "07:00", timeWindowEnd: "22:00" };
        const solverInput = {
            depot: 0,
            locations: [depot, ...clients.map(c => ({ 
                id: c.id, 
                lat: c.latitude || -23.59, 
                lng: c.longitude || -67.85, 
                serviceTime: c.serviceTime,
                timeWindowStart: c.timeWindowStart,
                timeWindowEnd: c.timeWindowEnd
            }))],
            vehicles: vehicles.map(v => ({ id: v.id, capacity: v.capacityWeight || 100 }))
        };

        // Call Python script
        const pythonProcess = spawn('python', [path.join(__dirname, '../vrp_solver.py')]);
        let resultData = '';
        
        pythonProcess.stdin.write(JSON.stringify(solverInput));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => { resultData += data.toString(); });
        
        pythonProcess.on('close', async (code) => {
            if (code !== 0) return res.status(500).json({ error: "Solver failed" });
            
            const result = JSON.parse(resultData);
            if (result.status === 'error') return res.status(400).json({ error: result.message });

            // Save results to DB
            const createdRoutes = [];
            for (const r of result.routes) {
                if (r.stops.length <= 2) continue; // Only depot -> depot skips

                const route = await prisma.route.create({
                    data: {
                        tenantId: 'default-tenant',
                        date: new Date(date),
                        vehicleId: vehicles[r.vehicle_index].id,
                        status: 'PLANNED',
                        stops: {
                            create: r.stops.slice(1, -1).map((s: any, idx: number) => ({
                                clientId: clients[s.location_index - 1].id,
                                sequence: idx + 1,
                                plannedEta: new Date(new Date(date).setSeconds(s.arrival_time))
                            }))
                        }
                    },
                    include: { stops: { include: { client: true } } }
                });
                createdRoutes.push(route);
            }
            res.json(createdRoutes);
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Optimization process failed" });
    }
});

// Deep Sync: Procesa flota, personal y rutas desde el sistema de planificación
app.post('/api/v1/sync-deep', async (req, res) => {
    try {
        const { fleet, employees, trips, month } = req.body;
        const tenantId = 'default-tenant';

        // 1. Sincronizar Flota
        if (fleet && Array.isArray(fleet)) {
            for (const v of fleet) {
                await prisma.vehicle.upsert({
                    where: { plate: v.plate },
                    update: {
                        driverName: v.driver,
                        contractType: v.contract,
                        vehicleType: v.vType,
                        fuelType: v.fuel,
                        insurance: v.insurance,
                        usefulLife: v.life
                    },
                    create: {
                        plate: v.plate,
                        tenantId,
                        driverName: v.driver,
                        contractType: v.contract,
                        vehicleType: v.vType,
                        fuelType: v.fuel,
                        insurance: v.insurance,
                        usefulLife: v.life
                    }
                });
            }
        }

        // 2. Sincronizar Personal (Crear Usuarios para App Choferes)
        if (employees && Array.isArray(employees)) {
            for (const e of employees) {
                const username = `${e.Apellido.trim().toUpperCase()} ${e.Nombre ? e.Nombre.trim().toUpperCase() : ''}`.trim();
                if (!username) continue;

                await prisma.user.upsert({
                    where: { username },
                    update: { fullName: username },
                    create: {
                        username,
                        password: 'r14', // Password por defecto
                        fullName: username,
                        role: (e['Tipo Puesto'] || '').toUpperCase().includes('CHOFER') ? 'DRIVER' : 'AUXILIAR',
                        tenantId
                    }
                });
            }
        }

        // 3. Sincronizar Viajes (Convertir Planning a Routes para la App)
        // Solo para el mes seleccionado para no sobreescribir todo
        if (trips && Array.isArray(trips)) {
            // Buscamos los usuarios para asignar driverId a la ruta
            const allUsers = await prisma.user.findMany({ where: { tenantId } });

            for (const t of trips) {
                const driverName = (t.driver || '').trim().toUpperCase();
                const user = allUsers.find(u => u.fullName.includes(driverName) || driverName.includes(u.fullName));
                
                // Si el viaje ya existe como "Trip", lo actualizamos
                await prisma.trip.upsert({
                    where: { id: t.id || -1 },
                    update: { ...t, date: new Date(t.date) },
                    create: { ...t, date: new Date(t.date) }
                });

                // Si tiene chofer identificado, le creamos una "Route" base si es para hoy o futuro
                if (user && user.role === 'DRIVER') {
                    const vehicle = await prisma.vehicle.findFirst({ where: { driverName: { contains: driverName } } });
                    
                    // Verificamos si ya existe una ruta para ese chofer y fecha
                    const tripDate = new Date(t.date);
                    const existingRoute = await prisma.route.findFirst({
                        where: {
                            driverId: user.id,
                            date: {
                                gte: new Date(tripDate.setHours(0,0,0,0)),
                                lte: new Date(tripDate.setHours(23,59,59,999))
                            }
                        }
                    });

                    if (!existingRoute) {
                        await prisma.route.create({
                            data: {
                                tenantId,
                                date: new Date(t.date),
                                driverId: user.id,
                                vehicleId: vehicle ? vehicle.id : null,
                                status: 'PLANNED'
                            }
                        });
                    }
                }
            }
        }

        res.json({ success: true, message: 'Sincronización profunda completada con éxito' });
    } catch (e: any) {
        console.error("Deep Sync Error:", e);
        res.status(500).json({ error: "Falló la sincronización profunda", details: e.message });
    }
});

// Direct Route Push: Crea una ruta filtrada por chofer y fecha con paradas pre-seleccionadas
app.post('/api/v1/routes-direct', async (req, res) => {
    try {
        const { date, driverName, vehicleId, stops } = req.body;
        const tenantId = 'default-tenant';

        // 1. Identificar o CREAR Driver automáticamente (Para que no haga falta el paso 1)
        const username = driverName.trim().toUpperCase();
        const user = await prisma.user.upsert({
            where: { username },
            update: { fullName: username },
            create: {
                username,
                password: 'r14',
                fullName: username,
                role: 'DRIVER',
                tenantId
            }
        });

        // 2. Limpiar rutas anteriores del día para ese chofer (Re-publicación)
        const d = new Date(date);
        await prisma.route.deleteMany({
            where: {
                driverId: user.id,
                tripId: null,
                date: {
                    gte: new Date(d.setHours(0, 0, 0, 0)),
                    lte: new Date(d.setHours(23, 59, 59, 999))
                }
            }
        });

        // 3. Identificar o CREAR Vehículo automáticamente
        let vId = null;
        if (vehicleId) {
            const v = await prisma.vehicle.upsert({
                where: { plate: vehicleId }, // Asumimos que vehicleId es la patente desde el dashboard
                update: { driverName: username },
                create: {
                    plate: vehicleId,
                    tenantId,
                    driverName: username,
                    status: 'ACTIVE'
                }
            });
            vId = v.id;
        }

        // 4. Crear nueva ruta con sus paradas
        const route = await prisma.route.create({
            data: {
                tenantId,
                date: new Date(date),
                driverId: user.id,
                vehicleId: vId,
                status: 'PLANNED',
                stops: {
                    create: (stops || []).map((s: any, idx: number) => ({
                        clientId: s.clientId,
                        sequence: s.sequence ?? idx + 1,
                        ...(s.plannedEta ? { plannedEta: new Date(s.plannedEta) } : {}),
                        status: 'PENDING'
                    }))
                }
            },
            include: { stops: true }
        });

        // Notificar al chofer que tiene una nueva ruta asignada
        if (user.pushToken) {
            const dateStr = new Date(date).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
            sendExpoPush(
                user.pushToken,
                '🗺️ Nueva ruta asignada',
                `Tenés ${(stops || []).length} paradas para ${dateStr}`,
                { routeId: route.id }
            ).catch(() => {});
        }

        res.json({ success: true, routeId: route.id });
    } catch (e: any) {
        console.error("Direct Route Error:", e);
        res.status(500).json({ error: "Error al publicar la ruta", details: e.message });
    }
});

// Sync Propio Drivers: Asegura que todos los choferes de la flota propia puedan loguearse
app.post('/api/v1/sync-fleet-auth', async (req, res) => {
    try {
        const { drivers } = req.body; // Array de strings (nombres de choferes)
        const tenantId = 'default-tenant';

        if (!drivers || !Array.isArray(drivers)) {
            return res.status(400).json({ error: 'Drivers list required' });
        }

        const results = [];
        for (const name of drivers) {
            const username = name.trim().toUpperCase();
            if (!username || username === 'SIN CHOFER') continue;

            const user = await prisma.user.upsert({
                where: { username },
                update: { fullName: username },
                create: {
                    username,
                    password: 'r14',
                    fullName: username,
                    role: 'DRIVER',
                    tenantId
                }
            });
            results.push(user.username);
        }

        res.json({ success: true, synced: results.length });
    } catch (e: any) {
        console.error("Fleet Auth Sync Error:", e);
        res.status(500).json({ error: "Fail to sync fleet drivers" });
    }
});

// Route & Execution (planificación: rutas asignadas a choferes con paradas)
app.get('/api/v1/routes', async (req, res) => {
    const { driverId, date, fromDate, toDate, days } = req.query;
    const where: any = {};
    if (driverId) where.driverId = String(driverId);
    if (date && typeof date === 'string') {
        // Parse YYYY-MM-DD as local day to avoid UTC offset issues on mobile.
        const parts = date.split('-').map((v) => Number(v));
        const hasValidDate = parts.length === 3 && parts.every((n) => Number.isFinite(n));
        const base = hasValidDate
            ? new Date(parts[0], parts[1] - 1, parts[2])
            : new Date(date);
        const start = new Date(base);
        start.setHours(0, 0, 0, 0);
        const end = new Date(base);
        end.setHours(23, 59, 59, 999);
        where.date = { gte: start, lte: end };
    }
    // Rango de fechas para historial de la app móvil
    if (!date) {
        const dateRange: any = {};
        if (fromDate && typeof fromDate === 'string') {
            const d = new Date(fromDate); d.setHours(0, 0, 0, 0);
            dateRange.gte = d;
        } else if (days && typeof days === 'string') {
            const n = parseInt(days, 10);
            if (n > 0 && n <= 365) {
                const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0);
                dateRange.gte = d;
            }
        }
        if (toDate && typeof toDate === 'string') {
            const d = new Date(toDate); d.setHours(23, 59, 59, 999);
            dateRange.lte = d;
        }
        if (Object.keys(dateRange).length > 0) where.date = dateRange;
    }
    const routes = await prisma.route.findMany({
        where,
        include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } }, vehicle: true, driver: true },
        orderBy: { date: 'desc' }
    });
    res.json(routes);
});

/** Detalle de ruta (mismo shape que en el listado) — útil para apps que refrescan por id. */
app.get('/api/v1/routes/:id', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        if (!Number.isFinite(routeId)) {
            return res.status(400).json({ error: 'ID de ruta inválido' });
        }
        const route = await prisma.route.findUnique({
            where: { id: routeId },
            include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } }, vehicle: true, driver: true }
        });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
        res.json(route);
    } catch (e: any) {
        console.error('GET /routes/:id:', e);
        res.status(500).json({ error: e?.message || 'Error al obtener ruta' });
    }
});

/** Eliminar una ruta y sus paradas */
app.delete('/api/v1/routes/:id', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        if (!Number.isFinite(routeId)) {
            return res.status(400).json({ error: 'ID de ruta inválido' });
        }
        const route = await prisma.route.findUnique({ where: { id: routeId } });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
        // Delete stops first, then the route
        await prisma.stop.deleteMany({ where: { routeId } });
        await prisma.route.delete({ where: { id: routeId } });
        res.json({ ok: true, deleted: routeId });
    } catch (e: any) {
        console.error('DELETE /routes/:id:', e);
        res.status(500).json({ error: e?.message || 'Error al eliminar ruta' });
    }
});

/** Inicio / fin de recorrido real (app chofer). Valida que el chofer sea el asignado a la ruta. */
app.patch('/api/v1/routes/:id/recorrido', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        const { driverId, action } = req.body || {};
        if (!Number.isFinite(routeId) || !driverId || (action !== 'start' && action !== 'end')) {
            return res.status(400).json({ error: 'Se requiere driverId y action: start | end' });
        }
        const route = await prisma.route.findUnique({ where: { id: routeId } });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
        if (route.driverId !== String(driverId)) {
            return res.status(403).json({ error: 'Esta ruta no está asignada a tu usuario' });
        }
        const now = new Date();
        if (action === 'start') {
            if (route.actualEndTime) {
                return res.status(400).json({ error: 'El recorrido ya fue finalizado' });
            }
            if (route.actualStartTime) {
                return res.status(400).json({ error: 'El recorrido ya fue iniciado' });
            }
            const updated = await prisma.route.update({
                where: { id: routeId },
                data: { actualStartTime: now, status: 'IN_PROGRESS' }
            });
            return res.json(updated);
        }
        if (route.actualEndTime) {
            return res.status(400).json({ error: 'El recorrido ya fue finalizado' });
        }
        const stopsRows = await prisma.stop.findMany({ where: { routeId } });
        const allStopsCompleted =
            stopsRows.length > 0 && stopsRows.every((s) => s.status === 'COMPLETED');

        if (!route.actualStartTime) {
            if (!allStopsCompleted) {
                return res.status(400).json({
                    error: 'Iniciá el recorrido o completá todas las paradas antes de cerrar'
                });
            }
            const inferStart = (): Date => {
                const ms: number[] = [];
                for (const s of stopsRows) {
                    if (s.actualArrival) ms.push(new Date(s.actualArrival).getTime());
                    if (s.actualDeparture) ms.push(new Date(s.actualDeparture).getTime());
                }
                return ms.length > 0 ? new Date(Math.min(...ms)) : now;
            };
            const startAt = inferStart();
            const updated = await prisma.route.update({
                where: { id: routeId },
                data: { actualStartTime: startAt, actualEndTime: now, status: 'COMPLETED' }
            });
            await prisma.deviceLocation.updateMany({
                where: { routeId, isActive: true },
                data: { isActive: false }
            });
            return res.json(updated);
        }
        const updated = await prisma.route.update({
            where: { id: routeId },
            data: { actualEndTime: now, status: 'COMPLETED' }
        });
        // Marcar DeviceLocations del recorrido como inactivas (conservar para historial)
        await prisma.deviceLocation.updateMany({
            where: { routeId, isActive: true },
            data: { isActive: false }
        });
        return res.json(updated);
    } catch (e: any) {
        console.error('PATCH /routes/:id/recorrido:', e);
        return res.status(500).json({ error: e?.message || 'Error al actualizar recorrido' });
    }
});

function localYmdArgentina(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function driverNamesMatchForRoute(tripDriver: string | null | undefined, userFullName: string | null | undefined): boolean {
    const a = String(tripDriver || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
    const b = String(userFullName || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a) || a === b;
}

/** Igual que en scripts de verificación R1/R4: cruzar nombres plantilla ↔ escuela (Client). */
function normClientNameForMatch(s: string | null | undefined): string {
    return String(s ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function toGoogleDirUrlByCoords(coords: Array<{ latitude: number; longitude: number }>): string {
    const segment = coords.map(c => `${c.latitude},${c.longitude}`).join('/');
    return `https://www.google.com/maps/dir/${segment}`;
}

/** Decodifica polyline encoded de Google Directions / Maps */
function decodeGooglePolyline(encoded: string): Array<{ lat: number; lng: number }> {
    const points: Array<{ lat: number; lng: number }> = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
        let b: number;
        let shift = 0;
        let result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
        lng += dlng;
        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
}

const APP_SETTINGS_GOOGLE_SERVER_KEY = 'google_maps_api_key_server';

function getGoogleDirectionsApiKeyFromEnv(): string | null {
    const k =
        process.env.GOOGLE_DIRECTIONS_API_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.GOOGLE_MAPS_SERVER_KEY ||
        '';
    const t = k.trim();
    return t || null;
}

/** API key para Directions en servidor: .env primero, luego clave guardada desde planificación */
async function resolveGoogleDirectionsApiKey(): Promise<string | null> {
    const fromEnv = getGoogleDirectionsApiKeyFromEnv();
    if (fromEnv) return fromEnv;
    try {
        const row = await prisma.appSettings.findUnique({ where: { key: APP_SETTINGS_GOOGLE_SERVER_KEY } });
        if (!row?.value) return null;
        const parsed = JSON.parse(row.value) as unknown;
        if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
        return null;
    } catch {
        return null;
    }
}

/** Máximo de puntos por solicitud Directions (origin + hasta 23 intermedios + destination) */
const DIRECTIONS_MAX_POINTS_PER_SEGMENT = 25;

function chunkCoordsForDirections(
    coords: Array<{ lat: number; lng: number }>
): Array<Array<{ lat: number; lng: number }>> {
    if (coords.length <= 1) return coords.length === 1 ? [] : [];
    const chunks: Array<Array<{ lat: number; lng: number }>> = [];
    let i = 0;
    while (i < coords.length) {
        const end = Math.min(i + DIRECTIONS_MAX_POINTS_PER_SEGMENT - 1, coords.length - 1);
        chunks.push(coords.slice(i, end + 1));
        if (end >= coords.length - 1) break;
        i = end;
    }
    return chunks;
}

function mergePolylineParts(
    parts: Array<Array<{ lat: number; lng: number }>>
): Array<{ lat: number; lng: number }> {
    const out: Array<{ lat: number; lng: number }> = [];
    const eps = 1e-6;
    for (const part of parts) {
        for (const p of part) {
            if (
                out.length > 0 &&
                Math.abs(out[out.length - 1].lat - p.lat) < eps &&
                Math.abs(out[out.length - 1].lng - p.lng) < eps
            ) {
                continue;
            }
            out.push(p);
        }
    }
    return out;
}

/** Une polilíneas de cada paso del trayecto (respeta orden origen → waypoints → destino) */
function polylineFromDirectionsRoute(route: any): Array<{ lat: number; lng: number }> {
    const out: Array<{ lat: number; lng: number }> = [];
    const eps = 1e-5;
    const legs = route?.legs || [];
    for (const leg of legs) {
        for (const step of leg?.steps || []) {
            const enc = step?.polyline?.points;
            if (!enc) continue;
            const pts = decodeGooglePolyline(enc);
            for (const p of pts) {
                if (
                    out.length > 0 &&
                    Math.abs(out[out.length - 1].lat - p.lat) < eps &&
                    Math.abs(out[out.length - 1].lng - p.lng) < eps
                ) {
                    continue;
                }
                out.push(p);
            }
        }
    }
    return out;
}

async function fetchDirectionsSegmentPolyline(
    chunk: Array<{ lat: number; lng: number }>,
    apiKey: string
): Promise<Array<{ lat: number; lng: number }>> {
    if (chunk.length < 2) return [];
    const origin = `${chunk[0].lat},${chunk[0].lng}`;
    const dest = `${chunk[chunk.length - 1].lat},${chunk[chunk.length - 1].lng}`;
    let url =
        'https://maps.googleapis.com/maps/api/directions/json?' +
        `origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}` +
        '&alternatives=false' +
        `&key=${encodeURIComponent(apiKey)}`;
    if (chunk.length > 2) {
        const wps = chunk
            .slice(1, -1)
            .map((p) => `${p.lat},${p.lng}`)
            .join('|');
        url += `&waypoints=${encodeURIComponent(wps)}`;
    }
    const res = await fetch(url);
    const data: any = await res.json();
    const route0 = data?.routes?.[0];
    if (data.status === 'OK' && route0) {
        const detailed = polylineFromDirectionsRoute(route0);
        if (detailed.length >= 2) return detailed;
        const enc = route0.overview_polyline?.points;
        if (enc) return decodeGooglePolyline(enc);
    }
    console.warn('[directions] segment fallback (straight line):', data.status, data.error_message || '');
    return chunk.map((c) => ({ lat: c.lat, lng: c.lng }));
}

const routeGeometryCache = new Map<string, { expires: number; body: unknown }>();
const ROUTE_GEOMETRY_TTL_MS = 10 * 60 * 1000;

/** Incluye coords y sequence para invalidar caché si cambia el cliente o el orden (sin depender de PATCH explícitos) */
function routeGeometryCacheKey(routeId: number, validStops: Array<{ id: number; sequence: number; client: { latitude: unknown; longitude: unknown } }>): string {
    const sig = validStops
        .map((s) => {
            const lat = Number(s.client?.latitude);
            const lng = Number(s.client?.longitude);
            const lr = (n: number) => (Number.isFinite(n) ? n.toFixed(5) : 'x');
            return `${s.id}:${s.sequence}:${lr(lat)}:${lr(lng)}`;
        })
        .join('|');
    return `${routeId}:${sig}`;
}

/** Distancia aproximada punto–segmento en metros (proyección local, válida para distancias cortas) */
function distancePointToSegmentMeters(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
): number {
    const latMid = (ax + bx + px) / 3;
    const kLat = 111320;
    const kLng = 111320 * Math.cos((latMid * Math.PI) / 180);
    const x = px * kLat;
    const y = py * kLng;
    const x1 = ax * kLat;
    const y1 = ay * kLng;
    const x2 = bx * kLat;
    const y2 = by * kLng;
    const vx = x2 - x1;
    const vy = y2 - y1;
    const wx = x - x1;
    const wy = y - y1;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-6) return Math.hypot(x - x1, y - y1);
    let t = (wx * vx + wy * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * vx;
    const projY = y1 + t * vy;
    return Math.hypot(x - projX, y - projY);
}

function minDistanceToPolylineMeters(
    lat: number,
    lng: number,
    poly: Array<{ lat: number; lng: number }>
): number | null {
    if (!poly || poly.length < 2) return null;
    let min = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
        const d = distancePointToSegmentMeters(lat, lng, poly[i].lat, poly[i].lng, poly[i + 1].lat, poly[i + 1].lng);
        if (d < min) min = d;
    }
    return Number.isFinite(min) ? min : null;
}

/** Polilínea planificada (misma lógica / caché que GET geometry) para calcular desvío */
async function getRoutePolylinePointsCachedOrBuild(routeId: number): Promise<Array<{ lat: number; lng: number }> | null> {
    const apiKey = await resolveGoogleDirectionsApiKey();
    const route = await prisma.route.findUnique({
        where: { id: routeId },
        include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } } }
    });
    if (!route) return null;
    const validStops = (route.stops || [])
        .filter((s: any) => s?.client?.latitude != null && s?.client?.longitude != null)
        .sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence));
    if (validStops.length < 2) return null;
    const coords = validStops.map((s: any) => ({
        lat: Number(s.client.latitude),
        lng: Number(s.client.longitude)
    }));
    const cacheKey = routeGeometryCacheKey(routeId, validStops as any);
    const now = Date.now();
    const cached = routeGeometryCache.get(cacheKey);
    if (cached && cached.expires > now) {
        const body = cached.body as { points?: Array<{ lat: number; lng: number }> };
        if (Array.isArray(body?.points) && body.points.length >= 2) return body.points;
    }
    if (!apiKey) return null;
    const chunks = chunkCoordsForDirections(coords);
    const segmentPolylines: Array<Array<{ lat: number; lng: number }>> = [];
    for (const chunk of chunks) {
        segmentPolylines.push(await fetchDirectionsSegmentPolyline(chunk, apiKey));
    }
    const points = mergePolylineParts(segmentPolylines);
    const stopsMeta = validStops.map((s: any) => ({
        sequence: Number(s.sequence),
        stopId: s.id,
        name: (s.client?.name || `Parada ${s.sequence}`).toString(),
        lat: Number(s.client.latitude),
        lng: Number(s.client.longitude)
    }));
    const payload = {
        routeId: route.id,
        points,
        segments: chunks.length,
        stopCount: validStops.length,
        stops: stopsMeta
    };
    routeGeometryCache.set(cacheKey, { expires: now + ROUTE_GEOMETRY_TTL_MS, body: payload });
    return points;
}

app.get('/api/v1/routes/:id/google-links', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'ID de ruta inválido' });

        const route = await prisma.route.findUnique({
            where: { id: routeId },
            include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } } }
        });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });

        const validStops = (route.stops || []).filter((s: any) =>
            s?.client?.latitude != null && s?.client?.longitude != null
        );
        const allCoords = validStops.map((s: any) => ({
            stopId: s.id,
            sequence: s.sequence,
            clientName: s.client?.name || `Parada ${s.sequence}`,
            latitude: Number(s.client.latitude),
            longitude: Number(s.client.longitude),
            status: s.status
        }));

        const pendingNext = allCoords.find((s: any) => s.status === 'PENDING' || s.status === 'ARRIVED');
        const nextStopLink = pendingNext
            ? `https://www.google.com/maps/dir/?api=1&destination=${pendingNext.latitude},${pendingNext.longitude}&travelmode=driving`
            : null;

        // Tramos de 9 puntos para evitar límites/errores en Google Maps para secuencias largas
        const maxPerBatch = 9;
        const batches: any[] = [];
        for (let i = 0; i < allCoords.length; i += maxPerBatch) {
            const chunk = allCoords.slice(i, i + maxPerBatch);
            batches.push({
                index: Math.floor(i / maxPerBatch) + 1,
                fromSequence: chunk[0]?.sequence ?? null,
                toSequence: chunk[chunk.length - 1]?.sequence ?? null,
                stops: chunk.map((c: any) => ({
                    stopId: c.stopId,
                    sequence: c.sequence,
                    clientName: c.clientName,
                    latitude: c.latitude,
                    longitude: c.longitude
                })),
                googleMapsUrl: toGoogleDirUrlByCoords(chunk)
            });
        }

        res.json({
            routeId: route.id,
            totalStops: route.stops.length,
            stopsWithCoords: allCoords.length,
            nextStopLink,
            batches
        });
    } catch (e: any) {
        console.error('GET /routes/:id/google-links:', e);
        res.status(500).json({ error: e?.message || 'Error generando links de Google Maps' });
    }
});

/** Geometría por calles (Google Directions) para dibujar en Torre de Control; tramos de hasta 25 puntos */
app.get('/api/v1/routes/:id/geometry', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'ID de ruta inválido' });

        const apiKey = await resolveGoogleDirectionsApiKey();
        if (!apiKey) {
            return res.status(503).json({
                error: 'Falta API key en el servidor',
                hint:
                    'Pulsá «Config Google Maps» en Torre de Control y guardá la key (se guarda en el servidor), o definí GOOGLE_DIRECTIONS_API_KEY / GOOGLE_MAPS_API_KEY en server/.env. Habilitá Directions API.'
            });
        }

        const route = await prisma.route.findUnique({
            where: { id: routeId },
            include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } } }
        });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });

        const validStops = (route.stops || [])
            .filter((s: any) => s?.client?.latitude != null && s?.client?.longitude != null)
            .sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence));
        if (validStops.length < 2) {
            return res.json({
                routeId: route.id,
                points: [],
                segments: 0,
                stops: [],
                message: 'Se necesitan al menos 2 paradas con coordenadas para trazar la ruta'
            });
        }

        const coords = validStops.map((s: any) => ({
            lat: Number(s.client.latitude),
            lng: Number(s.client.longitude)
        }));
        const stopsMeta = validStops.map((s: any) => ({
            sequence: Number(s.sequence),
            stopId: s.id,
            name: (s.client?.name || `Parada ${s.sequence}`).toString(),
            lat: Number(s.client.latitude),
            lng: Number(s.client.longitude)
        }));
        const cacheKey = routeGeometryCacheKey(routeId, validStops as any);
        const now = Date.now();
        const cached = routeGeometryCache.get(cacheKey);
        if (cached && cached.expires > now) {
            return res.json(cached.body);
        }

        const chunks = chunkCoordsForDirections(coords);
        const segmentPolylines: Array<Array<{ lat: number; lng: number }>> = [];
        for (const chunk of chunks) {
            segmentPolylines.push(await fetchDirectionsSegmentPolyline(chunk, apiKey));
        }
        const points = mergePolylineParts(segmentPolylines);

        const payload = {
            routeId: route.id,
            points,
            segments: chunks.length,
            stopCount: validStops.length,
            stops: stopsMeta
        };
        routeGeometryCache.set(cacheKey, { expires: now + ROUTE_GEOMETRY_TTL_MS, body: payload });
        res.json(payload);
    } catch (e: any) {
        console.error('GET /routes/:id/geometry:', e);
        res.status(500).json({ error: e?.message || 'Error calculando geometría de ruta' });
    }
});

function stripDirectionsHtml(html: string): string {
    return String(html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Pasos de navegación (Google Directions) desde la posición del chofer hasta la próxima parada PENDING */
app.get('/api/v1/routes/:id/navigation-to-next', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);
        if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'ID de ruta inválido' });
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ error: 'Query lat y lng requeridos (ubicación actual)' });
        }
        const apiKey = await resolveGoogleDirectionsApiKey();
        if (!apiKey) {
            return res.status(503).json({
                error: 'Falta API key de Directions en el servidor',
                hint: 'Configurá Google Maps / Directions en el servidor (misma key que geometría).'
            });
        }
        const route = await prisma.route.findUnique({
            where: { id: routeId },
            include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } } }
        });
        if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
        const sorted = [...(route.stops || [])].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence));
        const pending = sorted.find(
            (s: any) =>
                s.status === 'PENDING' && s.client?.latitude != null && s.client?.longitude != null
        );
        if (!pending) {
            return res.json({
                done: true,
                message: 'No hay paradas pendientes con coordenadas',
                steps: [],
                targetStop: null
            });
        }
        const destLat = Number(pending.client.latitude);
        const destLng = Number(pending.client.longitude);
        const url =
            'https://maps.googleapis.com/maps/api/directions/json?' +
            `origin=${encodeURIComponent(`${lat},${lng}`)}` +
            `&destination=${encodeURIComponent(`${destLat},${destLng}`)}` +
            '&mode=driving&language=es&alternatives=false' +
            `&key=${encodeURIComponent(apiKey)}`;
        const dres = await fetch(url);
        const data: any = await dres.json();
        if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
            return res.status(502).json({
                error: 'No se pudieron calcular indicaciones',
                detail: data.status,
                targetStop: {
                    sequence: pending.sequence,
                    name: (pending.client?.name || `Parada ${pending.sequence}`).toString(),
                    lat: destLat,
                    lng: destLng
                },
                steps: []
            });
        }
        const leg = data.routes[0].legs[0];
        const steps = (leg.steps || []).map((st: any) => ({
            instruction: stripDirectionsHtml(st.html_instructions || ''),
            distanceText: st.distance?.text || '',
            distanceMeters: st.distance?.value ?? null,
            durationText: st.duration?.text || '',
            maneuver: st.maneuver || null
        }));
        const overviewPolyline = data.routes[0].overview_polyline?.points || null;
        res.json({
            done: false,
            targetStop: {
                sequence: pending.sequence,
                name: (pending.client?.name || `Parada ${pending.sequence}`).toString(),
                lat: destLat,
                lng: destLng
            },
            summary:
                leg.distance?.text && leg.duration?.text
                    ? `${leg.distance.text} · ${leg.duration.text}`
                    : null,
            steps,
            overviewPolyline
        });
    } catch (e: any) {
        console.error('GET /routes/:id/navigation-to-next:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

app.patch('/api/v1/stops/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    const data: any = {};
    if (body.actualArrival != null) data.actualArrival = new Date(body.actualArrival);
    if (body.actualDeparture != null) data.actualDeparture = new Date(body.actualDeparture);
    if (body.status != null) data.status = String(body.status);
    if (body.observations != null) data.observations = String(body.observations);
    if (body.reasonCode != null) data.reasonCode = String(body.reasonCode);
    if (body.proofPhotoUrl !== undefined) {
        const v = body.proofPhotoUrl;
        data.proofPhotoUrl = v == null || v === '' ? null : String(v);
    }
    if (body.deliveryWithoutIssues !== undefined) {
        const v = body.deliveryWithoutIssues;
        data.deliveryWithoutIssues = v === null ? null : Boolean(v);
    }
    const stop = await prisma.stop.update({
        where: { id: Number(id) },
        data,
        include: { route: { select: { id: true, tripId: true, driverId: true } } }
    });
    io.emit('stop:updated', { stop });
    // Notificar a Torre de Control y a la app del chofer
    if (stop.route?.driverId) {
        io.to(`driver:${stop.route.driverId}`).emit('route:updated', { routeId: stop.route.id, type: 'stop_status' });
    }
    res.json(stop);
});

// ── Reordenamiento de paradas por el chofer ───────────────────────────────────
app.post('/api/v1/routes/:id/stops/reorder', async (req, res) => {
    try {
        const routeId = Number(req.params.id);
        const { newOrder, justification, driverName } = req.body as {
            newOrder: { stopId: number; sequence: number }[];
            justification: string;
            driverName?: string;
        };
        if (!Array.isArray(newOrder) || newOrder.length === 0) {
            res.status(400).json({ error: 'newOrder requerido' });
            return;
        }

        // Obtener secuencias actuales para preservar plannedSequence original
        const currentStops = await prisma.stop.findMany({
            where: { routeId },
            select: { id: true, sequence: true, plannedSequence: true }
        });
        const currentMap = new Map(currentStops.map(s => [s.id, s]));

        // Actualizar secuencias en transacción
        await prisma.$transaction(
            newOrder.map(item =>
                prisma.stop.update({
                    where: { id: item.stopId },
                    data: {
                        sequence: item.sequence,
                        // Guardar secuencia original solo la primera vez que se reordena
                        plannedSequence: currentMap.get(item.stopId)?.plannedSequence
                            ?? currentMap.get(item.stopId)?.sequence
                            ?? item.sequence,
                    }
                })
            )
        );

        // Guardar metadata de reordenamiento en la ruta
        const updatedRoute = await prisma.route.update({
            where: { id: routeId },
            data: {
                reorderReason: String(justification || '').trim() || null,
                reorderedAt: new Date(),
                reorderedByDriver: driverName ? String(driverName).trim() : null,
            },
            include: {
                stops: { orderBy: { sequence: 'asc' }, include: { client: true } },
                vehicle: true,
            }
        });

        // Emitir evento para Torre de Control y chofer
        io.emit('route:updated', {
            routeId,
            type: 'reorder',
            reason: justification,
            driverName: driverName || null,
        });

        res.json({ success: true, route: updatedRoute });
    } catch (e: any) {
        console.error('POST /routes/:id/stops/reorder:', e);
        res.status(500).json({ error: e?.message || 'Error al reordenar' });
    }
});

async function requestOptimizedTripFromOsrm(coords: number[][]) {
    const coordsString = coords.map(c => c.join(',')).join(';');
    const url = `https://router.project-osrm.org/trip/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true&source=first&destination=last`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data?.code !== 'Ok') {
        throw new Error(data?.message || 'OSRM route request failed');
    }
    return data;
}

async function requestOptimizedTripFromMapbox(coords: number[][], token: string) {
    const coordsString = coords.map(c => c.join(',')).join(';');
    const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving-traffic/${coordsString}?geometries=geojson&steps=true&source=first&destination=last&roundtrip=false&access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data?.code !== 'Ok') {
        throw new Error(data?.message || 'Mapbox optimized trips request failed');
    }
    return data;
}

app.post('/api/v1/vrp/fixed-route', async (req, res) => {
    try {
        const { origin, clients } = req.body || {};
        if (!origin || !Array.isArray(clients) || clients.length === 0) {
            return res.status(400).json({ error: 'Datos incompletos' });
        }

        const coords = [
            [origin.lng, origin.lat],
            ...clients.map((c: any) => [c.longitude, c.latitude]),
            [origin.lng, origin.lat]
        ];

        const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || '';
        let provider = 'osrm';
        let routingData: any;

        if (mapboxToken) {
            provider = 'mapbox';
            const coordsString = coords.map(c => c.join(',')).join(';');
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordsString}?geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(mapboxToken)}`;
            const response = await fetch(url);
            routingData = await response.json();
            if (!response.ok || routingData?.code !== 'Ok') {
                console.warn('Mapbox directions failed, falling back to OSRM');
                provider = 'osrm';
                routingData = null;
            }
        }

        if (provider === 'osrm' || !routingData) {
            const coordsString = coords.map(c => c.join(',')).join(';');
            const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true`;
            const response = await fetch(url);
            routingData = await response.json();
        }

        const route = routingData.routes?.[0];
        if (!route) return res.status(500).json({ error: 'No se pudo calcular la ruta fija' });

        res.json({
            provider,
            route: {
                durationSec: route.duration || 0,
                distanceMeters: route.distance || 0,
                geometry: route.geometry || null,
                legs: route.legs || []
            }
        });
    } catch (e) {
        console.error('Fixed route error:', e);
        res.status(500).json({ error: 'Error en cálculo de ruta fija' });
    }
});

app.post('/api/v1/vrp/live-optimize', async (req, res) => {
    try {
        const { origin, clients, departureTime } = req.body || {};
        if (!origin || typeof origin.lat !== 'number' || typeof origin.lng !== 'number') {
            return res.status(400).json({ error: 'Origin inválido' });
        }
        if (!Array.isArray(clients) || clients.length === 0) {
            return res.status(400).json({ error: 'Debe enviar al menos un destino' });
        }

        const validClients = clients.filter((c: any) =>
            c &&
            typeof c.id !== 'undefined' &&
            typeof c.latitude === 'number' &&
            typeof c.longitude === 'number'
        );
        if (validClients.length === 0) {
            return res.status(400).json({ error: 'No hay destinos con coordenadas válidas' });
        }
        if (validClients.length > 20) {
            return res.status(400).json({ error: 'Máximo 20 destinos por optimización' });
        }

        const coords = [
            [origin.lng, origin.lat],
            ...validClients.map((c: any) => [c.longitude, c.latitude]),
            [origin.lng, origin.lat]
        ];

        const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || '';
        let provider = 'osrm';
        let trafficLive = false;
        let routingData: any;

        if (mapboxToken) {
            try {
                routingData = await requestOptimizedTripFromMapbox(coords, mapboxToken);
                provider = 'mapbox';
                trafficLive = true;
            } catch (e) {
                console.warn('Mapbox traffic optimize failed, using OSRM fallback:', e);
                routingData = await requestOptimizedTripFromOsrm(coords);
            }
        } else {
            routingData = await requestOptimizedTripFromOsrm(coords);
        }

        const tripData = routingData.trips?.[0];
        if (!tripData) return res.status(500).json({ error: 'Respuesta de optimización inválida' });

        const waypoints = Array.isArray(routingData.waypoints) ? routingData.waypoints : [];
        const sortedWaypoints = [...waypoints]
            .filter((w: any) => w.waypoint_index > 0 && w.waypoint_index < coords.length - 1)
            .sort((a: any, b: any) => a.trips_index - b.trips_index);
        const orderedClientIds = sortedWaypoints
            .map((w: any) => validClients[w.waypoint_index - 1]?.id)
            .filter((id: any) => typeof id !== 'undefined');

        const rawLegs = Array.isArray(tripData.legs) ? [...tripData.legs] : [];
        while (rawLegs.length > 1) {
            const last = rawLegs[rawLegs.length - 1];
            if ((last?.duration || 0) < 1 && (last?.distance || 0) < 1) rawLegs.pop();
            else break;
        }

        const departure = departureTime ? new Date(departureTime) : new Date();
        const departureMs = Number.isNaN(departure.getTime()) ? Date.now() : departure.getTime();
        let cumulativeMs = departureMs;
        const etaByStop = orderedClientIds.map((clientId: any, idx: number) => {
            const leg = rawLegs[idx];
            const legDurationMs = Math.round((leg?.duration || 0) * 1000);
            cumulativeMs += legDurationMs;
            return {
                clientId,
                eta: new Date(cumulativeMs).toISOString(),
                durationSec: leg?.duration || 0,
                distanceMeters: leg?.distance || 0
            };
        });

        res.json({
            provider,
            trafficLive,
            route: {
                durationSec: tripData.duration || 0,
                distanceMeters: tripData.distance || 0,
                geometry: tripData.geometry || null,
                legs: rawLegs
            },
            orderedClientIds,
            etaByStop
        });
    } catch (e) {
        console.error('Traffic optimize error:', e);
        res.status(500).json({ error: 'No se pudo optimizar la ruta con tráfico' });
    }
});

// --- LEGACY COMPATIBILITY ---
app.get('/api/v1/trips', async (req, res) => {
    const { contractType, status, driver, month, year } = req.query;
    const where: any = {};
    if (contractType && contractType !== 'ALL') where.contractType = String(contractType);
    if (status && status !== 'ALL') where.status = String(status);
    if (driver && driver !== 'ALL') where.driver = String(driver);
    const monthMap: Record<string, number> = {
        enero: 0,
        febrero: 1,
        marzo: 2,
        abril: 3,
        mayo: 4,
        junio: 5,
        julio: 6,
        agosto: 7,
        septiembre: 8,
        octubre: 9,
        noviembre: 10,
        diciembre: 11
    };
    const monthKey = month ? String(month).toLowerCase() : '';
    const monthIdx = monthKey ? monthMap[monthKey] : undefined;
    const yearNum = year ? Number(year) : undefined;

    const trips = await prisma.trip.findMany({
        where,
        include: { stops: { orderBy: { sequence: 'asc' } } },
        orderBy: { date: 'desc' },
        take: 2000 
    });
    const filteredTrips = trips.filter((t: any) => {
        if (!monthKey && !yearNum) return true;
        const tripDate = new Date(t.date);
        if (Number.isNaN(tripDate.getTime())) return false;
        if (monthIdx !== undefined && tripDate.getMonth() !== monthIdx) return false;
        if (yearNum && tripDate.getFullYear() !== yearNum) return false;
        return true;
    });

    let minD: Date | null = null;
    let maxD: Date | null = null;
    for (const t of filteredTrips) {
        const tripDate = new Date(t.date);
        if (Number.isNaN(tripDate.getTime())) continue;
        const start = new Date(tripDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(tripDate);
        end.setHours(23, 59, 59, 999);
        if (!minD || start < minD) minD = start;
        if (!maxD || end > maxD) maxD = end;
    }
    const tripIds = (filteredTrips as any[]).map((t) => t.id).filter((id: number) => Number.isFinite(id));
    const routesLinkedToTrips =
        tripIds.length > 0
            ? await prisma.route.findMany({
                  where: { tripId: { in: tripIds } },
                  include: { driver: true }
              })
            : [];
    const routeByTripId = new Map<number, (typeof routesLinkedToTrips)[0]>();
    for (const r of routesLinkedToTrips) {
        if (r.tripId != null) routeByTripId.set(r.tripId, r);
    }

    if (minD && maxD) {
        const routesInRange = await prisma.route.findMany({
            where: { date: { gte: minD, lte: maxD } },
            include: { driver: true },
            orderBy: { id: 'desc' }
        });
        for (const t of filteredTrips as any[]) {
            const linked = routeByTripId.get(t.id);
            if (linked) {
                t.routeExecutionId = linked.id;
                t.routeActualStart = linked.actualStartTime;
                t.routeActualEnd = linked.actualEndTime;
                t.routeExecutionStatus = linked.status;
                continue;
            }
            const tripDate = new Date(t.date);
            if (Number.isNaN(tripDate.getTime())) continue;
            const ymd = localYmdArgentina(tripDate);
            const match = routesInRange.find((r) => {
                if (!r.driver?.fullName) return false;
                if (localYmdArgentina(new Date(r.date)) !== ymd) return false;
                return driverNamesMatchForRoute(t.driver, r.driver.fullName);
            });
            if (match) {
                t.routeExecutionId = match.id;
                t.routeActualStart = match.actualStartTime;
                t.routeActualEnd = match.actualEndTime;
                t.routeExecutionStatus = match.status;
            }
        }
    } else {
        for (const t of filteredTrips as any[]) {
            const linked = routeByTripId.get(t.id);
            if (linked) {
                t.routeExecutionId = linked.id;
                t.routeActualStart = linked.actualStartTime;
                t.routeActualEnd = linked.actualEndTime;
                t.routeExecutionStatus = linked.status;
            }
        }
    }

    res.json(filteredTrips);
});

app.post('/api/v1/trips', async (req, res) => {
    try {
        const trip = await prisma.trip.create({ data: req.body });
        await logAction(req, 'CREATE', 'trip', trip.id, trip.driver || String(trip.id), null, trip);
        io.emit('trip:created', { trip });
        // Notificar al usuario del reparto (nuevo modelo) o al chofer legacy
        const notifyTarget = String(trip.reparto || trip.driver || '').trim();
        if (notifyTarget) notifyDriver(notifyTarget, 'Nuevo viaje asignado', `Tenés un viaje asignado para ${trip.zone || 'hoy'}`, { tripId: trip.id });
        res.json(trip);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error creando viaje' });
    }
});

app.put('/api/v1/trips/:id', async (req, res) => {
    const { id } = req.params;
    const body = { ...req.body };
    delete body.stops;
    try {
        const before = await prisma.trip.findUnique({ where: { id: parseInt(id) } });
        const trip = await prisma.trip.update({ where: { id: parseInt(id) }, data: body });
        await logAction(req, 'UPDATE', 'trip', trip.id, trip.driver || id, before, trip);
        io.emit('trip:updated', { trip });
        res.json(trip);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error actualizando viaje' });
    }
});

/** Paradas de entrega (Route/Stop) vinculadas al viaje semanal, en orden. */
app.get('/api/v1/trips/:tripId/delivery-stops', async (req, res) => {
    try {
        const tripId = parseInt(req.params.tripId, 10);
        if (!Number.isFinite(tripId)) return res.status(400).json({ error: 'ID inválido' });
        const route = await prisma.route.findUnique({
            where: { tripId },
            include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } } }
        });
        if (!route) return res.json({ routeId: null, stops: [] });
        res.json({
            routeId: route.id,
            stops: route.stops.map((s) => ({
                id: s.id,
                sequence: s.sequence,
                clientId: s.clientId,
                name: s.client?.name || 'Cliente',
                address: s.client?.address || null,
                latitude: s.client?.latitude ?? null,
                longitude: s.client?.longitude ?? null
            }))
        });
    } catch (e: any) {
        console.error('GET trips delivery-stops:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

/** Reemplaza el orden de paradas del Route ligado al viaje (crea la ruta si no existe). */
app.put('/api/v1/trips/:tripId/delivery-stops', async (req, res) => {
    try {
        const tripId = parseInt(req.params.tripId, 10);
        if (!Number.isFinite(tripId)) return res.status(400).json({ error: 'ID inválido' });
        const clientIds: string[] = Array.isArray(req.body?.clientIds)
            ? req.body.clientIds.map((x: unknown) => String(x)).filter(Boolean)
            : [];
        const tenantId = 'default-tenant';

        const trip = await prisma.trip.findUnique({ where: { id: tripId } });
        if (!trip) return res.status(404).json({ error: 'Viaje no encontrado' });

        if (clientIds.length > 0) {
            // Validar por IDs únicos: el mismo cliente puede repetirse en el orden (dos entregas al mismo lugar).
            const uniqueIds = [...new Set(clientIds)];
            const found = await prisma.client.findMany({
                where: { id: { in: uniqueIds } },
                select: { id: true }
            });
            if (found.length !== uniqueIds.length) {
                const foundSet = new Set(found.map((f) => f.id));
                const missing = uniqueIds.filter((id) => !foundSet.has(id));
                return res.status(400).json({
                    error: 'Hay clientes inexistentes o dados de baja en la lista',
                    missingClientIds: missing.slice(0, 20)
                });
            }
        }

        let route = await prisma.route.findUnique({ where: { tripId } });
        if (!route) {
            const repartoUser = await resolveRepartoUserForTrip(trip, tenantId);
            if (!repartoUser) throw new Error('Asigná un reparto o chofer válido al viaje');
            route = await prisma.route.create({
                data: {
                    tenantId,
                    date: new Date(trip.date),
                    driverId: repartoUser.id,
                    status: 'PLANNED',
                    tripId
                }
            });
        } else {
            try {
                const repartoUser = await resolveRepartoUserForTrip(trip, tenantId);
                if (repartoUser) {
                    await prisma.route.update({
                        where: { id: route.id },
                        data: { driverId: repartoUser.id, date: new Date(trip.date) }
                    });
                }
            } catch {
                /* mantiene reparto actual en ruta */
            }
        }

        await prisma.$transaction([
            prisma.stop.deleteMany({ where: { routeId: route.id } }),
            ...(clientIds.length
                ? [
                      prisma.stop.createMany({
                          data: clientIds.map((clientId, idx) => ({
                              routeId: route!.id,
                              clientId,
                              sequence: idx + 1,
                              status: 'PENDING'
                          }))
                      })
                  ]
                : [])
        ]);

        res.json({ routeId: route.id, stopCount: clientIds.length });
    } catch (e: any) {
        console.error('PUT trips delivery-stops:', e);
        const msg = e?.message || 'Error al guardar paradas';
        if (msg.includes('chofer') || msg.includes('Chofer')) {
            return res.status(400).json({ error: msg });
        }
        res.status(500).json({ error: msg });
    }
});

/** Inicio / fin de recorrido desde torre de control (operador), sin validar chofer. */
app.patch('/api/v1/trips/:tripId/recorrido-operador', async (req, res) => {
    try {
        const tripId = parseInt(req.params.tripId, 10);
        const { action } = req.body || {};
        if (!Number.isFinite(tripId) || (action !== 'start' && action !== 'end')) {
            return res.status(400).json({ error: 'Se requiere action: start | end' });
        }
        const route = await prisma.route.findUnique({ where: { tripId } });
        if (!route) {
            return res.status(400).json({
                error: 'No hay ruta vinculada. Guardá las paradas de entrega en el viaje (modal de edición).'
            });
        }
        const stopCount = await prisma.stop.count({ where: { routeId: route.id } });
        if (stopCount === 0) {
            return res.status(400).json({ error: 'Agregá al menos una parada antes de iniciar el viaje.' });
        }

        const now = new Date();
        if (action === 'start') {
            if (route.actualEndTime) {
                return res.status(400).json({ error: 'El recorrido ya fue finalizado' });
            }
            if (route.actualStartTime) {
                return res.status(400).json({ error: 'El recorrido ya fue iniciado' });
            }
            const updated = await prisma.route.update({
                where: { id: route.id },
                data: { actualStartTime: now, status: 'IN_PROGRESS' }
            });
            await prisma.trip.update({
                where: { id: tripId },
                data: { status: 'OUT_OF_PLANT', startedAt: now }
            });
            return res.json({ route: updated });
        }

        if (route.actualEndTime) {
            return res.status(400).json({ error: 'El recorrido ya fue finalizado' });
        }
        const stopsRows = await prisma.stop.findMany({ where: { routeId: route.id } });
        const allStopsCompleted =
            stopsRows.length > 0 && stopsRows.every((s) => s.status === 'COMPLETED');

        if (!route.actualStartTime) {
            if (!allStopsCompleted) {
                return res.status(400).json({
                    error: 'Iniciá el viaje o completá todas las paradas antes de cerrar'
                });
            }
            const inferStart = (): Date => {
                const ms: number[] = [];
                for (const s of stopsRows) {
                    if (s.actualArrival) ms.push(new Date(s.actualArrival).getTime());
                    if (s.actualDeparture) ms.push(new Date(s.actualDeparture).getTime());
                }
                return ms.length > 0 ? new Date(Math.min(...ms)) : now;
            };
            const startAt = inferStart();
            const updated = await prisma.route.update({
                where: { id: route.id },
                data: { actualStartTime: startAt, actualEndTime: now, status: 'COMPLETED' }
            });
            await prisma.trip.update({
                where: { id: tripId },
                data: { status: 'COMPLETED', completedAt: now }
            });
            return res.json({ route: updated });
        }
        const updated = await prisma.route.update({
            where: { id: route.id },
            data: { actualEndTime: now, status: 'COMPLETED' }
        });
        await prisma.trip.update({
            where: { id: tripId },
            data: { status: 'COMPLETED', completedAt: now }
        });
        return res.json({ route: updated });
    } catch (e: any) {
        console.error('PATCH trips recorrido-operador:', e);
        res.status(500).json({ error: e?.message || 'Error al actualizar recorrido' });
    }
});

app.delete('/api/v1/trips/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const before = await prisma.trip.findUnique({ where: { id } });
        await prisma.tripLocation.deleteMany({ where: { tripId: id } });
        await (prisma as any).tripStop.deleteMany({ where: { tripId: id } });
        const linked = await prisma.route.findUnique({ where: { tripId: id } });
        if (linked) {
            // Marcar DeviceLocations del recorrido como inactivas (conservar para historial)
            await prisma.deviceLocation.updateMany({
                where: { routeId: linked.id, isActive: true },
                data: { isActive: false }
            });
            await prisma.stop.deleteMany({ where: { routeId: linked.id } });
            await prisma.route.delete({ where: { id: linked.id } });
        }
        await prisma.trip.delete({ where: { id } });
        await logAction(req, 'DELETE', 'trip', id, before?.driver || String(id), before, null);
        io.emit('trip:deleted', { id });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Trip Tracking & Stops — Paradas con lat/lng desde Client si no se envían
app.post('/api/v1/trips/:id/stops', async (req, res) => {
    const tripId = parseInt(req.params.id);
    const { stops } = req.body; // Array of { name, clientId?, latitude?, longitude? }
    
    try {
        await (prisma as any).tripStop.deleteMany({ where: { tripId } });
        const data: any[] = [];
        for (let idx = 0; idx < (stops || []).length; idx++) {
            const s = stops[idx];
            let lat = s.latitude;
            let lng = s.longitude;
            if ((lat == null || lng == null) && s.clientId) {
                const client = await prisma.client.findUnique({ where: { id: s.clientId } });
                if (client) {
                    lat = client.latitude ?? undefined;
                    lng = client.longitude ?? undefined;
                }
            }
            data.push({
                tripId,
                name: s.name || 'Sin nombre',
                sequence: idx + 1,
                clientId: s.clientId || null,
                latitude: lat ?? null,
                longitude: lng ?? null
            });
        }
        if (data.length > 0) {
            await (prisma as any).tripStop.createMany({ data });
        }
        res.json({ success: true, count: data.length });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/v1/trips/:id/stops/:stopId', async (req, res) => {
    try {
        const stop = await (prisma as any).tripStop.update({
            where: { id: parseInt(req.params.stopId) },
            data: req.body
        });
        res.json(stop);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/v1/trips/:id/location', async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        await (prisma as any).tripLocation.create({
            data: {
                tripId: parseInt(req.params.id),
                latitude,
                longitude
            }
        });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/v1/trips/:id/monitoring', async (req, res) => {
    try {
        const trip = await prisma.trip.findUnique({
            where: { id: parseInt(req.params.id) },
            include: { 
                stops: { orderBy: { sequence: 'asc' } },
                locations: { orderBy: { timestamp: 'desc' }, take: 100 }
            }
        });
        res.json(trip);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Flota: última ubicación por viaje activo (para mapa en tiempo real)
// + última posición por dispositivo desde la app chofer (DeviceLocation → POST /tracking/location)
app.get('/api/v1/fleet/locations', async (req, res) => {
    try {
        const trips = await prisma.trip.findMany({
            where: { status: { in: ['PENDING', 'OUT_OF_PLANT'] } },
            include: {
                locations: { orderBy: { timestamp: 'desc' }, take: 1 }
            },
            orderBy: { date: 'desc' },
            take: 50
        });
        const result: any[] = trips.map((t: any) => ({
            tripId: t.id,
            driver: t.driver,
            vehicle: t.vehicle,
            status: t.status,
            reparto: t.reparto,
            source: 'trip',
            lastLocation: t.locations?.[0]
                ? { latitude: t.locations[0].latitude, longitude: t.locations[0].longitude, timestamp: t.locations[0].timestamp }
                : null
        }));

        const since24h = new Date(Date.now() - 24 * 3600000);
        const recentDev = await prisma.deviceLocation.findMany({
            where: { isActive: true, timestamp: { gte: since24h } },
            orderBy: { timestamp: 'desc' }
        });
        const latestByDevice = new Map<string, (typeof recentDev)[0]>();
        for (const r of recentDev) {
            if (!latestByDevice.has(r.deviceId)) latestByDevice.set(r.deviceId, r);
        }

        const dayNow = new Date();
        const dayStart = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate(), 0, 0, 0, 0);
        const dayEnd = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate(), 23, 59, 59, 999);
        const driversForMap = await prisma.user.findMany({ where: { role: 'DRIVER' } });
        const driverIdByLabel = new Map<string, string>();
        for (const d of driversForMap) {
            driverIdByLabel.set(d.username.toLowerCase(), d.id);
            driverIdByLabel.set(d.fullName.toLowerCase(), d.id);
        }

        for (const r of latestByDevice.values()) {
            const labelKey = (r.deviceLabel || '').trim().toLowerCase();
            let inferredRouteId: number | null = null;
            if (labelKey) {
                const uid = driverIdByLabel.get(labelKey);
                if (uid) {
                    const rtToday = await prisma.route.findFirst({
                        where: { driverId: uid, date: { gte: dayStart, lte: dayEnd } },
                        orderBy: { id: 'desc' }
                    });
                    inferredRouteId = rtToday?.id ?? null;
                }
            }
            if (r.driverId && inferredRouteId == null) {
                const rtByDriver = await prisma.route.findFirst({
                    where: { driverId: r.driverId, date: { gte: dayStart, lte: dayEnd } },
                    orderBy: { id: 'desc' }
                });
                inferredRouteId = rtByDriver?.id ?? null;
            }
            const plannedRouteId = r.routeId != null ? r.routeId : inferredRouteId;
            result.push({
                tripId: `gps-${r.deviceId}`,
                driver: r.deviceLabel || r.deviceId,
                vehicle: 'App seguimiento',
                status: 'OUT_OF_PLANT',
                reparto: 'GPS',
                source: 'device',
                plannedRouteId,
                routeId: plannedRouteId,
                driverId: r.driverId ?? null,
                offRouteMeters: r.offRouteMeters ?? null,
                lastLocation: {
                    latitude: r.latitude,
                    longitude: r.longitude,
                    timestamp: r.timestamp,
                    offRouteMeters: r.offRouteMeters ?? null
                }
            });
        }

        const plannedIds = [...new Set(result.map((row: any) => row.plannedRouteId).filter((id: any) => id != null && Number.isFinite(Number(id))).map((id: any) => Number(id)))];
        let nextByRouteId = new Map<
            number,
            { stopId: number; sequence: number; name: string; lat: number; lng: number }
        >();
        if (plannedIds.length > 0) {
            const routesToday = await prisma.route.findMany({
                where: { id: { in: plannedIds } },
                include: { stops: { orderBy: { sequence: 'asc' }, include: { client: true } } }
            });
            for (const rt of routesToday) {
                const next = rt.stops.find(
                    (s) =>
                        s.status !== 'COMPLETED' &&
                        s.client?.latitude != null &&
                        s.client?.longitude != null
                );
                if (next) {
                    nextByRouteId.set(rt.id, {
                        stopId: next.id,
                        sequence: next.sequence,
                        name: (next.client?.name || `Parada ${next.sequence}`).toString(),
                        lat: Number(next.client!.latitude),
                        lng: Number(next.client!.longitude)
                    });
                }
            }
        }
        for (const row of result as any[]) {
            if (row.plannedRouteId != null && nextByRouteId.has(Number(row.plannedRouteId))) {
                row.nextPlannedStop = nextByRouteId.get(Number(row.plannedRouteId));
            }
        }

        res.json(result);
    } catch (e: any) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// Listado de choferes (usuarios con rol DRIVER) para asignar en repartos
app.get('/api/v1/drivers', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: { role: 'DRIVER' },
            select: { id: true, fullName: true, username: true }
        });
        res.json(users);
    } catch (e: any) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// Gestión de usuarios (credenciales) desde planificación
app.get('/api/v1/users', async (req, res) => {
    try {
        const roleRaw = String(req.query.role || '').trim().toUpperCase();
        const q = String(req.query.q || '').trim();
        const where: any = {
            tenantId: 'default-tenant'
        };
        if (roleRaw) where.role = roleRaw;
        if (q) {
            where.OR = [
                { username: { contains: q } },
                { fullName: { contains: q } }
            ];
        }
        const users = await prisma.user.findMany({
            where,
            orderBy: [{ role: 'asc' }, { username: 'asc' }],
            select: { id: true, username: true, fullName: true, role: true, tenantId: true, createdAt: true }
        });
        res.json(users);
    } catch (e: any) {
        res.status(500).json({ error: (e as Error).message });
    }
});

app.post('/api/v1/users', async (req, res) => {
    try {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '').trim();
        const fullName = String(req.body?.fullName || username).trim();
        const role = String(req.body?.role || 'DRIVER').trim().toUpperCase();

        if (!username) return res.status(400).json({ error: 'username es obligatorio' });
        if (!['DRIVER', 'ADMIN', 'CHOFER', 'AUXILIAR'].includes(role)) {
            return res.status(400).json({ error: 'role inválido (usar DRIVER, ADMIN, CHOFER o AUXILIAR)' });
        }
        // Solo DRIVER y ADMIN requieren password real (loguean en el sistema).
        // CHOFER y AUXILIAR son catálogos de personas: sin login.
        const requiresPassword = role === 'DRIVER' || role === 'ADMIN';
        if (requiresPassword && !password) {
            return res.status(400).json({ error: 'password es obligatorio para DRIVER/ADMIN' });
        }

        await prisma.tenant.upsert({
            where: { id: 'default-tenant' },
            update: {},
            create: { id: 'default-tenant', name: 'Real de Catorce' }
        });

        const user = await prisma.user.create({
            data: {
                username,
                password: requiresPassword ? await hashPassword(password) : '-',
                fullName: fullName || username,
                role,
                tenantId: 'default-tenant'
            },
            select: { id: true, username: true, fullName: true, role: true, tenantId: true, createdAt: true }
        });
        await logAction(req, 'CREATE', 'user', user.id, user.username, null, { username: user.username, role: user.role });
        res.status(201).json(user);
    } catch (e: any) {
        if (e?.code === 'P2002') return res.status(409).json({ error: 'El usuario ya existe' });
        res.status(500).json({ error: (e as Error).message });
    }
});

app.patch('/api/v1/users/:id/password', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const password = String(req.body?.password || '').trim();
        if (!id) return res.status(400).json({ error: 'id es obligatorio' });
        if (!password) return res.status(400).json({ error: 'password es obligatorio' });

        const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return res.status(404).json({ error: 'Usuario no encontrado' });

        await prisma.user.update({ where: { id }, data: { password: await hashPassword(password) } });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: (e as Error).message });
    }
});

app.patch('/api/v1/users/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const fullNameRaw = req.body?.fullName;
        const roleRaw = req.body?.role;
        if (!id) return res.status(400).json({ error: 'id es obligatorio' });

        const data: any = {};
        if (fullNameRaw !== undefined) {
            const fullName = String(fullNameRaw || '').trim();
            if (!fullName) return res.status(400).json({ error: 'fullName no puede estar vacío' });
            data.fullName = fullName;
        }
        if (roleRaw !== undefined) {
            const role = String(roleRaw || '').trim().toUpperCase();
            if (!['DRIVER', 'ADMIN', 'BLOCKED', 'CHOFER', 'AUXILIAR'].includes(role)) {
                return res.status(400).json({ error: 'role inválido (usar DRIVER, ADMIN, BLOCKED, CHOFER o AUXILIAR)' });
            }
            data.role = role;
        }
        if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Sin cambios para actualizar' });

        const user = await prisma.user.update({
            where: { id },
            data,
            select: { id: true, username: true, fullName: true, role: true, tenantId: true, createdAt: true }
        });
        res.json(user);
    } catch (e: any) {
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado' });
        res.status(500).json({ error: (e as Error).message });
    }
});

app.patch('/api/v1/users/:id/block', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id es obligatorio' });
        const blocked = Boolean(req.body?.blocked);
        let role = blocked ? 'BLOCKED' : String(req.body?.role || 'DRIVER').trim().toUpperCase();
        if (!['DRIVER', 'ADMIN'].includes(role) && !blocked) role = 'DRIVER';

        const user = await prisma.user.update({
            where: { id },
            data: { role },
            select: { id: true, username: true, fullName: true, role: true, tenantId: true, createdAt: true }
        });
        res.json(user);
    } catch (e: any) {
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado' });
        res.status(500).json({ error: (e as Error).message });
    }
});

app.delete('/api/v1/users/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: 'id es obligatorio' });
        await prisma.user.delete({ where: { id } });
        res.json({ success: true });
    } catch (e: any) {
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado' });
        res.status(500).json({ error: (e as Error).message });
    }
});

app.post('/api/upload-photo', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// --- ROUTE TEMPLATES API ---
app.get('/api/v1/route-templates', async (req, res) => {
    try {
        const templates = await (prisma as any).routeTemplate.findMany({
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });
        templates.sort((a: any, b: any) =>
            String(a?.name || '').localeCompare(String(b?.name || ''), 'es', {
                numeric: true,
                sensitivity: 'base'
            })
        );
        res.json(templates);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

async function upsertRouteTemplateByName(nameRaw: any, stopsRawInput: any) {
    const name = String(nameRaw || '').trim();
    const stopsRaw = Array.isArray(stopsRawInput) ? stopsRawInput : [];
    if (!name) throw new Error('name es obligatorio');
    if (stopsRaw.length === 0) throw new Error('stops es obligatorio');
    const stops = stopsRaw
        .map((s: any) => (typeof s === 'string' ? s : s?.name))
        .map((s: any) => String(s || '').trim())
        .filter(Boolean);
    if (stops.length === 0) throw new Error('stops vacío');

    const all = await (prisma as any).routeTemplate.findMany({ select: { id: true, name: true } });
    const existing = all.find((t: any) => String(t.name || '').trim().toUpperCase() === name.toUpperCase());

    let templateId = existing?.id as string | undefined;
    if (!templateId) {
        const created = await (prisma as any).routeTemplate.create({ data: { name } });
        templateId = created.id;
    } else {
        await (prisma as any).routeTemplate.update({
            where: { id: templateId },
            data: { name }
        });
    }

    await (prisma as any).routeStopTemplate.deleteMany({ where: { routeTemplateId: templateId } });
    for (let i = 0; i < stops.length; i++) {
        await (prisma as any).routeStopTemplate.create({
            data: { routeTemplateId: templateId, name: stops[i], sequence: i + 1 }
        });
    }
    return (prisma as any).routeTemplate.findUnique({
        where: { id: templateId },
        include: { stops: { orderBy: { sequence: 'asc' } } }
    });
}

app.post('/api/v1/route-templates', async (req, res) => {
    try {
        const saved = await upsertRouteTemplateByName(req.body?.name, req.body?.stops);
        res.json(saved);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error guardando plantilla' });
    }
});

// Alias admin para sincronización remota robusta (evita colisiones en proxies).
app.post('/api/v1/admin/route-templates', async (req, res) => {
    try {
        const saved = await upsertRouteTemplateByName(req.body?.name, req.body?.stops);
        res.json(saved);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error guardando plantilla' });
    }
});

/**
 * Convierte una plantilla de reparto (ej. R8) en clientIds ordenados para el viaje.
 * Los nombres de RouteStopTemplate deben coincidir (normalizados) con Client.name.
 */
app.get('/api/v1/route-templates/resolve-for-trip', async (req, res) => {
    try {
        const nameRaw = String(req.query.name || '').trim();
        if (!nameRaw || /^libre$/i.test(nameRaw)) {
            return res.status(400).json({ error: 'Indicá el nombre del reparto (ej. R8)' });
        }
        const want = nameRaw.toUpperCase();
        const candidates = await (prisma as any).routeTemplate.findMany({ select: { id: true, name: true } });
        const hit = candidates.find((t: { name: string }) => String(t.name).trim().toUpperCase() === want);
        if (!hit) {
            return res.json({
                templateFound: false,
                stops: [],
                unmatched: [],
                message: `No hay plantilla de reparto "${nameRaw}". Creala en «Rutas predefinidas».`
            });
        }
        const template = await (prisma as any).routeTemplate.findUnique({
            where: { id: hit.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });
        if (!template) {
            return res.json({ templateFound: false, stops: [], unmatched: [], message: 'Plantilla no encontrada' });
        }

        const clients = await prisma.client.findMany({
            select: { id: true, name: true, address: true }
        });
        const byNorm = new Map<string, { id: string; name: string; address: string | null }>();
        for (const c of clients) {
            const n = normClientNameForMatch(c.name);
            if (n && !byNorm.has(n)) byNorm.set(n, c);
        }

        const stops: Array<{ clientId: string; name: string; address: string; templateStopName: string }> = [];
        const unmatched: Array<{ templateStopName: string }> = [];
        for (const st of template.stops as Array<{ name: string }>) {
            const n = normClientNameForMatch(st.name);
            const c = byNorm.get(n);
            if (c) {
                stops.push({
                    clientId: c.id,
                    name: c.name,
                    address: c.address || '',
                    templateStopName: st.name
                });
            } else {
                unmatched.push({ templateStopName: st.name });
            }
        }

        res.json({
            templateFound: true,
            templateName: template.name,
            stops,
            unmatched
        });
    } catch (e: any) {
        console.error('GET route-templates/resolve-for-trip:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

app.put('/api/v1/route-templates/:id', async (req, res) => {
    const { id } = req.params;
    const { stops, name } = req.body; // Expected: array of strings or {name} objects, plus optional name

    try {
        // Update name if provided
        if (typeof name === 'string' && name.trim()) {
            await (prisma as any).routeTemplate.update({
                where: { id },
                data: { name: name.trim() }
            });
        }

        // Update stops if provided
        if (Array.isArray(stops)) {
            await (prisma as any).routeStopTemplate.deleteMany({
                where: { routeTemplateId: id }
            });

            const stopsToCreate = stops.map((s: any, idx: number) => ({
                routeTemplateId: id,
                name: typeof s === 'string' ? s : s.name,
                sequence: idx + 1
            }));

            for (const stop of stopsToCreate) {
                 await (prisma as any).routeStopTemplate.create({ data: stop });
            }
        }

        const updated = await (prisma as any).routeTemplate.findUnique({
            where: { id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });
        await logAction(req, 'UPDATE', 'route-template', id, updated?.name, null, { name: updated?.name, stopsCount: updated?.stops?.length });
        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Crear una plantilla de ruta vacía (sólo nombre, sin paradas)
app.post('/api/v1/route-templates/empty', async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'name es obligatorio' });

        const all = await (prisma as any).routeTemplate.findMany({ select: { id: true, name: true } });
        const dup = all.find((t: any) => String(t.name || '').trim().toUpperCase() === name.toUpperCase());
        if (dup) return res.status(409).json({ error: `Ya existe una ruta con el nombre "${name}"` });

        const created = await (prisma as any).routeTemplate.create({ data: { name } });
        const full = await (prisma as any).routeTemplate.findUnique({
            where: { id: created.id },
            include: { stops: { orderBy: { sequence: 'asc' } } }
        });
        await logAction(req, 'CREATE', 'route-template', created.id, name, null, { name });
        res.json(full);
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error creando plantilla' });
    }
});

// Eliminar una plantilla de ruta
app.delete('/api/v1/route-templates/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const before = await (prisma as any).routeTemplate.findUnique({ where: { id }, include: { stops: true } });
        await (prisma as any).routeStopTemplate.deleteMany({ where: { routeTemplateId: id } });
        await (prisma as any).routeTemplate.delete({ where: { id } });
        await logAction(req, 'DELETE', 'route-template', id, before?.name, before, null);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error eliminando plantilla' });
    }
});

// ── Push Notifications ───────────────────────────────────────────────────────
app.post('/api/v1/users/:id/push-token', async (req, res) => {
    try {
        const { id } = req.params;
        const token = String(req.body?.token || '').trim();
        if (!token) return res.status(400).json({ error: 'token requerido' });
        await prisma.user.update({ where: { id }, data: { pushToken: token } });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

/** Envía notificación push a un usuario a través de la API de Expo. */
async function sendExpoPush(pushToken: string, title: string, body: string, data?: any) {
    try {
        if (!pushToken.startsWith('ExponentPushToken[') && !pushToken.startsWith('ExpoPushToken[')) return;
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-encoding': 'gzip, deflate' },
            body: JSON.stringify({ to: pushToken, title, body, data: data || {}, sound: 'default', priority: 'high' })
        });
    } catch (e) { console.warn('[push] Error sending notification:', e); }
}

/** Notifica a un chofer por nombre de usuario si tiene push token. */
async function notifyDriver(driverUsername: string, title: string, body: string, data?: any) {
    try {
        const name = driverUsername.trim().toUpperCase();
        const user = await prisma.user.findFirst({ where: { username: name }, select: { pushToken: true } });
        if (user?.pushToken) await sendExpoPush(user.pushToken, title, body, data);
    } catch (_) {}
}

// ── Incidents ─────────────────────────────────────────────────────────────────
app.get('/api/v1/incidents', async (req, res) => {
    try {
        const status = String(req.query.status || '').trim() || undefined;
        const where: any = {};
        if (status) where.status = status;
        const incidents = await (prisma as any).incident.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { driver: { select: { id: true, fullName: true, username: true } } }
        });
        res.json(incidents);
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

app.post('/api/v1/incidents', async (req, res) => {
    try {
        const { driverId, tripId, type, description, photoUrl } = req.body;
        if (!driverId || !type || !description) return res.status(400).json({ error: 'driverId, type y description son obligatorios' });
        const incident = await (prisma as any).incident.create({
            data: { driverId, tripId: tripId || null, type, description, photoUrl: photoUrl || null }
        });
        // Notificar a todos los admins via socket
        io.emit('incident:created', { incident });
        res.status(201).json(incident);
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

app.patch('/api/v1/incidents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, resolution } = req.body;
        const data: any = {};
        if (status) data.status = status;
        if (resolution) data.resolution = resolution;
        if (status === 'CLOSED') data.closedAt = new Date();
        const incident = await (prisma as any).incident.update({ where: { id }, data });
        res.json(incident);
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

// ── Vehicle KM update ─────────────────────────────────────────────────────────
app.patch('/api/v1/vehicles/:plate/km', async (req, res) => {
    try {
        const { plate } = req.params;
        const km = Number(req.body?.km);
        if (!Number.isFinite(km) || km < 0) return res.status(400).json({ error: 'km debe ser un número válido' });
        const vehicle = await prisma.vehicle.upsert({
            where: { plate },
            update: { currentKm: km },
            create: { plate, tenantId: 'default-tenant', currentKm: km, status: 'ACTIVE' }
        });
        res.json({ success: true, currentKm: vehicle.currentKm });
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

// ── Client: toggle requiresProofPhoto ────────────────────────────────────────
app.patch('/api/v1/clients/:id/requires-proof', async (req, res) => {
    try {
        const { id } = req.params;
        const requires = Boolean(req.body?.requiresProofPhoto);
        const client = await prisma.client.update({ where: { id }, data: { requiresProofPhoto: requires } });
        res.json({ success: true, requiresProofPhoto: client.requiresProofPhoto });
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

// ── Trips bulk import ─────────────────────────────────────────────────────────
app.post('/api/v1/trips/bulk', async (req, res) => {
    const rows: any[] = Array.isArray(req.body?.trips) ? req.body.trips : [];
    if (!rows.length) return res.status(400).json({ error: 'El array trips está vacío' });

    let created = 0, errors: { row: number; error: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
        try {
            const row = rows[i];
            if (!row.date) { errors.push({ row: i + 1, error: 'Falta fecha' }); continue; }
            await prisma.trip.create({ data: { ...row, createdAt: undefined, updatedAt: undefined } });
            created++;
        } catch (e: any) {
            errors.push({ row: i + 1, error: e?.message || 'Error desconocido' });
        }
    }
    res.json({ created, errors, total: rows.length });
});

// ── WebSocket: rooms por chofer ───────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[ws] Cliente conectado: ${socket.id}`);

    // El cliente puede suscribirse a actualizaciones de un chofer específico
    // Uso: socket.emit('join:driver', 'id_del_chofer')
    socket.on('join:driver', (driverId: unknown) => {
        if (typeof driverId === 'string' && driverId.trim()) {
            socket.join(`driver:${driverId.trim()}`);
        }
    });

    socket.on('leave:driver', (driverId: unknown) => {
        if (typeof driverId === 'string' && driverId.trim()) {
            socket.leave(`driver:${driverId.trim()}`);
        }
    });

    socket.on('disconnect', () => console.log(`[ws] Cliente desconectado: ${socket.id}`));
});

// ── Estadísticas del día ──────────────────────────────────────────────────────
app.get('/api/v1/stats/today', async (_req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

        const [routesToday, routesCompleted, stopsTotal, stopsCompleted, stopsPending, activeTrackers, tripsToday, driversTotal] = await Promise.all([
            prisma.route.count({ where: { date: { gte: today, lt: tomorrow } } }),
            prisma.route.count({ where: { date: { gte: today, lt: tomorrow }, actualEndTime: { not: null } } }),
            prisma.stop.count({ where: { route: { date: { gte: today, lt: tomorrow } } } }),
            prisma.stop.count({ where: { status: 'COMPLETED', route: { date: { gte: today, lt: tomorrow } } } }),
            prisma.stop.count({ where: { status: 'PENDING', route: { date: { gte: today, lt: tomorrow } } } }),
            prisma.deviceLocation.findMany({ where: { timestamp: { gte: thirtyMinAgo } }, distinct: ['deviceId'], select: { deviceId: true } }).then(r => r.length),
            prisma.trip.count({ where: { date: { gte: today, lt: tomorrow } } }),
            prisma.user.count({ where: { role: 'DRIVER' } }),
        ]);

        res.json({ routesToday, routesCompleted, stopsTotal, stopsCompleted, stopsPending, activeTrackers, tripsToday, driversTotal });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Error al calcular estadísticas' });
    }
});

app.get('/api/v1/stats/week', async (_req, res) => {
    try {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const day = new Date();
            day.setHours(0, 0, 0, 0);
            day.setDate(day.getDate() - i);
            const nextDay = new Date(day);
            nextDay.setDate(nextDay.getDate() + 1);
            const [routes, completed, stops, stopsCompleted] = await Promise.all([
                prisma.route.count({ where: { date: { gte: day, lt: nextDay } } }),
                prisma.route.count({ where: { date: { gte: day, lt: nextDay }, actualEndTime: { not: null } } }),
                prisma.stop.count({ where: { route: { date: { gte: day, lt: nextDay } } } }),
                prisma.stop.count({ where: { status: 'COMPLETED', route: { date: { gte: day, lt: nextDay } } } }),
            ]);
            days.push({
                date: day.toISOString().slice(0, 10),
                routes,
                completed,
                stops,
                stopsCompleted
            });
        }
        res.json({ days });
    } catch (e: any) {
        console.error('GET /stats/week:', e);
        res.status(500).json({ error: e?.message || 'Error al obtener estadísticas semanales' });
    }
});

// ── TEMPORAL: crear cliente Real de Catorce y renombrar template REAL 14 ──
app.post('/api/admin/add-real14', async (req: any, res: any) => {
    const { key } = req.body || {};
    if (key !== 'r14-real14-2026') return res.status(403).json({ error: 'Forbidden' });

    try {
        const tenant = await prisma.tenant.findFirst();
        if (!tenant) return res.status(500).json({ error: 'No tenant' });

        // Crear cliente Real de Catorce
        const existing = await prisma.client.findFirst({ where: { name: 'Real de Catorce', tenantId: tenant.id } });
        let client;
        if (existing) {
            client = existing;
        } else {
            client = await prisma.client.create({
                data: {
                    tenantId: tenant.id,
                    name: 'Real de Catorce',
                    address: 'Ombú 1269, Burzaco, Almirante Brown',
                    latitude: -34.8353338,
                    longitude: -58.4233261,
                    zone: 'Almirante Brown',
                    barrio: 'BURZACO',
                    serviceTime: 15,
                    priority: 0,
                },
            });
        }

        // Renombrar template REAL 14 → Real de Catorce
        const updated = await prisma.routeStopTemplate.updateMany({
            where: { name: 'REAL 14' },
            data: { name: 'Real de Catorce' },
        });

        res.json({ client: { id: client.id, name: client.name, created: !existing }, templateUpdated: updated.count });
    } catch (e: any) {
        console.error('add-real14 error:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

// ── ELIMINADO: endpoint temporal rename-templates-2 (ya ejecutado) ──
if (false) app.post('/api/admin/rename-templates-2', async (req: any, res: any) => {
    const { key } = req.body || {};
    if (key !== 'r14-rename-2026-b2') return res.status(403).json({ error: 'Forbidden' });

    try {
        const mappings: { template: string; client: string }[] = [
            { template: "J.1", client: "Jardín Rincón Feliz N°1" },
            { template: "J.2", client: "Jardín Rincón Feliz N°2" },
            { template: "J.3", client: "Jardín Rincón Feliz N°3" },
            { template: "J.5", client: "Jardín Rincón Feliz N°5" },
            { template: "J.6", client: "Jardín Rincón Feliz N°6" },
            { template: "J.7", client: "Jardín Rincón Feliz N°7" },
            { template: "J.8", client: "Jardín Rincón Feliz N°8" },
            { template: "J.10", client: "Jardín Rincón Feliz N°10" },
            { template: "J.11", client: "Jardín Rincón Feliz N°11" },
            { template: "J.12", client: "Jardín Rincón Feliz N°12" },
            { template: "J.13", client: "Jardín Rincón Feliz N°13" },
            { template: "J.14", client: "Jardín Rincón Feliz N°14" },
            { template: "J.15", client: "Jardín Rincón Feliz N°15" },
            { template: "J.16", client: "Jardín Rincón Feliz N°16" },
            { template: "J.17", client: "Jardín Rincón Feliz N°17" },
            { template: "J.18", client: "Jardín Rincón Feliz N°18" },
            { template: "J.19", client: "Jardín Rincón Feliz N°19" },
            { template: "JM", client: "Jardin maternal 1" },
            { template: "CE.7", client: "JARDÍN DE INFANTES JUANA MANSO (MUNICIPAL N° 7)" },
        ];

        const results: { template: string; client: string; updated: number }[] = [];
        let totalUpdated = 0;

        for (const m of mappings) {
            const updated = await prisma.routeStopTemplate.updateMany({
                where: { name: m.template },
                data: { name: m.client },
            });
            results.push({ template: m.template, client: m.client, updated: updated.count });
            totalUpdated += updated.count;
        }

        const allTemplates = await prisma.routeStopTemplate.findMany({ select: { name: true } });
        const uniqueNames = [...new Set(allTemplates.map(t => t.name))];
        const clients = await prisma.client.findMany({ select: { name: true } });
        const clientNorms = new Map(clients.map(c => [normClientNameForMatch(c.name), c.name]));

        const matched: string[] = [];
        const unmatched: string[] = [];
        for (const n of uniqueNames) {
            if (clientNorms.has(normClientNameForMatch(n))) matched.push(n);
            else unmatched.push(n);
        }

        res.json({
            totalMappings: mappings.length,
            totalUpdated,
            details: results.filter(r => r.updated > 0),
            notFound: results.filter(r => r.updated === 0).map(r => r.template),
            verification: { totalUniqueTemplateNames: uniqueNames.length, matched: matched.length, unmatched: unmatched.length, unmatchedNames: unmatched },
        });
    } catch (e: any) {
        console.error('rename-templates-2 error:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

// ── ELIMINADO: endpoint temporal renombrar RouteStopTemplate (ya ejecutado) ──
if (false) app.post('/api/admin/rename-templates', async (req: any, res: any) => {
    const { key } = req.body || {};
    if (key !== 'r14-rename-2026') return res.status(403).json({ error: 'Forbidden' });

    try {
        const mappings: { template: string; client: string }[] = [
            { template: "EP.73", client: "E.P.B 73" },
            { template: "J.932", client: "JARDÍN 932" },
            { template: "ES.47", client: "E.E.S 47 (Ex SB 63)" },
            { template: "EP.75", client: "E.P.B 75" },
            { template: "ES.54", client: "E.E.S 54" },
            { template: "EP.70", client: "E.P.B 70" },
            { template: "J.915", client: "JARDÍN 915" },
            { template: "J.930", client: "JARDIN 930" },
            { template: "ES4", client: "E.E.S 4" },
            { template: "EP.21", client: "E.P.B 21" },
            { template: "EP.26", client: "E.P.B 26" },
            { template: "TEC.1", client: "TEC. 1" },
            { template: "J.903", client: "JARDIN 903" },
            { template: "EP.9", client: "E.P.B 9" },
            { template: "ES.70", client: "E.E.S 70" },
            { template: "EP.79", client: "E.P.B 79" },
            { template: "ES.36", client: "E.E.S 36 (Ex SB 67)" },
            { template: "EP.941", client: "JARDIN 941" },
            { template: "ES.10", client: "E.E.S 10" },
            { template: "ANEXO10", client: "E.E.S 10 (anexo)" },
            { template: "J.943", client: "JARDIN 943" },
            { template: "ES.30", client: "E.E.S 30" },
            { template: "SEC.44", client: "E.E.S 44" },
            { template: "EEE510", client: "E.E.E 510" },
            { template: "EP 31", client: "EP31" },
            { template: "JI 936", client: "J936" },
            { template: "JI 944", client: "J944" },
            { template: "EP 41", client: "E.P.B 41" },
            { template: "ES 44", client: "E.E.S 44" },
            { template: "Ce 18", client: "CE18" },
            { template: "EET 4", client: "TECNICA 4" },
            { template: "JI 932", client: "JARDÍN 932" },
            { template: "EP.42", client: "E.P.B 42" },
            { template: "ES.45", client: "E.E.S 45" },
            { template: "J.908", client: "Jardin de Infantes 908" },
            { template: "ES.17", client: "Secundaria 17" },
            { template: "TEC.3", client: "TEC. 3" },
            { template: "EP.24", client: "Primaria 24" },
            { template: "CEP.801", client: "CEC 801" },
            { template: "ES.5", client: "E.E.S 5" },
            { template: "EP30", client: "E.P.B 30" },
            { template: "J.917", client: "Jardin de Infantes 917" },
            { template: "EP.66", client: "E.P.B 66" },
            { template: "ES.26", client: "Secundaria 26" },
            { template: "EP.14", client: "Primaria 14" },
            { template: "J.912", client: "JARDIN 912" },
            { template: "TEC.8", client: "Técnica 8" },
            { template: "J.910", client: "Jardin de Infantes 910" },
            { template: "EP.38", client: "Primaria 38" },
            { template: "J.931", client: "JARDIN 931" },
            { template: "EP.15", client: "Primaria 15" },
            { template: "SEC.16", client: "Secundaria 16" },
            { template: "CPI3", client: "CPII 3" },
            { template: "CPI5", client: "CPII 5" },
            { template: "CPI 1", client: "CPII 1" },
            { template: "POLO ED", client: "Polo Educativo Malvinas Argentinas" },
            { template: "EP.65", client: "E.P.B 65" },
            { template: "EP.41", client: "E.P.B 41" },
            { template: "J.928", client: "JARDIN 928" },
            { template: "J.929", client: "JARDIN 929" },
            { template: "EP.80", client: "E.P.B 80" },
            { template: "J.942", client: "JARDÍN 942" },
            { template: "ES.14", client: "E.E.S 14" },
            { template: "J.911", client: "JARDÍN 911" },
            { template: "ES.20", client: "E.E.S 20 ( ex 54)" },
            { template: "CPI2", client: "CPII 2" },
            { template: "CPI4", client: "CPII 4" },
            { template: "J.953", client: "JARDIN 953" },
            { template: "EPB.61", client: "E.P.B 61" },
            { template: "EES.33", client: "E.E.S 33" },
            { template: "J.966", client: "JARDIN 966" },
            { template: "J.939", client: "JARDIN 939" },
            { template: "CPI6", client: "CPII 6" },
            { template: "EP.63", client: "E.P.B 63" },
            { template: "ES.66", client: "E.E.S 66" },
            { template: "EP.74", client: "E.P.B 74" },
            { template: "J.927", client: "JARDÍN 927" },
            { template: "J.913", client: "JARDÍN 913" },
            { template: "EP.68", client: "E.P.B 68" },
            { template: "ES.48", client: "E.E.S 48" },
            { template: "J.937", client: "JARDIN 937" },
            { template: "EPB.17", client: "E.P.B 17" },
            { template: "EEE.509", client: "E.E.E 509" },
            { template: "EES.6", client: "E.E.S 6" },
            { template: "EPB.34", client: "E.P.B 34" },
            { template: "J.934", client: "JARDIN 934" },
            { template: "J. GRILLITO", client: "JARDIN GRILLITO" },
            { template: "EP.10", client: "E.P.B 10" },
            { template: "J.956", client: "JARDIN 956" },
            { template: "SEC.8", client: "E.E.S 8" },
            { template: "EP.67", client: "E.P.B 67" },
            { template: "SEC.65", client: "E.E.S 65" },
            { template: "J.957", client: "JARDIN 957" },
            { template: "EP.44", client: "E.P.B 44" },
            { template: "SEC.60", client: "E.E.S 60" },
            { template: "J.2080", client: "JARDIN 2080" },
            { template: "EP.22", client: "E.P.B 22" },
            { template: "EP.40", client: "E.P.B 40" },
            { template: "J.916", client: "JARDIN 916" },
            { template: "ES.29", client: "E.E.S 29" },
            { template: "ES.9", client: "E.E.S 9" },
            { template: "J.922", client: "JARDIN 922" },
            { template: "EP.72", client: "E.P.B 72" },
            { template: "ES.34", client: "E.E.S 34" },
            { template: "J.951", client: "JARDIN 951" },
            { template: "EP.71", client: "E.P.B 71" },
            { template: "ES.71", client: "E.E.S 71" },
            { template: "J.921", client: "JARDIN 921" },
            { template: "EP.46", client: "E.P.B 46" },
            { template: "ES.62", client: "E.E.S 62" },
            { template: "J.955", client: "JARDIN 955" },
            { template: "J. LUCECITAS", client: "JARDIN LUCECITAS DE JESUS" },
            { template: "J. OLA VERDE", client: "JARDIN LA OLA VERDE" },
            { template: "ES.28", client: "E.E.S 28" },
            { template: "EP.25", client: "E.P.B 25" },
            { template: "EP.54", client: "E.P.B 54" },
            { template: "EEE.505", client: "E.E.E 505" },
            { template: "EP.32", client: "E.P.B 32" },
            { template: "ES.61", client: "E.E.S 61" },
            { template: "TEC.5", client: "TEC 5" },
            { template: "J MUNDO FELIZ", client: "JARDIN MUNDO FELIZ" },
            { template: "EP 74", client: "E.P.B 74" },
            { template: "J.925", client: "Jardin de Infantes 925" },
            { template: "ES.46", client: "E.E.S 46" },
            { template: "ES.19", client: "ES 19" },
            { template: "CET.1", client: "CEAT 1" },
            { template: "ES.16", client: "Secundaria 16" },
            { template: "EP.60", client: "E.P.B 60" },
            { template: "ES.64", client: "E.E.S 64" },
            { template: "J.938", client: "JARDIN 938" },
            { template: "EP.33", client: "E.P.B 33" },
            { template: "J.919", client: "JARDIN 919" },
        ];

        const results: { template: string; client: string; updated: number }[] = [];
        let totalUpdated = 0;

        for (const m of mappings) {
            const updated = await prisma.routeStopTemplate.updateMany({
                where: { name: m.template },
                data: { name: m.client },
            });
            results.push({ template: m.template, client: m.client, updated: updated.count });
            totalUpdated += updated.count;
        }

        // Verificar vinculación: cuántos templates ahora matchean un cliente
        const allTemplates = await prisma.routeStopTemplate.findMany({ select: { name: true } });
        const uniqueNames = [...new Set(allTemplates.map(t => t.name))];
        const clients = await prisma.client.findMany({ select: { name: true } });
        const clientNorms = new Map(clients.map(c => [normClientNameForMatch(c.name), c.name]));

        const matched: string[] = [];
        const unmatched: string[] = [];
        for (const n of uniqueNames) {
            if (clientNorms.has(normClientNameForMatch(n))) {
                matched.push(n);
            } else {
                unmatched.push(n);
            }
        }

        res.json({
            totalMappings: mappings.length,
            totalUpdated,
            details: results.filter(r => r.updated > 0),
            notFound: results.filter(r => r.updated === 0).map(r => r.template),
            verification: {
                totalUniqueTemplateNames: uniqueNames.length,
                matched: matched.length,
                unmatched: unmatched.length,
                unmatchedNames: unmatched,
            },
        });
    } catch (e: any) {
        console.error('rename-templates error:', e);
        res.status(500).json({ error: e?.message || 'Error' });
    }
});

// ── ELIMINADO: endpoint de migración SQLite→PostgreSQL (ya ejecutado) ────────
if (false) app.post('/api/admin/migrate-sqlite', async (req: any, res: any) => {
    const { key } = req.body || {};
    if (key !== 'r14-migrate-2026') return res.status(403).json({ error: 'Forbidden' });

    const sqlitePath = '/data/r14.db';
    if (!fs.existsSync(sqlitePath)) return res.status(404).json({ error: `No se encontró ${sqlitePath}` });

    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(sqlitePath, { readonly: true });
    const results: Record<string, any> = {};

    const b = (v: any) => v == null ? null : (v === 1 || v === true || v === '1' || v === 'true');
    const d = (v: any) => v ? new Date(v) : null;
    const n = (v: any) => v === undefined ? null : v;

    const migrate = async (name: string, rows: any[], fn: (row: any) => Promise<any>) => {
        let ok = 0, err = 0;
        for (const row of rows) {
            try { await fn(row); ok++; }
            catch (e: any) { err++; if (err <= 5) console.error(`[migrate] ${name}:`, e?.message?.slice(0, 150)); }
        }
        results[name] = { ok, err };
        console.log(`[migrate] ${name}: ${ok} ok, ${err} errores`);
    };

    try {
        await prisma.$executeRawUnsafe('SET session_replication_role = replica');

        const tenants = db.prepare('SELECT * FROM "Tenant"').all() as any[];
        await migrate('Tenant', tenants, r => prisma.tenant.upsert({ where: { id: r.id }, create: { id: r.id, name: r.name, settings: n(r.settings) }, update: { name: r.name, settings: n(r.settings) } }));

        const vehicles = db.prepare('SELECT * FROM "Vehicle"').all() as any[];
        await migrate('Vehicle', vehicles, r => prisma.vehicle.upsert({ where: { id: r.id }, create: { id: r.id, plate: r.plate, tenantId: r.tenantId, model: n(r.model), capacityWeight: n(r.capacityWeight ?? r.capacity), capacityVolume: n(r.capacityVolume), isRefrigerated: b(r.isRefrigerated) ?? false, status: r.status ?? 'ACTIVE', contractType: n(r.contractType), driverName: n(r.driverName), fuelType: n(r.fuelType), insurance: n(r.insurance), usefulLife: n(r.usefulLife), vehicleType: n(r.vehicleType) }, update: { plate: r.plate, model: n(r.model) } }));

        const users = db.prepare('SELECT * FROM "User"').all() as any[];
        await migrate('User', users, r => prisma.user.upsert({ where: { id: r.id }, create: { id: r.id, tenantId: r.tenantId, username: r.username, password: r.password, fullName: r.fullName, role: r.role ?? 'DRIVER', createdAt: d(r.createdAt) ?? new Date() }, update: { username: r.username, password: r.password, fullName: r.fullName } }));

        const clients = db.prepare('SELECT * FROM "Client"').all() as any[];
        await migrate('Client', clients, r => prisma.client.upsert({ where: { id: r.id }, create: { id: r.id, tenantId: r.tenantId, name: r.name, address: n(r.address), latitude: n(r.latitude), longitude: n(r.longitude), timeWindowStart: n(r.timeWindowStart), timeWindowEnd: n(r.timeWindowEnd), serviceTime: r.serviceTime ?? 15, zone: n(r.zone), priority: r.priority ?? 0, barrio: n(r.barrio) }, update: { name: r.name, address: n(r.address) } }));

        const rtemplates = db.prepare('SELECT * FROM "RouteTemplate"').all() as any[];
        await migrate('RouteTemplate', rtemplates, r => prisma.routeTemplate.upsert({ where: { id: r.id }, create: { id: r.id, name: r.name, createdAt: d(r.createdAt) ?? new Date(), updatedAt: d(r.updatedAt) ?? new Date() }, update: { name: r.name } }));

        const rstops = db.prepare('SELECT * FROM "RouteStopTemplate"').all() as any[];
        await migrate('RouteStopTemplate', rstops, r => prisma.routeStopTemplate.upsert({ where: { id: r.id }, create: { id: r.id, routeTemplateId: r.routeTemplateId, name: r.name, sequence: r.sequence }, update: { name: r.name, sequence: r.sequence } }));

        const trips = db.prepare('SELECT * FROM "Trip"').all() as any[];
        await migrate('Trip', trips, r => prisma.trip.upsert({ where: { id: r.id }, create: { id: r.id, date: d(r.date) ?? new Date(), priority: n(r.priority), zone: n(r.zone), vehicle: n(r.vehicle), driver: n(r.driver), provider: n(r.provider), auxiliar: n(r.auxiliar), auxiliar2: n(r.auxiliar2), auxiliar3: n(r.auxiliar3), businessUnit: n(r.businessUnit), distributionType: n(r.distributionType), contractType: n(r.contractType), vehicleType: n(r.vehicleType), tripType: n(r.tripType), entryTime: n(r.entryTime), exitTime: d(r.exitTime), returnTime: d(r.returnTime), value: n(r.value), paymentStatus: n(r.paymentStatus), paymentDate: d(r.paymentDate), observations: n(r.observations), notes: n(r.notes), status: r.status ?? 'PENDING', startedAt: d(r.startedAt), completedAt: d(r.completedAt), driverComments: n(r.driverComments), proofPhotoUrl: n(r.proofPhotoUrl), createdAt: d(r.createdAt) ?? new Date(), updatedAt: d(r.updatedAt) ?? new Date(), arrivalTime: n(r.arrivalTime), departureTime: n(r.departureTime), isRefrigerated: n(b(r.isRefrigerated)), kmArrival: n(r.kmArrival), kmDeparture: n(r.kmDeparture), reason: n(r.reason), temperature: n(r.temperature), reparto: n(r.reparto), locality: n(r.locality), vuelta: n(r.vuelta) }, update: { status: r.status ?? 'PENDING' } }));

        const routes = db.prepare('SELECT * FROM "Route"').all() as any[];
        await migrate('Route', routes, r => prisma.route.upsert({ where: { id: r.id }, create: { id: r.id, tenantId: r.tenantId, date: d(r.date) ?? new Date(), status: r.status ?? 'PLANNED', vehicleId: n(r.vehicleId), driverId: n(r.driverId), tripId: n(r.tripId), totalKm: n(r.totalKm), estimatedTime: n(r.estimatedTime), actualStartTime: d(r.actualStartTime), actualEndTime: d(r.actualEndTime), createdAt: d(r.createdAt) ?? new Date(), updatedAt: d(r.updatedAt) ?? new Date() }, update: { status: r.status ?? 'PLANNED' } }));

        const stops = db.prepare('SELECT * FROM "Stop"').all() as any[];
        await migrate('Stop', stops, r => prisma.stop.upsert({ where: { id: r.id }, create: { id: r.id, routeId: r.routeId, clientId: r.clientId, sequence: r.sequence, plannedEta: d(r.plannedEta), actualArrival: d(r.actualArrival), actualDeparture: d(r.actualDeparture), status: r.status ?? 'PENDING', reasonCode: n(r.reasonCode), observations: n(r.observations), proofPhotoUrl: n(r.proofPhotoUrl), deliveryWithoutIssues: n(b(r.deliveryWithoutIssues)), signatureUrl: n(r.signatureUrl) }, update: { status: r.status ?? 'PENDING' } }));

        const tripStops = db.prepare('SELECT * FROM "TripStop"').all() as any[];
        await migrate('TripStop', tripStops, r => prisma.tripStop.upsert({ where: { id: r.id }, create: { id: r.id, tripId: r.tripId, name: r.name, clientId: n(r.clientId), sequence: r.sequence, actualArrival: d(r.actualArrival), actualDeparture: d(r.actualDeparture), status: r.status ?? 'PENDING', observations: n(r.observations), failedReason: n(r.failedReason), latitude: n(r.latitude), longitude: n(r.longitude) }, update: { status: r.status ?? 'PENDING' } }));

        const salaries = db.prepare('SELECT * FROM "EmployeeSalary"').all() as any[];
        await migrate('EmployeeSalary', salaries, r => prisma.employeeSalary.upsert({ where: { id: r.id }, create: { id: r.id, month: r.month, firstName: n(r.firstName), lastName: r.lastName, role: n(r.role), grossSalary: n(r.grossSalary), dailyWage: n(r.dailyWage), seniority: n(r.seniority), baseScale: n(r.baseScale), createdAt: d(r.createdAt) ?? new Date(), updatedAt: d(r.updatedAt) ?? new Date() }, update: { grossSalary: n(r.grossSalary) } }));

        const maintenance = db.prepare('SELECT * FROM "MaintenanceRecord"').all() as any[];
        await migrate('MaintenanceRecord', maintenance, r => prisma.maintenanceRecord.upsert({ where: { id: r.id }, create: { id: r.id, plate: r.plate, category: n(r.category), month: n(r.month), date: n(r.date), mileage: n(r.mileage), workshop: n(r.workshop), workDone: n(r.workDone), cost: n(r.cost), notes: n(r.notes), createdAt: d(r.createdAt) ?? new Date(), updatedAt: d(r.updatedAt) ?? new Date() }, update: { cost: n(r.cost) } }));

        const settings = db.prepare('SELECT * FROM "AppSettings"').all() as any[];
        await migrate('AppSettings', settings, r => prisma.appSettings.upsert({ where: { id: r.id }, create: { id: r.id, key: r.key, value: r.value, updatedAt: d(r.updatedAt) ?? new Date() }, update: { value: r.value } }));

        const alerts = db.prepare('SELECT * FROM "Alert"').all() as any[];
        await migrate('Alert', alerts, r => prisma.alert.upsert({ where: { id: r.id }, create: { id: r.id, tenantId: n(r.tenantId), type: r.type, title: r.title, text: r.text, timeLabel: n(r.timeLabel), createdAt: d(r.createdAt) ?? new Date() }, update: { title: r.title } }));

        const repartos = db.prepare('SELECT * FROM "Reparto"').all() as any[];
        await migrate('Reparto', repartos, r => prisma.reparto.upsert({ where: { id: r.id }, create: { id: r.id, name: r.name, tenantId: r.tenantId ?? 'default-tenant', createdAt: d(r.createdAt) ?? new Date() }, update: { name: r.name } }));

        const repartoEstabs = db.prepare('SELECT * FROM "RepartoEstablishment"').all() as any[];
        await migrate('RepartoEstablishment', repartoEstabs, r => prisma.repartoEstablishment.upsert({ where: { id: r.id }, create: { id: r.id, repartoId: r.repartoId, excelName: r.excelName, sequence: r.sequence ?? 0 }, update: { excelName: r.excelName } }));

        const mappings = db.prepare('SELECT * FROM "EstablishmentMapping"').all() as any[];
        await migrate('EstablishmentMapping', mappings, r => prisma.establishmentMapping.upsert({ where: { id: r.id }, create: { id: r.id, excelName: r.excelName, clientId: r.clientId }, update: { clientId: r.clientId } }));

        // Resetear secuencias de autoincrement en PostgreSQL para evitar conflictos en nuevos registros
        for (const table of ['Route', 'Stop', 'Trip', 'TripStop', 'TripLocation', 'RepartoEstablishment']) {
            try {
                await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE(MAX(id), 1)) FROM "${table}"`);
            } catch { /* tabla vacía, sin problema */ }
        }

        results['DeviceLocation'] = { ok: 0, note: 'GPS histórico omitido (no crítico)' };

    } finally {
        await prisma.$executeRawUnsafe('SET session_replication_role = DEFAULT');
        db.close();
    }

    res.json({ success: true, results });
});
// ── FIN ──────────────────────────────────────────────────────────────────────

const host = process.env.HOST || '0.0.0.0';

// ── Cleanup automático de datos históricos ────────────────────────────────────
async function cleanupOldData() {
    const now = Date.now();
    const thirtyDaysAgo  = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo  = new Date(now - 90 * 24 * 60 * 60 * 1000);

    try {
        const r = await prisma.deviceLocation.deleteMany({ where: { timestamp: { lt: thirtyDaysAgo } } });
        if (r.count > 0) console.log(`[cleanup] GPS: ${r.count} registros borrados`);
    } catch (e) { console.error('[cleanup] Error GPS:', e); }

    try {
        const r = await (prisma as any).auditLog.deleteMany({ where: { createdAt: { lt: ninetyDaysAgo } } });
        if (r.count > 0) console.log(`[cleanup] AuditLog: ${r.count} registros borrados`);
    } catch { /* tabla puede no existir */ }

    try {
        const r = await prisma.alert.deleteMany({ where: { createdAt: { lt: thirtyDaysAgo } } });
        if (r.count > 0) console.log(`[cleanup] Alerts: ${r.count} registros borrados`);
    } catch (e) { console.error('[cleanup] Error alerts:', e); }

    // Limpiar fotos de entrega > 90 días
    try {
        if (fs.existsSync(uploadsDir)) {
            const cutoff = now - 90 * 24 * 60 * 60 * 1000;
            let deleted = 0;
            for (const file of fs.readdirSync(uploadsDir)) {
                const fp = path.join(uploadsDir, file);
                try {
                    const stat = fs.statSync(fp);
                    if (stat.mtimeMs < cutoff) { fs.unlinkSync(fp); deleted++; }
                } catch { /* skip */ }
            }
            if (deleted > 0) console.log(`[cleanup] Fotos: ${deleted} archivos borrados`);
        }
    } catch (e) { console.error('[cleanup] Error fotos:', e); }
}

function startCleanupJob() {
    cleanupOldData().catch(e => console.error('[cleanup] Error inicial:', e));
    setInterval(() => cleanupOldData().catch(e => console.error('[cleanup] Error periódico:', e)), 24 * 60 * 60 * 1000);
    console.log('[cleanup] Job iniciado — limpia GPS/Audit/Alerts/Fotos cada 24h');
}

async function bootstrapData() {
    try {
        await ensureSchemaReady();
        await initTenant();
        startupReady = true;
        startupError = null;
        console.log('[startup] Data initialization complete.');
        startCleanupJob();
        backfillAddressesFromCoords().catch(() => {});
    } catch (err) {
        console.error('[startup] Fatal startup error:', err);
        startupError = (err as any)?.message || String(err);
        // Dejamos logs visibles unos segundos y reiniciamos el contenedor.
        setTimeout(() => process.exit(1), 2000);
    }
}

httpServer.listen(port, host, () => {
    console.log(`R14 server listening on ${host}:${port}`);
    // No bloquea el healthcheck de Railway.
    bootstrapData().catch((err) => {
        console.error('[startup] Unexpected bootstrap failure:', err);
        startupError = (err as any)?.message || String(err);
        setTimeout(() => process.exit(1), 2000);
    });
});
