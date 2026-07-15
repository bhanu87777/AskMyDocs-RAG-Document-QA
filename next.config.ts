import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF parser ships native binaries / large assets and must run on the
  // Node server rather than being bundled. (Embeddings and OCR now go through
  // the Gemini API, so the local ML runtime is no longer bundled.)
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
