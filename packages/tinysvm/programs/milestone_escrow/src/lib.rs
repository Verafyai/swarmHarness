//! `milestone_escrow`: release one tranche per ruling that a milestone was met.
//!
//! Instruction `0 release`: milestone (u8), tranche count m (u8, 1 to 64), m
//! tranche amounts (u64), pot key, contractor key. Accounts: state (0),
//! transfer list (1). A milestone is released at most once.
//!
//! State (16 bytes): released bitmask, paid (u64).
#![cfg_attr(target_os = "solana", no_std)]

use abi::{err, get_u64, put_u64, write_transfers, Input, Reader};

/// The milestone was already released.
pub const ALREADY_RELEASED: u64 = 100;

pub fn release(state: &mut [u8], out: &mut [u8], milestone: u8, tranches: &[u64], pot: [u8; 32], to: [u8; 32]) -> Result<(), u64> {
    let m = tranches.len();
    if m == 0 || m > 64 {
        return Err(err::BAD_INPUT);
    }
    if milestone as usize >= m {
        return Err(err::OUT_OF_BOUNDS);
    }
    let mask = get_u64(state, 0)?;
    let paid = get_u64(state, 1)?;
    let bit = 1u64 << milestone;
    if mask & bit != 0 {
        return Err(ALREADY_RELEASED);
    }
    let t = tranches[milestone as usize];
    if t > i64::MAX as u64 {
        return Err(err::OVERFLOW);
    }
    write_transfers(out, &[(pot, -(t as i64)), (to, t as i64)])?;
    put_u64(state, 0, mask | bit)?;
    put_u64(state, 1, paid.checked_add(t).ok_or(err::OVERFLOW)?)
}

pub fn process(ix: &mut Input) -> Result<(), u64> {
    ix.expect(2)?;
    let mut r = Reader::new(ix.data);
    if r.u8()? != 0 {
        return Err(err::BAD_INPUT);
    }
    let milestone = r.u8()?;
    let m = r.u8()? as usize;
    if m == 0 || m > 64 {
        return Err(err::BAD_INPUT);
    }
    let mut tranches = [0u64; 64];
    for t in tranches.iter_mut().take(m) {
        *t = r.u64()?;
    }
    let pot = r.key()?;
    let to = r.key()?;
    r.end()?;
    let state = ix.take_owned(0)?;
    let out = ix.take_owned(1)?;
    release(state, out, milestone, &tranches[..m], pot, to)
}

abi::entrypoint!(process);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_milestone_releases_once() {
        let mut st = [0u8; 16];
        let mut out = [0u8; abi::TRANSFERS_ACCOUNT];
        let tr = [100, 200, 300];
        release(&mut st, &mut out, 1, &tr, [1; 32], [2; 32]).unwrap();
        assert_eq!(release(&mut st, &mut out, 1, &tr, [1; 32], [2; 32]), Err(ALREADY_RELEASED));
        assert_eq!(release(&mut st, &mut out, 3, &tr, [1; 32], [2; 32]), Err(err::OUT_OF_BOUNDS));
        release(&mut st, &mut out, 0, &tr, [1; 32], [2; 32]).unwrap();
        assert_eq!([get_u64(&st, 0).unwrap(), get_u64(&st, 1).unwrap()], [0b11, 300]);
    }
}
