import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages ship native binaries / large assets and must run on the
  // Node server rather than being bundled: the local embedding model
  // (transformers.js + onnxruntime) and the PDF parser.
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-node",
    "pdf-parse",
    "pdfjs-dist",
    "sharp",
  ],
};

export default nextConfig;
