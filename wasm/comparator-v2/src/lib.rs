//! Original bounded-allocation implementation of the documented comparator ABI.
//! Preserves registered v1 arithmetic; adds isolated live spec allocations.
#![cfg_attr(target_arch = "wasm32", no_std)]

pub fn compare(truth: i64, miner: i64, code: i32, tolerance: i64) -> i64 {
    if truth == 0 { return -1; }
    if code != 1 && code != 2 { return if truth == miner { 10_000 } else { 0 }; }
    let Some(difference) = miner.checked_sub(truth).and_then(i64::checked_abs) else { return -1; };
    let error = if code == 2 {
        let Some(denominator) = truth.checked_abs() else { return -1; };
        ((i128::from(difference) * 10_000) / i128::from(denominator.max(1))).min(i128::from(i64::MAX)) as i64
    } else { difference };
    if tolerance <= 0 { return if error == 0 { 10_000 } else { 0 }; }
    let window = tolerance.saturating_mul(2);
    if error >= window { return 0; }
    (window - error).saturating_mul(10_000) / window
}

#[cfg(target_arch = "wasm32")]
mod abi {
    use super::compare;
    use core::ptr;

    const SLOTS: usize = 32;
    const SIZE: usize = 16;
    #[repr(align(8))]
    struct Arena([u8; SLOTS * SIZE]);
    static mut ARENA: Arena = Arena([0; SLOTS * SIZE]);
    static mut LIVE: u32 = 0;

    fn base() -> *mut u8 { ptr::addr_of_mut!(ARENA).cast::<u8>() }
    fn index(pointer: i32) -> Option<usize> {
        if pointer <= 0 { return None; }
        let start = base() as usize;
        let offset = (pointer as usize).checked_sub(start)?;
        if offset >= SLOTS * SIZE || offset % SIZE != 0 { return None; }
        Some(offset / SIZE)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn imw_alloc(size: i32) -> i32 {
        if size != SIZE as i32 { return 0; }
        // One WASM instance is serial. Request isolation is owned by the executor.
        unsafe {
            for slot in 0..SLOTS {
                let bit = 1_u32 << slot;
                if LIVE & bit == 0 {
                    let p = base().add(slot * SIZE);
                    ptr::write_bytes(p, 0, SIZE);
                    LIVE |= bit;
                    return p as i32;
                }
            }
        }
        0
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn imw_free(pointer: i32, size: i32) {
        if size != SIZE as i32 { return; }
        let Some(slot) = index(pointer) else { return; };
        unsafe {
            let bit = 1_u32 << slot;
            if LIVE & bit != 0 {
                ptr::write_bytes(base().add(slot * SIZE), 0, SIZE);
                LIVE &= !bit;
            }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn imw_score_deterministic(truth: i64, miner: i64, pointer: i32) -> i64 {
        let Some(slot) = index(pointer) else { return -1; };
        unsafe {
            if LIVE & (1_u32 << slot) == 0 { return -1; }
            let p = base().add(slot * SIZE);
            let code = i64::from_le(ptr::read_unaligned(p.cast::<i64>())) as i32;
            let tolerance = i64::from_le(ptr::read_unaligned(p.add(8).cast::<i64>()));
            compare(truth, miner, code, tolerance)
        }
    }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }
}

#[cfg(test)]
mod tests {
    use super::compare;
    #[test]
    fn preserves_saturation_and_overflow_refusal() {
        assert_eq!(compare(100, 100, 1, i64::MAX), 1);
        assert_eq!(compare(i64::MIN, i64::MAX, 1, 1), -1);
        assert_eq!(compare(i64::MIN, i64::MIN, 2, 100), -1);
        assert_eq!(compare(0, 0, 0, 0), -1);
    }
    #[test]
    fn native_scale_relative_error_and_exact_rules() {
        assert_eq!(compare(1_000_000_000_000_000_000, 1_010_000_000_000_000_000, 2, 100), 5_000);
        assert_eq!(compare(100, 101, 99, 100), 0);
        assert_eq!(compare(-100, -110, 1, 10), 5_000);
    }
}
