/**
 * NTB encrypted-statement decryption using native WebCrypto.
 * Scheme, confirmed against a real NTB statement's own decryptDocument()
 * script (not CryptoJS's version-dependent PBKDF2 default): PBKDF2-SHA1,
 * 15,000 iterations, 128-bit key, then AES-128-CBC with PKCS#7 padding.
 * Equivalence is proven in ntbCrypto.test.ts, which pins CryptoJS's hasher to
 * SHA1 explicitly rather than relying on its default (which changed from
 * SHA-1 to SHA-256 in CryptoJS 4.2.0 — the wrong default would still make the
 * test pass against itself while decrypting nothing real).
 */

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function decryptAesCbcPbkdf2(
  password: string,
  saltHex: string,
  ivHex: string,
  cipherBase64: string,
): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const keyMaterial = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const keyBits = await subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex) as BufferSource, iterations: 15000, hash: "SHA-1" },
    keyMaterial,
    128,
  );
  const key = await subtle.importKey("raw", keyBits, { name: "AES-CBC" }, false, ["decrypt"]);
  const plaintext = await subtle.decrypt(
    { name: "AES-CBC", iv: hexToBytes(ivHex) as BufferSource },
    key,
    base64ToBytes(cipherBase64) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
