# 🤝 Panduan Kontribusi (Contributing Guide)

Terima kasih atas minat Anda untuk berkontribusi pada **Artoria-Baileys**! Dokumen ini menjelaskan alur kerja Git, standar kualitas kode, dan kebijakan pengujian proyek.

---

## 🌿 Alur Kerja Percabangan (Branching Workflow)

Untuk menjaga stabilitas branch utama (`main`) dan memastikan setiap perubahan telah melalui review menyeluruh:

1. **Larangan Push Langsung ke `main`**:
   - Branch `main` diproteksi dan hanya menerima perubahan melalui merge terverifikasi.
   - Jangan pernah melakukan commit dan push langsung ke branch `main`.

2. **Konvensi Penamaan Branch**:
   - **Fitur / Migrasi Level Baru**: `feature/level<N>-<deskripsi-singkat>`  
     *Contoh*: `feature/level3-usync-transaction`, `feature/level4-state-manager`
   - **Rilis Milestone**: `release/v<Major>.<Minor>.<Patch>`  
     *Contoh*: `release/v0.5.0`
   - **Perbaikan Bug**: `fix/<deskripsi-singkat>`  
     *Contoh*: `fix/session-record-buffer-deserialization`

3. **Alur Kerja Pengajuan**:
   ```bash
   # 1. Pastikan main Anda up-to-date
   git checkout main
   git pull origin main

   # 2. Buat branch baru untuk tugas Anda
   git checkout -b feature/level3-usync-transaction

   # 3. Kembangkan dan jalankan pengujian
   npm test

   # 4. Commit dan push ke branch Anda
   git commit -m "feat(level3): implement rust usync protocol decoder"
   git push -u origin feature/level3-usync-transaction
   ```
   - Buat **Pull Request (PR)** di GitHub menuju branch `main`.
   - Branch akan di-merge ke `main` setelah seluruh pengujian lolos dan disetujui.

---

## 🛡️ Standar Kualitas & Pengujian

Setiap modul Rust yang dimigrasikan wajib memenuhi standar:
1. **100% Bit-Exact Parity**: Hasil komputasi dan output enkripsi/dekripsi harus identik dengan spesifikasi Baileys & Signal Protocol.
2. **Dual-Engine / Cross-Engine Interoperability**: Untuk modul stateful kriptografi (seperti Signal Double Ratchet & X3DH), wajib menyertakan pengujian interoperabilitas dua arah (Rust $\leftrightarrow$ JS).
3. **Pembersihan State & Anti-DoS**: Wajib mematuhi batasan keamanan invariant (seperti limit 2000 iterasi ratchet masa depan dan batas FIFO capping state).
4. **Zero Credentials in Git**: Pastikan tidak ada kredensial WhatsApp atau file session runtime (`auth_info_baileys/`, test vectors) yang ter-commit ke repositori.

---

## 🛠️ Build dari Source

```bash
# Build binary Rust release
cargo build --manifest-path rust/Cargo.toml --package baileys-napi --release

# Salin binary ke root project
cp rust/target/release/libbaileys_napi.so baileys-napi.node        # Linux
cp rust/target/release/libbaileys_napi.dylib baileys-napi.node     # macOS
copy rust\target\release\baileys_napi.dll baileys-napi.node       # Windows
```
