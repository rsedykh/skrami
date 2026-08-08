import type { Attachment } from "../shared/types";

const UPLOAD_URL = "https://upload.uploadcare.com/base/";
export const API_KEYS_URL = "https://app.uploadcare.com/projects/-/api-keys/";

// Direct browser → Uploadcare; the board only ever stores the resulting URL.
// Hand-rolled against the base upload API — the widget would be a dependency for a form post.
// The key belongs to the board (see Board.uploadcareKey), not to Skrami.
export async function uploadFile(file: File, publicKey: string): Promise<Attachment> {
  const body = new FormData();
  body.append("UPLOADCARE_PUB_KEY", publicKey);
  body.append("UPLOADCARE_STORE", "auto");
  body.append("file", file);
  const res = await fetch(UPLOAD_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const { file: uuid } = (await res.json()) as { file: string };
  if (!uuid) throw new Error("upload failed: no file id");
  return {
    url: `https://ucarecdn.com/${uuid}/`,
    name: file.name,
    isImage: file.type.startsWith("image/"),
  };
}

// Pure URL rewriting — a thumb is a few KB and the original is never loaded inline.
export function thumbUrl(url: string, w: number, h: number): string {
  return `${url}-/preview/${w}x${h}/-/format/auto/`;
}
