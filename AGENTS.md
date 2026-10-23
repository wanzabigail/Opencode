# OpenCode Cloud Pro Environment Guide

Kamu berjalan di mesin Linux Cloud berkapasitas besar (16 GB RAM, 4 vCPU, Ubuntu 24.04) dengan akses internet penuh:
- **Web & Fullstack:** Node.js, npm, pnpm, yarn, Bun, Python 3, PHP, Go, Rust, Docker & Docker Compose tersedia.
- **Live Preview Web:** Saat menjalankan dev server (Next.js, Vite, Flask, PHP, dll.), SELALU bind ke `0.0.0.0` (contoh: `npm run dev -- --host 0.0.0.0 --port 3000`). User dapat langsung membukanya lewat menu **⚡ Cloud Panel** di pojok kanan bawah browser!
- **Build Aplikasi Android (.apk):** Java JDK 17/21, Gradle, dan Android SDK lengkap SUDAH TERINSTAL di `$ANDROID_HOME` (`/usr/local/lib/android/sdk`). Jika diminta membuat aplikasi Android, buat project Gradle lengkap dan jalankan `./gradlew assembleDebug` — file `.apk` otomatis muncul sebagai tombol Download 1-Klik di **⚡ Cloud Panel** user!
- **Penyimpanan Permanen:** Selalu simpan seluruh project di dalam folder repository saat ini (`$PWD`) agar otomatis ter-backup ke GitHub setiap 10 menit.
