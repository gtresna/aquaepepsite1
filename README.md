# Custom Biolink (Linktree sendiri) — versi online dengan server

Halaman biolink bertema Obsidian Gold / Purple Velvet / Midnight Neon, lengkap dengan music player YouTube
(audio saja) dan Dashboard Admin. Data disimpan **di server**, jadi saat Anda mengubah profil, link, musik
atau tema, perubahan **langsung tampil untuk semua pengunjung tanpa restart server**
(halaman yang sedang terbuka ikut menyegarkan diri setiap 30 detik).

Tanpa dependency: hanya butuh **Node.js 18 atau lebih baru**.

```
biolink-online/
├── server.js        # server (API + file statis, penyimpanan di data/db.json)
├── package.json
├── .env.example     # contoh pengaturan
├── .gitignore
└── public/
    └── index.html   # tampilan publik + Dashboard Admin
```

## 1. Jalankan di komputer sendiri

```bash
cd biolink-online
ADMIN_PASSWORD='PasswordKuatAnda' npm start      # Windows PowerShell: $env:ADMIN_PASSWORD='PasswordKuatAnda'; npm start
```

Buka http://localhost:3000, lalu klik tombol **Admin** di paling bawah.

## 2. Ganti password admin

Password **tidak lagi ada di file `index.html`**. Server yang memeriksanya, lewat environment variable:

| Variable         | Fungsi                                                                 |
|------------------|------------------------------------------------------------------------|
| `ADMIN_PASSWORD` | Password login admin. Jika kosong, dipakai default `G4lih#99Xz` (ganti!) |
| `SESSION_SECRET` | String acak minimal 32 karakter untuk menandatangani token login        |
| `DATA_DIR`       | Folder penyimpanan data. Arahkan ke disk permanen di hosting            |
| `PORT`           | Diisi otomatis oleh hosting                                             |

Lokasi default password ada di `server.js` (konstanta `DEFAULT_PASSWORD`), tetapi sebaiknya jangan diedit di kode:
cukup isi `ADMIN_PASSWORD` di dashboard hosting. Server menolak login setelah 5 kali salah dari IP yang sama
(terkunci 10 menit).

## 3. Online 24/7 — pilih hosting yang menjalankan Node.js

> Vercel / Netlify / GitHub Pages **tidak cocok** untuk versi ini karena itu hosting statis
> (tidak ada server yang bisa menyimpan perubahan). Pakai layanan yang menjalankan proses Node.js.

Langkah umum (contoh Render, Railway, Fly.io, atau VPS):

1. Upload folder ini ke repository GitHub (file `.gitignore` sudah menyembunyikan `data/` dan `.env`).
2. Buat **Web Service** baru dan hubungkan ke repository tersebut.
3. Runtime: **Node** · Build command: `npm install` · Start command: `npm start`.
4. Isi Environment Variables: `ADMIN_PASSWORD`, `SESSION_SECRET` (dan `DATA_DIR` bila memakai disk permanen).
5. Deploy. Buka URL yang diberikan.

### Penting: agar data tidak hilang

Data admin disimpan sebagai file (`db.json`). Di hosting dengan **disk sementara**, file ini hilang saat
service restart, redeploy, atau tertidur. Contohnya paket gratis Render: service tidur setelah 15 menit tanpa
trafik, dan file lokal hilang setiap restart/redeploy/tidur; disk permanen hanya tersedia di paket berbayar
([dokumen Render](https://render.com/docs/free)). Pilihan Anda:

- **Disk permanen (paling aman):** pakai paket yang menyediakan disk/volume (Render paket berbayar, Railway
  Volume, Fly.io Volume, atau VPS). Pasang disk ke mis. `/data`, lalu set `DATA_DIR=/data`.
- **Tetap di paket gratis, pakai `seed.json`:** setelah selesai mengatur, buka Dashboard > **Data** >
  **Export JSON**, ganti nama file menjadi `seed.json`, taruh di folder proyek (sejajar `server.js`), commit,
  dan deploy. Setiap kali data hilang, server otomatis memakai `seed.json` sebagai data awal. Perubahan
  yang dibuat setelah export terakhir tetap bisa hilang, jadi ekspor ulang setelah perubahan penting.

## 4. Keamanan singkat

- Token login berlaku 12 jam dan hanya disimpan di tab browser admin.
- Semua input disaring di server (URL hanya http/https/mailto/tel, ukuran dibatasi).
- Pasang HTTPS (otomatis di hampir semua hosting di atas) supaya password tidak terkirim polos.

## API (untuk referensi)

| Method | Path          | Akses  | Keterangan                              |
|--------|---------------|--------|-----------------------------------------|
| GET    | `/api/config` | publik | Profil, link, musik, tema               |
| POST   | `/api/login`  | publik | Body `{"password":"..."}` → `{token}`   |
| PUT    | `/api/config` | admin  | Header `Authorization: Bearer <token>`  |
| GET    | `/healthz`    | publik | Cek server hidup                        |
