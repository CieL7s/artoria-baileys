# Artoria-Baileys Memory & Runtime Optimization Plan

## Tujuan

Menurunkan RSS/native memory `artoria-baileys` tanpa mengorbankan API compatibility dan performa native yang sudah unggul di benchmark.

Target:
- mencari sumber selisih RSS 100+ MB antara Baileys dan Artoria-Baileys
- mengurangi native memory yang tidak perlu
- menghilangkan runtime/thread yang redundan
- mengurangi copy `Buffer -> Vec -> Buffer` dan serialisasi yang tidak perlu
- mempertahankan performa crypto/native
- menambah benchmark memory yang bisa membedakan V8 heap, ArrayBuffer, external memory, native allocation, dan RSS

## Kondisi Saat Ini

Observasi runtime bot:
- Baileys: RSS sekitar 210 MB, heapUsed sekitar 42 MB.
- Artoria-Baileys: RSS sekitar 330 MB, heapUsed sekitar 43 MB.
- Artoria-Baileys memiliki ArrayBuffer dan external memory lebih tinggi.
- `getActiveResourcesInfo()`, active handles, dan active requests tidak menunjukkan resource aktif yang tertinggal.
- Bot utama sekarang memakai Bun + N-API.

Benchmark v0.6.1 menunjukkan Rust unggul pada crypto dan beberapa operasi berat, tetapi kalah pada operasi yang sering melewati FFI/object boundary. Jangan mengoptimalkan memory dengan cara yang merusak benchmark tersebut.

## Phase 1 — Baseline Memory

Tambahkan benchmark checkpoint:

1. baseline Bun tanpa native module
2. setelah import `artoria-baileys`
3. setelah membuat `WhatsAppClient`
4. setelah `on_event()`
5. setelah `connect()`
6. setelah authentication
7. setelah 1 / 100 / 1.000 / 10.000 pesan
8. setelah GC
9. setelah disconnect
10. setelah object client dilepas

Metric:
- RSS
- heapUsed
- heapTotal
- external
- arrayBuffers
- maxRSS
- CPU time
- thread count jika tersedia

Jangan memakai RSS sebagai satu-satunya indikator.

## Phase 2 — Unifikasi Tokio Runtime

Temuan utama ada di `rust/baileys-napi/src/lib.rs`: `WhatsAppClient` sudah menyimpan `Arc<Runtime>`, tetapi constructor membuat runtime tersebut, `connect()` membuat runtime multi-thread baru di thread baru, dan `on_event()` membuat runtime current-thread lain.

Target:

```text
WhatsAppClient
└── 1 Tokio Runtime
    ├── connection task
    ├── event task
    └── service/background tasks
```

Perubahan:
- pertahankan satu `Arc<Runtime>`
- `connect()` spawn task pada runtime yang sudah ada
- `on_event()` spawn task pada runtime yang sama
- hilangkan runtime tambahan per method
- hindari `std::thread::spawn` yang hanya dipakai untuk membuat runtime
- pastikan runtime hidup selama task masih diperlukan

Acceptance:
- satu client tidak membuat runtime redundan
- pairing, connect, reconnect, send message, dan event callback tetap normal
- ukur RSS dan thread count sebelum/sesudah

## Phase 3 — Audit Thread & Task Lifetime

Ukur thread count pada:
- startup
- import native
- client creation
- connect
- authenticated
- steady-state
- disconnect

Audit:
- connection task
- websocket reader/writer
- ping/keepalive
- event dispatcher
- outgoing worker
- reconnect worker
- background sync

Pastikan semua task berhenti saat disconnect dan tidak menahan `Arc` yang sudah tidak diperlukan.

## Phase 4 — Audit Unbounded Channel

Cari seluruh `mpsc::unbounded_channel`, terutama:
- outgoing `BinaryNode`
- `BotEvent`
- raw frame/byte queue

Untuk tiap channel:
- tentukan apakah benar-benar perlu unbounded
- bila tidak, gunakan bounded channel
- tetapkan kapasitas
- tambahkan observability queue pressure
- pastikan backpressure tidak menyebabkan deadlock/message loss

Uji dengan burst traffic dan ukur pertumbuhan RSS.

## Phase 5 — Audit `FrameBuffer`

Periksa `FrameBuffer`:
- retained `Vec<u8>` capacity
- pola append/remove
- copy berulang
- perilaku setelah frame besar

Test:

```text
frame kecil
-> frame besar
-> frame kecil
-> GC
-> ukur RSS
```

Jika capacity retention terbukti, gunakan reuse/shrink berbasis threshold. Jangan `shrink_to_fit()` setiap frame.

## Phase 6 — Audit N-API Buffer Boundary

Cari pola:
- `Buffer -> Vec`
- `Vec -> Buffer`
- `Buffer::from(...)`
- `.as_ref().to_vec()`

Prioritas:
- media
- app-state patches
- Signal records
- Noise transport
- sender-key objects
- payload besar dan fungsi hot path

Kurangi copy hanya ketika ownership/safety tetap jelas.

## Phase 7 — Kurangi JSON Hot Path

Saat ini sejumlah API melakukan:

```text
JS object/JSON
-> serde_json deserialize
-> Rust object
-> Rust operation
-> serde_json serialize
-> JS object/JSON
```

Fokus:
- GroupCipher
- SessionCipher
- message normalization
- decode/encode node
- USync

Target:

```text
JS
-> native handle/state
-> Rust operation
-> minimal result
```

Bukan deserialize/serialize state pada setiap operasi.

Jangan mengubah persistence format publik tanpa compatibility layer.

## Phase 8 — Native Persistent Signal/Group State

Benchmark menunjukkan GroupCipher Rust terkena biaya serialisasi/deserialisasi state.

Target API konseptual:

```text
create record -> native handle
encrypt(handle, plaintext)
decrypt(handle, ciphertext)
serialize(handle) hanya saat persistence
```

Manfaat:
- mengurangi JSON allocation
- mengurangi string allocation
- mengurangi FFI overhead
- mengurangi temporary memory
- state lebih natural berada di Rust

Tetap jaga kompatibilitas persistence existing.

## Phase 9 — Audit Ownership & Lifetime

Audit:
- `Arc`
- `Mutex`
- `RwLock`
- `HashMap`
- `Vec`/`VecDeque`
- buffer/cache
- auth state
- crypto state
- transport state
- callback/task captures

Cari:
- `Arc` cycle
- clone tidak perlu
- cache tanpa eviction
- queue yang menahan buffer
- task yang mempertahankan `Arc<WhatsAppClientCore>`
- state yang tetap hidup setelah disconnect

Target lifecycle:

```text
create
-> connect
-> steady state
-> disconnect
-> cancel tasks
-> close channels
-> drop state
```

## Phase 10 — Native Memory Profiling

Jika source audit belum menjelaskan selisih RSS, lakukan profiling native.

Tooling yang dapat dipertimbangkan:
- Visual Studio Performance Profiler
- Windows Performance Recorder / Analyzer
- ETW
- allocator profiling seperti jemalloc/mimalloc bila cocok dengan build

Bedakan:
- live native allocation
- allocator retained memory
- thread stack reservation
- memory-mapped library/image
- retained cache/state

## Phase 11 — Benchmark Tambahan

Tambahkan macro benchmark:

### Startup

```text
empty process
import native
client construct
event registration
connect
authenticated
```

### Steady State

```text
1 min idle
5 min idle
30 min idle
```

### Traffic

```text
100 msg
1k msg
10k msg
50k msg
```

### Burst

```text
10k message burst
large media burst
large WABinary burst
```

### Recovery

```text
connect
traffic
disconnect
GC
reconnect
```

Setiap hasil simpan:
- RSS
- heapUsed
- external
- arrayBuffers
- maxRSS
- thread count
- CPU time
- allocation metrics bila profiler tersedia

## Phase 12 — Fairness & Regression

Benchmark existing tetap dipakai:
- warmup
- 5 independent runs
- median/mean/stddev/min/max
- payload identik

Untuk setiap optimization catat:

```text
Before:
RSS
heapUsed
external
arrayBuffers
threads
benchmark

After:
RSS
heapUsed
external
arrayBuffers
threads
benchmark

Delta:
memory %
performance %
```

Jangan menghapus testcase yang membuat Rust kalah.

Jangan merge jika:
- protocol reliability rusak
- reconnect rusak
- event hilang
- crypto parity berubah
- API compatibility rusak
- memory turun tetapi performance jatuh tanpa alasan yang jelas

## Urutan Eksekusi

```text
1. Baseline memory + thread profiling
2. Unifikasi Tokio runtime
3. Task lifecycle + disconnect cleanup
4. Audit unbounded channels
5. Audit FrameBuffer
6. Audit N-API Buffer copies
7. Native persistent Signal/Group state
8. Native allocator profiling
9. Benchmark ulang seluruh suite
10. Tuning akhir berdasarkan data
```

## Definition of Done

```text
[ ] Runtime redundant hilang
[ ] Thread count lebih rasional
[ ] Queue memiliki backpressure/lifecycle jelas
[ ] FrameBuffer tidak mempertahankan capacity abnormal
[ ] Hot-path Buffer copy berkurang
[ ] Group/Session state tidak serialize setiap operasi jika tidak diperlukan
[ ] Disconnect benar-benar membersihkan task/state
[ ] RSS turun secara measurable
[ ] Tidak ada regression protocol/API
[ ] Benchmark crypto tetap kompetitif
[ ] Semua before/after tersimpan
```

## Catatan Hipotesis

Hipotesis kerja saat ini: tambahan RSS terutama berasal dari native/runtime layer, bukan V8 heap. Prioritas investigasi adalah multiple Tokio runtime, thread/task lifetime, unbounded queue, retained buffer capacity, N-API Buffer copies, lalu JSON state roundtrip. Semua hipotesis harus divalidasi lewat measurement/profiling sebelum dianggap sebagai penyebab.
