const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(value: Uint8Array): string {
  let encodedValue = 0n;
  for (const byte of value) encodedValue = encodedValue * 256n + BigInt(byte);

  let encoded = "";
  while (encodedValue > 0n) {
    encoded = alphabet[Number(encodedValue % 58n)]! + encoded;
    encodedValue /= 58n;
  }
  const leadingZeros = value.findIndex((byte) => byte !== 0);
  const zeroCount = leadingZeros === -1 ? value.length : leadingZeros;
  return "1".repeat(zeroCount) + encoded;
}

export function decodeBase58(value: string): Buffer {
  let decoded = 0n;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Value is not valid Base58.");
    decoded = decoded * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.unshift(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  return Buffer.concat([Buffer.alloc(leadingZeros), Buffer.from(bytes)]);
}
