declare module "pdf-parse/lib/pdf-parse.js" {
  export default function pdf(
    data: Buffer,
  ): Promise<{ text: string; numpages: number; info: unknown }>;
}
