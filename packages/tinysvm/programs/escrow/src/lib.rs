//! `escrow`: hold, split and release a contract's escrow in an existing token.
//!
//! Instructions (first byte is the tag):
//!
//! * `0 jury`: the jury pay rule `runtime.js` runs in `buildDiff`. Data: escrow,
//!   juror, auditor and storage shares as f64, the counted vote count (u32),
//!   passed (u8) and the `pay` effect amount (f64, 0 for none). Writes eight i64
//!   deltas in micro-units into account 0: each counted vote, auditors, storage,
//!   sealer, the escrow pool, the escalation carry, and the pay effect's debit
//!   and credit (converted separately, as runtime.js's diff converts them).
//! * `1 hold`: put `amount` (u64 base units) of the pot named by `key` into the
//!   escrow state, account 0.
//! * `2 release`: release what an exit program's transfer list (account 1, read
//!   only) takes from the pot, against the escrow state (account 0).
//!
//! The jury rule is specified in IEEE-754 doubles, rounded to 1e-6 the way
//! `runtime.js` rounds (JavaScript `Math.round`). This program reproduces that
//! arithmetic bit for bit, then converts every delta to integer micro-units and
//! checks that they sum to exactly zero. An exact-integer split would disagree
//! with `runtime.js` on some rulings (see packages/tinysvm/README.md), and
//! disagreement is a fault, so the integer form waits for `runtime.js` to move.
//!
//! Escrow state (account 0, 48 bytes): held u64, released u64, pot key [32].
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, get_u64, put_u64, Input, Reader, Writer};

/// The release takes more than the escrow holds.
pub const INSUFFICIENT: u64 = 100;
/// The transfer list or the hold names a different pot than the escrow holds.
pub const WRONG_POT: u64 = 101;

/// |x|, without libm (core has no f64::abs on the platform-tools compiler).
fn fabs(x: f64) -> f64 {
    f64::from_bits(x.to_bits() & !(1u64 << 63))
}

/// JavaScript `Math.round`: the nearest integer, ties toward positive infinity.
pub fn round_js(x: f64) -> f64 {
    // At or above 2^52 every double is already an integer (and NaN stays NaN).
    if !(fabs(x) < 4_503_599_627_370_496.0) {
        return x;
    }
    let t = (x as i64) as f64; // truncates toward zero
    let f = x - t; // exact
    if f >= 0.5 {
        t + 1.0
    } else if f < -0.5 {
        t - 1.0
    } else {
        t
    }
}

/// `round` in runtime.js: Math.round(x * 1e6) / 1e6.
pub fn round6(x: f64) -> f64 {
    round_js(x * 1e6) / 1e6
}

/// A decimal amount as integer micro-units, the way the cross-runtime check converts it.
pub fn micro(x: f64) -> Result<i64, u64> {
    let m = round_js(x * 1e6);
    if !(fabs(m) < 9.0e15) {
        return Err(err::OVERFLOW);
    }
    Ok(m as i64)
}

/// The jury pay rule. Returns [each, auditors, storage, sealer, pool, carry, pay debit, pay credit] in micro-units.
pub fn jury(escrow: f64, jurors: f64, auditors: f64, storage: f64, n: u32, passed: bool, pay: f64) -> Result<[i64; 8], u64> {
    if !(escrow > 0.0) || !(escrow.is_finite()) || !pay.is_finite() || pay < 0.0 {
        return Err(err::OUT_OF_BOUNDS);
    }
    for s in [jurors, auditors, storage] {
        if !(s >= 0.0 && s <= 1.0) {
            return Err(err::OUT_OF_BOUNDS);
        }
    }
    let mut out = [0i64; 8];
    if !passed {
        out[4] = micro(-escrow)?;
        out[5] = micro(escrow)?;
        if out[4] + out[5] != 0 {
            return Err(err::NOT_CONSERVED);
        }
        return Ok(out);
    }
    let juror_share = round6(escrow * jurors);
    let each = if n > 0 { round6(juror_share / n as f64) } else { 0.0 };
    let paid_jurors = round6(each * n as f64);
    let aud = round6(escrow * auditors);
    let sto = round6(escrow * storage);
    let sealer = round6(escrow - paid_jurors - round6(escrow * auditors) - round6(escrow * storage));
    out[0] = micro(each)?;
    out[1] = micro(aud)?;
    out[2] = micro(sto)?;
    out[3] = micro(sealer)?;
    out[4] = micro(-escrow)?;
    out[6] = micro(-pay)?;
    out[7] = micro(pay)?;
    let sum = (out[0] as i128) * (n as i128) + out[1] as i128 + out[2] as i128 + out[3] as i128 + out[4] as i128;
    if sum != 0 {
        return Err(err::NOT_CONSERVED);
    }
    Ok(out)
}

/// Put `amount` of the pot `key` into the escrow state.
pub fn hold(state: &mut [u8], key: &[u8; 32], amount: u64) -> Result<(), u64> {
    if state.len() < 48 {
        return Err(err::SMALL_ACCOUNT);
    }
    let held = get_u64(state, 0)?;
    let pot = &mut state[16..48];
    if pot.iter().all(|b| *b == 0) {
        pot.copy_from_slice(key);
    } else if pot != key {
        return Err(WRONG_POT);
    }
    put_u64(state, 0, held.checked_add(amount).ok_or(err::OVERFLOW)?)
}

/// Release what a transfer list takes from the pot.
pub fn release(state: &mut [u8], transfers: &[u8]) -> Result<(), u64> {
    if state.len() < 48 {
        return Err(err::SMALL_ACCOUNT);
    }
    let mut r = Reader::new(transfers);
    let count = r.u32()? as usize;
    if count > abi::MAX_TRANSFERS {
        return Err(err::BAD_INPUT);
    }
    let mut sum: i128 = 0;
    let mut taken: u64 = 0;
    for _ in 0..count {
        let k = r.key()?;
        let d = r.i64()?;
        sum += d as i128;
        if d < 0 {
            if k[..] != state[16..48] {
                return Err(WRONG_POT);
            }
            taken = taken.checked_add(d.unsigned_abs()).ok_or(err::OVERFLOW)?;
        }
    }
    if sum != 0 {
        return Err(err::NOT_CONSERVED);
    }
    let held = get_u64(state, 0)?;
    if taken > held {
        return Err(INSUFFICIENT);
    }
    let released = get_u64(state, 1)?;
    put_u64(state, 0, held - taken)?;
    put_u64(state, 1, released.checked_add(taken).ok_or(err::OVERFLOW)?)
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    let mut r = Reader::new(ix.data);
    match r.u8()? {
        0 => {
            ix.expect(1)?;
            let (e, j, a, s) = (r.f64()?, r.f64()?, r.f64()?, r.f64()?);
            let n = r.u32()?;
            let passed = match r.u8()? { 0 => false, 1 => true, _ => return Err(err::BAD_INPUT) };
            let pay = r.f64()?;
            r.end()?;
            let out = jury(e, j, a, s, n, passed, pay)?;
            let mut w = Writer::new(ix.take_owned(0)?);
            for d in out {
                w.i64(d)?;
            }
            w.finish();
            Ok(())
        }
        1 => {
            ix.expect(1)?;
            let key = r.key()?;
            let amount = r.u64()?;
            r.end()?;
            hold(ix.take_owned(0)?, &key, amount)
        }
        2 => {
            ix.expect(2)?;
            r.end()?;
            let state = ix.take_owned(0)?;
            let transfers = ix.take_read(1)?;
            release(state, transfers)
        }
        _ => Err(err::BAD_INPUT),
    }
}

abi::entrypoint!(process);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_js_matches_javascript() {
        assert_eq!(round_js(2.5), 3.0);
        assert_eq!(round_js(-2.5), -2.0);
        assert_eq!(round_js(-2.6), -3.0);
        assert_eq!(round_js(0.49999999999999994), 0.0);
        assert_eq!(round_js(68570.99999999999), 68571.0);
    }

    #[test]
    fn jury_split_conserves_and_matches_the_delay_cover_example() {
        // escrow 0.6, split 0.8 / 0.1 / 0.05 / 0.05, five counted votes
        let out = jury(0.6, 0.8, 0.1, 0.05, 5, true, 0.0).unwrap();
        assert_eq!(out, [96000, 60000, 30000, 30000, -600000, 0, 0, 0]);
        let below = jury(0.6, 0.8, 0.1, 0.05, 5, false, 0.0).unwrap();
        assert_eq!(below, [0, 0, 0, 0, -600000, 600000, 0, 0]);
    }

    #[test]
    fn release_never_takes_more_than_is_held() {
        let mut st = [0u8; 48];
        let pot = [7u8; 32];
        hold(&mut st, &pot, 100).unwrap();
        let mut list = [0u8; abi::TRANSFERS_ACCOUNT];
        abi::write_transfers(&mut list, &[(pot, -150), ([1u8; 32], 150)]).unwrap();
        assert_eq!(release(&mut st, &list), Err(INSUFFICIENT));
        abi::write_transfers(&mut list, &[(pot, -60), ([1u8; 32], 60)]).unwrap();
        release(&mut st, &list).unwrap();
        assert_eq!((get_u64(&st, 0).unwrap(), get_u64(&st, 1).unwrap()), (40, 60));
        assert_eq!(hold(&mut st, &[9u8; 32], 1), Err(WRONG_POT));
    }
}
