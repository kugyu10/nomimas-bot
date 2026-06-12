import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // admin/ はモノリポ内のサブアプリ — turbopack.root を admin/ 自身に設定して
  // 上位の package-lock.json を workspace root と誤認しないようにする
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
