# 🗄️ Legacy JavaScript Implementation Archive

This directory contains the original pure-JavaScript reference implementations of modules that have been migrated to the native Rust engine (`rust/baileys-core` and `rust/baileys-napi`).

## Purpose & Usage
- **Parity Reference**: Used as the baseline ground truth during cross-interoperability tests and shadow-mode telemetry.
- **Rollback Safety**: Retained as emergency reference code.
- **Runtime Status**: These files are **NOT** loaded or executed in active runtime. All active socket and cryptographic operations execute directly via the Rust native bindings (`baileys-napi.node`).
