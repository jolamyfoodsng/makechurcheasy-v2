/**
 * uploadFileBytes.ts — save a file into the app's uploads folder through Tauri.
 *
 * Sends the bytes as the raw request body (`save_upload_file_raw`). The older
 * `save_upload_file` command takes a JSON list of numbers, which is very slow for large videos;
 * it is kept only as the fallback.
 */

export async function saveUploadBytes(fileName: string, bytes: Uint8Array): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<string>("save_upload_file_raw", bytes, {
      headers: { "x-file-name": encodeURIComponent(fileName) },
    });
  } catch (rawErr) {
    console.warn("[upload] Raw save failed, using the slower save:", rawErr);
    return await invoke<string>("save_upload_file", {
      fileName,
      fileData: Array.from(bytes),
    });
  }
}
