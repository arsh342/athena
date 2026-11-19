use std::slice;
fn f(p: *const u8, n: usize) -> &'static [u8] {
    unsafe { slice::from_raw_parts(p, n) } // EXPECT rust-unsafe-ffi.from-raw-parts
}
fn g() -> u32 {
    unsafe { std::mem::zeroed() } // EXPECT rust-unsafe-ffi.uninitialized-memory
}
