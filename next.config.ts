import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Her home directory is itself an unrelated git repo with its own
  // package-lock.json further up the tree — pin the workspace root
  // explicitly so Turbopack doesn't try to guess it.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
