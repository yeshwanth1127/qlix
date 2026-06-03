import * as ed from '@noble/ed25519';

export async function generateKeypair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const { secretKey, publicKey } = await ed.keygenAsync();

  return {
    privateKey: Buffer.from(secretKey).toString('hex'),
    publicKey: Buffer.from(publicKey).toString('hex'),
  };
}

export async function signAction(payload: string, privateKeyHex: string): Promise<string> {
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  const messageBytes = new TextEncoder().encode(payload);
  const signature = await ed.signAsync(messageBytes, secretKey);
  return Buffer.from(signature).toString('hex');
}

export async function verifySignature(
  payload: string,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
  const signatureBytes = Buffer.from(signatureHex, 'hex');
  const messageBytes = new TextEncoder().encode(payload);
  return ed.verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
}
