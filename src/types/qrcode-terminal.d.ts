declare module 'qrcode-terminal' {
  export interface GenerateOptions {
    readonly small?: boolean;
  }

  export type GenerateCallback = (qr: string) => void;

  export interface QrCodeTerminal {
    generate(text: string, options?: GenerateOptions, callback?: GenerateCallback): void;
  }

  const qrcodeTerminal: QrCodeTerminal;
  export = qrcodeTerminal;
}
