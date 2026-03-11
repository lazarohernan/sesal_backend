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
}

class MemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private stats = { hits: 0, misses: 0 };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Limpiar entradas expiradas cada 5 minutos
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
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

    const data = await generator();
    this.set(key, data, ttlMs);
    return data;
  }

  /**
   * Elimina una entrada del caché
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Elimina todas las entradas que coincidan con un patrón
   * @param pattern Patrón de prefijo para las claves
   */
  deleteByPattern(pattern: string): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Limpia todo el caché
   */
  clear(): void {
    this.cache.clear();
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
  getStats(): CacheStats {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Calcula el hit ratio del caché
   */
  getHitRatio(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return this.stats.hits / total;
  }

  /**
   * Destruye el caché y limpia el intervalo
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
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
  
  // Resultados de consultas pivot (2 minutos)
  CONSULTA_PIVOT: 2 * 60 * 1000,
  
  // Resumen del tablero (5 minutos)
  RESUMEN_TABLERO: 5 * 60 * 1000,
  
  // Datos del mapa (10 minutos)
  DATOS_MAPA: 10 * 60 * 1000
} as const;

// Claves de caché predefinidas
export const CACHE_KEYS = {
  CATALOGO_PIVOT: "pivot:catalogo",
  ANIOS_DISPONIBLES: "pivot:anios",
  PERIODOS_DISPONIBLES: "pivot:periodos",
  TABLAS_DETALLE: "pivot:tablas_detalle",
  DIMENSION_VALORES: (dimensionId: string, filtros?: string) => 
    `pivot:dimension:${dimensionId}${filtros ? `:${filtros}` : ""}`,
  RESUMEN_TABLERO: (anio?: number) => 
    `tablero:resumen${anio ? `:${anio}` : ""}`,
  DATOS_MAPA: "tablero:mapa"
} as const;
