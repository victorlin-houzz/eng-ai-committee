declare module 'mammoth' {
  interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string; paragraph?: unknown }>;
  }
  interface InputBuffer {
    buffer: Buffer;
  }
  interface InputPath {
    path: string;
  }
  export function extractRawText(input: InputBuffer | InputPath): Promise<ConversionResult>;
  export function convertToHtml(input: InputBuffer | InputPath): Promise<ConversionResult>;
}
