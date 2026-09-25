import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ObjectStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

function resolveSafePath(root: string, key: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, key);

  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Invalid object storage key.");
  }

  return resolvedPath;
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root = process.env.STORAGE_LOCAL_DIR ?? ".data/objects") {
    this.root = path.resolve(root);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const target = resolveSafePath(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(resolveSafePath(this.root, key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(resolveSafePath(this.root, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;

    if (!bucket || !region) {
      throw new Error("S3_BUCKET and S3_REGION are required for S3 storage.");
    }

    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      throw new Error(
        "S3_ACCESS_KEY and S3_SECRET_KEY must be provided together.",
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!result.Body) {
      throw new Error(`Object storage returned no body for ${key}.`);
    }

    return result.Body.transformToByteArray();
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}

let objectStorage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  if (objectStorage) {
    return objectStorage;
  }

  const mode =
    process.env.STORAGE_MODE ??
    (process.env.NODE_ENV === "production" ? "s3" : "local");

  if (mode === "s3") {
    objectStorage = new S3ObjectStorage();
    return objectStorage;
  }

  if (mode === "local") {
    objectStorage = new LocalObjectStorage();
    return objectStorage;
  }

  throw new Error(`Unsupported STORAGE_MODE: ${mode}`);
}
