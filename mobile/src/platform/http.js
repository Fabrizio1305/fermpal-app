// Requêtes vers kDrive (qui refuse les appels d'une page web) : sur le téléphone,
// le canal natif d'Android (CapacitorHttp, pas de CORS) ; en mode web (tests),
// fetch. Corps binaire : octets (Uint8Array) ; réponse « bytes », « json » ou « text ».
// Même module que MyGarden (23/10).
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function request({ method = "GET", url, headers = {}, body, responseType = "json", timeout = 30000 }) {
  if (Capacitor.isNativePlatform()) {
    const isBytes = body instanceof Uint8Array;
    const res = await CapacitorHttp.request({
      method,
      url,
      headers,
      ...(body === undefined ? {} : isBytes ? { data: bytesToBase64(body), dataType: "file" } : { data: body }),
      responseType: responseType === "bytes" ? "arraybuffer" : responseType === "json" ? "json" : "text",
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    let data = res.data;
    // Octets : base64 d'Android ; mais une réponse annoncée JSON arrive déjà lue (objet).
    if (responseType === "bytes") data = typeof data === "string" ? base64ToBytes(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(JSON.stringify(data));
    else if (responseType === "json" && typeof data === "string") data = data ? JSON.parse(data) : null;
    return { status: res.status, data };
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : typeof body === "string" ? body : JSON.stringify(body),
  });
  const data = responseType === "bytes" ? new Uint8Array(await res.arrayBuffer()) : responseType === "json" ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data };
}
