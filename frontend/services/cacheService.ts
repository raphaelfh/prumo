/**
 * Centralized cache for the application
 * Supports TTL, invalidation and multiple instances
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number;
}

class CacheService {
  private cache: Map<string, CacheEntry<any>>;
  private name: string;

  constructor(name: string = 'default') {
    this.cache = new Map();
    this.name = name;
  }

  /**
   * Armazena um valor no cache
   */
  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Recupera um valor do cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;

      // Check if expired
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Recupera ou busca um valor
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    const data = await fetchFn();
    this.set(key, data, ttl);
    return data;
  }

  /**
   * Remove um valor do cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Verifica se uma chave existe
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

      // Check if expired
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove entradas expiradas
   */
  cleanup(): number {
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Retorna o tamanho do cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Returns cache statistics
   */
  getStats() {
    return {
      name: this.name,
      size: this.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

// Pre-configured cache instances
export const globalCache = new CacheService('global');
export const articleCache = new CacheService('article');

// Auto cleanup every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    globalCache.cleanup();
    articleCache.cleanup();
  }, 5 * 60 * 1000);
}

