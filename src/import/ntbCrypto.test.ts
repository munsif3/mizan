import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import { decryptAesCbcPbkdf2 } from "./ntbCrypto";

/**
 * Equivalence proof: encrypt with CryptoJS exactly the way NTB statements are
 * encrypted (PBKDF2 keySize 4 words / SHA-1 / 15000 iterations, AES-CBC PKCS#7),
 * then decrypt with our WebCrypto implementation. The hasher is pinned to SHA1
 * explicitly — CryptoJS.PBKDF2's *default* hasher changed from SHA-1 to SHA-256
 * in CryptoJS 4.2.0, so relying on the default here would silently test the
 * wrong scheme (and would have, against a real NTB statement, decrypted nothing).
 */
function encryptLikeNTB(plaintext: string, password: string, saltHex: string, ivHex: string): string {
  const key = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(saltHex), {
    keySize: 4,
    iterations: 15000,
    hasher: CryptoJS.algo.SHA1,
  });
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, { iv: CryptoJS.enc.Hex.parse(ivHex) });
  return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
}

const SALT = "0123456789abcdef0123456789abcdef";
const IV = "fedcba9876543210fedcba9876543210";
const DOB = "14071995";

describe("decryptAesCbcPbkdf2", () => {
  it("decrypts CryptoJS-encrypted content byte-for-byte", async () => {
    const plaintext = "<table><tr><td>statement body with ලංකා unicode</td></tr></table>";
    const cipher = encryptLikeNTB(plaintext, DOB, SALT, IV);
    await expect(decryptAesCbcPbkdf2(DOB, SALT, IV, cipher)).resolves.toBe(plaintext);
  });

  it("fails with the wrong password", async () => {
    const cipher = encryptLikeNTB("secret", DOB, SALT, IV);
    await expect(decryptAesCbcPbkdf2("01011990", SALT, IV, cipher)).rejects.toThrow();
  });
});
