declare module 'qrcode' {
  export interface ToFileOptions {
    readonly width?: number;
  }

  export function toFile(path: string, text: string, options?: ToFileOptions): Promise<void>;
}
