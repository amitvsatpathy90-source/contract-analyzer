import type { ObjectStorage } from "@/server/documents/storage";

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, new Uint8Array(data));
  }

  async get(key: string): Promise<Uint8Array> {
    const data = this.objects.get(key);

    if (!data) {
      throw new Error(`Object not found: ${key}`);
    }

    return new Uint8Array(data);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }
}
