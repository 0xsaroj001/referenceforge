//! Original implementation of Telegraph's documented comparator ABI.
//! Inputs are fixed-point i64 values. Matches the pinned V2 reference's i64
//! saturation, using i128 only for the relative-error product. Refuses signed
//! difference/absolute-value overflow instead of inheriting release-mode wrap.
#![cfg_attr(target_arch = "wasm32", no_std)]

pub fn compare(truth: i64, miner: i64, code: i32, tolerance: i64) -> i64 {
    // The documented host excludes zero reference values. Refuse misuse.
    if truth == 0 {
        return -1;
    }
    if code != 1 && code != 2 {
        return if truth == miner { 10_000 } else { 0 };
    }
    let Some(difference) = miner.checked_sub(truth).and_then(i64::checked_abs) else { return -1; };
    let error = if code == 2 {
        let Some(denominator) = truth.checked_abs() else { return -1; };
        ((i128::from(difference) * 10_000) / i128::from(denominator.max(1)))
            .min(i128::from(i64::MAX)) as i64
    } else {
        difference
    };
    // The pinned reference applies a zero tolerance to the quantized error,
    // including RelTol's integer-bps truncation, rather than raw equality.
    if tolerance <= 0 { return if error == 0 { 10_000 } else { 0 }; }
    let window = tolerance.saturating_mul(2);
    if error >= window {
        return 0;
    }
    (window - error).saturating_mul(10_000) / window
}

#[cfg(target_arch = "wasm32")]
mod abi {
    use super::compare;
    use core::ptr;

    // The comparator contract allocates exactly one 16-byte comparison spec.
    // No general-purpose allocator, external state or host imports are needed.
    static mut SPEC: [u8; 16] = [0; 16];

    fn spec_address() -> *mut u8 {
        ptr::addr_of_mut!(SPEC).cast::<u8>()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn imw_alloc(size: i32) -> i32 {
        if size != 16 { return 0; }
        spec_address() as i32
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn imw_free(pointer: i32, size: i32) {
        if pointer == spec_address() as i32 && size == 16 {
            // Safe because the host calls are serial, and the range is static.
            unsafe { ptr::write_bytes(spec_address(), 0, 16); }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn imw_score_deterministic(truth: i64, miner: i64, pointer: i32) -> i64 {
        if pointer != spec_address() as i32 { return -1; }
        // The node supplies two little-endian i64 words. Only the low 32 bits
        // of the first word define the comparison code, as documented.
        let (code, tolerance) = unsafe {
            let p = spec_address();
            (i64::from_le(ptr::read_unaligned(p.cast::<i64>())) as i32,
             i64::from_le(ptr::read_unaligned(p.add(8).cast::<i64>())))
        };
        compare(truth, miner, code, tolerance)
    }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
        core::arch::wasm32::unreachable()
    }
}

#[cfg(test)]
mod tests {
    use super::compare;

    #[test]
    fn exact_and_pass_fail_do_not_accept_tolerance() {
        for code in [0, 3, -1, 99] {
            assert_eq!(compare(100, 100, code, 1000), 10_000);
            assert_eq!(compare(100, 101, code, 1000), 0);
        }
    }

    #[test]
    fn absolute_linear_band_and_boundary() {
        for delta in [-21_i64, -20, -10, 0, 10, 20, 21] {
            let expected = match delta.abs() { 0 => 10_000, 10 => 5_000, _ => 0 };
            assert_eq!(compare(-100, -100 + delta, 1, 10), expected);
        }
    }

    #[test]
    fn relative_error_uses_truth_and_wide_multiplication() {
        assert_eq!(compare(1_000_000_000_000_000_000, 1_010_000_000_000_000_000, 2, 100), 5_000);
        assert_eq!(compare(1_000_000_000_000_000_000, 1_020_000_000_000_000_000, 2, 100), 0);
        assert_eq!(compare(-1_000_000, -1_010_000, 2, 100), 5_000);
        assert_eq!(compare(10_000, 10_100, 2, 100), 5_000);
    }

    #[test]
    fn zero_negative_tolerance_and_invalid_truth() {
        assert_eq!(compare(10, 10, 1, 0), 10_000);
        assert_eq!(compare(10, 11, 2, -1), 0);
        assert_eq!(compare(0, 0, 0, 0), -1);
    }

    #[test]
    fn extreme_signed_inputs_refuse_overflow() {
        assert_eq!(compare(i64::MIN, i64::MAX, 1, i64::MAX), -1);
        assert_eq!(compare(i64::MIN, i64::MIN, 2, i64::MAX), -1);
        assert_eq!(compare(i64::MAX, i64::MIN, 2, 10_000), -1);
        assert_eq!(compare(i64::MIN, i64::MIN, 0, 0), 10_000);
    }

    #[test]
    fn i64_saturation_matches_pinned_reference_not_unbounded_formula() {
        assert_eq!(compare(100, 100, 1, i64::MAX), 1);
        assert_eq!(compare(1, i64::MAX, 2, 100), 0);
        assert_eq!(compare(1_000_000_000_000_000_000, 1_000_000_000_000_000_001, 2, 0), 10_000);
    }
}
