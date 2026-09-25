import path from "node:path";

export const PDF_MIME_TYPE = "application/pdf";
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const GENERIC_BINARY_MIME_TYPE = "application/octet-stream";

const SUPPORTED_TYPES = {
  ".pdf": PDF_MIME_TYPE,
  ".docx": DOCX_MIME_TYPE,
} as const;

export interface UploadFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ValidatedUpload {
  filename: string;
  mimeType: SupportedMimeType;
  bytes: Uint8Array;
}

export type SupportedMimeType =
  (typeof SUPPORTED_TYPES)[keyof typeof SUPPORTED_TYPES];

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentValidationError";
  }
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

function expectedMimeType(filename: string): SupportedMimeType {
  const extension = path.extname(filename).toLowerCase();
  const mimeType = SUPPORTED_TYPES[extension as keyof typeof SUPPORTED_TYPES];

  if (!mimeType) {
    throw new DocumentValidationError(
      "Unsupported file type. Upload a PDF or DOCX file.",
    );
  }

  return mimeType;
}

export async function validateUpload(file: UploadFile): Promise<ValidatedUpload> {
  if (!file.name.trim()) {
    throw new DocumentValidationError("The uploaded file has no filename.");
  }

  const mimeType = expectedMimeType(file.name);

  if (
    file.type &&
    file.type !== mimeType &&
    file.type !== GENERIC_BINARY_MIME_TYPE
  ) {
    throw new DocumentValidationError(
      "The uploaded file type does not match its .pdf or .docx filename.",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.length === 0) {
    throw new DocumentValidationError("The uploaded file is empty.");
  }

  const hasValidSignature =
    mimeType === PDF_MIME_TYPE
      ? startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
      : startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);

  if (!hasValidSignature) {
    throw new DocumentValidationError(
      `The uploaded file is not a valid ${mimeType === PDF_MIME_TYPE ? "PDF" : "DOCX"} file.`,
    );
  }

  return {
    filename: path.basename(file.name),
    mimeType,
    bytes,
  };
}
