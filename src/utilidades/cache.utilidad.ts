/**
 * Sistema de caché en memoria con TTL para optimizar consultas frecuentes.
 * Ideal para catálogos, dimensiones y datos que no cambian frecuentemente.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  keys: string[];
  pending: number;
}

class MemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private pending = new Map<string, Promise<unknown>>();
  private stats = { hits: 0, misses: 0 };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Limpiar entradas expiradas cada 5 minutos
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  /**
   * Obtiene un valor del caché
   * @param key Clave del caché
   * @returns El valor cacheado o undefined si no existe o expiró
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    this.stats.hits++;
    return entry.data;
  }

  /**
   * Almacena un valor en el caché
   * @param key Clave del caché
   * @param data Datos a cachear
   * @param ttlMs Tiempo de vida en milisegundos (default: 5 minutos)
   */
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      expiresAt: now + ttlMs,
      createdAt: now
    });
  }

  /**
   * Obtiene un valor del caché o lo genera si no existe
   * @param key Clave del caché
   * @param generator Función que genera el valor si no está en caché
   * @param ttlMs Tiempo de vida en milisegundos
   */
  async getOrSet<T>(
    key: string,
    generator: () => Promise<T>,
    ttlMs: number = 5 * 60 * 1000
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.pending.get(key) as Promise<T> | undefined;
    if (pending) {
      this.stats.hits++;
      return pending;
    }

    const promise = generator()
      .then((data) => {
        this.set(key, data, ttlMs);
        return data;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Elimina una entrada del caché
   */
  delete(key: string): boolean {
    this.pending.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Limpia todo el caché
   */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Elimina entradas expiradas
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Obtiene estadísticas del caché
   */
  getStats(options?: { includeKeys?: boolean; maxKeys?: number }): CacheStats {
    const includeKeys = options?.includeKeys ?? true;
    const maxKeys = Math.max(0, options?.maxKeys ?? 100);

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      keys: includeKeys ? Array.from(this.cache.keys()).slice(0, maxKeys) : [],
      pending: this.pending.size
    };
  }

  countKeysByPrefix(prefix: string): number {
    let total = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        total++;
      }
    }
    return total;
  }

  /**
   * Calcula el hit ratio del caché
   */
  getHitRatio(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return this.stats.hits / total;
  }
}

// Instancia singleton del caché
export const cache = new MemoryCache();

// TTLs predefinidos para diferentes tipos de datos
export const CACHE_TTL = {
  // Catálogos que casi nunca cambian (30 minutos)
  CATALOGO_PIVOT: 30 * 60 * 1000,
  
  // Años disponibles (10 minutos)
  ANIOS_DISPONIBLES: 10 * 60 * 1000,
  
  // Valores de dimensiones estáticas como regiones, niveles (15 minutos)
  DIMENSION_ESTATICA: 15 * 60 * 1000,
  
  // Valores de dimensiones dinámicas como establecimientos (5 minutos)
  DIMENSION_DINAMICA: 5 * 60 * 1000,
  
  // Resultados de consultas pivot (60 minutos - los datos históricos no cambian frecuentemente)
  CONSULTA_PIVOT: 60 * 60 * 1000,

  // Resumen del tablero (60 minutos)
  RESUMEN_TABLERO: 60 * 60 * 1000,

  // Datos del mapa (60 minutos)
  DATOS_MAPA: 60 * 60 * 1000
} as const;

// Claves de caché predefinidas
export const CACHE_KEYS = {
  CATALOGO_PIVOT: "pivot:catalogo",
  ANIOS_DISPONIBLES: "pivot:anios",
  PERIODOS_DISPONIBLES: "pivot:periodos",
  TABLAS_DETALLE: "pivot:tablas_detalle",
  MESES_OCUPADOS: (anio: number) => `pivot:meses:${anio}`,
  DIMENSION_VALORES: (dimensionId: string, filtros?: string) => 
    `pivot:dimension:${dimensionId}${filtros ? `:${filtros}` : ""}`,
  RESUMEN_TABLERO: (anio?: number) => 
    `tablero:resumen${anio ? `:${anio}` : ""}`,
  DATOS_MAPA: "tablero:mapa"
} as const;
