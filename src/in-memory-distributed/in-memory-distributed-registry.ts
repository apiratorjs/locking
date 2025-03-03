import { Semaphore } from "../semaphore";

export const inMemoryDistributedSemaphoreRegistry = new Map<string, Semaphore>();
export const inMemoryDistributedMutexRegistry = new Map<string, Semaphore>();

export class InMemoryDistributedRegistry {
  public static listMutexNames(): string[] {
    return Array.from(inMemoryDistributedMutexRegistry.keys());
  }

  public static listSemaphoreNames(): string[] {
    return Array.from(inMemoryDistributedSemaphoreRegistry.keys());
  }

  public static clearMutexRegistry(): void {
    inMemoryDistributedMutexRegistry.clear();
  }

  public static clearSemaphoreRegistry(): void {
    inMemoryDistributedSemaphoreRegistry.clear();
  }

  public static hasMutex(name: string): boolean {
    return inMemoryDistributedMutexRegistry.has(name);
  }

  public static hasSemaphore(name: string): boolean {
    return inMemoryDistributedSemaphoreRegistry.has(name);
  }

  public static getMutex(name: string): Semaphore {
    const mutex = inMemoryDistributedMutexRegistry.get(name);
    if (!mutex) {
      throw new Error(`Mutex ${name} does not exist`);
    }

    return mutex;
  }

  public static getSemaphore(name: string): Semaphore {
    const semaphore = inMemoryDistributedSemaphoreRegistry.get(name);
    if (!semaphore) {
      throw new Error(`Semaphore ${name} does not exist`);
    }

    return semaphore;
  }
}
